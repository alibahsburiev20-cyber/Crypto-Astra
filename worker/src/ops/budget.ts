// Бюджет запросов и режимы бережливости.
//
// Зачем: на бесплатном плане Cloudflare даёт 100 000 запросов в сутки на весь
// аккаунт (и столько же запросов Durable Objects). Когда лимит кончается,
// Cloudflare не берёт денег — он просто отвечает ошибкой 1027, и сайт «лежит»
// до полуночи UTC. Хуже всего, что это происходит без предупреждения.
//
// Поэтому считаем свои запросы сами и заранее уходим в деградацию:
//
//   full     < 60 %  — работаем как обычно;
//   thrifty  < 80 %  — тяжёлые витрины живут в кэше (заголовок X-Astra-Mode);
//   lite     < 95 %  — витрины и рынок отвечают 503 server_lite;
//   sleep   >= 95 %  — только деньги, вход и админка; остальное 503 server_sleep
//                      с Retry-After до полуночи UTC.
//
// Резерв в 5 % не тратится на игру специально: это вход в админку и денежные
// маршруты, чтобы владелец мог разобраться даже в самый плохой день.
//
// Счётчик приблизительный и сознательно дешёвый: в памяти изолята копится пачка,
// раз в 20 запросов (или 20 секунд) она сбрасывается одним UPDATE в D1. Считать
// каждым запросом отдельную строку нельзя: 100 000 записей в сутки — это ровно
// лимит D1, и счётчик съел бы его целиком.

export type OpsMode = 'full' | 'thrifty' | 'lite' | 'sleep';

/** Сколько запросов в сутки мы разрешаем себе по умолчанию (бесплатный план). */
export const DEFAULT_DAILY_REQUEST_BUDGET = 100_000;

/** Границы режимов, доля от суточного бюджета. */
export const MODE_THRESHOLDS = { thrifty: 0.6, lite: 0.8, sleep: 0.95 } as const;

/** Класс маршрута: от него зависит, что можно отключить. */
export type RouteClass = 'critical' | 'heavy' | 'normal';

/** Что никогда не отключаем: вход, деньги, здоровье, админка, статус. */
const CRITICAL_PREFIXES = ['/health', '/ops/', '/admin', '/auth', '/pay/'];
/** Что отключаем первым: витрины, которые можно посмотреть позже. */
const HEAVY_PREFIXES = ['/market', '/guild', '/season', '/social', '/ledger', '/pool.json', '/minigame'];

export function routeClass(pathname: string): RouteClass {
  const path = String(pathname ?? '/');
  if (CRITICAL_PREFIXES.some((p) => path === p || path.startsWith(p))) return 'critical';
  if (HEAVY_PREFIXES.some((p) => path === p || path.startsWith(p))) return 'heavy';
  return 'normal';
}

/** Бюджет из конфигурации; мусор — значение по умолчанию. */
export function dailyBudget(raw?: string | number | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_REQUEST_BUDGET;
  return Math.floor(n);
}

export function modeForUsed(used: number, limit = DEFAULT_DAILY_REQUEST_BUDGET): OpsMode {
  if (!Number.isFinite(used) || used <= 0) return 'full';
  const safeLimit = limit > 0 ? limit : DEFAULT_DAILY_REQUEST_BUDGET;
  const ratio = used / safeLimit;
  if (ratio < MODE_THRESHOLDS.thrifty) return 'full';
  if (ratio < MODE_THRESHOLDS.lite) return 'thrifty';
  if (ratio < MODE_THRESHOLDS.sleep) return 'lite';
  return 'sleep';
}

/**
 * Отключается ли маршрут в этом режиме.
 *
 * `thrifty` не блокирует ничего: в нём только сокращается кэш и количество
 * пересчётов. Блокировки начинаются с `lite`.
 */
export function isBlocked(mode: OpsMode, klass: RouteClass): boolean {
  if (klass === 'critical') return false;
  if (mode === 'full' || mode === 'thrifty') return false;
  if (mode === 'lite') return klass === 'heavy';
  return true; // sleep: всё, кроме critical
}

/** Код ошибки для ответа — клиент показывает по нему понятный текст. */
export function blockedCode(mode: OpsMode): 'server_lite' | 'server_sleep' {
  return mode === 'sleep' ? 'server_sleep' : 'server_lite';
}

