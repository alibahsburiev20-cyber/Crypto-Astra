import { syncArchive } from './archive';
import { cleanupAuthLimits } from './auth/rateLimit';
import { ensureArchiveSchema } from './db/bootstrap';
import { cleanupSessions } from './auth/sessions';
import type { Env } from './env';
import { route } from './http/router';
import { WorldLobby } from './lobby/WorldLobby';
import { SITE_FILES } from './static/site';
import { World } from './world/World';

export { World, WorldLobby };
export type { Env };

// HTML отдают статические ассеты, поэтому заголовки для него живут в client/_headers.
// Здесь — только запасной путь, если файл когда-нибудь начнёт отдавать Worker.
const SECURITY: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

// Список миров берём у лобби. Если лобби недоступно, падаем на зеркало world_seats в D1:
// cron не должен терять миры из-за одной ошибки.
async function worldIds(env: Env): Promise<string[]> {
  try {
    const seats = await env.LOBBY.get(env.LOBBY.idFromName('main')).seats();
    const ids = seats.map((w) => String(w.world_id)).filter(Boolean);
    if (ids.length) return ids;
  } catch (e) {
    console.error('lobby seats failed', e);
  }
  try {
    const rows = await env.DB.prepare('SELECT world_id FROM world_seats').all<{ world_id: string }>();
    return (rows.results ?? []).map((r) => String(r.world_id)).filter(Boolean);
  } catch (e) {
    console.error('world_seats fallback failed', e);
    return [];
  }
}

function staticResponse(pathname: string, method: string): Response | null {
  const path = pathname === '/' ? '/index.html' : pathname;
  const file = SITE_FILES[path];
  if (!file) return null;
  const headers: Record<string, string> = { 'Content-Type': file.type, 'Cache-Control': 'no-cache' };
  if (file.type.startsWith('text/html')) Object.assign(headers, SECURITY);
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(file.body, { status: 200, headers });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' || request.method === 'HEAD') {
      const file = staticResponse(url.pathname, request.method);
      if (file) return Promise.resolve(file);
    }
    return route(request, env);
  },
  // Часовой cron — страховка, если будильник мира не сработал. Сверка и рейсы живут в alarm мира.
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const ids = await worldIds(env);
    for (const id of ids) {
      try {
        await env.WORLD.get(env.WORLD.idFromName(id)).poke();
      } catch (e) {
        console.error('poke failed', id, e);
      }
    }
    // Архив: снимки миров в R2 (если бакет подключён) и историю сезонов в D1.
    // Таблицы создаём сами: деплой идёт из браузера, `wrangler d1 migrations`
    // оттуда не запустить. На мигрированной базе это no-op.
    await ensureArchiveSchema(env.DB);
    try {
      const archived = await syncArchive(env, ids);
      if (archived.archived || archived.failed) console.log('archive', archived);
    } catch (e) {
      console.error('archive failed', e);
    }
    // Гигиена D1: истёкшие refresh-сессии и старые счётчики частоты.
    const now = Date.now();
    try {
      await cleanupSessions(env.DB, now);
    } catch (e) {
      console.error('session cleanup failed', e);
    }
    await cleanupAuthLimits(env.DB, now);
  },
};
