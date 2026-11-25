// Замок на nonce и подтверждение выплат по квитанции сети (BNB Chain).
//
// Здесь два «денежных» инварианта, и оба проверяются потому, что стоят они
// дорого:
//   * два админа не могут подписать один и тот же `nonce` (иначе вторая заявка
//     зависает в `broadcasting` с уже списанным резервом);
//   * `confirmed` ставится только когда сеть показала успешную квитанцию и
//     нужное число подтверждений, а реверт возвращает деньги ровно один раз.
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { payBalanceMicro } from '../../src/pay/ledger';
import {
  NONCE_SCOPE, applyEvmPayoutConfirmations, nonceKey, releaseNonce,
  reserveNonce, verifyPayout,
} from '../../src/pay/evm/payouts';
import { payoutMaxCostWei } from '../../src/pay/evm/payouts';

const OWNER = '0x' + 'aa'.repeat(20);
const TXID = 'ab'.repeat(32);
const T0 = 1_700_000_000_000;

async function freshDb() {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  return db;
}

/** Заявка в произвольном состоянии — вставляем напрямую, автомат проверяем отдельно. */
async function insertWithdrawal(db: D1Database, id: string, status: string, txid: string | null = TXID) {
  await db.prepare(
    `INSERT INTO pay_withdrawals (id, user_id, address, amount_micro, fee_micro, status, idem_key, created_at, decided_at, txid)
     VALUES (?, 'u1', ?, 5000000, 0, ?, ?, ?, ?, ?)`,
  ).bind(id, OWNER, status, `wd:${id}`, T0, T0, txid).run();
}

function node(opts: {
  nonce?: number;
  receipt?: Record<string, unknown> | null;
  head?: number;
}) {
  const seen: string[] = [];
  return {
    seen,
    rpc: {
      transactionCount: async () => opts.nonce ?? 7,
      transactionReceipt: async (hash: string) => {
        seen.push(hash);
        if (opts.receipt === null || opts.receipt === undefined) return null;
        return opts.receipt as never;
      },
      blockNumber: async () => opts.head ?? 100,
    },
  };
}

describe('замок на nonce (EVM)', () => {
  it('первый запрос получает номер от ноды, второй — следующий, а не тот же', async () => {
    const db = await freshDb();
    let calls = 0;
    const rpc = { transactionCount: async () => (calls += 1, 7) } as never;

    const first = await reserveNonce(db, rpc, 56, OWNER, T0);
    const second = await reserveNonce(db, rpc, 56, OWNER, T0);

    expect(first.nonce).toBe(7);
    // Нода отдала тот же номер (первая транзакция ещё не всплыла) — значит второй
    // обязан уйти с 8, а не подписать 7 дважды.
    expect(second.nonce).toBe(8);
    expect(calls).toBe(2);
    expect(first.key).toBe(nonceKey(56, OWNER, 7));
  });

  it('регистр адреса не создаёт второй замок на тот же номер', async () => {
    const db = await freshDb();
    const rpc = { transactionCount: async () => 3 } as never;
    const a = await reserveNonce(db, rpc, 56, OWNER.toUpperCase(), T0);
    await expect(reserveNonce(db, { transactionCount: async () => 3 } as never, 56, OWNER, T0))
      .resolves.toMatchObject({ nonce: 4 });
    expect(a.nonce).toBe(3);
  });

  it('после освобождения номер снова свободен', async () => {
    const db = await freshDb();
    const rpc = { transactionCount: async () => 5 } as never;
    const taken = await reserveNonce(db, rpc, 56, OWNER, T0);
    await releaseNonce(db, taken.key);
    const again = await reserveNonce(db, rpc, 56, OWNER, T0);
    expect(again.nonce).toBe(5);
    const rows = await db.prepare('SELECT COUNT(*) AS c FROM pay_operations WHERE scope = ?')
      .bind(NONCE_SCOPE).first<number>('c');
    expect(Number(rows)).toBe(1);
  });

  it('три занятых номера подряд — это `nonce_busy`, а не «подпишем четвёртый»', async () => {
    const db = await freshDb();
    // Забиты 7, 8, 9.
    for (const nonce of [7, 8, 9]) {
      await db.prepare('INSERT INTO pay_operations (scope, idem_key, created_at) VALUES (?, ?, ?)')
        .bind(NONCE_SCOPE, nonceKey(56, OWNER, nonce), T0).run();
    }
    const rpc = { transactionCount: async () => 7 } as never;
    await expect(reserveNonce(db, rpc, 56, OWNER, T0)).rejects.toThrow('nonce_busy');
  });
});

