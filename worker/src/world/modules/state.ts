import { FUEL_DAILY_MAX, FUEL_UNIT_PRICE, utcDay } from '../../shared/constants';
import {
  EXPEDITION_TYPES, PLANETS, RESOURCE_NAMES, SECTORS, SHIP_ORDER, SHIPS, sectorById,
  type ExpeditionKind, type ShipType,
} from '../../shared/gameData';
import { fuelCost, repairCost, rewardRange, xpThreshold } from './expeditionMath';
import { listExpeditions } from './expeditions';
import { dailyOf, fuelCap, isFrozen } from './maintenance';
import { playerPayload } from '../scheduler';
import { getPlayerState } from './players';

export function buildState(sql: SqlStorage, playerId: string, now: number) {
  const base = getPlayerState(sql, playerId);
  const day = utcDay(now);
  const daily = dailyOf(sql, playerId, day);
  const cap = fuelCap(sql, playerId);
  const owned = new Set(base.ships.map((s) => String(s.type)));
  const ships = base.ships.map((raw) => {
    const type = String(raw.type) as ShipType;
    const def = SHIPS[type];
    const durability = Number(raw.durability);
    const status = String(raw.status);
    let repair: { blocked: 'ok' | 'busy' | 'full' | 'needs_plate'; cost: number | null } = { blocked: 'full', cost: null };
    if (status !== 'idle') repair = { blocked: 'busy', cost: null };
    else if (durability < 50) repair = { blocked: 'needs_plate', cost: null };
    else if (durability < 100) repair = { blocked: 'ok', cost: repairCost(100 - durability, def.repairCoef) };
    return { id: String(raw.id), type, name: def.name, durability, status, repair };
  });
  const activeShip = ships[0];
  const planets = PLANETS.map((planet) => {
    const sector = sectorById(planet.sector);
    const levelLocked = base.level < sector.level;
    const rangeLocked = !activeShip || SHIPS[activeShip.type].maxSector < planet.sector;
    const locked = levelLocked || rangeLocked;
    const options = locked || !activeShip ? [] : (['short', 'medium', 'long'] as ExpeditionKind[]).map((kind) => {
      const type = EXPEDITION_TYPES[kind];
      const range = rewardRange(planet.id, activeShip.type, kind);
      return {
        kind, label: type.label, durationMs: type.durationMs, xp: type.xp, fuel: fuelCost(SHIPS[activeShip.type].consumption, kind),
        astra: range.astra, units: range.units,
      };
    });
    return {
      id: planet.id, name: planet.name, sector: planet.sector, sectorName: sector.name,
      resources: planet.resources.map((id) => ({ id, name: RESOURCE_NAMES[id] ?? id })),
      difficulty: planet.difficulty, locked,
      lock: levelLocked ? `Нужен уровень ${sector.level}` : rangeLocked ? 'Корабль не долетает до сектора' : null,
      options,
    };
  });
  const regen = sql.exec(
    `SELECT MIN(run_at) AS t FROM jobs WHERE kind = 'fuel_regen' AND status = 'pending' AND payload = ?`,
    playerPayload(playerId),
  ).toArray();
  const nextFuelAt = regen.length && regen[0].t != null ? Number(regen[0].t) : null;
  return {
    ...base,
    ships,
    xpNext: xpThreshold(base.level + 1),
    resources: sql.exec('SELECT resource, amount FROM resources WHERE player_id = ? AND amount > 0 ORDER BY resource', playerId).toArray()
      .map((r) => ({ id: String(r.resource), name: RESOURCE_NAMES[String(r.resource)] ?? String(r.resource), amount: Number(r.amount) })),
    fuel: { cap, price: FUEL_UNIT_PRICE, boughtToday: daily.fuelBought, dailyMax: FUEL_DAILY_MAX, nextAt: nextFuelAt },
    expeditions: listExpeditions(sql, playerId),
    frozen: isFrozen(sql),
    catalog: SHIP_ORDER.map((type) => {
      const def = SHIPS[type];
      return {
        type, name: def.name, rarity: def.rarity, cargo: def.cargo, tank: def.tank, consumption: def.consumption,
        mining: def.mining, price: def.price, unlockLevel: def.unlockLevel, owned: owned.has(type),
        locked: !owned.has(type),
      };
    }),
    sectors: SECTORS.map((s) => ({ id: s.id, name: s.name, level: s.level, open: base.level >= s.level })),
  };
}

export function listLedger(sql: SqlStorage, playerId: string, limit: number) {
  const n = Math.min(50, Math.max(1, Math.floor(limit) || 20));
  return sql.exec(
    `SELECT seq, asset, delta, reason, source_ref, created_at FROM ledger WHERE player_id = ? ORDER BY seq DESC LIMIT ?`,
    playerId, n,
  ).toArray().map((r) => ({
    seq: Number(r.seq), asset: String(r.asset), delta: Number(r.delta), reason: String(r.reason),
    sourceRef: r.source_ref == null ? null : String(r.source_ref), createdAt: Number(r.created_at),
  }));
}
