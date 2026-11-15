import type { Env } from './env';
import { route } from './http/router';
import { WorldLobby } from './lobby/WorldLobby';
import { SITE_FILES } from './static/site';
import { World } from './world/World';

export { World, WorldLobby };
export type { Env };

const SECURITY: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

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
    const lobby = env.LOBBY.get(env.LOBBY.idFromName('main'));
    const worlds = await lobby.seats();
    for (const w of worlds) {
      const id = String(w.world_id);
      try {
        await env.WORLD.get(env.WORLD.idFromName(id)).poke();
      } catch (e) {
        console.error('poke failed', id, e);
      }
    }
  },
};
