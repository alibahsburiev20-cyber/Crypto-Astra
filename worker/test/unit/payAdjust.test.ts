// Ручная корректировка USDT (списание из админки).
//
// Смысл теста: «списать деньги» в этом контуре физически не может означать
// «подправить строку» — `pay_ledger` append-only, а парсер суммы не принимает
// минус. Поэтому проверяем три вещи: списание возможно только как compensating
// запись; оно не может увести баланс в минус и не может съесть деньги, уже
// обещанные незакрытой заявкой; и повтор с тем же ключом не удваивает операцию.
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { payBalanceMicro } from '../../src/pay/ledger';
import { requestWithdrawal } from '../../src/pay/payouts';
import {
  ADJUST_CONFIRM, MAX_ADJUST_MICRO, AdjustError, adjustBalance, adjustStatus, parseAdjustInput,
  pendingWithdrawalMicro,
} from '../../src/pay/adjust';

const T0 = 1_700_000_000_000;
const PLAYER = 'u_adjust_player';
const ADDRESS = 'TEpNofrztMUwq3HgRjQARLF4ScxSbWRgFp';

async function freshDb() {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  return db;
}

/** Пополнение «извне» — то, что потом можно списать. */
async function topUp(db: D1Database, micro: number, key: string) {
  const { appendPayLedger } = await import('../../src/pay/ledger');
  await appendPayLedger(db, { userId: PLAYER, delta: micro, reason: 'deposit', idemKey: key, createdAt: T0 });
}

const base = {
  userId: PLAYER, reason: 'возврат покупки', idemKey: 'adj-0001', confirm: ADJUST_CONFIRM,
};

describe('разбор суммы корректировки', () => {
  it('человекочитаемая сумма и направление дают знак', () => {
    expect(parseAdjustInput({ player: PLAYER, amount: '12.5', direction: 'debit', reason: 'x12', idem: 'adj-0002' }))
      .toEqual({ ok: true, value: { userId: PLAYER, deltaMicro: -12_500_000, reason: 'x12', idemKey: 'adj-0002', dryRun: true, confirm: '' } });
    expect(parseAdjustInput({ player: PLAYER, amount: '12.5', reason: 'x12', idem: 'adj-0003' }).ok).toBe(true);
  });

  it('минус в сумме и direction: debit не взаимно не уничтожаются', () => {
    const both = parseAdjustInput({ player: PLAYER, amount: '-5', direction: 'debit', reason: 'x12', idem: 'adj-0004' });
    expect(both.ok && both.value.deltaMicro).toBe(-5_000_000);
  });

  it('ноль, дробь микро-ровнее шести знаков и мусор отвергаются', () => {
    for (const amount of ['0', '-0', '1.1234567', '12,5', '', 'abc']) {
      expect(parseAdjustInput({ player: PLAYER, amount, reason: 'x12', idem: 'adj-0005' }).ok).toBe(false);
    }
    expect(parseAdjustInput({ player: PLAYER, deltaMicro: 0, reason: 'x12', idem: 'adj-0006' }).ok).toBe(false);
  });

  it('причина обязательна: без неё проводку неотличить от ошибки', () => {
    const res = parseAdjustInput({ player: PLAYER, amount: '5', idem: 'adj-0007' });
    expect(res).toEqual({ ok: false, error: 'reason_required' });
  });

  it('ключ идемпотентности обязателен и не может быть коротким', () => {
    expect(parseAdjustInput({ player: PLAYER, amount: '5', reason: 'x12', idem: 'ab' }).ok).toBe(false);
    expect(parseAdjustInput({ player: PLAYER, amount: '5', reason: 'x12' }).ok).toBe(false);
  });

  it('одна операция ограничена планкой заявки на вывод', () => {
    const res = parseAdjustInput({ player: PLAYER, deltaMicro: MAX_ADJUST_MICRO + 1, reason: 'x12', idem: 'adj-0008' });
    expect(res).toEqual({ ok: false, error: 'amount_too_big' });
    expect(parseAdjustInput({ player: PLAYER, deltaMicro: MAX_ADJUST_MICRO, reason: 'x12', idem: 'adj-0009' }).ok).toBe(true);
  });
});

