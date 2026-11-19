import { ApiError } from '../world/errors';

// Пул (этап 5, срезы 5.1–5.2). Это учёт денег вокруг игры: взносы, призы и
// расходы на операции. С игровой валютой он не связан: ASTRA живёт в Ledger мира,
// её нельзя купить или вывести, поэтому никаких «курсов» здесь нет.
//
// Правила учёта простые и проверяемые:
//   · запись append-only, исправление — обратная запись, а не правка;
//   · `ref` уникален: повторный вебхук не удвоит отчёт;
//   · суммы в минимальных единицах валюты (для EUR/USD — центы), без float;
//   · 20 % взносов резервируется на операции (домен, хостинг, реклама), остальное
//     считается призовым фондом. Это отчётная величина, а не автоматический перевод.

/** Доля взносов, зарезервированная на операции, в базисных пунктах. */
export const POOL_FEE_BP = 2000;
export const POOL_FEE_PERCENT = POOL_FEE_BP / 100;
export const POOL_CURRENCIES = ['EUR', 'USD'] as const;
export type PoolCurrency = (typeof POOL_CURRENCIES)[number];
export const POOL_KINDS = ['in', 'out', 'ops'] as const;
export type PoolKind = (typeof POOL_KINDS)[number];

/** Пока выплат нет: включатся только после гейта 4 и заключения юриста. */
export const POOL_PAYOUTS_ENABLED = false;

export interface PoolRow {
  kind: PoolKind;
  amount: number;
  currency: string;
}

export interface PoolTotals {
  currency: string;
  /** Взносы в пул. */
  in: number;
  /** Выплаченные призы. */
  prizes: number;
  /** Расходы на операции. */
  ops: number;
  /** Резерв на операции (20 % взносов) — отчётная величина. */
  feeReserved: number;
  /** Призовой фонд, доступный по правилам. */
  prizeFund: number;
  /** Деньги на счетах: взносы минус призы и операции. */
  balance: number;
  /** Призовой фонд, который ещё не выплачен. Может быть отрицательным при перерасходе. */
  available: number;
}

/**
 * Считает итоги по строкам. Чистая функция: её проверяют тесты, а D1 только
 * группирует суммы, чтобы не тянуть все записи в память.
 */
export function summarizePool(rows: PoolRow[]): PoolTotals[] {
  const byCurrency = new Map<string, { in: number; prizes: number; ops: number }>();
  for (const row of rows) {
    const acc = byCurrency.get(row.currency) ?? { in: 0, prizes: 0, ops: 0 };
    const amount = Number(row.amount);
    if (row.kind === 'in') acc.in += amount;
    else if (row.kind === 'out') acc.prizes += amount;
    else if (row.kind === 'ops') acc.ops += amount;
    byCurrency.set(row.currency, acc);
  }
  return [...byCurrency.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, acc]) => {
      const feeReserved = Math.floor((acc.in * POOL_FEE_BP) / 10_000);
      const prizeFund = acc.in - feeReserved;
      return {
        currency,
        in: acc.in,
        prizes: acc.prizes,
        ops: acc.ops,
        feeReserved,
        prizeFund,
        balance: acc.in - acc.prizes - acc.ops,
        available: prizeFund - acc.prizes,
      };
    });
}

export interface PoolEntryInput {
  kind: PoolKind;
  amount: number;
  currency: PoolCurrency;
  ref: string;
  note: string;
  seasonId: string | null;
}

const REF_RE = /^[A-Za-z0-9:_-]{3,64}$/;

/** Разбор и проверка тела записи. Ошибки — те же коды, что видит админка. */
export function parsePoolEntry(body: Record<string, unknown>): PoolEntryInput {
  const kind = String(body.kind ?? '');
  if (!(POOL_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, 'bad_pool_kind');
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000_000) {
    throw new ApiError(400, 'bad_pool_amount');
  }
  const currency = String(body.currency ?? 'EUR').toUpperCase();
  if (!(POOL_CURRENCIES as readonly string[]).includes(currency)) throw new ApiError(400, 'bad_pool_currency');
  const ref = String(body.ref ?? '').trim();
  if (!REF_RE.test(ref)) throw new ApiError(400, 'bad_pool_ref');
  const rawNote = typeof body.note === 'string' ? body.note : '';
  // Заметка публикуется на /pool.html: обрезаем и не даём писать простыни.
  const note = rawNote.replace(/\s+/g, ' ').trim().slice(0, 200);
  const rawSeason = typeof body.seasonId === 'string' ? body.seasonId.trim() : '';
  const seasonId = rawSeason ? rawSeason.slice(0, 40) : null;
  return { kind: kind as PoolKind, amount, currency: currency as PoolCurrency, ref, note, seasonId };
}

