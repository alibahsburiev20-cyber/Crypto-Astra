import { FUEL_DAILY_MAX, FUEL_UNIT_PRICE, utcDay } from '../../shared/constants';
import { SHIPS, type ShipType } from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { repairCost } from './expeditionMath';
import { assertPlayable, bumpDaily, dailyOf, fuelCap } from './maintenance';

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
    if (durability < 50) throw new ApiError(409, 'repair_needs_alloy_plate');
    const def = SHIPS[String(rows[0].type) as ShipType];
    const cost = repairCost(100 - durability, def.repairCoef);
    const astra = applyDelta(sql, { playerId, asset: 'astra', delta: -cost, reason: 'repair', sourceRef: shipId, idemKey }, now);
    sql.exec(`UPDATE ships SET durability = 100 WHERE id = ?`, shipId);
    return { value: { shipId, durability: 100, cost, astra }, store: true };
  });
}
