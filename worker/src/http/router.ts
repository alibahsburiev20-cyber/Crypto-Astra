import { requireAuth } from '../auth/guards';
import type { Env } from '../env';
import { config, login, logout, refresh, register } from '../routes/auth';
import {
  buyFuel, cancelExpedition, chooseEvent, claim, craftStart, guild, guildCreate, guildJoin, guildKick, guildLeave,
  guildRename, guildRole, ledger, market, marketBuy, marketCancel, marketLot, me, missionClaim, moduleInstall, passClaim,
  referralApply, repair, season, shipBuy, social, startExpedition,
} from '../routes/game';
import {
  adminPay, adminPayStop, adminPayWithdrawal, payAccount, payProducts, payPurchase, payStatus,
  payWithdraw, payWithdrawals,
} from '../routes/pay';
import { adminPool, adminPoolEntry, poolPublic } from '../routes/pool';
import { errorResponse, json } from './response';

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;
  try {
    if (p === '/health') return json({ ok: true, service: 'crypto-astra-api', now: Date.now() });
    if (m === 'GET' && p === '/config') return config(env);
    // Пул: публичный отчёт открыт без авторизации, запись — только с админ-токеном.
    if (m === 'GET' && (p === '/pool.json' || p === '/pool/report')) return await poolPublic(env);
    // Astra Pay: состояние контура. Денежных маршрутов на этапе 1 нет.
    if (m === 'GET' && p === '/pay/status.json') return await payStatus(env);
    if (m === 'GET' && p === '/pay/products.json') return await payProducts(env);
    if (p === '/pay/account.json' || p === '/pay/purchase' || p === '/pay/withdrawals' || p === '/pay/withdraw') {
      const auth = await requireAuth(request, env);
      if (m === 'GET' && p === '/pay/account.json') return await payAccount(env, auth);
      if (m === 'POST' && p === '/pay/purchase') return await payPurchase(request, env, auth);
      if (m === 'GET' && p === '/pay/withdrawals') return await payWithdrawals(env, auth);
      if (m === 'POST' && p === '/pay/withdraw') return await payWithdraw(request, env, auth);
      return json({ error: 'not_found' }, 404);
    }
    if (p === '/admin/pay' || p === '/admin/pay/withdrawal' || p === '/admin/pay/stop') {
      if (m === 'GET' && p === '/admin/pay') return await adminPay(request, env);
      if (m === 'POST' && p === '/admin/pay/withdrawal') return await adminPayWithdrawal(request, env);
      if (m === 'POST' && p === '/admin/pay/stop') return await adminPayStop(request, env);
      return json({ error: 'not_found' }, 404);
    }
    if (p === '/admin/pool' || p === '/admin/pool/entry') {
      if (m === 'GET' && p === '/admin/pool') return await adminPool(request, env);
      if (m === 'POST' && p === '/admin/pool/entry') return await adminPoolEntry(request, env);
      return json({ error: 'not_found' }, 404);
    }

    if (m === 'POST' && p === '/auth/register') return await register(request, env);
    if (m === 'POST' && p === '/auth/login') return await login(request, env);
    if (m === 'POST' && p === '/auth/refresh') return await refresh(request, env);
    if (m === 'POST' && p === '/auth/logout') return await logout(request, env);

    if (p === '/me' || p === '/season' || p === '/claim' || p === '/ledger' || p === '/expeditions/start' || p === '/expeditions/cancel' || p === '/expeditions/choose' || p === '/expeditions/choose-event' || p === '/ships/repair' || p === '/fuel/buy' || p === '/craft/start' || p === '/modules/install' || p === '/ships/buy' || p === '/market' || p === '/market/lot' || p === '/market/buy' || p === '/market/cancel' || p === '/social' || p === '/missions/claim' || p === '/pass/claim' || p === '/guild' || p === '/guild/create' || p === '/guild/join' || p === '/guild/leave' || p === '/guild/kick' || p === '/guild/role' || p === '/guild/rename' || p === '/referrals/apply') {
      const a = await requireAuth(request, env);
      if (m === 'GET' && p === '/me') return await me(env, a);
      if (m === 'GET' && p === '/ledger') return await ledger(url, env, a);
      if (m === 'GET' && p === '/season') return await season(env, a);
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
      if (m === 'GET' && p === '/social') return await social(env, a);
      if (m === 'POST' && p === '/missions/claim') return await missionClaim(request, env, a);
      if (m === 'POST' && p === '/pass/claim') return await passClaim(request, env, a);
      if (m === 'GET' && p === '/guild') return await guild(env, a);
      if (m === 'POST' && p === '/guild/create') return await guildCreate(request, env, a);
      if (m === 'POST' && p === '/guild/join') return await guildJoin(request, env, a);
      if (m === 'POST' && p === '/guild/leave') return await guildLeave(request, env, a);
      if (m === 'POST' && p === '/guild/kick') return await guildKick(request, env, a);
      if (m === 'POST' && p === '/guild/role') return await guildRole(request, env, a);
      if (m === 'POST' && p === '/guild/rename') return await guildRename(request, env, a);
      if (m === 'POST' && p === '/referrals/apply') return await referralApply(request, env, a);
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
