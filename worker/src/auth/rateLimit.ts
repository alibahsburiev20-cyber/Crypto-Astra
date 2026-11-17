import { sha256Hex } from '../shared/sha256';

// Ограничение частоты для входа и регистрации. Источник истины — D1, потому что
// счётчик должен быть общим для всех изолятов Worker. Ошибка D1 не должна
// блокировать вход всем: helpers ниже «падают открыто» и только пишут в лог.

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;
export const LOGIN_IP_MAX = 10;
export const LOGIN_TURNSTILE_AFTER = 3;

export const REGISTER_WINDOW_MS = 60 * 60 * 1000;
export const REGISTER_BLOCK_MS = 60 * 60 * 1000;
export const REGISTER_IP_MAX = 10;

export interface LimitState {
  attempts: number;
  windowStart: number;
  blockedUntil: number;
}

export interface LimitPolicy {
  windowMs: number;
  blockMs: number;
  /** Infinity — блокировка не ставится, счётчик нужен только для эскалации Turnstile. */
  max: number;
}

export const LOGIN_IP_POLICY: LimitPolicy = { windowMs: LOGIN_WINDOW_MS, blockMs: LOGIN_BLOCK_MS, max: LOGIN_IP_MAX };
// По email жёсткой блокировки нет: иначе чужой перебор мог бы запереть владельца адреса.
export const LOGIN_EMAIL_POLICY: LimitPolicy = { windowMs: LOGIN_WINDOW_MS, blockMs: LOGIN_BLOCK_MS, max: Infinity };
export const REGISTER_IP_POLICY: LimitPolicy = { windowMs: REGISTER_WINDOW_MS, blockMs: REGISTER_BLOCK_MS, max: REGISTER_IP_MAX };

/** Чистая функция: новое состояние счётчика после попытки. */
export function bump(prev: LimitState | null, now: number, policy: LimitPolicy): LimitState {
  const windowExpired = !prev || now < prev.windowStart || now - prev.windowStart >= policy.windowMs;
  const blockExpired = !!prev && prev.blockedUntil > 0 && prev.blockedUntil <= now;
  const fresh = windowExpired || blockExpired;
  const attempts = fresh ? 1 : prev.attempts + 1;
  const windowStart = fresh ? now : prev.windowStart;
  const blockedUntil = attempts >= policy.max
    ? now + policy.blockMs
    : prev && prev.blockedUntil > now ? prev.blockedUntil : 0;
  return { attempts, windowStart, blockedUntil };
}

/** Сколько миллисекунд ещё нельзя повторять. 0 — можно. */
export function blockedFor(state: LimitState | null, now: number): number {
  return state && state.blockedUntil > now ? state.blockedUntil - now : 0;
}

export function loginKeys(ip: string | null, email: string): string[] {
  const who = ip && ip.trim() ? ip.trim() : 'unknown';
  return [`login_ip:${who}`, `login_email:${sha256Hex(email)}`];
}

export function registerKeys(ip: string | null): string[] {
  const who = ip && ip.trim() ? ip.trim() : 'unknown';
  return [`register_ip:${who}`];
}

export function ipOf(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP');
}

function parse(row: Record<string, unknown> | null): LimitState | null {
  if (!row) return null;
  return {
    attempts: Number(row.attempts) || 0,
    windowStart: Number(row.window_start) || 0,
    blockedUntil: Number(row.blocked_until) || 0,
  };
}

export async function readState(db: D1Database, key: string): Promise<LimitState | null> {
  try {
    const row = await db
      .prepare('SELECT attempts, window_start, blocked_until FROM auth_limits WHERE key = ?')
      .bind(key)
      .first<Record<string, unknown>>();
    return parse(row ?? null);
  } catch (e) {
    console.error('rate limit read failed', key, e);
    return null;
  }
}

export async function writeState(db: D1Database, key: string, state: LimitState): Promise<void> {
  try {
    await db
      .prepare(`INSERT INTO auth_limits (key, attempts, window_start, blocked_until) VALUES (?, ?, ?, ?)
                ON CONFLICT (key) DO UPDATE SET attempts = excluded.attempts,
                  window_start = excluded.window_start, blocked_until = excluded.blocked_until`)
      .bind(key, state.attempts, state.windowStart, state.blockedUntil)
      .run();
  } catch (e) {
    console.error('rate limit write failed', key, e);
  }
}

/** Регистрирует попытку и возвращает максимальную блокировку по всем ключам. */
export async function recordAttempt(
  db: D1Database, keys: string[], now: number, policy: LimitPolicy,
): Promise<{ retryAfterSec: number; states: LimitState[] }> {
  const states: LimitState[] = [];
  let retryAfterMs = 0;
  for (const key of keys) {
    const prev = await readState(db, key);
    const next = bump(prev, now, policy);
    await writeState(db, key, next);
    states.push(next);
    retryAfterMs = Math.max(retryAfterMs, blockedFor(next, now));
  }
  return { retryAfterSec: Math.ceil(retryAfterMs / 1000), states };
}

/** Проверяет блокировку, не меняя счётчики. */
export async function currentBlock(db: D1Database, keys: string[], now: number): Promise<number> {
  let retryAfterMs = 0;
  for (const key of keys) {
    const state = await readState(db, key);
    retryAfterMs = Math.max(retryAfterMs, blockedFor(state, now));
  }
  return Math.ceil(retryAfterMs / 1000);
}

export async function clearAttempts(db: D1Database, keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await db.batch(keys.map((k) => db.prepare('DELETE FROM auth_limits WHERE key = ?').bind(k)));
  } catch (e) {
    console.error('rate limit clear failed', e);
  }
}

/** Удаляет старые строки; вызывается из cron. */
export async function cleanupAuthLimits(db: D1Database, now: number): Promise<number> {
  try {
    const r = await db
      .prepare('DELETE FROM auth_limits WHERE blocked_until < ? AND window_start < ?')
      .bind(now, now - REGISTER_WINDOW_MS)
      .run();
    return r.meta.changes ?? 0;
  } catch (e) {
    console.error('auth limits cleanup failed', e);
    return 0;
  }
}
