import { describe, expect, it } from 'vitest';
import { DAY_MS, REPAIR_ASTRA_PER_PERCENT, START_ASTRA, START_FUEL } from '../../src/shared/constants';
import { PLANET_BY_ID, EVENTS } from '../../src/shared/gameData';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { runDueJobs } from '../../src/world/jobs';
import { enqueue } from '../../src/world/scheduler';
import {
  computeReward, durabilityLoss, fuelCost, levelFromXp, repairCost, seedMultiplier, xpThreshold,
} from '../../src/world/modules/expeditionMath';
import { regenPlan, bumpDaily, isFrozen, runLedgerVerify } from '../../src/world/modules/maintenance';
import { cancelExpedition, chooseExpeditionEvent, finishExpedition, listExpeditions, openExpeditionEvent, startExpedition, timeoutExpeditionEvent } from '../../src/world/modules/expeditions';
import { buildState } from '../../src/world/modules/state';
import { claim } from '../../src/world/modules/claim';
import { createPlayer } from '../../src/world/modules/players';
import { applyDurability } from '../../src/world/modules/progress';
import { buyFuel, repairShip } from '../../src/world/modules/upkeep';
import { setLevel } from '../helpers/level';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;
const SHORT = 15 * 60 * 1000;
const MEDIUM = 4 * 60 * 60 * 1000;

function shipId(sql: SqlStorage): string {
  return String(sql.exec('SELECT id FROM ships LIMIT 1').toArray()[0].id);
}
function expeditionId(sql: SqlStorage): string {
  return String(sql.exec('SELECT id FROM expeditions LIMIT 1').toArray()[0].id);
}

describe('формулы этапа 1', () => {
  it('seed даёт множитель 0.8–1.2, уровень и ремонт сходятся с концепцией', () => {
    expect(seedMultiplier('00'.repeat(8))).toBeCloseTo(0.8);
    expect(seedMultiplier('ff'.repeat(8))).toBeCloseTo(1.2);
    // Кривая уровня. Числа зафиксированы специально: они решают, когда игрок
    // доходит до верфи, и менять их можно только вместе с этим тестом.
    expect(xpThreshold(1)).toBe(0);
    expect(xpThreshold(2)).toBe(40);
    expect(xpThreshold(5)).toBe(242);
    expect(xpThreshold(12)).toBe(903);
    expect(xpThreshold(20)).toBe(1838);
    expect(xpThreshold(30)).toBe(3185);
    expect(levelFromXp(39)).toBe(1);
    expect(levelFromXp(40)).toBe(2);
    expect(levelFromXp(241)).toBe(4);
    expect(levelFromXp(242)).toBe(5);
    // Порог монотонный: «опыт есть, а уровень не растёт» невозможен по построению.
    for (let level = 2; level <= 40; level++) {
      expect(xpThreshold(level), `L${level}`).toBeGreaterThan(xpThreshold(level - 1));
    }
    expect(fuelCost(1, 'short')).toBe(1);
    expect(fuelCost(1, 'medium')).toBe(2);
    expect(fuelCost(1, 'long')).toBe(4);
    expect(fuelCost(1.2, 'short')).toBe(2);
    expect(repairCost(20, 1)).toBe(20 * REPAIR_ASTRA_PER_PERCENT);
    expect(repairCost(20, 1.5)).toBe(30 * REPAIR_ASTRA_PER_PERCENT);
    expect(durabilityLoss('00'.repeat(8), false, 0)).toBe(5);
    expect(durabilityLoss('ff'.repeat(8), false, 0)).toBe(15);
    expect(durabilityLoss('ff'.repeat(8), true, 0)).toBe(25);
  });

  it('короткая на Ferra со seed 00: 6 ASTRA, 1 ресурс, 10 очков, износ 5', () => {
    const r = computeReward({
      planet: PLANET_BY_ID.ferra, shipType: 'scout', kind: 'short', seed: '00'.repeat(8),
      eventBonusBp: 1000, extraWear: 0, durability: 100, expeditionsToday: 0, pointsToday: 0,
    });
    expect(r.astra).toBe(6);
    expect(r.units).toBe(1);
    expect(r.points).toBe(10);
    expect(r.xp).toBe(10);
    expect(r.wear).toBe(5);
    expect(r.resources.reduce((s, x) => s + x.amount, 0)).toBe(1);
  });

  it('после 8 рейсов награда половинная, очки упираются в потолок', () => {
    const half = computeReward({
      planet: PLANET_BY_ID.ferra, shipType: 'scout', kind: 'short', seed: '00'.repeat(8),
      eventBonusBp: 1000, extraWear: 0, durability: 100, expeditionsToday: 8, pointsToday: 0,
    });
    expect(half.diminished).toBe(true);
    expect(half.astra).toBe(3);
    expect(half.units).toBe(0);
    const soft = computeReward({
      planet: PLANET_BY_ID.ferra, shipType: 'scout', kind: 'short', seed: '00'.repeat(8),
      eventBonusBp: 1000, extraWear: 0, durability: 100, expeditionsToday: 0, pointsToday: 700,
    });
    expect(soft.points).toBe(5);
    const hard = computeReward({
      planet: PLANET_BY_ID.ferra, shipType: 'scout', kind: 'short', seed: '00'.repeat(8),
      eventBonusBp: 1000, extraWear: 0, durability: 100, expeditionsToday: 0, pointsToday: 1000,
    });
    expect(hard.points).toBe(0);
  });

  it('восстановление топлива догоняет пропущенные тики, но не выше бака', () => {
    const step = 2 * 60 * 60 * 1000;
    expect(regenPlan(0, 0, 3, 5)).toEqual({ grant: 1, nextAt: step });
    expect(regenPlan(0, step * 2, 3, 5).grant).toBe(2);
  });
});