describe('списание из админки', () => {
  it('по умолчанию — пробный проход: числа есть, журнала нет', async () => {
    const db = await freshDb();
    await topUp(db, 10_000_000, 'dep-1');

    const preview = await adjustBalance(db, { ...base, deltaMicro: -4_000_000, dryRun: true }, T0 + 1000);
    expect(preview.dryRun).toBe(true);
    expect(preview.direction).toBe('debit');
    expect(preview.balanceBeforeMicro).toBe(10_000_000);
    expect(preview.balanceAfterMicro).toBe(6_000_000);
    expect(await payBalanceMicro(db, PLAYER)).toBe(10_000_000);
  });

  it('без слова подтверждения запись не создаётся', async () => {
    const db = await freshDb();
    await topUp(db, 10_000_000, 'dep-1');
    await expect(adjustBalance(db, { ...base, deltaMicro: -4_000_000, confirm: '', dryRun: false }, T0 + 1000))
      .rejects.toThrow(AdjustError);
    expect(await payBalanceMicro(db, PLAYER)).toBe(10_000_000);
  });

  it('списание — это проводка adjust с обратным знаком', async () => {
    const db = await freshDb();
    await topUp(db, 10_000_000, 'dep-1');

    const res = await adjustBalance(db, { ...base, deltaMicro: -4_000_000, dryRun: false }, T0 + 1000);
    expect(res.duplicated).toBe(false);
    expect(res.idemKey).toBe('admadj:adj-0001');
    expect(await payBalanceMicro(db, PLAYER)).toBe(6_000_000);

    const row = await db.prepare("SELECT delta, reason FROM pay_ledger WHERE idem_key = 'admadj:adj-0001'")
      .first<{ delta: number; reason: string }>();
    expect(row?.delta).toBe(-4_000_000);
    expect(row?.reason).toBe('adjust');
  });

  it('в минус баланс не уходит — и на пробном проходе тоже', async () => {
    const db = await freshDb();
    await topUp(db, 3_000_000, 'dep-1');

    await expect(adjustBalance(db, { ...base, deltaMicro: -3_000_001, dryRun: false }, T0 + 1000))
      .rejects.toThrow('balance_below_zero');
    await expect(adjustBalance(db, { ...base, deltaMicro: -3_000_001, dryRun: true }, T0 + 1000))
      .rejects.toThrow('balance_below_zero');
    expect(await payBalanceMicro(db, PLAYER)).toBe(3_000_000);
    // Ровно в ноль — можно.
    const zero = await adjustBalance(db, { ...base, deltaMicro: -3_000_000, dryRun: false }, T0 + 2000);
    expect(zero.balanceAfterMicro).toBe(0);
  });

  it('нельзя съесть деньги, обещанные незакрытой заявкой', async () => {
    const db = await freshDb();
    await topUp(db, 10_000_000, 'dep-1');
    const { withdrawal } = await requestWithdrawal(db, {
      userId: PLAYER, address: ADDRESS, amountMicro: 7_000_000, idemKey: 'wd-adj-1',
    }, T0 + 500);
    expect(await pendingWithdrawalMicro(db, PLAYER)).toBe(7_000_000);

    // 10 − 4 = 6 < 7 — остатка не хватит на резерв, поэтому отказ.
    await expect(adjustBalance(db, { ...base, deltaMicro: -4_000_000, dryRun: false }, T0 + 1000))
      .rejects.toThrow('below_pending_withdrawals');
    const ok = await adjustBalance(db, { ...base, deltaMicro: -3_000_000, dryRun: false }, T0 + 1000);
    expect(ok.balanceAfterMicro).toBe(7_000_000);

    // После того как заявку закрыли откатом, списание свободно.
    const { failWithdrawal } = await import('../../src/pay/payouts');
    await failWithdrawal(db, withdrawal.id, 'тест', T0 + 2000);
    expect(await pendingWithdrawalMicro(db, PLAYER)).toBe(0);
    const after = await adjustBalance(db, { ...base, idemKey: 'adj-0002', deltaMicro: -7_000_000, dryRun: false }, T0 + 3000);
    expect(after.balanceAfterMicro).toBe(0);
  });

  it('начисление резерв не ограничивает', async () => {
    const db = await freshDb();
    await topUp(db, 5_000_000, 'dep-2');
    await requestWithdrawal(db, { userId: PLAYER, address: ADDRESS, amountMicro: 5_000_000, idemKey: 'wd-adj-2' }, T0 + 500);
    // Заявка «в головах», а баланс ещё не тронут: начисление сверху не может
    // сломать очередь, поэтому граница pending на него не распространяется.
    const res = await adjustBalance(db, { ...base, deltaMicro: 2_000_000, dryRun: false }, T0 + 1000);
    expect(res.direction).toBe('credit');
    expect(res.pendingMicro).toBe(5_000_000);
    expect(res.balanceAfterMicro).toBe(7_000_000);
  });
});

