import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { appendPayLedger, creditDeposit, payBalanceMicro } from '../../src/pay/ledger';
import {
  DAILY_LIMIT_MICRO, MIN_WITHDRAW_MICRO, PayoutError, approveWithdrawal, confirmWithdrawal,
  failWithdrawal, legacyWithdrawalIdemKey, requestWithdrawal, reserveWithdrawal, markBroadcast, markSent,
  withdrawalIdemKey, withdrawalQueue,
} from '../../src/pay/payouts';
import { isPayoutsStopped, reconcile, reconcileAndFlag, setPayoutsStop } from '../../src/pay/reconcile';
import { hexToBase58 } from '../../src/pay/tron/address';

// Этапы 10–11: выплаты и сверка. Здесь проверяется то, из-за чего люди теряют
// деньги: двойная выплата, выплата без резерва, «зависший» возврат и тихое
// расхождение в учёте.

const ALICE = hexToBase58('41' + '11'.repeat(20));
const BOB_ADDR = hexToBase58('41' + '22'.repeat(20));
const TX = (n: string) => n.repeat(64).slice(0, 64);
const T0 = 1_700_000_000_000;

async function freshDb() {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  return db;
}

async function funded(micro: number, userId = 'u1') {
  const db = await freshDb();
  await creditDeposit(db, {
    txid: TX('a'), eventIndex: 0, userId, address: ALICE, amountMicro: micro,
  }, T0);
  return db;
}