describe('флот летает параллельно', () => {
  /**
   * Добавить корабль напрямую: верфь в этом тесте не проверяется, важен рейс.
   * Прочность — через журнал, как при выдаче: иначе сверка увидит 100 против 0
   * и мир «замёрз бы» на расхождении прямо в тесте.
   */
  function addShip(sql: SqlStorage, id: string, type: string): string {
    sql.exec(`INSERT INTO ships (id, player_id, type, durability, status) VALUES (?, 'p1', ?, 0, 'idle')`, id, type);
    applyDurability(sql, { playerId: 'p1', shipId: id, delta: 100, reason: 'ship_delivery', sourceRef: 'test' }, T0);
    return id;
  }

  /** Топливо на несколько параллельных рейсов: списание тоже идёт через журнал. */
  function grantFuel(sql: SqlStorage, tx: <T>(fn: () => T) => T, amount: number): void {
    tx(() => applyDelta(sql, { playerId: 'p1', asset: 'fuel', delta: amount, reason: 'fuel_purchase', sourceRef: 'test' }, T0));
  }

  it('несколько кораблей — несколько рейсов, и каждый видит свою планету', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const scout = shipId(sql);
    const hauler = addShip(sql, 'ship-2', 'hauler');
    const miner = addShip(sql, 'ship-3', 'miner');
    grantFuel(sql, tx, 20);

    tx(() => startExpedition(sql, 'p1', 'k1', { shipId: scout, planet: 'ferra', kind: 'short' }, T0));
    tx(() => startExpedition(sql, 'p1', 'k2', { shipId: hauler, planet: 'cinder', kind: 'short' }, T0));
    tx(() => startExpedition(sql, 'p1', 'k3', { shipId: miner, planet: 'lumen', kind: 'short' }, T0));

    expect(sql.exec('SELECT COUNT(*) AS c FROM expeditions').toArray()[0].c).toBe(3);
    // Топливо кончилось ровно на суммарный расход: 1 + 2 + 2.
    expect(getBalance(sql, 'p1', 'fuel')).toBe(START_FUEL + 20 - 5);
    const list = listExpeditions(sql, 'p1');
    expect(list.active.length).toBe(3);
    expect(list.activeCount).toBe(3);
    // Порядок — по старту, и каждый рейс привязан к своему кораблю и планете.
    expect(list.active.map((e) => `${e.shipId}:${e.planet}`))
      .toEqual([`${scout}:ferra`, `ship-2:cinder`, `ship-3:lumen`]);
    expect(sql.exec(`SELECT status FROM ships WHERE id = 'ship-2'`).toArray()[0].status).toBe('flying');
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('тот же корабль дважды не улетает, свободный — улетает', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const scout = shipId(sql);
    addShip(sql, 'ship-2', 'hauler');
    grantFuel(sql, tx, 20);
    tx(() => startExpedition(sql, 'p1', 'k1', { shipId: scout, planet: 'ferra', kind: 'short' }, T0));
    expect(() => tx(() => startExpedition(sql, 'p1', 'k2', { shipId: scout, planet: 'cinder', kind: 'short' }, T0)))
      .toThrow(/ship_busy/);
    expect(() => tx(() => startExpedition(sql, 'p1', 'k3', { shipId: 'ship-2', planet: 'cinder', kind: 'short' }, T0)))
      .not.toThrow();
    expect(listExpeditions(sql, 'p1').activeCount).toBe(2);
  });

  it('отмена одного рейса не трогает остальные', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const scout = shipId(sql);
    addShip(sql, 'ship-2', 'hauler');
    grantFuel(sql, tx, 20);
    tx(() => startExpedition(sql, 'p1', 'k1', { shipId: scout, planet: 'ferra', kind: 'medium' }, T0));
    tx(() => startExpedition(sql, 'p1', 'k2', { shipId: 'ship-2', planet: 'cinder', kind: 'medium' }, T0));
    const first = String(sql.exec(`SELECT id FROM expeditions WHERE ship_id = ?`, scout).toArray()[0].id);

    tx(() => cancelExpedition(sql, 'p1', 'c1', first, T0 + 60_000));
    const left = listExpeditions(sql, 'p1');
    expect(left.activeCount).toBe(1);
    expect(left.active[0].shipId).toBe('ship-2');
    expect(String(sql.exec(`SELECT status FROM ships WHERE id = ?`, scout).toArray()[0].status)).toBe('idle');
    expect(String(sql.exec(`SELECT status FROM ships WHERE id = 'ship-2'`).toArray()[0].status)).toBe('flying');
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('оба рейса финишируют независимо и оба приносят награду', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const scout = shipId(sql);
    addShip(sql, 'ship-2', 'hauler');
    grantFuel(sql, tx, 20);
    tx(() => startExpedition(sql, 'p1', 'k1', { shipId: scout, planet: 'ferra', kind: 'short' }, T0));
    tx(() => startExpedition(sql, 'p1', 'k2', { shipId: 'ship-2', planet: 'cinder', kind: 'short' }, T0 + 1000));
    const ids = sql.exec('SELECT id FROM expeditions ORDER BY started_at').toArray().map((r) => String(r.id));
    for (const id of ids) tx(() => finishExpedition(sql, id, T0 + 60 * 60 * 1000));
    expect(sql.exec(`SELECT COUNT(*) AS c FROM expeditions WHERE status = 'completed'`).toArray()[0].c).toBe(2);
    expect(sql.exec(`SELECT COUNT(*) AS c FROM ships WHERE status = 'idle'`).toArray()[0].c).toBe(2);
    expect(getBalance(sql, 'p1', 'points')).toBeGreaterThan(0);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('список активных — массив: второй рейс не прячется за первым', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const one = listExpeditions(sql, 'p1');
    expect(one.active).toEqual([]);
    expect(one.activeCount).toBe(0);
    addShip(sql, 'ship-2', 'hauler');
    grantFuel(sql, tx, 20);
    tx(() => startExpedition(sql, 'p1', 'k1', { shipId: shipId(sql), planet: 'ferra', kind: 'short' }, T0));
    tx(() => startExpedition(sql, 'p1', 'k2', { shipId: 'ship-2', planet: 'cinder', kind: 'short' }, T0));
    const two = listExpeditions(sql, 'p1');
    expect(Array.isArray(two.active)).toBe(true);
    expect(two.active.length).toBe(2);
  });

/**
   * Дальность считается по флоту, а под выбранный борт — только оценки рейса.
   *
   * Старое поведение игрок видел как «странную дальность»: планета выглядела
   * закрытой, хотя в ангаре стоял корабль, который туда летает, — замок висел на
   * первом борту списка. Теперь `locked` означает «летать нечем», а «этот борт не
   * дотягивает» отделён (`shipTooFar`) и лечится выбором корабля рядом.
   */
  it('/me считает планеты под выбранный корабль, а не только под первый', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => setLevel(sql, 'p1', 12));
    const scout = shipId(sql);
    const explorer = addShip(sql, 'ship-exp', 'explorer');
    const byScout = buildState(sql, 'p1', T0, false, scout);
    const byExplorer = buildState(sql, 'p1', T0, false, explorer);
    // Vesper — сектор 3: скаут туда не долетает, разведчик долетает.
    const vesperScout = byScout.planets.find((p: { id: string }) => p.id === 'vesper')!;
    const vesperExplorer = byExplorer.planets.find((p: { id: string }) => p.id === 'vesper')!;
    expect(vesperScout.locked).toBe(false);
    expect(vesperScout.shipTooFar).toBe(true);
    expect(vesperScout.options).toEqual([]);
    expect(vesperScout.lock).toMatch(/Выберите борт с дальностью ≥ 3/);
    expect(vesperExplorer.locked).toBe(false);
    expect(vesperExplorer.shipTooFar).toBe(false);
    expect(vesperExplorer.options.length).toBe(3);
    // Дальность видна клиенту обоими числами: флота и выбранного борта.
    expect(vesperExplorer.fleetRange).toBe(4);
    expect(vesperScout.shipRange).toBe(2);
    // Топливо считается по выбранному корпусу: у explorer расход 1, у scout — 1,
    // а на средней дистанции оба платят по 2; важнее другое — оценки свои у каждого.
    expect(byScout.planets.find((p: { id: string }) => p.id === 'ferra')!.options[0].fuel)
      .toBe(byExplorer.planets.find((p: { id: string }) => p.id === 'ferra')!.options[0].fuel);
    // Несуществующий корабль не ломает состояние: сервер откатывается к первому,
    // но планета при этом остаётся открытой — флот-то долетает.
    const broken = buildState(sql, 'p1', T0, false, 'no-such-ship');
    expect(broken.planets.find((p: { id: string }) => p.id === 'vesper')!.locked).toBe(false);
    expect(broken.planets.find((p: { id: string }) => p.id === 'vesper')!.shipTooFar).toBe(true);
    // И без параметра — то же: планета доступна, вопрос только в борте.
    expect(buildState(sql, 'p1', T0, false).planets.find((p: { id: string }) => p.id === 'vesper')!.locked).toBe(false);
  });

  it('одним скаутом сектор 3 закрыт честно — и это видно в замке', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => setLevel(sql, 'p1', 12));
    const vesper = buildState(sql, 'p1', T0, false).planets.find((p: { id: string }) => p.id === 'vesper')!;
    expect(vesper.locked).toBe(true);
    expect(vesper.shipTooFar).toBe(false);
    expect(vesper.lock).toMatch(/Нужен корабль с дальностью ≥ 3 — сейчас у флота 2/);
  });
});
describe('экспедиция', () => {
  it('старт списывает топливо один раз, повтор ключа ничего не меняет', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const id = shipId(sql);
    const body = { shipId: id, planet: 'ferra', kind: 'short' };
    const a = tx(() => startExpedition(sql, 'p1', 'k1', body, T0));
    const b = tx(() => startExpedition(sql, 'p1', 'k1', body, T0));
    expect(b.expedition.id).toBe(a.expedition.id);
    expect(getBalance(sql, 'p1', 'fuel')).toBe(START_FUEL - 1);
    expect(() => tx(() => startExpedition(sql, 'p1', 'k2', body, T0))).toThrow(/ship_busy/);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('длинная без топлива не создаёт рейс, чужой сектор закрыт', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const id = shipId(sql);
    expect(() => tx(() => startExpedition(sql, 'p1', 'k', { shipId: id, planet: 'ferra', kind: 'long' }, T0))).toThrow(/not_enough_fuel/);
    expect(sql.exec('SELECT COUNT(*) AS c FROM expeditions').toArray()[0].c).toBe(0);
    expect(() => tx(() => startExpedition(sql, 'p1', 'k', { shipId: id, planet: 'tessera', kind: 'short' }, T0))).toThrow(/sector_locked/);
    tx(() => setLevel(sql, 'p1', 12));
    expect(() => tx(() => startExpedition(sql, 'p1', 'k', { shipId: id, planet: 'vesper', kind: 'short' }, T0))).toThrow(/ship_range/);
  });

  it('отмена в первые 10% возвращает половину топлива, позже — нет', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const id = shipId(sql);
    tx(() => startExpedition(sql, 'p1', 'k', { shipId: id, planet: 'ferra', kind: 'medium' }, T0));
    expect(getBalance(sql, 'p1', 'fuel')).toBe(1);
    expect(() => tx(() => cancelExpedition(sql, 'p1', 'c-late', expeditionId(sql), T0 + 30 * 60 * 1000))).toThrow(/too_late_to_cancel/);
    tx(() => cancelExpedition(sql, 'p1', 'c1', expeditionId(sql), T0 + 60_000));
    expect(getBalance(sql, 'p1', 'fuel')).toBe(2);
    expect(String(sql.exec(`SELECT status FROM expeditions`).toArray()[0].status)).toBe('cancelled');
    expect(String(sql.exec(`SELECT status FROM ships`).toArray()[0].status)).toBe('idle');
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('финиш начисляет один раз и сверяется с формулой по seed', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => startExpedition(sql, 'p1', 'k', { shipId: shipId(sql), planet: 'ferra', kind: 'short' }, T0));
    const row = sql.exec('SELECT id, seed FROM expeditions').toArray()[0];
    tx(() => finishExpedition(sql, String(row.id), T0 + SHORT));
    const expected = computeReward({
      planet: PLANET_BY_ID.ferra, shipType: 'scout', kind: 'short', seed: String(row.seed),
      eventBonusBp: 1000, extraWear: 0, durability: 100, expeditionsToday: 0, pointsToday: 0,
    });
    const done = sql.exec('SELECT status, reward_json FROM expeditions').toArray()[0];
    const reward = JSON.parse(String(done.reward_json));
    expect(done.status).toBe('completed');
    expect(reward.astra).toBe(expected.astra);
    expect(reward.points).toBe(expected.points);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA + expected.astra);
    expect(Number(sql.exec('SELECT durability FROM ships').toArray()[0].durability)).toBe(100 - expected.wear);
    const again = getBalance(sql, 'p1', 'astra');
    tx(() => finishExpedition(sql, String(row.id), T0 + SHORT));
    expect(getBalance(sql, 'p1', 'astra')).toBe(again);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('безопасный выбор и таймаут не ломают журнал', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => startExpedition(sql, 'p1', 'k', { shipId: shipId(sql), planet: 'ferra', kind: 'medium' }, T0));
    const exp = expeditionId(sql);
    const ev = sql.exec('SELECT idx, kind, opens_at FROM expedition_events').toArray()[0];
    tx(() => openExpeditionEvent(sql, exp, Number(ev.idx), Number(ev.opens_at)));
    expect(String(sql.exec('SELECT status FROM expeditions').toArray()[0].status)).toBe('waiting_choice');
    const safe = EVENTS[String(ev.kind) as 'anomaly'].choices.find((c) => c.safe);
    tx(() => chooseExpeditionEvent(sql, 'p1', 'ch', exp, String(safe?.id), Number(ev.opens_at) + 1000));
    expect(String(sql.exec('SELECT status FROM expeditions').toArray()[0].status)).toBe('flying');

    const { sql: sql2, tx: tx2 } = makeWorld();
    tx2(() => createPlayer(sql2, 'p1', T0));
    tx2(() => startExpedition(sql2, 'p1', 'k', { shipId: shipId(sql2), planet: 'ferra', kind: 'medium' }, T0));
    const exp2 = expeditionId(sql2);
    const ev2 = sql2.exec('SELECT idx, opens_at, deadline_at FROM expedition_events').toArray()[0];
    tx2(() => openExpeditionEvent(sql2, exp2, Number(ev2.idx), Number(ev2.opens_at)));
    tx2(() => timeoutExpeditionEvent(sql2, exp2, Number(ev2.idx), Number(ev2.deadline_at)));
    tx2(() => finishExpedition(sql2, exp2, T0 + MEDIUM));
    expect(String(sql2.exec('SELECT status FROM expeditions').toArray()[0].status)).toBe('completed');
    expect(verifyLedger(sql).ok).toBe(true);
    expect(verifyLedger(sql2).ok).toBe(true);
  });

  it('планировщик доводит рейс до completed и хоронит битую задачу после 5 попыток', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => startExpedition(sql, 'p1', 'k', { shipId: shipId(sql), planet: 'ferra', kind: 'short' }, T0));
    tx(() => enqueue(sql, 'boom', T0, {}));
    runDueJobs(sql, T0 + SHORT, tx);
    expect(String(sql.exec(`SELECT status FROM expeditions`).toArray()[0].status)).toBe('completed');
    expect(verifyLedger(sql).ok).toBe(true);
    let t = T0;
    for (let i = 0; i < 5; i++) {
      runDueJobs(sql, t, tx);
      const job = sql.exec(`SELECT status, run_at FROM jobs WHERE kind = 'boom'`).toArray()[0];
      t = Number(job.run_at);
      if (job.status === 'failed') break;
    }
    expect(String(sql.exec(`SELECT status FROM jobs WHERE kind = 'boom'`).toArray()[0].status)).toBe('failed');
  });
});

