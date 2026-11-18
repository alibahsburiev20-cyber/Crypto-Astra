import { FUEL_DAILY_MAX, FUEL_UNIT_PRICE, utcDay } from '../../shared/constants';
import { SHIPS, type ShipType } from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { repairCost } from './expeditionMath';
import { fxOfShip } from './shipModules';
import { applyDurability } from './progress';
import { applyResourceDelta, assertPlayable, bumpDaily, dailyOf, fuelCap, getResource } from './maintenance';

export function buyFuel(sql: SqlStorage, playerId: string, idemKey: string, now: number) {
  return withIdempotency(sql, playerId, 'fuel_buy', idemKey, { qty: 1 }, now, () => {
    assertPlayable(sql);
    const cap = fuelCap(sql, playerId);
    const have = getBalance(sql, playerId, 'fuel');
    if (have >= cap) throw new ApiError(409, 'fuel_tank_full');
    const day = utcDay(now);
    const bought = dailyOf(sql, playerId, day).fuelBought;
    if (bought >= FUEL_DAILY_MAX) throw new ApiError(409, 'fuel_daily_limit');
    const astra = applyDelta(sql, { playerId, asset: 'astra', delta: -FUEL_UNIT_PRICE, reason: 'fuel_purchase', idemKey }, now);
    const fuel = applyDelta(sql, { playerId, asset: 'fuel', delta: 1, reason: 'fuel_purchase', idemKey }, now);
    bumpDaily(sql, playerId, day, 'fuel_bought', 1);
    return { value: { astra, fuel, boughtToday: bought + 1, cap, price: FUEL_UNIT_PRICE }, store: true };
  });
}

export function repairShip(sql: SqlStorage, playerId: string, idemKey: string, shipId: string, now: number) {
  return withIdempotency(sql, playerId, 'repair', idemKey, { shipId }, now, () => {
    assertPlayable(sql);
    const rows = sql.exec('SELECT id, type, durability, status FROM ships WHERE id = ? AND player_id = ?', shipId, playerId).toArray();
    if (!rows.length) throw new ApiError(404, 'ship_not_found');
    if (String(rows[0].status) !== 'idle') throw new ApiError(409, 'ship_busy');
    const durability = Number(rows[0].durability);
    if (durability >= 100) throw new ApiError(409, 'nothing_to_repair');
    const def = SHIPS[String(rows[0].type) as ShipType];
    // Ремкомплект срезает цену ремонта.
    const cost = repairCost(100 - durability, def.repairCoef, fxOfShip(sql, shipId).repair);
    // Крупный ремонт (ниже 50 %) требует компонент: с этапа 2 его можно скрафтить,
    // поэтому это уже не тупик, а цена решения.
    const needsPlate = durability < 50;
    if (needsPlate && getResource(sql, playerId, 'alloy_plate') < 1) throw new ApiError(409, 'repair_needs_alloy_plate');
    const astra = applyDelta(sql, { playerId, asset: 'astra', delta: -cost, reason: 'repair', sourceRef: shipId, idemKey }, now);
    if (needsPlate) {
      applyResourceDelta(sql, { playerId, resource: 'alloy_plate', delta: -1, reason: 'repair_plate', sourceRef: shipId, idemKey }, now);
    }
    applyDurability(sql, { playerId, shipId, delta: 100 - durability, reason: 'repair', sourceRef: shipId, idemKey }, now);
    return { value: { shipId, durability: 100, cost, astra }, store: true };
  });
}