describe('заявка на выплату', () => {
  it('проверяет адрес, сумму, лимиты и баланс', async () => {
    const db = await freshDb();
    await expect(requestWithdrawal(db, { userId: 'u1', address: 'bad', amountMicro: 6_000_000, idemKey: 'order-0001' }, T0))
      .rejects.toThrow(/bad_address/);
    await expect(requestWithdrawal(db, { userId: 'u1', address: ALICE, amountMicro: MIN_WITHDRAW_MICRO - 1, idemKey: 'order-0002' }, T0))
      .rejects.toThrow(/below_minimum/);
    await expect(requestWithdrawal(db, { userId: 'u1', address: ALICE, amountMicro: 6_000_000_000, idemKey: 'order-0003' }, T0))
      .rejects.toThrow(/above_maximum/);
    await expect(requestWithdrawal(db, { userId: 'u1', address: ALICE, amountMicro: 6_000_000, idemKey: 'short' }, T0))
      .rejects.toThrow(/bad_idem_key/);
    await expect(requestWithdrawal(db, { userId: 'u1', address: ALICE, amountMicro: 6_000_000, idemKey: 'order-0004' }, T0))
      .rejects.toThrow(/insufficient_funds/);
  });

  it('повтор с тем же ключом не создаёт вторую заявку', async () => {
    const db = await funded(10_000_000);
    const first = await requestWithdrawal(db, { userId: 'u1', address: BOB_ADDR, amountMicro: 6_000_000, idemKey: 'order-0005' }, T0);
    const second = await requestWithdrawal(db, { userId: 'u1', address: BOB_ADDR, amountMicro: 6_000_000, idemKey: 'order-0005' }, T0 + 1);
    expect(first.duplicated).toBe(false);
    expect(second.duplicated).toBe(true);
    const count = await db.prepare('SELECT COUNT(*) AS c FROM pay_withdrawals').first<number>('c');
    expect(Number(count)).toBe(1);
  });

  it('заявка не двигает деньги, резерв — двигает', async () => {
    const db = await funded(10_000_000);
    const { withdrawal } = await requestWithdrawal(db, {
      userId: 'u1', address: BOB_ADDR, amountMicro: 6_000_000, idemKey: 'order-0006',
    }, T0);
    expect(withdrawal.status).toBe('requested');
    expect(await payBalanceMicro(db, 'u1')).toBe(10_000_000);

    await approveWithdrawal(db, withdrawal.id, T0 + 1);
    const reserved = await reserveWithdrawal(db, withdrawal.id, T0 + 2);
    expect(reserved.status).toBe('reserved');
    expect(await payBalanceMicro(db, 'u1')).toBe(4_000_000);

    // Повторный резерв — уже нечего: состояние сменилось.
    await expect(reserveWithdrawal(db, withdrawal.id, T0 + 3)).rejects.toThrow(PayoutError);
    expect(await payBalanceMicro(db, 'u1')).toBe(4_000_000);
  });

  it('нельзя перескочить состояние', async () => {
    const db = await funded(10_000_000);
    const { withdrawal } = await requestWithdrawal(db, {
      userId: 'u1', address: BOB_ADDR, amountMicro: 6_000_000, idemKey: 'order-0007',
    }, T0);
    // Отправка возможна только из `broadcasting`: состояние проверяется до записи.
    await expect(markSent(db, withdrawal.id, TX('b'), T0)).rejects.toThrow(/bad_transition|status_changed/);
    await expect(confirmWithdrawal(db, withdrawal.id, T0)).rejects.toThrow(/status_changed/);
  });

  it('отправка, подтверждение и txid', async () => {
    const db = await funded(10_000_000);
    const { withdrawal } = await requestWithdrawal(db, {
      userId: 'u1', address: BOB_ADDR, amountMicro: 6_000_000, idemKey: 'order-0008',
    }, T0);
    await approveWithdrawal(db, withdrawal.id, T0 + 1);
    await reserveWithdrawal(db, withdrawal.id, T0 + 2);

    const broadcast = await markBroadcast(db, withdrawal.id, { txid: TX('b'), attempt: 1 }, T0 + 3);
    expect(broadcast.status).toBe('broadcasting');
    expect(broadcast.txid).toBe(TX('b'));

    const sent = await markSent(db, withdrawal.id, TX('b'), T0 + 4);
    expect(sent.status).toBe('sent');
    const confirmed = await confirmWithdrawal(db, withdrawal.id, T0 + 5);
    expect(confirmed.status).toBe('confirmed');
    expect(await withdrawalQueue(db)).toHaveLength(0);
  });

  it('провал после резерва возвращает деньги ровно один раз', async () => {
    const db = await funded(10_000_000);
    const { withdrawal } = await requestWithdrawal(db, {
      userId: 'u1', address: BOB_ADDR, amountMicro: 6_000_000, idemKey: 'order-0009',
    }, T0);
    await approveWithdrawal(db, withdrawal.id, T0 + 1);
    await reserveWithdrawal(db, withdrawal.id, T0 + 2);
    expect(await payBalanceMicro(db, 'u1')).toBe(4_000_000);

    const failed = await failWithdrawal(db, withdrawal.id, 'сеть отказала', T0 + 3);
    expect(failed.status).toBe('failed');
    expect(await payBalanceMicro(db, 'u1')).toBe(10_000_000);

    await expect(failWithdrawal(db, withdrawal.id, 'ещё раз', T0 + 4)).rejects.toThrow(/bad_transition/);
    expect(await payBalanceMicro(db, 'u1')).toBe(10_000_000);
  });

  it('суточный лимит не даёт вывести всё за один день', async () => {
    const db = await freshDb();
    const maxPerRequest = 5_000_000_000;
    await appendPayLedger(db, {
      userId: 'u1', delta: DAILY_LIMIT_MICRO + 10_000_000, reason: 'adjust', idemKey: 'adj-limit', createdAt: T0,
    });
    // Четыре заявки по максимуму ровно выбирают суточный лимит.
    for (let i = 0; i < DAILY_LIMIT_MICRO / maxPerRequest; i += 1) {
      await requestWithdrawal(db, {
        userId: 'u1', address: BOB_ADDR, amountMicro: maxPerRequest, idemKey: `order-1${i}00`,
      }, T0 + 10 + i);
    }
    await expect(requestWithdrawal(db, {
      userId: 'u1', address: BOB_ADDR, amountMicro: MIN_WITHDRAW_MICRO, idemKey: 'order-1900',
    }, T0 + 20)).rejects.toThrow(/daily_limit/);
  });
});