describe('ремонт, топливо, заморозка', () => {
  it('ремонт выше 50% списывает цену за процент, ниже 50% требует пластину и не трогает баланс', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const id = shipId(sql);
    // Износ идёт через журнал (срез 2): прямой UPDATE прочность больше не меняет.
    tx(() => applyDurability(sql, { playerId: 'p1', shipId: id, delta: -60, reason: 'test_wear' }, T0));
    expect(() => tx(() => repairShip(sql, 'p1', 'r0', id, T0))).toThrow(/repair_needs_alloy_plate/);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA);
    tx(() => applyDurability(sql, { playerId: 'p1', shipId: id, delta: 40, reason: 'test_wear' }, T0));
    const repaired = tx(() => repairShip(sql, 'p1', 'r1', id, T0));
    const expected = 20 * REPAIR_ASTRA_PER_PERCENT;
    expect(repaired.cost).toBe(expected);
    expect(repaired.durability).toBe(100);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA - expected);
    expect(tx(() => repairShip(sql, 'p1', 'r1', id, T0)).cost).toBe(expected);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA - expected);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('покупка топлива до бака и суточный отказ', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => buyFuel(sql, 'p1', 'f1', T0));
    tx(() => buyFuel(sql, 'p1', 'f2', T0));
    expect(getBalance(sql, 'p1', 'fuel')).toBe(5);
    expect(() => tx(() => buyFuel(sql, 'p1', 'f3', T0))).toThrow(/fuel_tank_full/);
    expect(getBalance(sql, 'p1', 'astra')).toBe(START_ASTRA - 50);
    tx(() => sql.exec('UPDATE balances SET amount = 0 WHERE player_id = ? AND asset = ?', 'p1', 'fuel'));
    tx(() => bumpDaily(sql, 'p1', Math.floor(T0 / DAY_MS), 'fuel_bought', 20));
    expect(() => tx(() => buyFuel(sql, 'p1', 'f4', T0))).toThrow(/fuel_daily_limit/);
  });

  it('расхождение журнала замораживает мир: рейс и Claim не проходят', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => sql.exec(`UPDATE balances SET amount = amount + 1 WHERE player_id = 'p1' AND asset = 'astra'`));
    tx(() => runLedgerVerify(sql, T0));
    expect(isFrozen(sql)).toBe(true);
    expect(() => tx(() => startExpedition(sql, 'p1', 'k', { shipId: shipId(sql), planet: 'ferra', kind: 'short' }, T0))).toThrow(/world_frozen/);
    expect(() => tx(() => claim(sql, 'p1', 'c', T0))).toThrow(/world_frozen/);
  });
});

describe('топливо на полном баке', () => {
  it('regenPlan не выдаёт сверх бака и не ставит задачу в прошлое', () => {
    const step = 2 * 60 * 60 * 1000;
    const plan = regenPlan(0, step * 10, 5, 5);
    expect(plan.grant).toBe(0);
    expect(plan.nextAt).toBeGreaterThan(step * 10);
  });
});
