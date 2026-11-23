// Баланс целиком: обязательства игроков против того, что реально лежит в сети.
//
// Смысл теста: система не должна уметь «выглядеть платёжеспособной». Если
// обязательств больше активов — это дефицит, и он называется дефицитом, а не
// округляется в «всё хорошо».
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { addPrizeBudget, ensureOpenCycle } from '../../src/pay/pool';
import { appendPayLedger } from '../../src/pay/ledger';
import { playerLiabilitiesMicro, prizeLiabilityMicro, solvencySheet } from '../../src/pay/solvency';

const T0 = 1_700_000_000_000;

async function freshDb() {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  await ensureOpenCycle(db, T0);
  return db;
}

async function credit(db: D1Database, userId: string, micro: number, idem: string) {
  await appendPayLedger(db, { userId, delta: micro, reason: 'deposit', idemKey: idem, createdAt: T0 });
}

describe('обязательства', () => {
  it('складывает положительные балансы и не вычитает отрицательные', async () => {
    const db = await freshDb();
    await credit(db, 'u1', 5_000_000, 'dep-u1');
    await credit(db, 'u2', 3_000_000, 'dep-u2');
    // У третьего баланс ушёл в минус (аварийный случай): его не вычитаем из суммы.
    await appendPayLedger(db, { userId: 'u3', delta: -1_000_000, reason: 'adjust', idemKey: 'neg-u3', createdAt: T0 });

    const result = await playerLiabilitiesMicro(db);
    expect(result.micro).toBe(8_000_000);
    expect(result.players).toBe(2);
  });

  it('призовой фонд — тоже обязательство', async () => {
    const db = await freshDb();
    await addPrizeBudget(db, 2_000_000, T0);
    expect(await prizeLiabilityMicro(db)).toBe(2_000_000);
  });
});

describe('покрытие', () => {
  it('активов больше — покрыто', async () => {
    const db = await freshDb();
    await credit(db, 'u1', 5_000_000, 'dep-u1');
    await addPrizeBudget(db, 2_000_000, T0); // обязательств 7, активов 10

    const sheet = await solvencySheet(db, {
      addressesMicro: 6_000_000, hotMicro: 4_000_000, addresses: 3, chainErrors: 0,
    }, T0);

    expect(sheet.liabilities.totalMicro).toBe(7_000_000);
    expect(sheet.assets.totalMicro).toBe(10_000_000);
    expect(sheet.status).toBe('ok');
    expect(sheet.coveragePercent).toBe(142.9);
    expect(sheet.gapMicro).toBe(0);
  });

  it('обязательств больше — это дефицит, а не «почти хорошо»', async () => {
    const db = await freshDb();
    await credit(db, 'u1', 10_000_000, 'dep-u1');

    const sheet = await solvencySheet(db, {
      addressesMicro: 2_000_000, hotMicro: 1_000_000, addresses: 2, chainErrors: 0,
    }, T0);

    expect(sheet.status).toBe('short');
    expect(sheet.coveragePercent).toBe(30);
    expect(sheet.gapMicro).toBe(7_000_000);
    expect(sheet.liabilities.total).toBe('10.00');
  });

  it('часть адресов не прочиталась — вердикта нет, а не «покрыто»', async () => {
    const db = await freshDb();
    await credit(db, 'u1', 5_000_000, 'dep-u1');

    const sheet = await solvencySheet(db, {
      addressesMicro: null, hotMicro: 1_000_000, addresses: 2, chainErrors: 1,
    }, T0);

    expect(sheet.status).toBe('unknown');
    expect(sheet.assets.incomplete).toBe(true);
  });

  it('обязательств нет — покрытие не считается', async () => {
    const db = await freshDb();
    const sheet = await solvencySheet(db, { addressesMicro: 0, hotMicro: 0, addresses: 0, chainErrors: 0 }, T0);
    expect(sheet.status).toBe('no_liabilities');
    expect(sheet.coveragePercent).toBeNull();
  });
});
