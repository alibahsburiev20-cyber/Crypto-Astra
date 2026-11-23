// Призы из фонда сезона.
//
// Смысл теста: фонд — это доля выручки магазина, и он не может быть источником
// денег, которых никто не заплатил. Поэтому проверяется не только «приз начислен»,
// но и обратное: без покупок фонд пуст, взносы игроков его не наполняют, а выдать
// больше накопленного нельзя даже повтором запроса.
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { addPoolIncome, addPrizeBudget, ensureOpenCycle, prizeFromPrice, usdtPoolBlock } from '../../src/pay/pool';
import { MAX_PRIZE_AWARD_MICRO, PrizeError, awardPrize, listPrizes, prizeSummary } from '../../src/pay/prize';
import { payBalanceMicro, appendPayLedger } from '../../src/pay/ledger';
import { requestWithdrawal } from '../../src/pay/payouts';

const T0 = 1_700_000_000_000;
const PLAYER = 'u_prize_player';
const ADDRESS = 'TEpNofrztMUwq3HgRjQARLF4ScxSbWRgFp';

async function freshDb() {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  await ensureOpenCycle(db, T0);
  return db;
}

/** Покупка косметики глазами фонда: 5 USDT Premium → 2 USDT в призовой фонд. */
async function buyPremium(db: D1Database) {
  await addPrizeBudget(db, prizeFromPrice(5_000_000, 40), T0);
}

describe('призовой фонд: откуда деньги', () => {
  it('фонд растёт только от покупок', async () => {
    const db = await freshDb();
    expect((await prizeSummary(db, T0)).budgetMicro).toBe(0);

    await buyPremium(db);
    expect((await prizeSummary(db, T0)).budgetMicro).toBe(2_000_000);
  });

  it('взносы игроков фонд не наполняют', async () => {
    const db = await freshDb();
    // Даже если в цикл пула пришли «вклады» (`confirmed_in`), призовой фонд
    // остаётся нулевым: это разные счётчики, и это защита от пирамиды.
    await addPoolIncome(db, 10_000_000);
    const block = await usdtPoolBlock(db, T0);
    expect(block.confirmedIn).toBe(10_000_000);
    expect(block.prizeBudget).toBe(0);

    await expect(awardPrize(db, { userId: PLAYER, amountMicro: 1_000_000, idemKey: 'prize-1' }, T0))
      .rejects.toThrow(PrizeError);
  });
});

describe('начисление приза', () => {
  it('списывает из фонда и зачисляет игроку', async () => {
    const db = await freshDb();
    await buyPremium(db);

    const award = await awardPrize(db, { userId: PLAYER, amountMicro: 1_000_000, note: '1 место', idemKey: 'week-42-1' }, T0);
    expect(award.duplicated).toBe(false);
    expect(award.amount).toBe('1.00');
    expect(award.budgetAfterMicro).toBe(1_000_000);
    expect(await payBalanceMicro(db, PLAYER)).toBe(1_000_000);

    const prizes = await listPrizes(db, 10);
    expect(prizes).toHaveLength(1);
    expect(prizes[0].userId).toBe(PLAYER);
    expect(prizes[0].sourceRef).toBe('prize:week-42-1');
  });

  it('больше, чем в фонде, выдать нельзя', async () => {
    const db = await freshDb();
    await buyPremium(db); // 2 USDT

    await expect(awardPrize(db, { userId: PLAYER, amountMicro: 3_000_000, idemKey: 'too-much-1' }, T0))
      .rejects.toThrow(/insufficient_prize_fund/);
    expect((await prizeSummary(db, T0)).budgetMicro).toBe(2_000_000);
    expect(await payBalanceMicro(db, PLAYER)).toBe(0);
  });

  it('повтор с тем же ключом не начисляет дважды', async () => {
    const db = await freshDb();
    await buyPremium(db);

    const first = await awardPrize(db, { userId: PLAYER, amountMicro: 1_000_000, idemKey: 'same-key-1' }, T0);
    const second = await awardPrize(db, { userId: PLAYER, amountMicro: 1_000_000, idemKey: 'same-key-1' }, T0 + 1000);
    expect(first.duplicated).toBe(false);
    expect(second.duplicated).toBe(true);
    expect(await payBalanceMicro(db, PLAYER)).toBe(1_000_000);
    expect((await prizeSummary(db, T0)).budgetMicro).toBe(1_000_000);
  });

  it('два приза подряд не уводят фонд в минус', async () => {
    const db = await freshDb();
    await buyPremium(db); // ровно 2 USDT

    await awardPrize(db, { userId: 'u_a', amountMicro: 2_000_000, idemKey: 'all-fund-1' }, T0);
    await expect(awardPrize(db, { userId: 'u_b', amountMicro: 1, idemKey: 'one-more-1' }, T0))
      .rejects.toThrow(/insufficient_prize_fund/);
    expect((await prizeSummary(db, T0)).budgetMicro).toBe(0);
  });

  it('потолок одного приза и мусорные входы', async () => {
    const db = await freshDb();
    await addPrizeBudget(db, MAX_PRIZE_AWARD_MICRO * 2, T0);

    await expect(awardPrize(db, { userId: PLAYER, amountMicro: MAX_PRIZE_AWARD_MICRO + 1, idemKey: 'big-prize-1' }, T0))
      .rejects.toThrow(/above_maximum/);
    await expect(awardPrize(db, { userId: '', amountMicro: 1_000_000, idemKey: 'no-user-1' }, T0))
      .rejects.toThrow(/bad_user/);
    await expect(awardPrize(db, { userId: PLAYER, amountMicro: 1.5, idemKey: 'frac-amount-1' }, T0))
      .rejects.toThrow(/bad_amount/);
    await expect(awardPrize(db, { userId: PLAYER, amountMicro: 1_000_000, idemKey: 'short' }, T0))
      .rejects.toThrow(/bad_idem_key/);
    expect(await payBalanceMicro(db, PLAYER)).toBe(0);
  });
});

describe('приз и вывод — один путь', () => {
  it('приз становится балансом, с которого работает обычная заявка на вывод', async () => {
    const db = await freshDb();
    await buyPremium(db);
    await buyPremium(db);
    await buyPremium(db); // 6 USDT в фонде

    await awardPrize(db, { userId: PLAYER, amountMicro: 5_000_000, note: 'сезон 1', idemKey: 'season-1-1' }, T0);

    const { withdrawal } = await requestWithdrawal(db, {
      userId: PLAYER, address: ADDRESS, amountMicro: 5_000_000, idemKey: 'wd-prize-1',
    }, T0 + 1000);
    expect(withdrawal.status).toBe('requested');
    expect(withdrawal.amount_micro).toBe(5_000_000);

    // Приз не «печатает» деньги: остаток фонда — ровно то, что заплатили за скины.
    expect((await prizeSummary(db, T0)).budgetMicro).toBe(1_000_000);
    // Депозитного баланса у игрока нет — вывести можно только приз, не больше.
    await appendPayLedger(db, {
      userId: PLAYER, delta: -5_000_000, reason: 'payout', idemKey: 'test-payout-1', createdAt: T0 + 2000,
    });
    expect(await payBalanceMicro(db, PLAYER)).toBe(0);
  });
});
