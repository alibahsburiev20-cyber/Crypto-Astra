import {
  MARKET_CORRIDOR_BP, MARKET_LOT_LIMIT, MARKET_MAX_AMOUNT, MARKET_TAX_BP, MARKET_WINDOW_MS,
  RESOURCE_BASE_PRICES, RESOURCE_NAMES, marketTax,
} from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { applyResourceDelta, assertPlayable, getResource } from './maintenance';

// Рынок (этап 2, срез 6). Лот держит ресурс в эскроу: при выставлении он
// списывается у продавца, приходит покупателю только при покупке, а при отмене
// возвращается продавцу. Поэтому продать один и тот же ресурс дважды нельзя.
//
// Налог уходит в систему отдельной записью: продавцу начисляется вся выручка
// (market_sale), налог списывается (market_tax). Так его видно в журнале, и
// сверка остаётся простой: сумма записей равна остатку.

export const TRADABLE_RESOURCES: string[] = Object.keys(RESOURCE_BASE_PRICES);

export interface PriceBand {
  /** Базовая цена ресурса: используется, пока сделок не было. */
  base: number;
  median: number;
  min: number;
  max: number;
  sales: number;
}

/**
 * Сколько последних сделок читает коридор цены.
 *
 * Потолок — не косметика: запрос идёт на каждом открытом экране рынка (по разу
 * на каждый ресурс), а `market_sales` — таблица append-only и растёт вместе с
 * оборотом. Без потолка «медиана за 7 дней» превращается в «прочесть все сделки
 * недели и отсортировать их», и ровно это можно было раздуть двумя счётчиками до
 * сотен тысяч строк на один запрос. 2 000 последних сделок — это медиана того же
 * смысла и работа за конечное время.
 */
export const MARKET_BAND_MAX_SALES = 2000;

/** Коридор цены: медиана сделок за 7 дней (или база) ±50 %. */
export function priceBand(sql: SqlStorage, resource: string, now: number): PriceBand {
  const base = RESOURCE_BASE_PRICES[resource];
  if (!base) throw new ApiError(400, 'bad_resource');
  // Сначала «последние N» (индекс `(resource, at)`), уже среди них — сортировка
  // по цене для медианы. Наоборот (ORDER BY unit_price LIMIT N) получили бы
  // «медиана самых дешёвых», и коридор уехал бы вниз.
  const prices = sql.exec(
    `SELECT unit_price FROM (
        SELECT unit_price FROM market_sales WHERE resource = ? AND at >= ?
         ORDER BY at DESC LIMIT ?
     ) ORDER BY unit_price`,
    resource, now - MARKET_WINDOW_MS, MARKET_BAND_MAX_SALES,
  ).toArray().map((r) => Number(r.unit_price));
  let median = base;
  if (prices.length) {
    const mid = Math.floor(prices.length / 2);
    median = prices.length % 2 === 1 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
  }
  const min = Math.max(1, Math.ceil((median * (10000 - MARKET_CORRIDOR_BP)) / 10000));
  const max = Math.max(min, Math.floor((median * (10000 + MARKET_CORRIDOR_BP)) / 10000));
  return { base, median, min, max, sales: prices.length };
}

function sellerLabel(id: string): string {
  // Полного имени в мире нет: клиент показывает только email-логин у себя.
  return `Пилот ${id.slice(0, 4)}`;
}

interface LotRow {
  id: string; seller_id: string; resource: string; amount: number; unit_price: number; status: string; created_at: number;
}

function lotOf(sql: SqlStorage, lotId: string): LotRow {
  const rows = sql.exec(
    'SELECT id, seller_id, resource, amount, unit_price, status, created_at FROM market_lots WHERE id = ?',
    lotId,
  ).toArray();
  if (!rows.length) throw new ApiError(404, 'lot_not_found');
  const r = rows[0];
  return {
    id: String(r.id), seller_id: String(r.seller_id), resource: String(r.resource),
    amount: Number(r.amount), unit_price: Number(r.unit_price), status: String(r.status), created_at: Number(r.created_at),
  };
}