export interface PoolEntryView {
  kind: PoolKind;
  amount: number;
  currency: string;
  note: string;
  seasonId: string | null;
  createdAt: number;
}

/** Строки только для админки: там видно `ref`, чтобы сверять с провайдером. */
export interface PoolEntryAdminView extends PoolEntryView {
  id: string;
  ref: string;
}

export async function poolTotals(db: D1Database): Promise<PoolTotals[]> {
  const { results } = await db
    .prepare('SELECT currency, kind, COALESCE(SUM(amount), 0) AS total FROM pool_entries GROUP BY currency, kind')
    .all<{ currency: string; kind: string; total: number }>();
  return summarizePool((results ?? []).map((r) => ({ currency: String(r.currency), kind: String(r.kind) as PoolKind, amount: Number(r.total) })));
}

export async function poolLatest(db: D1Database, limit = 10): Promise<PoolEntryView[]> {
  const { results } = await db
    .prepare(`SELECT kind, amount, currency, note, season_id, created_at
                FROM pool_entries ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(Math.min(50, Math.max(1, limit)))
    .all<{ kind: string; amount: number; currency: string; note: string; season_id: string | null; created_at: number }>();
  return (results ?? []).map((r) => ({
    kind: String(r.kind) as PoolKind,
    amount: Number(r.amount),
    currency: String(r.currency),
    note: String(r.note ?? ''),
    seasonId: r.season_id ? String(r.season_id) : null,
    createdAt: Number(r.created_at),
  }));
}

/** Полный список для админки: с `ref` и id, чтобы сверять с выпиской. */
export async function poolAll(db: D1Database, limit = 100): Promise<PoolEntryAdminView[]> {
  const { results } = await db
    .prepare(`SELECT id, kind, amount, currency, ref, note, season_id, created_at
                FROM pool_entries ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(Math.min(500, Math.max(1, limit)))
    .all<Record<string, unknown>>();
  return (results ?? []).map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as PoolKind,
    amount: Number(r.amount),
    currency: String(r.currency),
    ref: String(r.ref),
    note: String(r.note ?? ''),
    seasonId: r.season_id ? String(r.season_id) : null,
    createdAt: Number(r.created_at),
  }));
}

export async function poolEntryExists(db: D1Database, ref: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS one FROM pool_entries WHERE ref = ?').bind(ref).first<{ one: number }>();
  return Boolean(row);
}

/**
 * Добавляет запись. `ref` уникален на уровне схемы, поэтому гонка двух админов
 * заканчивается ошибкой `pool_ref_exists`, а не двумя одинаковыми суммами.
 */
export async function addPoolEntry(db: D1Database, input: PoolEntryInput, now: number): Promise<void> {
  if (await poolEntryExists(db, input.ref)) throw new ApiError(409, 'pool_ref_exists');
  try {
    await db
      .prepare(`INSERT INTO pool_entries (id, kind, amount, currency, ref, note, season_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), input.kind, input.amount, input.currency, input.ref, input.note, input.seasonId, now)
      .run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|unique constraint/i.test(message)) throw new ApiError(409, 'pool_ref_exists');
    throw e;
  }
}

/** Публичный отчёт: те же числа, что в админке, но без `ref` и id. */
export async function poolReport(db: D1Database, now: number) {
  const [totals, latest] = await Promise.all([poolTotals(db), poolLatest(db, 10)]);
  return {
    updatedAt: now,
    currency: totals.length === 1 ? totals[0].currency : totals.length ? 'multi' : 'EUR',
    feeBp: POOL_FEE_BP,
    feePercent: POOL_FEE_PERCENT,
    payoutsEnabled: POOL_PAYOUTS_ENABLED,
    currencies: POOL_CURRENCIES,
    totals,
    latest,
    entries: totals.length ? latest.length : 0,
  };
}
