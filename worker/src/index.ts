import type { Env } from './env';
import { World } from './world/World';
import { WorldLobby } from './lobby/WorldLobby';

export { World, WorldLobby };
export type { Env };

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'crypto-astra-api' });
    return Response.json({ error: 'not_found' }, { status: 404 });
  },
};
