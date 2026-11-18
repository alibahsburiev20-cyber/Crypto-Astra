import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { MODULES, MODULE_MAX_LEVEL, modulePrice } from '../../src/shared/gameData';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { computeReward, durationOf, repairCost } from '../../src/world/modules/expeditionMath';
import { startExpedition } from '../../src/world/modules/expeditions';
import { addResource, getResource, fuelCap } from '../../src/world/modules/maintenance';
import { createPlayer } from '../../src/world/modules/players';
import { applyDurability } from '../../src/world/modules/progress';
import { fxOfShip, installModule, moduleStateFor } from '../../src/world/modules/shipModules';
import { repairShip } from '../../src/world/modules/upkeep';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

function world() {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  w.tx(() => applyDelta(w.sql, { playerId: 'p1', asset: 'astra', delta: 100000, reason: 'claim' }, T0 + 1));
  return w;
}

function shipId(sql: SqlStorage): string {
  return String(sql.exec(`SELECT id FROM ships WHERE player_id = 'p1'`).toArray()[0].id);
}

/** Кладёт в трюм компоненты на уровень: amount × level. */
function giveParts(sql: SqlStorage, tx: <T>(fn: () => T) => T, module: keyof typeof MODULES, level: number) {
  for (const part of MODULES[module].parts) {
    tx(() => addResource(sql, 'p1', part.resource, part.amount * level, T0 + 2));
  }
}

/** Компоненты на все пять уровней сразу: 1+2+3+4+5 = 15 долей. */
function giveAllLevels(sql: SqlStorage, tx: <T>(fn: () => T) => T, module: keyof typeof MODULES) {
  giveParts(sql, tx, module, (MODULE_MAX_LEVEL * (MODULE_MAX_LEVEL + 1)) / 2);
}

