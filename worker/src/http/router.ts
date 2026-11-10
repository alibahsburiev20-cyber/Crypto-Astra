import { requireAuth } from '../auth/guards';
import type { Env } from '../env';
import { login, logout, refresh, register } from '../routes/auth';
import { claim, me } from '../routes/game';
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

    if (p === '/me' || p === '/claim') {
      const a = await requireAuth(request, env);
      if (m === 'GET' && p === '/me') return await me(env, a);
      if (m === 'POST' && p === '/claim') return await claim(request, env, a);
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