describe('сверка (этап 11)', () => {
  it('чистый учёт сводится без замечаний', async () => {
    const db = await funded(10_000_000);
    const { withdrawal } = await requestWithdrawal(db, {
      userId: 'u1', address: BOB_ADDR, amountMicro: 6_000_000, idemKey: 'order-0012',
    }, T0);
    await approveWithdrawal(db, withdrawal.id, T0 + 1);
    await reserveWithdrawal(db, withdrawal.id, T0 + 2);

    const report = await reconcile(db, T0 + 3);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.totals.depositsMicro).toBe(10_000_000);
    expect(report.totals.payoutsMicro).toBe(6_000_000);
    expect(report.totals.reservedWithdrawalsMicro).toBe(6_000_000);
  });

  it('выплата без заявки видна и сама поднимает стоп-флаг', async () => {
    const db = await funded(10_000_000);
    // «Кто-то» списал деньги мимо заявок — так выглядит ошибка кода или взлом.
    await appendPayLedger(db, {
      userId: 'u1', delta: -1_000_000, reason: 'payout', idemKey: 'ghost', createdAt: T0 + 1,
    });

    const report = await reconcile(db, T0 + 2);
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain('payouts_vs_withdrawals');
    expect(report.stop).toBe(false);

    const flagged = await reconcileAndFlag(db, T0 + 3);
    expect(flagged.stop).toBe(true);
    expect(await isPayoutsStopped(db)).toBe(true);

    await setPayoutsStop(db, false, 'разобрались', T0 + 4);
    expect(await isPayoutsStopped(db)).toBe(false);
  });

  it('отрицательный баланс — тоже расхождение', async () => {
    const db = await freshDb();
    await appendPayLedger(db, {
      userId: 'u1', delta: -1_000_000, reason: 'adjust', idemKey: 'neg-1', createdAt: T0,
    });
    const report = await reconcile(db, T0 + 1);
    expect(report.issues.map((i) => i.code)).toContain('negative_balance');
  });

  it('подмена строки в журнале ломает сверку', async () => {
    const db = await funded(10_000_000);
    const raw = (db as unknown as { __raw: { exec: (sql: string) => void } }).__raw;
    raw.exec('DROP TRIGGER pay_ledger_no_update');
    raw.exec("UPDATE pay_ledger SET delta = 99000000 WHERE rowid = 1");

    const report = await reconcile(db, T0 + 1);
    expect(report.ledger.ok).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain('ledger_broken');
  });
});

