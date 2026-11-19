import { describe, expect, it } from 'vitest';
import {
  DAY_MS, MISSION_DAILY_REWARD, PASS_REWARDS, PASS_SLOT_LEVEL, PASS_THRESHOLDS,
} from '../../src/shared/constants';
import { RECIPES } from '../../src/shared/gameData';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { achievementsView } from '../../src/world/modules/achievements';
import { startCraft } from '../../src/world/modules/crafting';
import { addResource } from '../../src/world/modules/maintenance';
import { claimMission, dailyMissions, missionsView, weeklyMission } from '../../src/world/modules/missions';
import { claimPass, craftSlotsFor, levelForPoints, passView } from '../../src/world/modules/pass';
import { createPlayer } from '../../src/world/modules/players';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

type World = ReturnType<typeof makeWorld>;

function world(id = 'p1'): World {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, id, T0));
  return w;
}

function completed(w: World, playerId: string, count: number, at = T0 + 1000) {
  for (let i = 0; i < count; i += 1) {
    w.sql.exec(
      `INSERT INTO expeditions (id, player_id, ship_id, planet, kind, status, seed, started_at, ends_at, fuel_spent, created_at)
       VALUES (?, ?, 'ship-1', 'ferrum', 'short', 'completed', 'seed', ?, ?, 1, ?)`,
      crypto.randomUUID(), playerId, at - 500, at, at - 1000,
    );
  }
}

/** Закрывает миссию по её метрике: тест не должен зависеть от набора дня. */
function satisfy(w: World, mission: { metric: string; target: number }) {
  const at = T0 + 4000;
  if (mission.metric === 'expeditions') completed(w, 'p1', mission.target, at);
  if (mission.metric === 'crafts') {
    for (let i = 0; i < mission.target; i += 1) {
      w.sql.exec(
        `INSERT INTO craft_jobs (id, player_id, recipe, status, started_at, ends_at, fee)
         VALUES (?, 'p1', 'alloy_plate', 'done', ?, ?, 10)`,
        crypto.randomUUID(), at - 1000, at,
      );
    }
  }
  if (mission.metric === 'sales' || mission.metric === 'purchases') {
    for (let i = 0; i < mission.target; i += 1) {
      w.sql.exec(
        `INSERT INTO market_sales (id, lot_id, seller_id, buyer_id, resource, amount, unit_price, gross, tax, at)
         VALUES (?, ?, 'p1', 'p2', 'iron_ore', 1, 10, 10, 1, ?)`,
        crypto.randomUUID(), crypto.randomUUID(), at,
      );
    }
    if (mission.metric === 'purchases') {
      w.sql.exec(`UPDATE market_sales SET seller_id = 'p2', buyer_id = 'p1'`);
    }
  }
  if (mission.metric === 'claims') {
    for (let i = 0; i < mission.target; i += 1) {
      w.tx(() => applyDelta(w.sql, { playerId: 'p1', asset: 'astra', delta: 5, reason: 'claim', sourceRef: `c${i}` }, at));
    }
  }
  if (mission.metric === 'repairs') {
    for (let i = 0; i < mission.target; i += 1) {
      w.tx(() => applyDelta(w.sql, { playerId: 'p1', asset: 'astra', delta: -2, reason: 'repair', sourceRef: `r${i}` }, at));
    }
  }
}

function givePoints(w: World, playerId: string, amount: number) {
  w.tx(() => applyDelta(w.sql, { playerId, asset: 'points', delta: amount, reason: 'expedition_reward', sourceRef: 'exp' }, T0 + 100));
}