/** UTC-день: лимиты Cloudflare сбрасываются в 00:00 UTC, считаем так же. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Сколько секунд ждать до сброса лимита (не меньше одной). */
export function secondsUntilReset(now: number): number {
  const next = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - now) / 1000));
}

// --- Учёт в D1 ---------------------------------------------------------------

let schemaReady = false;

export async function ensureOpsSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS ops_usage (
       day        TEXT PRIMARY KEY,
       requests   INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL
     )`,
  ).run();
  schemaReady = true;
}

export function resetOpsSchemaForTests(): void {
  schemaReady = false;
  counter = null;
}

async function readUsage(db: D1Database, day: string): Promise<number> {
  const row = await db.prepare('SELECT requests FROM ops_usage WHERE day = ?')
    .bind(day).first<number>('requests');
  return Number(row ?? 0);
}

async function addUsage(db: D1Database, day: string, delta: number, now: number): Promise<void> {
  if (delta <= 0) return;
  await db.prepare(
    `INSERT INTO ops_usage (day, requests, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET requests = requests + excluded.requests, updated_at = excluded.updated_at`,
  ).bind(day, delta, now).run();
}

// --- Счётчик в памяти изолята ------------------------------------------------

interface Counter {
  day: string;
  flushed: number;
  pending: number;
  readAt: number;
  writeAt: number;
}

let counter: Counter | null = null;

/** Как часто перечитывать D1 (другой изолят мог успеть записать своё). */
const READ_TTL_MS = 15_000;
/** Сколько запросов копим перед сбросом в D1. */
const FLUSH_EVERY = 20;
/** И раз в столько миллисекунд — даже если запросов мало. */
const FLUSH_EVERY_MS = 20_000;

export interface BudgetState {
  mode: OpsMode;
  used: number;
  limit: number;
  remaining: number;
  day: string;
}

/**
 * Учесть один запрос и вернуть текущее состояние бюджета.
 *
 * Ошибка D1 не должна ломать запрос игрока: если счётчик недоступен, считаем,
 * что режим `full`, и продолжаем. Худший случай — мы не заметим лимит; лучший
 * (и частый) — сайт работает, когда база недоступна.
 */
export async function consumeRequest(
  db: D1Database,
  now: number,
  limit = DEFAULT_DAILY_REQUEST_BUDGET,
): Promise<BudgetState> {
  const day = utcDay(now);
  try {
    await ensureOpsSchema(db);
    if (!counter || counter.day !== day) {
      counter = { day, flushed: await readUsage(db, day), pending: 0, readAt: now, writeAt: now };
    } else if (now - counter.readAt > READ_TTL_MS) {
      counter.flushed = await readUsage(db, day);
      counter.readAt = now;
    }

    counter.pending += 1;
    const used = counter.flushed + counter.pending;

    if (counter.pending >= FLUSH_EVERY || now - counter.writeAt >= FLUSH_EVERY_MS) {
      await flushUsage(db, now);
    }
    return { mode: modeForUsed(used, limit), used, limit, remaining: Math.max(0, limit - used), day };
  } catch {
    return { mode: 'full', used: 0, limit, remaining: limit, day };
  }
}

/** Сбросить накопленную пачку в D1. Не бросает: счётчик не важнее запроса. */
export async function flushUsage(db: D1Database, now: number): Promise<void> {
  if (!counter || counter.pending <= 0) return;
  const delta = counter.pending;
  try {
    await addUsage(db, counter.day, delta, now);
    counter.flushed += delta;
    counter.pending = 0;
    counter.writeAt = now;
    counter.readAt = now;
  } catch {
    // Оставим в pending: попробуем в следующий раз. Переполнение памяти
    // исключено — значение ограничено размером пачки.
  }
}

/** Текущее состояние без учёта нового запроса (для `/ops/status`). */
export async function peekBudget(
  db: D1Database,
  now: number,
  limit = DEFAULT_DAILY_REQUEST_BUDGET,
): Promise<BudgetState> {
  const day = utcDay(now);
  let used = counter && counter.day === day ? counter.flushed + counter.pending : 0;
  try {
    await ensureOpsSchema(db);
    if (!counter || counter.day !== day) used = await readUsage(db, day);
  } catch {
    used = counter && counter.day === day ? counter.flushed + counter.pending : 0;
  }
  return { mode: modeForUsed(used, limit), used, limit, remaining: Math.max(0, limit - used), day };
}

export function resetCounterForTests(): void {
  counter = null;
}