describe('модули (срез 4 этапа 2)', () => {
  it('установка списывает ASTRA и компоненты, пишет журнал и даёт уровень 1', () => {
    const { sql, tx } = world();
    giveParts(sql, tx, 'engine', 1);
    const ship = shipId(sql);
    const astraBefore = getBalance(sql, 'p1', 'astra');

    const res = tx(() => installModule(sql, 'p1', 'k1', { shipId: ship, module: 'engine' }, T0 + 100));

    expect(res.level).toBe(1);
    expect(res.price).toBe(modulePrice('engine', 1));
    expect(getBalance(sql, 'p1', 'astra')).toBe(astraBefore - modulePrice('engine', 1));
    expect(getResource(sql, 'p1', 'circuit')).toBe(0);
    const reasons = sql.exec('SELECT reason FROM ledger').toArray().map((r) => String(r.reason));
    expect(reasons).toContain('module_buy');
    expect(reasons).toContain('module_parts');
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('без компонентов установка не начинается и ASTRA остаётся на месте', () => {
    const { sql, tx } = world();
    const ship = shipId(sql);
    const astraBefore = getBalance(sql, 'p1', 'astra');
    expect(() => tx(() => installModule(sql, 'p1', 'k1', { shipId: ship, module: 'engine' }, T0 + 100)))
      .toThrow(/insufficient_resources/);
    expect(getBalance(sql, 'p1', 'astra')).toBe(astraBefore);
    expect(fxOfShip(sql, ship).duration).toBe(1);
  });

  it('лимит слотов держится: у Scout один слот', () => {
    const { sql, tx } = world();
    const ship = shipId(sql);
    giveParts(sql, tx, 'engine', 1);
    giveParts(sql, tx, 'scanner', 1);
    tx(() => installModule(sql, 'p1', 'k1', { shipId: ship, module: 'engine' }, T0 + 100));
    expect(() => tx(() => installModule(sql, 'p1', 'k2', { shipId: ship, module: 'scanner' }, T0 + 200)))
      .toThrow(/module_slots_full/);
  });

  it('уровень растёт до максимума и дальше не продаётся', () => {
    const { sql, tx } = world();
    const ship = shipId(sql);
    giveAllLevels(sql, tx, 'engine');
    for (let level = 1; level <= MODULE_MAX_LEVEL; level++) {
      const res = tx(() => installModule(sql, 'p1', `k${level}`, { shipId: ship, module: 'engine' }, T0 + 100 * level));
      expect(res.level).toBe(level);
      expect(res.price).toBe(modulePrice('engine', level));
    }
    expect(() => tx(() => installModule(sql, 'p1', 'k6', { shipId: ship, module: 'engine' }, T0 + 900)))
      .toThrow(/module_max_level/);
  });

  it('повтор с тем же Idempotency-Key не списывает второй раз', () => {
    const { sql, tx } = world();
    const ship = shipId(sql);
    giveParts(sql, tx, 'engine', 1);
    const first = tx(() => installModule(sql, 'p1', 'same', { shipId: ship, module: 'engine' }, T0 + 100));
    const second = tx(() => installModule(sql, 'p1', 'same', { shipId: ship, module: 'engine' }, T0 + 100));
    expect(second.level).toBe(first.level);
    expect(sql.exec(`SELECT COUNT(*) AS c FROM ledger WHERE reason = 'module_buy'`).toArray()[0].c).toBe(1);
  });

  it('в полёте модуль не ставится', () => {
    const { sql, tx } = world();
    const ship = shipId(sql);
    giveParts(sql, tx, 'engine', 1);
    sql.exec(`UPDATE ships SET status = 'flying' WHERE id = ?`, ship);
    expect(() => tx(() => installModule(sql, 'p1', 'k1', { shipId: ship, module: 'engine' }, T0 + 100)))
      .toThrow(/ship_busy/);
  });

  it('двигатель сокращает рейс, щит срезает износ, бур и трюм увеличивают груз', () => {
    const { sql, tx } = world();
    const ship = shipId(sql);
    expect(durationOf('short', { ...fxOfShip(sql, ship) }).valueOf()).toBe(900000);
    giveAllLevels(sql, tx, 'engine');
    for (let level = 1; level <= MODULE_MAX_LEVEL; level++) {
      tx(() => installModule(sql, 'p1', `e${level}`, { shipId: ship, module: 'engine' }, T0 + 100 * level));
    }
    const fx = fxOfShip(sql, ship);
    expect(fx.duration).toBeCloseTo(0.85, 5);
    expect(durationOf('short', fx)).toBe(Math.round(900000 * 0.85));

    const planet = { id: 'ferra', name: 'Ferra', sector: 1, resources: ['iron_ore', 'copper_ore'] as [string, string], difficulty: 1, rareChance: 0.02 };
    const base = {
      planet, shipType: 'scout' as const, kind: 'short' as const, seed: 'ab'.repeat(8),
      eventBonusBp: 1000, extraWear: 0, durability: 100, expeditionsToday: 0, pointsToday: 0,
    };
    const plain = computeReward(base);
    const boosted = computeReward({ ...base, fx: { duration: 1, cargo: 1.5, mining: 1.3, wear: 0.6, repair: 0.5, tank: 5, scanner: 0.3 } });
    expect(boosted.wear).toBeLessThan(plain.wear);
    expect(boosted.units).toBeGreaterThanOrEqual(plain.units);
    expect(boosted.wear).toBeGreaterThanOrEqual(1);
  });

  it('топливная система расширяет бак, ремкомплект снижает цену ремонта', () => {
    const { sql, tx } = world();
    const ship = shipId(sql);
    expect(fuelCap(sql, 'p1')).toBe(5);
    giveParts(sql, tx, 'fuel_system', 2);
    tx(() => installModule(sql, 'p1', 'k1', { shipId: ship, module: 'fuel_system' }, T0 + 100));
    expect(fuelCap(sql, 'p1')).toBe(6);
    expect(repairCost(20, 1, fxOfShip(sql, ship).repair)).toBe(300);

    // Ремкомплект ставим на второй корабль: у Scout слот занят.
    const second = crypto.randomUUID();
    sql.exec(`INSERT INTO ships (id, player_id, type, durability, status) VALUES (?, 'p1', 'hauler', 0, 'idle')`, second);
    tx(() => applyDurability(sql, { playerId: 'p1', shipId: second, delta: 100, reason: 'ship_delivery' }, T0 + 101));
    giveParts(sql, tx, 'repair_kit', 1);
    tx(() => addResource(sql, 'p1', 'alloy_plate', 1, T0 + 102));
    tx(() => installModule(sql, 'p1', 'k2', { shipId: second, module: 'repair_kit' }, T0 + 102));
    expect(fxOfShip(sql, second).repair).toBeCloseTo(0.9, 5);
    const state = moduleStateFor(sql, 'p1');
    expect(state.ships.length).toBe(2);
    expect(state.ships[1].modules[0].id).toBe('repair_kit');
    expect(state.ships[1].modules[0].next?.level).toBe(2);

    tx(() => applyDurability(sql, { playerId: 'p1', shipId: second, delta: -60, reason: 'expedition_wear' }, T0 + 103));
    const before = getBalance(sql, 'p1', 'astra');
    const res = tx(() => repairShip(sql, 'p1', 'r1', second, T0 + 104));
    expect(res.cost).toBe(repairCost(60, 1.5, 0.9));
    expect(getBalance(sql, 'p1', 'astra')).toBe(before - res.cost);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('двигатель виден в старте рейса: конец наступает раньше', () => {
    const { sql, tx } = world();
    const ship = shipId(sql);
    giveAllLevels(sql, tx, 'engine');
    for (let level = 1; level <= MODULE_MAX_LEVEL; level++) {
      tx(() => installModule(sql, 'p1', `e${level}`, { shipId: ship, module: 'engine' }, T0 + 100 * level));
    }
    const now = T0 + 1000;
    const res = tx(() => startExpedition(sql, 'p1', 'x1', { shipId: ship, planet: 'ferra', kind: 'short' }, now));
    expect(res.expedition.endsAt - now).toBe(Math.round(900000 * 0.85));
    expect(verifyLedger(sql).ok).toBe(true);
  });
});
