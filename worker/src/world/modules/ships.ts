import { SHIPS, type ShipType } from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { applyDurability } from './progress';
import { garageSlots } from './garage';

// Покупка корабля (этап 2, срез 5). Один корпус каждого типа: флот растёт по
// уровням, а не по количеству одинаковых Scout'ов. Flagship не продаётся за
// ASTRA — он появится вместе с чертежом и крафтом.

export interface BuyResult {
  ship: { id: string; type: ShipType; name: string };
  price: number;
  astra: number;
}

export function buyShip(
  sql: SqlStorage, playerId: string, idemKey: string, type: string, now: number, premium = false,
): BuyResult {
  return withIdempotency(sql, playerId, 'ship_buy', idemKey, { type }, now, () => {
    assertPlayable(sql);
    const def = SHIPS[type as ShipType];
    if (!def) throw new ApiError(400, 'bad_ship_type');
    if (def.price == null) throw new ApiError(400, 'ship_not_for_sale');

    const player = sql.exec('SELECT level FROM players WHERE id = ?', playerId).toArray();
    if (!player.length) throw new ApiError(404, 'player_not_found');
    if (Number(player[0].level) < def.unlockLevel) throw new ApiError(403, 'ship_locked');

    const owned = sql.exec('SELECT 1 FROM ships WHERE player_id = ? AND type = ? LIMIT 1', playerId, def.type).toArray();
    if (owned.length) throw new ApiError(409, 'ship_owned');

    // Гараж: без свободной ячейки новый корпус купить нельзя. Проверка стоит до
    // списания ASTRA, чтобы отказ не стоил игроку денег.
    const fleet = sql.exec('SELECT COUNT(*) AS n FROM ships WHERE player_id = ?', playerId).toArray()[0];
    if (Number(fleet?.n ?? 0) >= garageSlots(sql, playerId, premium)) throw new ApiError(409, 'garage_full');

    if (getBalance(sql, playerId, 'astra') < def.price) throw new ApiError(409, 'insufficient_funds');
    const price = def.price;
    const shipId = crypto.randomUUID();
    applyDelta(sql, { playerId, asset: 'astra', delta: -price, reason: 'ship_purchase', sourceRef: shipId, idemKey }, now);
    // Как и стартовый корабль: вставляем с нулевой прочностью и начисляем 100
    // через журнал, иначе сумма журнала не сойдётся с полем durability.
    sql.exec(`INSERT INTO ships (id, player_id, type, durability, status) VALUES (?, ?, ?, 0, 'idle')`, shipId, playerId, def.type);
    applyDurability(sql, { playerId, shipId, delta: 100, reason: 'ship_delivery', sourceRef: shipId, idemKey }, now);

    return {
      value: { ship: { id: shipId, type: def.type, name: def.name }, price, astra: getBalance(sql, playerId, 'astra') },
      store: true,
    };
  });
}