function lotView(row: Record<string, unknown>, playerId: string) {
  const amount = Number(row.amount);
  const unitPrice = Number(row.unit_price);
  return {
    id: String(row.id),
    resource: String(row.resource),
    name: RESOURCE_NAMES[String(row.resource)] ?? String(row.resource),
    amount,
    unitPrice,
    total: amount * unitPrice,
    seller: sellerLabel(String(row.seller_id)),
    mine: String(row.seller_id) === playerId,
    createdAt: Number(row.created_at),
  };
}

/** Что видит клиент: свои и чужие лоты, коридор по каждому ресурсу, лимиты. */
export function marketView(sql: SqlStorage, playerId: string, now: number) {
  const lots = sql.exec(
    `SELECT id, seller_id, resource, amount, unit_price, created_at FROM market_lots
      WHERE status = 'open' ORDER BY unit_price, created_at LIMIT 200`,
  ).toArray().map((r) => lotView(r, playerId));
  const mine = lots.filter((l) => l.mine).length;
  return {
    tax: MARKET_TAX_BP / 100,
    limit: MARKET_LOT_LIMIT,
    maxAmount: MARKET_MAX_AMOUNT,
    windowDays: Math.round(MARKET_WINDOW_MS / 86400000),
    lots,
    mine,
    resources: TRADABLE_RESOURCES.map((id) => ({
      id,
      name: RESOURCE_NAMES[id] ?? id,
      have: getResource(sql, playerId, id),
      band: priceBand(sql, id, now),
    })),
    astra: getBalance(sql, playerId, 'astra'),
  };
}

export interface CreateLotInput { resource: string; amount: number; unitPrice: number }

