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
// Второй способ войти — `X-Admin-Key`: ключ младшего админа из `admin_accounts`
// (ссылка-приглашение из админки). Роли нужны затем, чтобы «помощник, который
// правит ASTRA» не мог ни отправить выплату, ни отозвать чужой доступ, ни закрыть
// аккаунт: все эти действия требуют владельца. Проверка идёт по базе на каждый
// запрос — отозванный доступ перестаёт работать немедленно, без перевыпуска
// секрета и без пересборки воркера.
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
import { OWNER_PRINCIPAL, lookupAdminKey, touchAdminAccount, type AdminPrincipal } from '../admin/accounts';
import { ensureAdminSchema } from '../admin/schema';

export type { AdminPrincipal } from '../admin/accounts';

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

/**
 * Минимальная длина секрета админки.
 *
 * `docs/ADMIN.md` просит 32+ случайных символа; планка ниже (24) стоит ровно
 * затем, чтобы «a1b2c3» из чата не оказался ключом к деньгам: подбор токена
 * лимитирован десятью ошибками на IP за 15 минут, но лимит по IP — это защита
 * от одного адреса, а не от распределённого перебора коротких значений.
 *
 * Ответ — 503, а не «токен не подошёл»: владелец должен увидеть, что дело в
 * конфигурации, а не в его опечатке.
 */
export const ADMIN_TOKEN_MIN = 24;

/**
 * Проверка доступа. Возвращает, КТО вошёл: роль решает дальнейшие гейты, и
 * возвращать «просто ок» было бы нельзя — маршруты различают владельца и
 * младшего админа.
 */
export async function requireAdmin(request: Request, env: Env): Promise<AdminPrincipal> {
  const expected = String(env.ADMIN_TOKEN ?? '');
  // Ключи младших админов живут в той же админке, что и секрет владельца: если
  // `ADMIN_TOKEN` не задан или он короткий, админка закрыта ДЛЯ ВСЕХ. Иначе
  // «включим помощнику, а себе секрет не заводили» превратилось бы в дыру.
  if (!expected) throw new ApiError(503, 'admin_disabled');
  if (expected.length < ADMIN_TOKEN_MIN) throw new ApiError(503, 'admin_weak_token');

  const key = adminKey(request);
  const now = Date.now();
  const state = await readState(env, key);
  const blocked = state?.blockedUntil ?? 0;
  if (blocked > now) throw new ApiError(429, 'too_many_attempts', Math.ceil((blocked - now) / 1000));

  const given = request.headers.get('X-Admin-Token') ?? '';
  const givenKey = request.headers.get('X-Admin-Key') ?? '';
  const sentMail = (request.headers.get('X-Admin-Email') ?? '').trim().toLowerCase();
  // Пустые заголовки — это не попытка подбора: так стучится страница без входа.
  if (!given && !givenKey) throw new ApiError(401, 'admin_token_required');

  if (given && sameToken(given, expected)) {
    const mail = String(env.ADMIN_EMAIL ?? '').trim().toLowerCase();
    if (mail && (!sentMail || !sameToken(sentMail, mail))) {
      return await failAttempt(env, key, now, new ApiError(403, 'admin_email_forbidden'));
    }
    await clearAttempts(env, key, state);
    return OWNER_PRINCIPAL;
  }

  if (givenKey) {
    if (!(await ensureAdminSchema(env.DB))) throw new ApiError(503, 'admin_store_unavailable');
    let found: Awaited<ReturnType<typeof lookupAdminKey>>;
    try {
      found = await lookupAdminKey(env.DB, givenKey, now);
    } catch (e) {
      console.error('admin key lookup failed', e);
      throw new ApiError(503, 'admin_store_unavailable');
    }
    if (found.status === 'revoked') throw new ApiError(403, 'admin_key_revoked');
    if (found.status === 'expired') throw new ApiError(403, 'admin_key_expired');
    if (found.status === 'ok') {
      // Email доступа — вторая щеколда именно этого ключа: украденная ссылка
      // из переписки не заработает у того, у кого другой ящик. Для владельца
      // её роль играет `ADMIN_EMAIL`, тут логика та же, но на строку в базе.
      const bound = String(found.account.email ?? '').trim().toLowerCase();
      if (bound && (!sentMail || !sameToken(sentMail, bound))) {
        return await failAttempt(env, key, now, new ApiError(403, 'admin_email_forbidden'));
      }
      await touchAdminAccount(env.DB, found.account.id, now, ipOf(request) ?? '');
      await clearAttempts(env, key, state);
      return found.principal;
    }
    // Считаем как попытку подбора: «ключа с таким хешем нет» — это ровно то, что
    // видит перебор. Просроченный и отозванный ключи — не перебор, их не считаем.
    return await failAttempt(env, key, now, new ApiError(403, 'admin_key_unknown'));
  }

  return await failAttempt(env, key, now, new ApiError(403, 'admin_forbidden'));
}

/** Требование «это владелец». Младшему админу доступ к деньгам не выдаётся. */
export function requireOwner(principal: AdminPrincipal): AdminPrincipal {
  if (principal.role !== 'owner') throw new ApiError(403, 'owner_only');
  return principal;
}

async function clearAttempts(env: Env, key: string, state: { attempts: number; blockedUntil: number } | null): Promise<void> {
  if (!state || (state.attempts === 0 && state.blockedUntil === 0)) return;
  try {
    await env.DB.prepare('DELETE FROM auth_limits WHERE key = ?').bind(key).run();
  } catch (e) {
    console.error('admin limit clear failed', e);
  }
}
