import type { AuthContext } from '../auth/guards';
import type { Env } from '../env';
import { json } from '../http/response';
import { ensureAddress, findAddress, signerDeriver } from '../pay/addresses';
import { payFlags, publicFlags, walletState } from '../pay/flags';
import { payBalanceMicro, payHistory } from '../pay/ledger';
import { ensurePaySchema, PAY_SCHEMA_VERSION, PAY_TABLES } from '../pay/schema';
import { ShopError, catalogForClient, entitlements, premiumStatus, purchase } from '../pay/shop';
import { formatMicroUsdt } from '../pay/tron/amount';
import { usdtContract } from '../pay/tron/contracts';
import { requireAdmin } from '../http/admin';
import {
  DAILY_LIMIT_MICRO, MIN_WITHDRAW_MICRO, PayoutError, approveWithdrawal, confirmWithdrawal,
  failWithdrawal, listWithdrawals, markBroadcast, markSent, requestWithdrawal, reserveWithdrawal,
  withdrawalQueue,
} from '../pay/payouts';
import { isPayoutsStopped, reconcile, setPayoutsStop } from '../pay/reconcile';
import { ownedCosmetics } from '../pay/cosmetics';
import { BroadcastError, sendUsdt, signerClient, trongridTransport } from '../pay/broadcast';
import { usdtContract as usdtContractOf } from '../pay/tron/contracts';
import { ApiError } from '../world/errors';

// Astra Pay: маршруты.
//
// На этапе 3–8 открыты каталог, баланс и покупка. Ни приёма денег, ни выплат
// снаружи по-прежнему нет: депозиты появляются только из монитора блокчейна,
// выплаты — только после этапа 10 и отдельного решения.
//
// Все денежные маршруты закрыты флагом: пока `PURCHASES_ENABLED` выключен,
// покупка отвечает `503 purchases_disabled`, а не «тихо не работает».

export async function payStatus(env: Env): Promise<Response> {
  const flags = payFlags(env);
  // Базу трогаем только когда это осмысленно: при выключенных деньгах запрос не
  // должен стоить ни одного DDL-запроса к D1.
  const touchDb = flags.payments || flags.schemaCheck;
  const ready = touchDb ? await ensurePaySchema(env.DB) : null;
  return json({
    ok: true,
    service: 'astra-pay',
    version: PAY_SCHEMA_VERSION,
    network: flags.network,
    asset: 'USDT',
    decimals: 6,
    contract: usdtContract(env, flags.network),
    flags: publicFlags(flags),
    // off — деньги выключены; signer_required — включены, но кошельки ещё не
    // выдаются (не настроен Signer); ready — можно покупать и принимать USDT.
    wallets: walletState(env, flags),
    // null — база не проверялась (деньги выключены), 'ready' — таблицы на месте.
    schema: ready === null ? 'off' : ready ? 'ready' : 'error',
    tables: PAY_TABLES.length,
    now: Date.now(),
  }, 200, { 'Cache-Control': 'no-store' });
}

/** Каталог. Цены — серверные; выключенные товары не показываются. */
export async function payProducts(env: Env): Promise<Response> {
  const flags = payFlags(env);
  return json({
    ok: true,
    purchasesEnabled: flags.purchases,
    wallets: walletState(env, flags),
    asset: 'USDT',
    products: catalogForClient(),
    now: Date.now(),
  }, 200, { 'Cache-Control': 'public, max-age=300' });
}

/**
 * Личный адрес для депозитов. Адрес выдаётся один раз и не меняется — иначе
 * игрок отправит деньги на старый адрес и они потеряются.
 *
 * Без Signer-контура адрес не выдаётся: `503 signer_not_configured`. Это
 * осознанно — «временный» адрес из ниоткуда хуже, чем понятная ошибка.
 */
export async function payAddress(env: Env, auth: AuthContext): Promise<Response> {
  const flags = payFlags(env);
  if (!flags.deposits) throw new ApiError(503, 'deposits_disabled');
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');

  const existing = await findAddress(env.DB, auth.userId);
  if (existing) {
    return json({
      ok: true, address: existing.address, index: existing.index, created: false,
      network: flags.network, asset: 'USDT', contract: usdtContract(env, flags.network),
    });
  }

  let address;
  try {
    address = await ensureAddress(env.DB, auth.userId, signerDeriver(env), Date.now());
  } catch (e) {
    const code = e instanceof Error ? e.message : 'signer_error';
    if (code === 'signer_not_configured') throw new ApiError(503, 'signer_not_configured');
    throw new ApiError(502, 'signer_unavailable');
  }

  return json({
    ok: true, address: address.address, index: address.index, created: address.created,
    network: flags.network, asset: 'USDT', contract: usdtContract(env, flags.network),
  }, 201);
}