describe('подтверждение выплаты по квитанции', () => {
  it('квитанции нет → ждём, состояние не трогаем', async () => {
    const db = await freshDb();
    await insertWithdrawal(db, 'wd_1', 'broadcasting');
    const { rpc } = node({ receipt: null });

    const res = await verifyPayout({ db, rpc: rpc as never, confirmations: 15, withdrawalId: 'wd_1', now: T0 });
    expect(res).toBe('pending');
    const row = await db.prepare('SELECT status FROM pay_withdrawals WHERE id = ?').bind('wd_1').first<string>('status');
    expect(row).toBe('broadcasting');
  });

  it('реверт → `failed` и возврат резерва ровно один раз', async () => {
    const db = await freshDb();
    await insertWithdrawal(db, 'wd_1', 'broadcasting');
    // Резерв уже списан — моделируем это записью в журнале.
    await db.prepare(
      `INSERT INTO pay_ledger (id, user_id, delta, reason, source_ref, idem_key, created_at)
       VALUES ('lg_1', 'u1', -5000000, 'payout', 'wd_1', 'wdres:wd_1', ?)`,
    ).bind(T0).run();
    expect(await payBalanceMicro(db, 'u1')).toBe(-5_000_000);

    // Форма — как её отдаёт `rpc.transactionReceipt`: status уже boolean, номера
    // уже числа. Подделывать «сырой ответ ноды» здесь значит тестировать не то.
    const { rpc } = node({ receipt: { status: false, blockNumber: 100, gasUsed: 60000 } });
    expect(await verifyPayout({ db, rpc: rpc as never, confirmations: 15, withdrawalId: 'wd_1', now: T0 })).toBe('reverted');
    expect(await payBalanceMicro(db, 'u1')).toBe(0);

    const payoutRow = await db.prepare('SELECT result, error FROM pay_payouts WHERE withdrawal_id = ?')
      .bind('wd_1').first<{ result: string; error: string } | null>();
    expect(payoutRow).toBeNull(); // попытки не было — и выдумывать её сверка не обязана

    // Повторная сверка не должна вернуть деньги второй раз.
    expect(await verifyPayout({ db, rpc: rpc as never, confirmations: 15, withdrawalId: 'wd_1', now: T0 })).toBe('skipped');
    expect(await payBalanceMicro(db, 'u1')).toBe(0);
  });

  it('мало подтверждений → ещё не `confirmed`', async () => {
    const db = await freshDb();
    await insertWithdrawal(db, 'wd_1', 'sent');
    const { rpc } = node({ head: 100, receipt: { status: true, blockNumber: 96, gasUsed: 60000 } });
    expect(await verifyPayout({ db, rpc: rpc as never, confirmations: 15, withdrawalId: 'wd_1', now: T0 })).toBe('pending');
    expect(await db.prepare('SELECT status FROM pay_withdrawals WHERE id = ?').bind('wd_1').first<string>('status')).toBe('sent');
  });

  it('достаточно подтверждений → `sent` → `confirmed` одним проходом', async () => {
    const db = await freshDb();
    await insertWithdrawal(db, 'wd_1', 'broadcasting');
    // 100 - 90 + 1 = 11 подтверждений.
    const { rpc } = node({ head: 100, receipt: { status: true, blockNumber: 90, gasUsed: 60000 } });
    const res = await verifyPayout({ db, rpc: rpc as never, confirmations: 11, withdrawalId: 'wd_1', now: T0 });
    expect(res).toBe('confirmed');
    const row = await db.prepare('SELECT status, txid FROM pay_withdrawals WHERE id = ?').bind('wd_1').first<{ status: string; txid: string }>();
    expect(row).toMatchObject({ status: 'confirmed', txid: TXID });
    const payout = await db.prepare('SELECT result, solidified_at FROM pay_payouts WHERE withdrawal_id = ?')
      .bind('wd_1').first<{ result: string; solidified_at: number }>();
    // `pay_payouts` заполняет маршрут при отправке; здесь проверяем, что
    // подтверждение не выдумывает строку, которой нет.
    expect(payout).toBeNull();
  });

  it('сверка очереди идёт пачкой и не падает на одной битой заявке', async () => {
    const db = await freshDb();
    await insertWithdrawal(db, 'wd_1', 'sent');
    await insertWithdrawal(db, 'wd_2', 'sent', 'cd'.repeat(32));
    const rpc = {
      blockNumber: async () => 100,
      transactionReceipt: async (hash: string) => hash === TXID
        ? ({ status: true, blockNumber: 90, gasUsed: 60000 } as never)
        : (() => { throw new Error('нода легла'); })(),
    } as never;

    const res = await applyEvmPayoutConfirmations(db, rpc, 11, T0);
    expect(res).toMatchObject({ checked: 2, confirmed: 1, pending: 1 });
  });

  it('заявки в `confirmed`/`failed` в очередь не попадают', async () => {
    const db = await freshDb();
    await insertWithdrawal(db, 'wd_1', 'confirmed');
    const res = await applyEvmPayoutConfirmations(db, node({}).rpc as never, 11, T0);
    expect(res.checked).toBe(0);
  });
});

describe('стоимость газа', () => {
  it('худшая цена перевода = лимит газа × ставка', () => {
    expect(payoutMaxCostWei(3_000_000_000n)).toBe(80_000n * 3_000_000_000n);
    expect(payoutMaxCostWei(1_000_000_000n, 21_000n)).toBe(21_000_000_000_000n);
  });
});
