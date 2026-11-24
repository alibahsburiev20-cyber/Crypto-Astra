import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { SHIPS } from '../../src/shared/gameData';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { fuelCap } from '../../src/world/modules/maintenance';
import { createPlayer } from '../../src/world/modules/players';
import { buyShip } from '../../src/world/modules/ships';
import { setLevel } from '../helpers/level';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

function world(astra = 50000, level = 1) {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  if (astra > 0) w.tx(() => applyDelta(w.sql, { playerId: 'p1', asset: 'astra', delta: astra, reason: 'claim' }, T0 + 1));
  if (level > 1) setLevel(w.sql, 'p1', level);
  return w;
}

function shipCount(sql: SqlStorage, type?: string): number {
  const rows = type
    ? sql.exec('SELECT COUNT(*) AS c FROM ships WHERE player_id = ? AND type = ?', 'p1', type).toArray()
    : sql.exec('SELECT COUNT(*) AS c FROM ships WHERE player_id = ?', 'p1').toArray();
  return Number(rows[0].c);
}

describe('покупка кораблей (срез 5 этапа 2)', () => {
  it('покупка списывает ASTRA, ставит корабль и пишет журнал', () => {
    const { sql, tx } = world(50000, 5);
    const before = getBalance(sql, 'p1', 'astra');
    const res = tx(() => buyShip(sql, 'p1', 'k1', 'hauler', T0 + 100));

    expect(res.price).toBe(SHIPS.hauler.price);
    expect(res.ship.type).toBe('hauler');
    expect(getBalance(sql, 'p1', 'astra')).toBe(before - SHIPS.hauler.price);
    expect(shipCount(sql, 'hauler')).toBe(1);
    // Прочность приходит через журнал, как у стартового корабля.
    const dur = sql.exec(`SELECT durability FROM ships WHERE player_id = 'p1' AND type = 'hauler'`).toArray();
    expect(Number(dur[0].durability)).toBe(100);
    const reasons = sql.exec('SELECT reason FROM ledger').toArray().map((r) => String(r.reason));
    expect(reasons).toContain('ship_purchase');
    expect(reasons).toContain('ship_delivery');
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('бак растёт вместе с новым корпусом', () => {
    const { sql, tx } = world(50000, 5);
    expect(fuelCap(sql, 'p1')).toBe(SHIPS.scout.tank);
    tx(() => buyShip(sql, 'p1', 'k1', 'hauler', T0 + 100));
    expect(fuelCap(sql, 'p1')).toBe(SHIPS.hauler.tank);
  });

  it('уровень ниже нужного — отказ, деньги не списаны', () => {
    const { sql, tx } = world(50000, 1);
    const before = getBalance(sql, 'p1', 'astra');
    expect(() => tx(() => buyShip(sql, 'p1', 'k1', 'explorer', T0 + 100))).toThrow(/ship_locked/);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before);
    expect(shipCount(sql)).toBe(1);
  });

  it('второй такой же корпус не продаётся', () => {
    const { sql, tx } = world(50000, 5);
    tx(() => buyShip(sql, 'p1', 'k1', 'hauler', T0 + 100));
    expect(() => tx(() => buyShip(sql, 'p1', 'k2', 'hauler', T0 + 200))).toThrow(/ship_owned/);
    expect(shipCount(sql, 'hauler')).toBe(1);
  });

  it('без денег покупки нет, журнал не расходится', () => {
    const { sql, tx } = world(100, 5);
    expect(() => tx(() => buyShip(sql, 'p1', 'k1', 'miner', T0 + 100))).toThrow(/insufficient_funds/);
    expect(shipCount(sql)).toBe(1);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('Flagship за ASTRA не продаётся, выдуманный тип тоже', () => {
    const { sql, tx } = world(500000, 40);
    expect(() => tx(() => buyShip(sql, 'p1', 'k1', 'flagship', T0 + 100))).toThrow(/ship_not_for_sale/);
    expect(() => tx(() => buyShip(sql, 'p1', 'k2', 'dreadnought', T0 + 200))).toThrow(/bad_ship_type/);
  });

  it('повтор с тем же ключом не списывает второй раз', () => {
    const { sql, tx } = world(50000, 5);
    const first = tx(() => buyShip(sql, 'p1', 'same', 'miner', T0 + 100));
    const second = tx(() => buyShip(sql, 'p1', 'same', 'miner', T0 + 150));
    expect(second.ship.id).toBe(first.ship.id);
    expect(shipCount(sql, 'miner')).toBe(1);
    expect(sql.exec(`SELECT COUNT(*) AS c FROM ledger WHERE reason = 'ship_purchase'`).toArray()[0].c).toBe(1);
  });
});
