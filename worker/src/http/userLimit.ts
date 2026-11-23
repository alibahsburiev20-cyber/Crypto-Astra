import type { Env } from '../env';
import { ApiError } from '../world/errors';

// Частотный лимит на игровые запросы.
//
// Раньше ограничение стояло только на `/auth/*`, а всё остальное можно было
// дёргать в цикле: каждый POST — запись в мир и в D1. Здесь простой счётчик в
// той же таблице `auth_limits`, что и у входа: окно 60 секунд, отдельные
// пороги для чтения и записи.
//
// Лимит не мешает играть: 90 чтений и 30 действий в минуту — это больше, чем
// человек делает руками. Он бьёт по скриптам, которые «накликивают» экономику.

const WINDOW_MS = 60_000;
const READ_LIMIT = 90;
const WRITE_LIMIT = 30;

export interface LimitDecision {
  allowed: boolean;
  retryAfterSec: number;
}

export async function checkUserLimit(
  env: Env, userId: string, write: boolean, now = Date.now(),
): Promise<LimitDecision> {
  const limit = write ? WRITE_LIMIT : READ_LIMIT;
  const bucket = write ? 'w' : 'r';
  const key = `u:${bucket}:${userId}`;
  try {
    const row = await env.DB.prepare(
      'SELECT attempts, window_start FROM auth_limits WHERE key = ?',
    ).bind(key).first<{ attempts: number; window_start: number }>();

    if (!row || now - Number(row.window_start) >= WINDOW_MS) {
      await env.DB.prepare(
        `INSERT INTO auth_limits (key, attempts, window_start, blocked_until) VALUES (?, 1, ?, 0)
         ON CONFLICT (key) DO UPDATE SET attempts = 1, window_start = excluded.window_start, blocked_until = 0`,
      ).bind(key, now).run();
      return { allowed: true, retryAfterSec: 0 };
    }

    if (Number(row.attempts) >= limit) {
      const retry = Math.max(1, Math.ceil((Number(row.window_start) + WINDOW_MS - now) / 1000));
      return { allowed: false, retryAfterSec: retry };
    }

    await env.DB.prepare('UPDATE auth_limits SET attempts = attempts + 1 WHERE key = ?').bind(key).run();
    return { allowed: true, retryAfterSec: 0 };
  } catch (e) {
    // D1 недоступна — не запираем игрока из-за счётчика.
    console.error('user limit failed', e);
    return { allowed: true, retryAfterSec: 0 };
  }
}

export async function enforceUserLimit(env: Env, userId: string, write: boolean): Promise<void> {
  const decision = await checkUserLimit(env, userId, write);
  if (!decision.allowed) throw new ApiError(429, 'too_many_requests');
}
