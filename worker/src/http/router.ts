import { requireAuth } from '../auth/guards';
import type { Env } from '../env';
import { config, login, logout, refresh, register } from '../routes/auth';
import {
  buyFuel, cancelExpedition, chooseEvent, claim, craftStart, guild, guildCreate, guildJoin, guildKick, guildLeave,
  garage, garageBuy, minigame, minigameFinish, minigameStart, profile, profileCallsign, profileStyle,
  guildRename, guildRole, ledger, market, marketBuy, marketCancel, marketLot, me, missionClaim, moduleInstall, passClaim,
  referralApply, repair, season, shipBuy, social, startExpedition,
} from '../routes/game';
import {
  adminPay, adminPayPrize, adminPayPrizeAward, adminPaySend, adminPayStop,
  adminPaySweepPlan, adminPayWithdrawal,
  payAccount, payAddress, payProducts, payPurchase,
  payStatus, payWithdraw, payWithdrawals,
} from '../routes/pay';
import { adminPool, adminPoolEntry, poolPublic } from '../routes/pool';
import { adminFreeze, adminGrant, adminWorld } from '../routes/admin';
import { accountDelete, accountExport } from '../routes/account';
import { enforceUserLimit } from './userLimit';
import { errorResponse, json } from './response';

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;
  try {
    if (p === '/health') {
      // build — метка из [vars]: по ней видно, какая сборка отвечает.
      return json({ ok: true, service: 'crypto-astra-api', build: String(env.APP_BUILD ?? 'dev'), now: Date.now() });
    }
    if (m === 'GET' && p === '/config') return config(env);
    // Пул: публичный отчёт открыт без авторизации, запись — только с админ-токеном.
    if (m === 'GET' && (p === '/pool.json' || p === '/pool/report')) return await poolPublic(env);
    // Astra Pay: состояние контура. Денежных маршрутов на этапе 1 нет.
    if (m === 'GET' && p === '/pay/status.json') return await payStatus(env);
    if (m === 'GET' && p === '/pay/products.json') return await payProducts(env);
    if (p === '/pay/account.json' || p === '/pay/purchase' || p === '/pay/withdrawals'
      || p === '/pay/withdraw' || p === '/pay/address.json') {
      const auth = await requireAuth(request, env);
      if (m === 'GET' && p === '/pay/account.json') return await payAccount(env, auth);
      if (m === 'POST' && p === '/pay/purchase') return await payPurchase(request, env, auth);
      if (m === 'GET' && p === '/pay/withdrawals') return await payWithdrawals(env, auth);
      if (m === 'GET' && p === '/pay/address.json') return await payAddress(env, auth);
      if (m === 'POST' && p === '/pay/withdraw') return await payWithdraw(request, env, auth);
      return json({ error: 'not_found' }, 404);
    }
    if (p === '/admin/pay' || p === '/admin/pay/withdrawal' || p === '/admin/pay/stop'
      || p === '/admin/pay/send' || p === '/admin/pay/sweep/plan'
      || p === '/admin/pay/prize' || p === '/admin/pay/prize/award') {
      if (m === 'GET' && p === '/admin/pay') return await adminPay(request, env);
      if (m === 'GET' && p === '/admin/pay/sweep/plan') return await adminPaySweepPlan(request, env);
      if (m === 'GET' && p === '/admin/pay/prize') return await adminPayPrize(request, env);
      if (m === 'POST' && p === '/admin/pay/prize/award') return await adminPayPrizeAward(request, env);
      if (m === 'POST' && p === '/admin/pay/withdrawal') return await adminPayWithdrawal(request, env);
      if (m === 'POST' && p === '/admin/pay/stop') return await adminPayStop(request, env);
      if (m === 'POST' && p === '/admin/pay/send') return await adminPaySend(request, env);
      return json({ error: 'not_found' }, 404);
    }
    if (p === '/admin/world' || p === '/admin/world/freeze' || p === '/admin/world/grant') {
      if (m === 'GET' && p === '/admin/world') return await adminWorld(request, env);
      if (m === 'POST' && p === '/admin/world/freeze') return await adminFreeze(request, env);
      if (m === 'POST' && p === '/admin/world/grant') return await adminGrant(request, env);
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

    // Личные данные: экспорт и удаление аккаунта (GDPR).
    if (p === '/account' && m === 'DELETE') {
      const a = await requireAuth(request, env);
      return await accountDelete(request, env, a);
    }
    if (p === '/account/export' && m === 'GET') {
      const a = await requireAuth(request, env);
      return await accountExport(env, a);
    }

    if (p === '/profile' || p === '/profile/callsign' || p === '/profile/style' || p === '/me' || p === '/garage' || p === '/garage/buy' || p === '/minigame' || p === '/minigame/start' || p === '/minigame/finish' || p === '/season' || p === '/claim' || p === '/ledger' || p === '/expeditions/start' || p === '/expeditions/cancel' || p === '/expeditions/choose' || p === '/expeditions/choose-event' || p === '/ships/repair' || p === '/fuel/buy' || p === '/craft/start' || p === '/modules/install' || p === '/ships/buy' || p === '/market' || p === '/market/lot' || p === '/market/buy' || p === '/market/cancel' || p === '/social' || p === '/missions/claim' || p === '/pass/claim' || p === '/guild' || p === '/guild/create' || p === '/guild/join' || p === '/guild/leave' || p === '/guild/kick' || p === '/guild/role' || p === '/guild/rename' || p === '/referrals/apply') {
      const a = await requireAuth(request, env);
      // Частотный лимит: чтение и запись считаются отдельно.
      await enforceUserLimit(env, a.userId, m !== 'GET');
      if (m === 'GET' && p === '/me') return await me(env, a);
      if (m === 'GET' && p === '/profile') return await profile(env, a);
      if (m === 'POST' && p === '/profile/callsign') return await profileCallsign(request, env, a);
      if (m === 'POST' && p === '/profile/style') return await profileStyle(request, env, a);
      if (m === 'GET' && p === '/ledger') return await ledger(url, env, a);
      if (m === 'GET' && p === '/season') return await season(env, a);
      if (m === 'GET' && p === '/garage') return await garage(env, a);
      if (m === 'POST' && p === '/garage/buy') return await garageBuy(request, env, a);
      if (m === 'GET' && p === '/minigame') return await minigame(env, a);
      if (m === 'POST' && p === '/minigame/start') return await minigameStart(request, env, a);
      if (m === 'POST' && p === '/minigame/finish') return await minigameFinish(request, env, a);
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