describe('повтор запроса', () => {
  it('тот же ключ и та же сумма — та же запись, без удвоения', async () => {
    const db = await freshDb();
    await topUp(db, 10_000_000, 'dep-1');
    const first = await adjustBalance(db, { ...base, deltaMicro: -4_000_000, dryRun: false }, T0 + 1000);
    const again = await adjustBalance(db, { ...base, deltaMicro: -4_000_000, dryRun: false }, T0 + 2000);
    expect(again.duplicated).toBe(true);
    expect(again.ledgerHash).toBe(first.ledgerHash);
    // «До» и «стало» остаются теми же, что видел оператор: баланс после записи
    // разворачивается назад, иначе повтор показал бы новое списание.
    expect(again.balanceBeforeMicro).toBe(10_000_000);
    expect(again.balanceAfterMicro).toBe(6_000_000);
    expect(await payBalanceMicro(db, PLAYER)).toBe(6_000_000);
  });

  it('тот же ключ и другая сумма — отказ, а не подмена', async () => {
    const db = await freshDb();
    await topUp(db, 10_000_000, 'dep-1');
    await adjustBalance(db, { ...base, deltaMicro: -4_000_000, dryRun: false }, T0 + 1000);
    await expect(adjustBalance(db, { ...base, deltaMicro: -5_000_000, dryRun: false }, T0 + 2000))
      .rejects.toThrow('idem_conflict');
    expect(await payBalanceMicro(db, PLAYER)).toBe(6_000_000);
  });
});

describe('сверка после списания', () => {
  it('компенсирующая запись не ломает цепь и не поднимает стоп выплат', async () => {
    const db = await freshDb();
    const { reconcile } = await import('../../src/pay/reconcile');
    await topUp(db, 10_000_000, 'dep-1');
    // Сравниваем набор расхождений «до» и «после», а не ждём пустого: проводка
    // `deposit` здесь создана руками, без строки в `pay_deposits`, и сверка это
    // видит законно. Важно, что списание НЕ ДОБАВЛЯЕТ ни одного issue и не
    // поднимает стоп-флаг — иначе каждая ручная компенсация останавливала бы
    // выплаты всем.
    const before = await reconcile(db, T0);

    await adjustBalance(db, { ...base, deltaMicro: -4_000_000, dryRun: false }, T0 + 1000);
    const after = await reconcile(db, T0 + 2000);
    expect(after.issues.map((i) => i.code)).toEqual(before.issues.map((i) => i.code));
    expect(after.ledger.ok).toBe(true);
    expect(after.stop).toBe(false);
  });

  it('журнал остаётся append-only: UPDATE и DELETE по-прежнему закрыты', async () => {
    const db = await freshDb();
    await topUp(db, 10_000_000, 'dep-1');
    await adjustBalance(db, { ...base, deltaMicro: -4_000_000, dryRun: false }, T0 + 1000);
    const { raw } = (await import('../helpers/d1')).makeD1();
    expect(raw).toBeTruthy();
    await expect(db.prepare("UPDATE pay_ledger SET delta = -1 WHERE idem_key = 'admadj:adj-0001'").run())
      .rejects.toThrow();
    await expect(db.prepare("DELETE FROM pay_ledger WHERE idem_key = 'admadj:adj-0001'").run())
      .rejects.toThrow();
  });
});

describe('статусы отказа', () => {
  it('у отказа есть смысл для клиента', () => {
    expect(adjustStatus('confirm_required')).toBe(400);
    expect(adjustStatus('balance_below_zero')).toBe(409);
    expect(adjustStatus('below_pending_withdrawals')).toBe(409);
    expect(adjustStatus('idem_conflict')).toBe(409);
    expect(adjustStatus('amount_too_big')).toBe(422);
    expect(adjustStatus('bad_amount')).toBe(400);
  });
});
