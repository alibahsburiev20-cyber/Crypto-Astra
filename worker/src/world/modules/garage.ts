import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { playerExists } from './players';

// Гараж (этап 14). Корабль нельзя купить «в воздух»: сначала нужна ячейка.
// Ячейки не сгорают и не отбираются, они навсегда, как место в ангаре.
//
// Premium добавляет одну ячейку, пока подписка активна. Она не «покупает»
// преимущество в экономике: корабли всё равно стоят ASTRA, а ASTRA нельзя
// купить за USDT — то есть Premium продаёт место, а не деньги.

/** Сколько ячеек у всех. */
export const GARAGE_BASE = 3;
/** Потолок: больше 8 кораблей одновременно не нужно даже флагману. */
export const GARAGE_MAX = 8;
/** Цена одной дополнительной ячейки в ASTRA. */
export const SLOT_PRICE = 200;

export interface GarageView {
  slots: number;
  used: number;
  free: number;
  max: number;
  base: number;
  extra: number;
  premiumBonus: number;
  price: number;
  canBuy: boolean;
}

function extrasOf(sql: SqlStorage, playerId: string): number {
  const row = sql.exec('SELECT extra FROM garage_slots WHERE player_id = ?', playerId).toArray()[0];
  return row ? Number(row.extra) : 0;
}

function usedShips(sql: SqlStorage, playerId: string): number {
  const row = sql.exec('SELECT COUNT(*) AS n FROM ships WHERE player_id = ?', playerId).toArray()[0];
  return row ? Number(row.n) : 0;
}

/** Сколько ячеек доступно прямо сейчас: база + купленные + премиумная. */
export function garageSlots(sql: SqlStorage, playerId: string, premium = false): number {
  const slots = GARAGE_BASE + extrasOf(sql, playerId) + (premium ? 1 : 0);
  return Math.min(GARAGE_MAX, slots);
}

export function garageView(sql: SqlStorage, playerId: string, premium = false): GarageView {
  const extra = extrasOf(sql, playerId);
  const slots = garageSlots(sql, playerId, premium);
  const used = usedShips(sql, playerId);
  return {
    slots,
    used,
    free: Math.max(0, slots - used),
    max: GARAGE_MAX,
    base: GARAGE_BASE,
    extra,
    premiumBonus: premium ? 1 : 0,
    price: SLOT_PRICE,
    canBuy: GARAGE_BASE + extra < GARAGE_MAX,
  };
}

export interface BuySlotResult {
  slots: number;
  extra: number;
  price: number;
  astra: number;
}

/** Покупка ячейки. Цена фиксированная: «чем дальше, тем дороже» здесь не нужно. */
export function buySlot(sql: SqlStorage, playerId: string, idemKey: string, now: number): BuySlotResult {
  return withIdempotency<BuySlotResult>(sql, playerId, 'garage_slot', idemKey, {}, now, () => {
    if (!playerExists(sql, playerId)) throw new ApiError(404, 'player_not_found');
    assertPlayable(sql);
    const extra = extrasOf(sql, playerId);
    if (GARAGE_BASE + extra >= GARAGE_MAX) throw new ApiError(409, 'garage_max');
    if (getBalance(sql, playerId, 'astra') < SLOT_PRICE) throw new ApiError(409, 'insufficient_funds');

    sql.exec(
      `INSERT INTO garage_slots (player_id, extra, updated_at) VALUES (?, 1, ?)
       ON CONFLICT (player_id) DO UPDATE SET extra = extra + 1, updated_at = excluded.updated_at`,
      playerId, now,
    );
    const balance = applyDelta(sql, {
      playerId, asset: 'astra', delta: -SLOT_PRICE, reason: 'garage_slot', sourceRef: 'slot', idemKey,
    }, now);
    return {
      value: { slots: GARAGE_BASE + extra + 1, extra: extra + 1, price: SLOT_PRICE, astra: balance },
      store: true,
    };
  });
}