/** Баланс, история и купленная косметика — только для владельца. */
export async function payAccount(env: Env, auth: AuthContext): Promise<Response> {
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const flags = payFlags(env);
  const now = Date.now();
  const [balanceMicro, history, owned, premium] = await Promise.all([
    payBalanceMicro(env.DB, auth.userId),
    payHistory(env.DB, auth.userId, 50),
    entitlements(env.DB, auth.userId),
    premiumStatus(env.DB, auth.userId, now),
  ]);
  return json({
    ok: true,
    asset: 'USDT',
    balanceMicro,
    balance: formatMicroUsdt(balanceMicro),
    purchasesEnabled: flags.purchases,
    history,
    entitlements: owned,
    premium,
    now,
  });
}

/** Покупка за баланс. Повтор с тем же `Idempotency-Key` не спишет дважды. */
export async function payPurchase(request: Request, env: Env, auth: AuthContext): Promise<Response> {
  const flags = payFlags(env);
  if (!flags.purchases) throw new ApiError(503, 'purchases_disabled');
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');

  const body = await readJsonObject(request);
  const idemKey = request.headers.get('Idempotency-Key') ?? String(body.idemKey ?? '');
  const productId = String(body.productId ?? '');

  try {
    const result = await purchase(env.DB, { userId: auth.userId, productId, idemKey }, Date.now());
    // Купленное сразу видно другим: мир получает срок Premium и выбранный стиль.
    try {
      const owned = await ownedCosmetics(env.DB, auth.userId, Date.now());
      const skin = productId === 'skin_nebula' ? 'nebula' : productId === 'skin_ember' ? 'ember' : productId === 'premium_30' ? 'premium' : null;
      const payload: Record<string, unknown> = {};
      if (skin) { payload.frame = skin; payload.trail = skin; }
      if (productId === 'badge_pioneer') payload.badge = 'pioneer';
      await env.WORLD.get(env.WORLD.idFromName(auth.worldId)).syncPremium(
        auth.userId, owned.premiumUntil,
        { ...owned, ...(payload as { frame?: 'nebula'; trail?: 'nebula'; badge?: 'pioneer' }) },
      );
    } catch (e) {
      // Покупка уже прошла: сбой синхронизации косметики не отменяет её.
      console.error('cosmetic sync failed', e);
    }
    return json({
      ok: true,
      ...result,
      balance: formatMicroUsdt(result.balanceMicro),
    }, result.duplicated ? 200 : 201);
  } catch (e) {
    if (e instanceof ShopError) {
      if (e.code === 'unknown_product') throw new ApiError(404, 'unknown_product');
      if (e.code === 'insufficient_funds') throw new ApiError(402, 'insufficient_funds');
      if (e.code === 'bad_idem_key') throw new ApiError(400, 'bad_idem_key');
      throw new ApiError(409, e.code);
    }
    throw e;
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}


// --- Выплаты (этап 10) --------------------------------------------------------
//
// Заявку создаёт игрок, подтверждает админ. Пока `PAYOUTS_ENABLED` выключен,
// маршрут отвечает 503: «кнопка есть, денег нет» — честнее, чем тишина.
// Подписи и отправки в сети здесь ещё нет: это Signer (этап 9).

export async function payWithdrawals(env: Env, auth: AuthContext): Promise<Response> {
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const flags = payFlags(env);
  const [items, balanceMicro, stopped] = await Promise.all([
    listWithdrawals(env.DB, auth.userId, 20),
    payBalanceMicro(env.DB, auth.userId),
    isPayoutsStopped(env.DB),
  ]);
  return json({
    ok: true,
    asset: 'USDT',
    balanceMicro,
    balance: formatMicroUsdt(balanceMicro),
    payoutsEnabled: flags.payouts && !stopped,
    stopped,
    minAmountMicro: MIN_WITHDRAW_MICRO,
    dailyLimitMicro: DAILY_LIMIT_MICRO,
    items,
    now: Date.now(),
  });
}

export async function payWithdraw(request: Request, env: Env, auth: AuthContext): Promise<Response> {
  const flags = payFlags(env);
  if (!flags.payouts) throw new ApiError(503, 'payouts_disabled');
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  if (await isPayoutsStopped(env.DB)) throw new ApiError(409, 'payouts_stopped');

  const body = await readJsonObject(request);
  const idemKey = request.headers.get('Idempotency-Key') ?? String(body.idemKey ?? '');
  try {
    const result = await requestWithdrawal(env.DB, {
      userId: auth.userId,
      address: String(body.address ?? ''),
      amountMicro: Number(body.amountMicro ?? 0),
      idemKey,
    }, Date.now());
    return json({
      ok: true,
      withdrawal: result.withdrawal,
      amount: formatMicroUsdt(result.withdrawal.amount_micro),
      duplicated: result.duplicated,
    }, result.duplicated ? 200 : 201);
  } catch (e) {
    if (e instanceof PayoutError) throw new ApiError(payoutStatus(e.code), e.code);
    throw e;
  }
}

function payoutStatus(code: string): number {
  if (code === 'bad_address' || code === 'bad_amount' || code === 'bad_idem_key') return 400;
  if (code === 'insufficient_funds') return 402;
  if (code === 'daily_limit' || code === 'status_changed') return 409;
  if (code === 'below_minimum' || code === 'above_maximum') return 422;
  return 400;
}

// --- Админка платежей (этап 11) ----------------------------------------------

export async function adminPay(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const now = Date.now();
  const [report, queue] = await Promise.all([reconcile(env.DB, now), withdrawalQueue(env.DB, 50)]);
  return json({
    ok: true,
    flags: publicFlags(payFlags(env)),
    reconcile: report,
    queue,
    now,
  }, 200, { 'Cache-Control': 'no-store' });
}

const ACTIONS: Record<string, (db: D1Database, id: string, body: Record<string, unknown>, now: number) => Promise<unknown>> = {
  approve: (db, id, _b, now) => approveWithdrawal(db, id, now),
  reserve: (db, id, _b, now) => reserveWithdrawal(db, id, now),
  broadcast: (db, id, b, now) => markBroadcast(db, id, {
    txid: b.txid ? String(b.txid) : undefined,
    attempt: b.attempt === undefined ? 1 : Number(b.attempt),
    error: b.error ? String(b.error) : undefined,
  }, now),
  sent: (db, id, b, now) => markSent(db, id, String(b.txid ?? ''), now),
  confirm: (db, id, _b, now) => confirmWithdrawal(db, id, now),
  fail: (db, id, b, now) => failWithdrawal(db, id, String(b.reason ?? 'manual'), now),
};

export async function adminPayWithdrawal(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const body = await readJsonObject(request);
  const id = String(body.id ?? '');
  const action = String(body.action ?? '');
  const handler = ACTIONS[action];
  if (!id || !handler) throw new ApiError(400, 'bad_action');
  try {
    const withdrawal = await handler(env.DB, id, body, Date.now());
    return json({ ok: true, action, withdrawal });
  } catch (e) {
    if (e instanceof PayoutError) throw new ApiError(payoutStatus(e.code), e.code);
    throw e;
  }
}

export async function adminPayStop(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const body = await readJsonObject(request);
  const stop = body.stop !== false;
  const now = Date.now();
  await setPayoutsStop(env.DB, stop, String(body.reason ?? 'manual'), now);
  return json({ ok: true, stop, now });
}


// --- Реальная отправка (этап 10, тестнет) -------------------------------------

/**
 * Собрать, подписать и отправить выплату. Вызывается админом по заявке в
 * состоянии `reserved`: пока заявка не зарезервирована, деньги с баланса не
 * списаны, и отправлять нечего.
 *
 * Без `SIGNER` и `PAY_HOT_ADDRESS` маршрут отвечает 503: лучше явная ошибка,
 * чем «будто отправили».
 */
export async function adminPaySend(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');

  const body = await readJsonObject(request);
  const id = String(body.id ?? '');
  if (!id) throw new ApiError(400, 'bad_id');

  const row = await env.DB.prepare(
    'SELECT id, user_id, address, amount_micro, status, txid FROM pay_withdrawals WHERE id = ?',
  ).bind(id).first<{ id: string; user_id: string; address: string; amount_micro: number; status: string; txid: string | null }>();
  if (!row) throw new ApiError(404, 'not_found');
  if (row.status !== 'reserved') throw new ApiError(409, 'not_reserved');

  const flags = payFlags(env);
  const owner = String(env.PAY_HOT_ADDRESS ?? '');
  if (!owner) throw new ApiError(503, 'hot_wallet_missing');
  if (!env.SIGNER) throw new ApiError(503, 'signer_not_configured');

  const attemptRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM pay_payouts WHERE withdrawal_id = ?')
    .bind(id).first<number>('c');
  const attempt = Number(attemptRow ?? 0) + 1;

  try {
    const sent = await sendUsdt(trongridTransport(env), signerClient(env), {
      owner,
      to: String(row.address),
      amountMicro: Number(row.amount_micro),
      contract: usdtContractOf(env, flags.network),
    });
    const updated = await markBroadcast(env.DB, id, { txid: sent.txid, attempt }, Date.now());
    return json({ ok: true, txid: sent.txid, withdrawal: updated });
  } catch (e) {
    if (e instanceof BroadcastError) {
      await markBroadcast(env.DB, id, { attempt, error: e.message }, Date.now()).catch(() => null);
      throw new ApiError(502, e.code);
    }
    throw e;
  }
}
