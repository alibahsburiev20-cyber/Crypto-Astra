import { World } from './world/World';
import { WorldLobby } from './lobby/WorldLobby';

export { World, WorldLobby };

export interface Env {
  DB: D1Database;
  WORLD: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  JWT_SECRET: string;
  TURNSTILE_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_ACCESS_AUD: string;
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'crypto-astra-api' });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  },
};
