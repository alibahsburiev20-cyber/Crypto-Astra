import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { playerLevel } from './progress';
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
/** Цена первой дополнительной ячейки. Дальше она только растёт. */
export const SLOT_PRICE = 200;
/** Множитель цены за каждую купленную ячейку: вторая дороже первой в 1.8 раза. */
export const SLOT_STEP = 1.8;
/** Надбавка за уровень: +5 % к цене ячейки за каждый уровень выше первого. */
export const SLOT_LEVEL_STEP = 0.05;

/**
 * Цена следующей ячейки: `SLOT_PRICE × 1.8^купленных × (1 + 0.05 × (уровень − 1))`,
 * округлено до 10 ASTRA.
 *
 * Растёт по двум причинам и обе правильные. Во-первых, место в ангаре конечное:
 * шестая ячейка должна стоить дороже третьей, иначе «докупить» ничего не стоит.
 * Во-вторых, уровень — это прожитые рейсы и деньги: игрок 20-го уровня копит
 * быстрее новичка, поэтому цена обязана масштабироваться вместе с доходом, иначе
 * гараж был бы бесплатным для тех, кто в игре давно. Округление до 10 — чтобы в
 * интерфейсе не мелькали дробные ASTRA.
 */
export function slotPrice(extra: number, level: number): number {
  const grown = SLOT_PRICE * Math.pow(SLOT_STEP, Math.max(0, Math.floor(extra)));
  const levelFactor = 1 + SLOT_LEVEL_STEP * Math.max(0, Math.floor(level) - 1);
  return Math.max(SLOT_PRICE, Math.round((grown * levelFactor) / 10) * 10);
}

export interface GarageView {
  slots: number;
  used: number;
  free: number;
  max: number;
  base: number;
  extra: number;
  premiumBonus: number;
  /** Уровень игрока: он влияет на цену ячейки. */
  level: number;
  /** Сколько стоит следующая ячейка — уже с учётом уровня. */
  price: number;
  /** Лестница цен на все оставшиеся ячейки: видно, что каждая дороже предыдущей. */
  nextPrices: number[];
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
  const level = playerLevel(sql, playerId);
  const canBuy = GARAGE_BASE + extra < GARAGE_MAX;
  // Лестница считается для всех оставшихся ячеек, включая ту, что даёт Premium:
  // игрок обязан видеть потолок расходов до того, как начнёт платить.
  const nextPrices = canBuy
    ? Array.from({ length: GARAGE_MAX - (GARAGE_BASE + extra) }, (_, i) => slotPrice(extra + i, level))
    : [];
  return {
    slots,
    used,
    free: Math.max(0, slots - used),
    max: GARAGE_MAX,
    base: GARAGE_BASE,
    extra,
    premiumBonus: premium ? 1 : 0,
    level,
    price: slotPrice(extra, level),
    nextPrices,
    canBuy,
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
    // Цена считается в момент покупки: «доплатить за остаток по старой цене»
    // невозможно, и это правильно — ячейка дорожает вместе с игроком.
    const price = slotPrice(extra, playerLevel(sql, playerId));
    if (getBalance(sql, playerId, 'astra') < price) throw new ApiError(409, 'insufficient_funds');

    sql.exec(
      `INSERT INTO garage_slots (player_id, extra, updated_at) VALUES (?, 1, ?)
       ON CONFLICT (player_id) DO UPDATE SET extra = extra + 1, updated_at = excluded.updated_at`,
      playerId, now,
    );
    const balance = applyDelta(sql, {
      playerId, asset: 'astra', delta: -price, reason: 'garage_slot', sourceRef: 'slot', idemKey,
    }, now);
    return {
      value: { slots: GARAGE_BASE + extra + 1, extra: extra + 1, price, astra: balance },
      store: true,
    };
  });
}
