// Админ-доступ Astra Pay, пула и мира.
//
// Админку закрывает заголовок `X-Admin-Token`. Сравнение — без утечки длины по
// времени: токен админа тоже секрет.
//
// Необязательный второй замок — `ADMIN_EMAIL`: если секрет задан, запрос обязан
// прийти с тем же email в `X-Admin-Email`. Это не пароль и не «вход по почте»:
// почта лишь сужает круг, а решает всё равно токен. Пароли игроков и админов в
// этом контуре не хранятся вообще.
//
// Третий замок появился потому, что домен и Cloudflare Access — платная история,
// а админка должна быть защищена и на бесплатном `*.workers.dev`: подбор токена
// с одного IP блокируется на 15 минут после 10 ошибок (та же таблица
// `auth_limits`, что у входа). Успешный вход сбрасывает счётчик.
//
// Слабые места честно: лимит считается по IP, поэтому распределённый перебор
// он не остановит — от этого защищает длина токена (≥ 32 случайных символа) и,
// позже, Cloudflare Access.

import type { Env } from '../env';
import { ApiError } from '../world/errors';
import { ipOf } from '../auth/rateLimit';

export const ADMIN_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_BLOCK_MS = 15 * 60 * 1000;
export const ADMIN_IP_MAX = 10;

/** Сравнение строк за постоянное время. */
export function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface LimitState { attempts: number; windowStart: number; blockedUntil: number }

function adminKey(request: Request): string {
  const ip = ipOf(request);
  return `admin_ip:${ip && ip.trim() ? ip.trim() : 'unknown'}`;
}

async function readState(env: Env, key: string): Promise<LimitState | null> {
  try {
    const row = await env.DB.prepare('SELECT attempts, window_start, blocked_until FROM auth_limits WHERE key = ?')
      .bind(key).first<Record<string, unknown>>();
    if (!row) return null;
    return {
      attempts: Number(row.attempts) || 0,
      windowStart: Number(row.window_start) || 0,
      blockedUntil: Number(row.blocked_until) || 0,
    };
  } catch (e) {
    // База недоступна — не запираем админку: токен всё равно проверяется ниже.
    console.error('admin limit read failed', e);
    return null;
  }
}

async function writeState(env: Env, key: string, state: LimitState): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO auth_limits (key, attempts, window_start, blocked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET attempts = excluded.attempts,
         window_start = excluded.window_start, blocked_until = excluded.blocked_until`,
    ).bind(key, state.attempts, state.windowStart, state.blockedUntil).run();
  } catch (e) {
    console.error('admin limit write failed', e);
  }
}

/** Ошибка токена: считаем попытку и, если порог перейдён, отвечаем 429. */
async function failAttempt(env: Env, key: string, now: number, error: ApiError): Promise<never> {
  const prev = await readState(env, key);
  const windowExpired = !prev || now < prev.windowStart || now - prev.windowStart >= ADMIN_WINDOW_MS;
  const blockExpired = !!prev && prev.blockedUntil > 0 && prev.blockedUntil <= now;
  const fresh = windowExpired || blockExpired;
  const attempts = fresh ? 1 : prev.attempts + 1;
  const blockedUntil = attempts >= ADMIN_IP_MAX ? now + ADMIN_BLOCK_MS : 0;
  await writeState(env, key, { attempts, windowStart: fresh ? now : prev!.windowStart, blockedUntil });
  if (blockedUntil > now) {
    throw new ApiError(429, 'too_many_attempts', Math.ceil((blockedUntil - now) / 1000));
  }
  throw error;
}

export async function requireAdmin(request: Request, env: Env): Promise<void> {
  const expected = String(env.ADMIN_TOKEN ?? '');
  if (!expected) throw new ApiError(503, 'admin_disabled');

  const key = adminKey(request);
  const now = Date.now();
  const state = await readState(env, key);
  const blocked = state?.blockedUntil ?? 0;
  if (blocked > now) throw new ApiError(429, 'too_many_attempts', Math.ceil((blocked - now) / 1000));

  const given = request.headers.get('X-Admin-Token') ?? '';
  // Пустой заголовок — это не попытка подбора: так стучится страница без входа.
  if (!given) throw new ApiError(401, 'admin_token_required');
  if (!sameToken(given, expected)) await failAttempt(env, key, now, new ApiError(403, 'admin_forbidden'));

  const mail = String(env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (mail) {
    const sent = (request.headers.get('X-Admin-Email') ?? '').trim().toLowerCase();
    if (!sent || !sameToken(sent, mail)) await failAttempt(env, key, now, new ApiError(403, 'admin_email_forbidden'));
  }

  // Успех сбрасывает счётчик, чтобы редкая опечатка не копилась месяцами.
  if (state && (state.attempts > 0 || state.blockedUntil > 0)) {
    try {
      await env.DB.prepare('DELETE FROM auth_limits WHERE key = ?').bind(key).run();
    } catch (e) {
      console.error('admin limit clear failed', e);
    }
  }
}
