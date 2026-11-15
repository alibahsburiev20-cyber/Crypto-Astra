import { requireAuth } from '../auth/guards';
import type { Env } from '../env';
import { login, logout, refresh, register } from '../routes/auth';
import { claim, collectExpedition, me, startExpedition } from '../routes/game';
import { errorResponse, json } from './response';

export async function route(request: Request, env: Env): Promise<Response> {
  const { pathname: p } = new URL(request.url);
  const m = request.method;
  try {
    if (p === '/health') return json({ ok: true, service: 'crypto-astra-api' });

    if (m === 'POST' && p === '/auth/register') return await register(request, env);
    if (m === 'POST' && p === '/auth/login') return await login(request, env);
    if (m === 'POST' && p === '/auth/refresh') return await refresh(request, env);
    if (m === 'POST' && p === '/auth/logout') return await logout(request, env);

    const collectMatch = /^\/expeditions\/([^/]{1,64})\/collect$/.exec(p);
    if (p === '/me' || p === '/claim' || p === '/expeditions/start' || collectMatch) {
      const a = await requireAuth(request, env);
      if (m === 'GET' && p === '/me') return await me(env, a);
      if (m === 'POST' && p === '/claim') return await claim(request, env, a);
      if (m === 'POST' && p === '/expeditions/start') return await startExpedition(request, env, a);
      if (m === 'POST' && collectMatch) return await collectExpedition(request, env, a, collectMatch[1]);
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