/** Выставление лота: ресурс уходит в эскроу той же транзакцией. */
export function createLot(sql: SqlStorage, playerId: string, idemKey: string, body: CreateLotInput, now: number) {
  return withIdempotency(sql, playerId, 'market_lot', idemKey, body, now, () => {
    assertPlayable(sql);
    const resource = String(body.resource ?? '');
    if (!RESOURCE_BASE_PRICES[resource]) throw new ApiError(400, 'bad_resource');
    const amount = Math.floor(Number(body.amount));
    const unitPrice = Math.floor(Number(body.unitPrice));
    if (!Number.isFinite(amount) || amount <= 0 || amount > MARKET_MAX_AMOUNT) throw new ApiError(400, 'bad_amount');
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new ApiError(400, 'bad_price');

    const open = Number(sql.exec(
      `SELECT COUNT(*) AS c FROM market_lots WHERE seller_id = ? AND status = 'open'`,
      playerId,
    ).toArray()[0].c);
    if (open >= MARKET_LOT_LIMIT) throw new ApiError(409, 'market_lot_limit');

    const band = priceBand(sql, resource, now);
    if (unitPrice < band.min || unitPrice > band.max) throw new ApiError(409, 'price_out_of_band');
    if (getResource(sql, playerId, resource) < amount) throw new ApiError(409, 'insufficient_resources');

    const id = crypto.randomUUID();
    applyResourceDelta(sql, { playerId, resource, delta: -amount, reason: 'market_escrow', sourceRef: id, idemKey }, now);
    sql.exec(
      `INSERT INTO market_lots (id, seller_id, resource, amount, unit_price, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      id, playerId, resource, amount, unitPrice, now,
    );
    return {
      value: { lot: lotView({ id, seller_id: playerId, resource, amount, unit_price: unitPrice, created_at: now }, playerId) },
      store: true,
    };
  });
}

function flag(sql: SqlStorage, kind: string, sellerId: string, buyerId: string, resource: string, gross: number, now: number): void {
  sql.exec(
    'INSERT INTO market_flags (id, kind, seller_id, buyer_id, resource, gross, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    crypto.randomUUID(), kind, sellerId, buyerId, resource, gross, now,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Покупка лота целиком. Покупатель платит всю сумму, продавец получает выручку
 * и платит налог отдельной записью. Лот закрывается в той же транзакции, поэтому
 * два покупателя не могут купить один лот.
 */
export function buyLot(sql: SqlStorage, playerId: string, idemKey: string, lotId: string, now: number) {
  return withIdempotency(sql, playerId, 'market_buy', idemKey, { lotId }, now, () => {
    assertPlayable(sql);
    const lot = lotOf(sql, lotId);
    if (lot.status !== 'open') throw new ApiError(409, 'lot_closed');
    if (lot.seller_id === playerId) throw new ApiError(409, 'own_lot');

    const gross = lot.amount * lot.unit_price;
    const tax = marketTax(gross);
    if (getBalance(sql, playerId, 'astra') < gross) throw new ApiError(409, 'insufficient_funds');

    applyDelta(sql, { playerId, asset: 'astra', delta: -gross, reason: 'market_buy', sourceRef: lotId, idemKey }, now);
    applyResourceDelta(sql, { playerId, resource: lot.resource, delta: lot.amount, reason: 'market_buy', sourceRef: lotId, idemKey }, now);
    applyDelta(sql, { playerId: lot.seller_id, asset: 'astra', delta: gross, reason: 'market_sale', sourceRef: lotId, idemKey }, now);
    if (tax > 0) {
      applyDelta(sql, { playerId: lot.seller_id, asset: 'astra', delta: -tax, reason: 'market_tax', sourceRef: lotId, idemKey }, now);
    }
    sql.exec(
      `INSERT INTO market_sales (id, lot_id, seller_id, buyer_id, resource, amount, unit_price, gross, tax, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), lotId, lot.seller_id, playerId, lot.resource, lot.amount, lot.unit_price, gross, tax, now,
    );
    sql.exec(
      `UPDATE market_lots SET status = 'sold', buyer_id = ?, closed_at = ? WHERE id = ?`,
      playerId, now, lotId,
    );

    // Флаги не блокируют сделку: их смотрят при разборе спорных случаев.
    const pair = sql.exec(
      `SELECT COUNT(*) AS c FROM market_sales
        WHERE at >= ? AND ((seller_id = ? AND buyer_id = ?) OR (seller_id = ? AND buyer_id = ?))`,
      now - DAY_MS, lot.seller_id, playerId, playerId, lot.seller_id,
    ).toArray();
    if (Number(pair[0].c) >= 3) flag(sql, 'repeat_pair', lot.seller_id, playerId, lot.resource, gross, now);
    if (gross >= 20000) flag(sql, 'large_trade', lot.seller_id, playerId, lot.resource, gross, now);

    return {
      value: {
        lotId, resource: lot.resource, amount: lot.amount, unitPrice: lot.unit_price,
        gross, tax, astra: getBalance(sql, playerId, 'astra'),
      },
      store: true,
    };
  });
}

/** Отмена: эскроу возвращается продавцу, лот закрывается. */
export function cancelLot(sql: SqlStorage, playerId: string, idemKey: string, lotId: string, now: number) {
  return withIdempotency(sql, playerId, 'market_cancel', idemKey, { lotId }, now, () => {
    assertPlayable(sql);
    const lot = lotOf(sql, lotId);
    if (lot.seller_id !== playerId) throw new ApiError(403, 'not_your_lot');
    if (lot.status !== 'open') throw new ApiError(409, 'lot_closed');
    applyResourceDelta(sql, {
      playerId, resource: lot.resource, delta: lot.amount, reason: 'market_cancel', sourceRef: lotId, idemKey,
    }, now);
    sql.exec(`UPDATE market_lots SET status = 'cancelled', closed_at = ? WHERE id = ?`, now, lotId);
    return { value: { lotId, resource: lot.resource, amount: lot.amount }, store: true };
  });
}
