// Админ-доступ Astra Pay, пула и мира.
//
// До среза 5.3 (Cloudflare Access) админку закрывает заголовок `X-Admin-Token`.
// Сравнение — без утечки длины по времени: токен админа тоже секрет.
//
// Необязательный второй замок — `ADMIN_EMAIL`: если секрет задан, запрос обязан
// прийти с тем же email в `X-Admin-Email`. Это не пароль и не «вход по почте»:
// почта лишь сужает круг, а решает всё равно токен. Пароли игроков и админов в
// этом контуре не хранятся вообще.
//
// Когда появится Access, эта функция останется вторым замком: Access проверяет
// личность, токен — что запрос вообще из админского контура.

import type { Env } from '../env';
import { ApiError } from '../world/errors';

/** Сравнение строк за постоянное время. */
export function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function requireAdmin(request: Request, env: Env): void {
  const expected = String(env.ADMIN_TOKEN ?? '');
  if (!expected) throw new ApiError(503, 'admin_disabled');

  const given = request.headers.get('X-Admin-Token') ?? '';
  if (!given) throw new ApiError(401, 'admin_token_required');
  if (!sameToken(given, expected)) throw new ApiError(403, 'admin_forbidden');

  const mail = String(env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (mail) {
    const sent = (request.headers.get('X-Admin-Email') ?? '').trim().toLowerCase();
    if (!sent || !sameToken(sent, mail)) throw new ApiError(403, 'admin_email_forbidden');
  }
}
