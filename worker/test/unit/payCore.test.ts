import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import {
  appendPayLedger, creditDeposit, payBalanceMicro, payHistory, verifyPayLedger,
} from '../../src/pay/ledger';
import { applyDeposits, scanAddress, scanAll } from '../../src/pay/monitor';
import { catalogForClient, entitlements, purchase, ShopError } from '../../src/pay/shop';
import {
  addPoolIncome, availableMicro, closeCycle, ensureOpenCycle, reservePayout, usdtPoolBlock,
} from '../../src/pay/pool';
import { hexToBase58 } from '../../src/pay/tron/address';

// Этапы 5–8: монитор → депозит → журнал → магазин → пул USDT.
// Всё проверяется на настоящем SQLite через D1-заглушку: гарантии живут в схеме.

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ALICE = hexToBase58('41' + '11'.repeat(20));
const BOB = hexToBase58('41' + '22'.repeat(20));
const TX = (n: string) => n.repeat(64).slice(0, 64);
const T0 = 1_700_000_000_000;

async function freshDb() {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  return db;
}

async function addAddress(db: D1Database, userId: string, address: string, index: number) {
  await db.prepare(
    `INSERT INTO pay_addresses (id, user_id, address, hex, derivation_index, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(`ad_${index}`, userId, address, `41${String(index).padStart(40, '0')}`, index, T0).run();
}

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    transaction_id: TX('a'),
    token_info: { address: USDT, decimals: 6, symbol: 'USDT' },
    block_timestamp: T0,
    from: BOB,
    to: ALICE,
    type: 'Transfer',
    value: '2500000',
    ...overrides,
  };
}

describe('журнал денег (этап 6)', () => {
  it('депозит зачисляется ровно один раз', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', ALICE, 0);
    const first = await creditDeposit(db, {
      txid: TX('a'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 2_500_000,
    }, T0);
    expect(first).toMatchObject({ credited: true, duplicated: false, balanceMicro: 2_500_000 });

    const second = await creditDeposit(db, {
      txid: TX('a'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 2_500_000,
    }, T0 + 1000);
    expect(second).toMatchObject({ credited: false, duplicated: true, balanceMicro: 2_500_000 });

    const rows = await db.prepare('SELECT COUNT(*) AS c FROM pay_ledger').first<number>('c');
    expect(Number(rows)).toBe(1);
    expect(await payBalanceMicro(db, 'u1')).toBe(2_500_000);
  });

  it('разные события складываются, чужой игрок не задет', async () => {
    const db = await freshDb();
    await creditDeposit(db, { txid: TX('a'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 1_000_000 }, T0);
    await creditDeposit(db, { txid: TX('a'), eventIndex: 1, userId: 'u1', address: ALICE, amountMicro: 500_000 }, T0);
    expect(await payBalanceMicro(db, 'u1')).toBe(1_500_000);
    expect(await payBalanceMicro(db, 'u2')).toBe(0);
  });

  it('нулевая и отрицательная сумма в журнал не попадают', async () => {
    const db = await freshDb();
    await expect(creditDeposit(db, {
      txid: TX('a'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 0,
    }, T0)).rejects.toThrow(/bad_amount/);
    await expect(appendPayLedger(db, {
      userId: 'u1', delta: 0, reason: 'adjust', idemKey: 'k1', createdAt: T0,
    })).rejects.toThrow(/bad_delta/);
  });

  it('хеш-цепочка проверяется, а подмена строки видна', async () => {
    const db = await freshDb();
    await creditDeposit(db, { txid: TX('a'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 1_000_000 }, T0);
    await creditDeposit(db, { txid: TX('b'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 2_000_000 }, T0 + 1);

    const clean = await verifyPayLedger(db);
    expect(clean.ok).toBe(true);
    expect(clean.rows).toBe(2);

    // Обходим append-only единственным способом: снимаем триггер как «злой админ».
    const raw = makeD1Raw(db);
    raw.exec('DROP TRIGGER pay_ledger_no_update');
    raw.exec("UPDATE pay_ledger SET delta = 999999999 WHERE rowid = 1");

    const broken = await verifyPayLedger(db);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).not.toBeNull();
  });

  it('повтор операции с тем же ключом не создаёт вторую запись', async () => {
    const db = await freshDb();
    const first = await appendPayLedger(db, {
      userId: 'u1', delta: 1_000_000, reason: 'adjust', idemKey: 'adj:1', createdAt: T0,
    });
    const second = await appendPayLedger(db, {
      userId: 'u1', delta: 1_000_000, reason: 'adjust', idemKey: 'adj:1', createdAt: T0,
    });
    expect(first.duplicated).toBe(false);
    expect(second.duplicated).toBe(true);
    expect(second.hash).toBe(first.hash);
    expect(await payBalanceMicro(db, 'u1')).toBe(1_000_000);
  });

  it('история для кабинета показывает суммы в USDT', async () => {
    const db = await freshDb();
    await creditDeposit(db, { txid: TX('a'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 1_500_000 }, T0);
    const history = await payHistory(db, 'u1');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ delta: 1_500_000, amount: '1.50', reason: 'deposit' });
  });
});

describe('монитор (этап 5)', () => {
  const deps = (rows: unknown[], calls: string[] = []) => ({
    contracts: [USDT],
    fetchJson: async (url: string) => {
      calls.push(url);
      return { data: rows };
    },
  });

  it('находит перевод, сохраняет событие и двигает курсор', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', ALICE, 0);
    const calls: string[] = [];
    const result = await scanAddress(db, deps([transfer()], calls), ALICE, T0 + 5000);

    expect(result).toMatchObject({ fetched: 1, stored: 1, duplicates: 0, rejected: 0, error: null });
    expect(result.nextCursor).toBe(T0);
    expect(calls[0]).toContain('only_confirmed=true');
    expect(calls[0]).toContain(encodeURIComponent(ALICE));

    const cursor = await db.prepare('SELECT last_scanned_ts FROM pay_addresses WHERE user_id = ?')
      .bind('u1').first<number>('last_scanned_ts');
    expect(Number(cursor)).toBe(T0);
  });

  it('повторный опрос не создаёт дубль', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', ALICE, 0);
    await scanAddress(db, deps([transfer()]), ALICE, T0);
    const again = await scanAddress(db, deps([transfer()]), ALICE, T0 + 60_000);
    expect(again.stored).toBe(0);
    expect(again.duplicates).toBe(1);
    const count = await db.prepare('SELECT COUNT(*) AS c FROM pay_chain_events').first<number>('c');
    expect(Number(count)).toBe(1);
  });

  it('чужой контракт и перевод не на наш адрес не сохраняются', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', ALICE, 0);
    const other = transfer({ token_info: { address: 'TXYZ', decimals: 6 } });
    const elsewhere = transfer({ transaction_id: TX('c'), to: BOB });
    const result = await scanAddress(db, deps([other, elsewhere]), ALICE, T0);
    expect(result.stored).toBe(0);
    expect(result.rejected).toBe(1); // чужой контракт отброшен разбором
  });

  it('ошибка сети не двигает курсор и не роняет cron', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', ALICE, 0);
    const result = await scanAddress(db, {
      contracts: [USDT],
      fetchJson: async () => { throw new Error('429'); },
    }, ALICE, T0);
    expect(result.error).toContain('429');
    expect(result.nextCursor).toBe(0);
  });

  it('обход адресов возвращает сводку без падения на одном адресе', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', ALICE, 0);
    await addAddress(db, 'u2', BOB, 1);
    let n = 0;
    const summary = await scanAll(db, {
      contracts: [USDT],
      fetchJson: async () => {
        n += 1;
        if (n === 1) throw new Error('timeout');
        return { data: [] };
      },
    }, T0);
    expect(summary.addresses).toBe(2);
    expect(summary.errors).toHaveLength(1);
  });

  it('события превращаются в деньги, незнакомый адрес пропускается', async () => {
    const db = await freshDb();
    await addAddress(db, 'u1', ALICE, 0);
    await scanAddress(db, deps([transfer({ to: ALICE })]), ALICE, T0);

    // Событие на чужой адрес: владельца нет — зачислять некому.
    await db.prepare(
      `INSERT INTO pay_chain_events (txid, event_index, block_height, block_time, from_addr, to_addr, contract, amount_micro, created_at)
       VALUES (?, 0, 1, ?, ?, ?, ?, 700000, ?)`,
    ).bind(TX('d'), T0, BOB, 'TUnknownAddressWithoutOwner1', USDT, T0).run();

    const applied = await applyDeposits(db, T0 + 1000);
    expect(applied.processed).toBe(2);
    expect(applied.credited).toBe(1);
    expect(applied.unknownAddress).toBe(1);
    expect(await payBalanceMicro(db, 'u1')).toBe(2_500_000);

    const again = await applyDeposits(db, T0 + 2000);
    expect(again.processed).toBe(0);
    expect(await payBalanceMicro(db, 'u1')).toBe(2_500_000);
  });
});

describe('магазин (этап 7)', () => {
  async function funded(amount = 10_000_000) {
    const db = await freshDb();
    await creditDeposit(db, { txid: TX('a'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: amount }, T0);
    return db;
  }

  it('каталог отдаёт цены строкой и не показывает выключенные товары', () => {
    const catalog = catalogForClient();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((p) => p.enabled)).toBe(true);
    expect(catalog.some((p) => p.id === 'pass_premium_slot')).toBe(false);
    expect(catalog[0].price).toMatch(/^\d+\.\d{2}$/);
  });

  it('покупка списывает деньги и выдаёт товар ровно один раз', async () => {
    const db = await funded();
    const first = await purchase(db, { userId: 'u1', productId: 'skin_nebula', idemKey: 'order-0001' }, T0);
    expect(first).toMatchObject({ priceMicro: 2_000_000, balanceMicro: 8_000_000, duplicated: false });

    const second = await purchase(db, { userId: 'u1', productId: 'skin_nebula', idemKey: 'order-0001' }, T0 + 1);
    expect(second.duplicated).toBe(true);
    expect(second.balanceMicro).toBe(8_000_000);

    const rows = await db.prepare('SELECT COUNT(*) AS c FROM pay_ledger').first<number>('c');
    expect(Number(rows)).toBe(2); // депозит + покупка

    const granted = await entitlements(db, 'u1');
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({ productId: 'skin_nebula', cosmetic: 'skin:nebula' });
  });

  it('без денег купить нельзя, баланс не уходит в минус', async () => {
    const db = await freshDb();
    await expect(purchase(db, { userId: 'u1', productId: 'skin_nebula', idemKey: 'order-0002' }, T0))
      .rejects.toThrow(ShopError);
    expect(await payBalanceMicro(db, 'u1')).toBe(0);
  });

  it('ровно хватает — покупка проходит, лишнего не остаётся', async () => {
    const db = await funded(2_000_000);
    const result = await purchase(db, { userId: 'u1', productId: 'skin_ember', idemKey: 'order-0003' }, T0);
    expect(result.balanceMicro).toBe(0);
    expect(await entitlements(db, 'u1')).toHaveLength(1);
  });

  it('неизвестный, выключенный товар и кривой ключ отвергаются', async () => {
    const db = await funded();
    await expect(purchase(db, { userId: 'u1', productId: 'nope', idemKey: 'order-0004' }, T0))
      .rejects.toThrow(/unknown_product/);
    await expect(purchase(db, { userId: 'u1', productId: 'pass_premium_slot', idemKey: 'order-0005' }, T0))
      .rejects.toThrow(/unknown_product/);
    await expect(purchase(db, { userId: 'u1', productId: 'skin_nebula', idemKey: 'short' }, T0))
      .rejects.toThrow(/bad_idem_key/);
  });
});

describe('пул USDT (этап 8)', () => {
  it('Available = Confirmed − Reserved − Paid − Locked', () => {
    expect(availableMicro({ confirmed_in: 10_000_000, reserved: 2_000_000, paid: 1_000_000, locked: 500_000 }))
      .toBe(6_500_000);
  });

  it('открытый цикл один, при закрытии остаток переносится', async () => {
    const db = await freshDb();
    const cycle = await ensureOpenCycle(db, T0);
    expect(cycle.status).toBe('open');
    expect((await ensureOpenCycle(db, T0 + 1)).id).toBe(cycle.id);

    await addPoolIncome(db, 5_000_000);
    expect((await reservePayout(db, 2_000_000))).toBe(true);
    expect((await reservePayout(db, 99_000_000))).toBe(false); // больше, чем есть

    const closed = await closeCycle(db, T0 + 2);
    expect(closed?.availableMicro).toBe(3_000_000);

    const next = await ensureOpenCycle(db, T0 + 3);
    expect(next.id).not.toBe(cycle.id);
    expect(next.confirmed_in).toBe(3_000_000); // остаток не исчез
  });

  it('публичный блок считает и показывает дефицит', async () => {
    const db = await freshDb();
    const empty = await usdtPoolBlock(db, T0);
    expect(empty).toMatchObject({ open: false, available: 0, status: 'no_cycle' });

    await ensureOpenCycle(db, T0);
    await addPoolIncome(db, 1_000_000);
    const block = await usdtPoolBlock(db, T0 + 1);
    expect(block).toMatchObject({ open: true, available: 1_000_000, availableText: '1.00', status: 'ok' });

    // Дефицит: выплатили больше, чем было — статус обязан это показать.
    const cycle = await ensureOpenCycle(db, T0);
    await db.prepare('UPDATE pay_pool_cycles SET paid = ? WHERE id = ?').bind(4_000_000, cycle.id).run();
    const deficit = await usdtPoolBlock(db, T0 + 2);
    expect(deficit.status).toBe('deficit');
    expect(deficit.available).toBe(-3_000_000);
  });
});

/** Сырой SQLite из заглушки: нужен только тесту на подмену журнала. */
function makeD1Raw(db: D1Database) {
  const raw = (db as unknown as { __raw?: { exec: (sql: string) => void } }).__raw;
  if (!raw) throw new Error('raw недоступен');
  return raw;
}