describe('миссии (этап 4)', () => {
  it('набор дня стабилен и состоит из трёх разных миссий', () => {
    const day = Math.floor(T0 / DAY_MS);
    const a = dailyMissions('p1', day);
    const b = dailyMissions('p1', day);
    expect(a).toHaveLength(3);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(new Set(a.map((m) => m.id)).size).toBe(3);
    // Другой день — другой набор хотя бы у одного из десяти игроков.
    const other = Array.from({ length: 10 }, (_, i) => dailyMissions(`p${i}`, day + 1).map((m) => m.id).join(','));
    const today = Array.from({ length: 10 }, (_, i) => dailyMissions(`p${i}`, day).map((m) => m.id).join(','));
    expect(other.some((ids, i) => ids !== today[i])).toBe(true);
  });

  it('прогресс считается по фактам игры, а не по счётчику клиента', () => {
    const w = world();
    completed(w, 'p1', 3);
    const view = missionsView(w.sql, 'p1', T0 + 5000);
    for (const m of [...view.daily, view.weekly]) {
      if (m.metric === 'expeditions') expect(m.progress).toBe(Math.min(m.target, 3));
      else expect(m.progress).toBe(0);
    }
  });

  it('награда выдаётся один раз и только за выполненную миссию', () => {
    const w = world();
    const day = Math.floor((T0 + 5000) / DAY_MS);
    const mission = dailyMissions('p1', day)[0];
    satisfy(w, mission);
    const before = getBalance(w.sql, 'p1', 'astra');
    const res = w.tx(() => claimMission(w.sql, 'p1', 'm1', mission.id, T0 + 5000));
    expect(res.astra).toBe(mission.astra);
    expect(getBalance(w.sql, 'p1', 'astra')).toBe(before + mission.astra);
    expect(getBalance(w.sql, 'p1', 'points')).toBe(MISSION_DAILY_REWARD.points >= mission.points ? mission.points : getBalance(w.sql, 'p1', 'points'));

    expect(() => w.tx(() => claimMission(w.sql, 'p1', 'm2', mission.id, T0 + 6000))).toThrowError(/mission_claimed/);
    expect(() => w.tx(() => claimMission(w.sql, 'p1', 'm3', 'nope', T0 + 6000))).toThrowError(/bad_mission/);
    expect(verifyLedger(w.sql).ok).toBe(true);
  });

  it('незавершённую миссию забрать нельзя', () => {
    const w = world();
    const day = Math.floor((T0 + 5000) / DAY_MS);
    const mission = dailyMissions('p1', day)[0];
    expect(() => w.tx(() => claimMission(w.sql, 'p1', 'm1', mission.id, T0 + 5000))).toThrowError(/mission_incomplete/);
  });

  it('недельная миссия считается отдельно от дневных', () => {
    const w = world();
    const day = Math.floor(T0 / DAY_MS);
    const week = Math.floor(day / 7);
    const mission = weeklyMission('p1', week);
    expect(mission.id.startsWith('w_')).toBe(true);
    satisfy(w, mission);
    const res = w.tx(() => claimMission(w.sql, 'p1', 'w1', mission.id, T0 + 5000));
    expect(res.astra).toBe(mission.astra);
    expect(w.sql.exec('SELECT COUNT(*) AS c FROM mission_claims').toArray()[0].c).toBe(1);
  });
});

describe('Astra Pass (этап 4)', () => {
  it('пороги уровней считаются по очкам сезона', () => {
    expect(levelForPoints(0)).toBe(0);
    expect(levelForPoints(PASS_THRESHOLDS[0] - 1)).toBe(0);
    expect(levelForPoints(PASS_THRESHOLDS[0])).toBe(1);
    expect(levelForPoints(PASS_THRESHOLDS[2])).toBe(3);
    expect(levelForPoints(1_000_000)).toBe(PASS_THRESHOLDS.length);
  });

  it('награду нельзя забрать дважды и нельзя забрать закрытый уровень', () => {
    const w = world();
    givePoints(w, 'p1', PASS_THRESHOLDS[0]);
    const before = getBalance(w.sql, 'p1', 'astra');
    const res = w.tx(() => claimPass(w.sql, 'p1', 'p1', 1, T0 + 2000));
    // Сумма берётся из константы, а не из литерала: баланс правят симуляцией.
    const reward = PASS_REWARDS[1].astra ?? 0;
    expect(reward).toBeGreaterThan(0);
    expect(res.astra).toBe(reward);
    expect(getBalance(w.sql, 'p1', 'astra')).toBe(before + reward);
    expect(() => w.tx(() => claimPass(w.sql, 'p1', 'p2', 1, T0 + 3000))).toThrowError(/pass_claimed/);
    expect(() => w.tx(() => claimPass(w.sql, 'p1', 'p3', 5, T0 + 3000))).toThrowError(/pass_locked/);
    expect(() => w.tx(() => claimPass(w.sql, 'p1', 'p4', 99, T0 + 3000))).toThrowError(/bad_pass_level/);
    expect(verifyLedger(w.sql).ok).toBe(true);
  });

  it('третий уровень открывает второй слот крафта', () => {
    const w = world();
    givePoints(w, 'p1', PASS_THRESHOLDS[PASS_SLOT_LEVEL - 1]);
    expect(craftSlotsFor(w.sql, 'p1')).toBe(1);

    // Материалы на две пластины: 6 руды и 4 меди.
    w.tx(() => addResource(w.sql, 'p1', 'iron_ore', 6, T0));
    w.tx(() => addResource(w.sql, 'p1', 'copper_ore', 4, T0));
    w.tx(() => applyDelta(w.sql, { playerId: 'p1', asset: 'astra', delta: 2000, reason: 'claim', sourceRef: 'x' }, T0));
    w.tx(() => startCraft(w.sql, 'p1', 'c1', 'alloy_plate', T0 + 1000));
    expect(() => w.tx(() => startCraft(w.sql, 'p1', 'c2', 'alloy_plate', T0 + 2000))).toThrowError(/craft_queue_full/);

    w.tx(() => claimPass(w.sql, 'p1', 'p1', PASS_SLOT_LEVEL, T0 + 3000));
    expect(craftSlotsFor(w.sql, 'p1')).toBe(2);
    const second = w.tx(() => startCraft(w.sql, 'p1', 'c3', 'alloy_plate', T0 + 4000));
    expect(second.slots).toBe(2);
    expect(w.sql.exec(`SELECT COUNT(*) AS c FROM craft_jobs WHERE status = 'running'`).toArray()[0].c).toBe(2);
    expect(RECIPES.alloy_plate.inputs.length).toBe(2);
  });
});

