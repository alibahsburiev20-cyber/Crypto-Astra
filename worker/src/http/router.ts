import { requireAuth } from '../auth/guards';
import type { Env } from '../env';
import { config, login, logout, refresh, register } from '../routes/auth';
import { buyFuel, cancelExpedition, chooseEvent, claim, craftStart, ledger, market, marketBuy, marketCancel, marketLot, me, moduleInstall, repair, shipBuy, startExpedition } from '../routes/game';
import { errorResponse, json } from './response';

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;
  try {
    if (p === '/health') return json({ ok: true, service: 'crypto-astra-api', now: Date.now() });
    if (m === 'GET' && p === '/config') return config(env);

    if (m === 'POST' && p === '/auth/register') return await register(request, env);
    if (m === 'POST' && p === '/auth/login') return await login(request, env);
    if (m === 'POST' && p === '/auth/refresh') return await refresh(request, env);
    if (m === 'POST' && p === '/auth/logout') return await logout(request, env);

    if (p === '/me' || p === '/claim' || p === '/ledger' || p === '/expeditions/start' || p === '/expeditions/cancel' || p === '/expeditions/choose' || p === '/expeditions/choose-event' || p === '/ships/repair' || p === '/fuel/buy' || p === '/craft/start' || p === '/modules/install' || p === '/ships/buy' || p === '/market' || p === '/market/lot' || p === '/market/buy' || p === '/market/cancel') {
      const a = await requireAuth(request, env);
      if (m === 'GET' && p === '/me') return await me(env, a);
      if (m === 'GET' && p === '/ledger') return await ledger(url, env, a);
      if (m === 'POST' && p === '/claim') return await claim(request, env, a);
      if (m === 'POST' && p === '/expeditions/start') return await startExpedition(request, env, a);
      if (m === 'POST' && p === '/expeditions/cancel') return await cancelExpedition(request, env, a);
      // /expeditions/choose-event — имя из концепции (II.7); /expeditions/choose оставлен для совместимости.
      if (m === 'POST' && (p === '/expeditions/choose' || p === '/expeditions/choose-event')) return await chooseEvent(request, env, a);
      if (m === 'POST' && p === '/ships/repair') return await repair(request, env, a);
      if (m === 'POST' && p === '/fuel/buy') return await buyFuel(request, env, a);
      if (m === 'POST' && p === '/craft/start') return await craftStart(request, env, a);
      if (m === 'POST' && p === '/modules/install') return await moduleInstall(request, env, a);
      if (m === 'POST' && p === '/ships/buy') return await shipBuy(request, env, a);
      if (p === '/market' && m === 'GET') return await market(url, env, a);
      if (m === 'POST' && p === '/market/lot') return await marketLot(request, env, a);
      if (m === 'POST' && p === '/market/buy') return await marketBuy(request, env, a);
      if (m === 'POST' && p === '/market/cancel') return await marketCancel(request, env, a);
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
