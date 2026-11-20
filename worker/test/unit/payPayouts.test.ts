import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { appendPayLedger, creditDeposit, payBalanceMicro } from '../../src/pay/ledger';
import {
  DAILY_LIMIT_MICRO, MIN_WITHDRAW_MICRO, PayoutError, approveWithdrawal, confirmWithdrawal,
  failWithdrawal, requestWithdrawal, reserveWithdrawal, markBroadcast, markSent, withdrawalQueue,
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