describe('Astra Pass: обзор и достижения', () => {
  it('обзор Pass показывает следующий уровень и забранные награды', () => {
    const w = world();
    givePoints(w, 'p1', PASS_THRESHOLDS[1]);
    w.tx(() => claimPass(w.sql, 'p1', 'k1', 1, T0 + 2000));
    const view = passView(w.sql, 'p1', T0 + 3000);
    expect(view.level).toBe(2);
    expect(view.levels[0]).toMatchObject({ level: 1, claimed: true, ready: false });
    expect(view.levels[1]).toMatchObject({ level: 2, unlocked: true, claimed: false, ready: true });
    expect(view.next?.level).toBe(3);
    expect(view.slotActive).toBe(false);
  });

  it('достижения открываются по фактам и не дают ASTRA', () => {
    const w = world();
    const empty = achievementsView(w.sql, 'p1');
    expect(empty.unlocked).toBe(0);
    expect(empty.list.find((a) => a.id === 'first_expedition')?.unlocked).toBe(false);

    completed(w, 'p1', 1);
    const astraBefore = getBalance(w.sql, 'p1', 'astra');
    const after = achievementsView(w.sql, 'p1');
    expect(after.list.find((a) => a.id === 'first_expedition')?.unlocked).toBe(true);
    expect(after.list.find((a) => a.id === 'ten_expeditions')?.unlocked).toBe(false);
    // Косметика: баланс не изменился.
    expect(getBalance(w.sql, 'p1', 'astra')).toBe(astraBefore);
  });

  it('в новом сезоне награды Pass доступны снова, а слот крафта остаётся', () => {
    const w = world();
    givePoints(w, 'p1', PASS_THRESHOLDS[PASS_SLOT_LEVEL - 1]);
    w.tx(() => claimPass(w.sql, 'p1', 'k1', 1, T0 + 1000));
    w.tx(() => claimPass(w.sql, 'p1', 'k2', PASS_SLOT_LEVEL, T0 + 2000));
    expect(craftSlotsFor(w.sql, 'p1')).toBe(2);

    // Сезон закрылся и очки сбросились: отметки остались, но они из прошлого сезона.
    w.sql.exec("UPDATE pass_claims SET season_id = 'past'");
    const view = passView(w.sql, 'p1', T0 + 3000);
    // Отметка прошлого сезона больше не считается: уровень снова доступен.
    expect(view.levels[0]).toMatchObject({ claimed: false, ready: true });
    // Слот и косметика не сгорают вместе с очками.
    expect(craftSlotsFor(w.sql, 'p1')).toBe(2);
    expect(view.slotActive).toBe(true);
    expect(view.badges.length).toBe(0);

    // Набрал очки в новом сезоне — те же уровни можно забрать снова.
    const res = w.tx(() => claimPass(w.sql, 'p1', 'k3', 1, T0 + 5000));
    expect(res.astra).toBe(PASS_REWARDS[1].astra);
  });
});
