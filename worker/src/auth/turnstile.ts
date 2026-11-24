import type { Env } from '../env';
import { ApiError } from '../world/errors';
import { ipOf } from './rateLimit';

// Проверка токена Turnstile на сервере (siteverify). Клиенту верить нельзя.
export async function verifyTurnstile(secret: string, token: unknown, ip: string | null): Promise<boolean> {
  if (typeof token !== 'string' || !token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}

/** Секрет задан — значит включено и требование, и выдача site key клиенту. */
export function turnstileEnabled(env: Env): boolean {
  return Boolean(env.TURNSTILE_SECRET);
}

/**
 * Шлюз «подтверди, что ты человек» для бесплатных наград.
 *
 * Регистрация требует проверку всегда (там спрятан и лимит брутфорса), а вот
 * Claim и бесплатные боксы — это чистый кран: без Turnstile их выкачивают
 * скрипты, и суточные лимиты придуманы как раз против этого. Правило: секрет
 * не задан — пропускаем (локальная разработка, тесты, превью); задан — каждый
 * запрос обязан нести свежий одноразовый токен. Токен проверяем до обращения к
 * миру: отказ не должен ни списывать, ни начислять.
 */
export async function checkTurnstile(env: Env, request: Request, body: Record<string, unknown>): Promise<void> {
  if (!turnstileEnabled(env)) return;
  if (!env.TURNSTILE_SITE_KEY) console.warn('TURNSTILE_SECRET задан, но TURNSTILE_SITE_KEY пуст: клиент не сможет получить токен');
  const token = body.turnstileToken;
  if (typeof token !== 'string' || !token) throw new ApiError(403, 'turnstile_required');
  const ok = await verifyTurnstile(env.TURNSTILE_SECRET, token, ipOf(request));
  if (!ok) throw new ApiError(403, 'turnstile_failed');
}