describe('ключ идемпотентности заявки принадлежит игроку', () => {
  // pay_withdrawals.idem_key — UNIQUE на всю таблицу, а ключ придумывает клиент.
  // Без метки владельца второй игрок, назвавший тот же ключ, получил бы чужую
  // заявку как «свой повтор»: адрес вывода, сумму и user_id владельца.
  it('чужой ключ не находится и не мешает своей заявке', async () => {
    const db = await freshDb();
    await creditDeposit(db, { txid: TX('a'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 20_000_000 }, T0);
    await creditDeposit(db, { txid: TX('b'), eventIndex: 0, userId: 'u2', address: ALICE, amountMicro: 20_000_000 }, T0);

    const first = await requestWithdrawal(db, { userId: 'u1', address: ALICE, amountMicro: 6_000_000, idemKey: 'shared-1000' }, T0);
    const second = await requestWithdrawal(db, { userId: 'u2', address: BOB_ADDR, amountMicro: 7_000_000, idemKey: 'shared-1000' }, T0 + 1);

    expect(second.duplicated).toBe(false);
    expect(second.withdrawal.user_id).toBe('u2');
    expect(second.withdrawal.address).toBe(BOB_ADDR);
    expect(second.withdrawal.id).not.toBe(first.withdrawal.id);
    const rows = await db.prepare('SELECT user_id, amount_micro FROM pay_withdrawals ORDER BY created_at').all<{ user_id: string; amount_micro: number }>();
    expect(rows.results).toEqual([
      { user_id: 'u1', amount_micro: 6_000_000 },
      { user_id: 'u2', amount_micro: 7_000_000 },
    ]);
  });

  it('повтор своим же ключом — та же заявка, чужая — нет', async () => {
    const db = await funded(20_000_000);
    const first = await requestWithdrawal(db, { userId: 'u1', address: ALICE, amountMicro: 6_000_000, idemKey: 'mine-10000' }, T0);
    const again = await requestWithdrawal(db, { userId: 'u1', address: BOB_ADDR, amountMicro: 9_000_000, idemKey: 'mine-10000' }, T0 + 1);
    // Другой адрес и сумма в повторе игнорируются: возвращается ровно то, что уже стоит в очереди.
    expect(again.duplicated).toBe(true);
    expect(again.withdrawal.id).toBe(first.withdrawal.id);
    expect(again.withdrawal.address).toBe(ALICE);
  });

  it('старая заявка без метки владельца находится только у своего игрока', async () => {
    const db = await freshDb();
    await creditDeposit(db, { txid: TX('a'), eventIndex: 0, userId: 'u1', address: ALICE, amountMicro: 20_000_000 }, T0);
    await creditDeposit(db, { txid: TX('b'), eventIndex: 0, userId: 'u2', address: ALICE, amountMicro: 20_000_000 }, T0);
    // Строка в старом формате ключа: `wd:<ключ>`, без метки.
    await db.prepare(
      `INSERT INTO pay_withdrawals (id, user_id, address, amount_micro, fee_micro, status, idem_key, created_at)
       VALUES ('wd_old_key_000001', 'u1', ?, 6000000, 0, 'requested', 'wd:old-key-000001', ?)`,
    ).bind(ALICE, T0).run();

    const owner = await requestWithdrawal(db, { userId: 'u1', address: ALICE, amountMicro: 6_000_000, idemKey: 'old-key-000001' }, T0 + 1);
    expect(owner.duplicated).toBe(true);
    expect(owner.withdrawal.user_id).toBe('u1');

    // Второй игрок с тем же ключом обязан получить свою заявку, а не чужую.
    const other = await requestWithdrawal(db, { userId: 'u2', address: BOB_ADDR, amountMicro: 6_000_000, idemKey: 'old-key-000001' }, T0 + 2);
    expect(other.duplicated).toBe(false);
    expect(other.withdrawal.user_id).toBe('u2');
    const count = await db.prepare('SELECT COUNT(*) AS c FROM pay_withdrawals').first<number>('c');
    expect(Number(count)).toBe(2);
  });

  // Меж двумя одновременными заявками баланс не двигается (списывает его резерв),
  // а вот суточный потолок считается по уже вставленным строкам. Поэтому проверка
  // «проверил — вставил» обязана продублироваться условием внутри самой вставки:
  // иначе N параллельных заявок по 5 000 USDT каждая увидят пустой день и все N
  // встанут в очередь.
  it('шесть одновременных заявок не пробивают суточный потолок', async () => {
    const db = await funded(30_000_000_000);
    const one = 5_000_000_000; // MAX_WITHDRAW_MICRO: потолок одной заявки
    const settled = await Promise.allSettled(
      [1, 2, 3, 4, 5, 6].map((n) => requestWithdrawal(db, {
        userId: 'u1', address: BOB_ADDR, amountMicro: one, idemKey: `par-000${n}`,
      }, T0)),
    );
    const ok = settled.filter((r) => r.status === 'fulfilled');
    const failed = settled.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    // Ровно DAILY_LIMIT_MICRO / one = 4 заявки, не больше.
    expect(ok.length).toBe(4);
    expect(failed.length).toBe(2);
    for (const f of failed) expect(String(f.reason)).toMatch(/daily_limit/);
    const total = await db.prepare("SELECT COALESCE(SUM(amount_micro), 0) AS s FROM pay_withdrawals WHERE status NOT IN ('failed')")
      .first<number>('s');
    expect(Number(total)).toBe(DAILY_LIMIT_MICRO);
  });

  it('суммы заявок за день считаются с учётом уже принятых', async () => {
    const db = await funded(DAILY_LIMIT_MICRO);
    // Заявка на весь суточный потолок: её вставили не мы, но учёт обязан считать
    // её как свою — и следующая не должна вставиться ни под каким предлогом.
    await db.prepare(
      `INSERT INTO pay_withdrawals (id, user_id, address, amount_micro, fee_micro, status, idem_key, created_at)
       VALUES ('wd_today_0000000', 'u1', ?, ?, 0, 'requested', 'wd:today:0000000', ?)`,
    ).bind(ALICE, DAILY_LIMIT_MICRO, T0).run();
    await expect(requestWithdrawal(db, { userId: 'u1', address: BOB_ADDR, amountMicro: 6_000_000, idemKey: 'day-200000' }, T0 + 1))
      .rejects.toThrow(/daily_limit/);
    const count = await db.prepare('SELECT COUNT(*) AS c FROM pay_withdrawals').first<number>('c');
    expect(Number(count)).toBe(1);
  });

  it('ключ строится с меткой игрока', () => {
    expect(withdrawalIdemKey('u1', 'abc-123456')).toMatch(/^wd:[0-9a-f]{16}:abc-123456$/);
    expect(withdrawalIdemKey('u1', 'abc-123456')).not.toBe(withdrawalIdemKey('u2', 'abc-123456'));
    expect(legacyWithdrawalIdemKey('abc-123456')).toBe('wd:abc-123456');
  });
});
