import type { AuthContext } from '../auth/guards';
import type { Env } from '../env';
import { json } from '../http/response';
import { payFlags, publicFlags } from '../pay/flags';
import { payBalanceMicro, payHistory } from '../pay/ledger';
import { ensurePaySchema, PAY_SCHEMA_VERSION, PAY_TABLES } from '../pay/schema';
import { ShopError, catalogForClient, entitlements, purchase } from '../pay/shop';
import { formatMicroUsdt } from '../pay/tron/amount';
import { usdtContract } from '../pay/tron/contracts';
import { requireAdmin } from '../http/admin';
import {
  DAILY_LIMIT_MICRO, MIN_WITHDRAW_MICRO, PayoutError, approveWithdrawal, confirmWithdrawal,
  failWithdrawal, listWithdrawals, markBroadcast, markSent, requestWithdrawal, reserveWithdrawal,
  withdrawalQueue,
} from '../pay/payouts';
import { isPayoutsStopped, reconcile, setPayoutsStop } from '../pay/reconcile';
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
    asset: 'USDT',
    products: catalogForClient(),
    now: Date.now(),
  }, 200, { 'Cache-Control': 'public, max-age=300' });
}

/** Баланс, история и купленная косметика — только для владельца. */
export async function payAccount(env: Env, auth: AuthContext): Promise<Response> {
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const flags = payFlags(env);
  const [balanceMicro, history, owned] = await Promise.all([
    payBalanceMicro(env.DB, auth.userId),
    payHistory(env.DB, auth.userId, 50),
    entitlements(env.DB, auth.userId),
  ]);
  return json({
    ok: true,
    asset: 'USDT',
    balanceMicro,
    balance: formatMicroUsdt(balanceMicro),
    purchasesEnabled: flags.purchases,
    history,
    entitlements: owned,
    now: Date.now(),
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
  requireAdmin(request, env);
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
  requireAdmin(request, env);
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
  requireAdmin(request, env);
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const body = await readJsonObject(request);
  const stop = body.stop !== false;
  const now = Date.now();
  await setPayoutsStop(env.DB, stop, String(body.reason ?? 'manual'), now);
  return json({ ok: true, stop, now });
}
