import type { AuthContext } from '../auth/guards';
import type { Env } from '../env';
import { json } from '../http/response';
import { payFlags, publicFlags } from '../pay/flags';
import { payBalanceMicro, payHistory } from '../pay/ledger';
import { ensurePaySchema, PAY_SCHEMA_VERSION, PAY_TABLES } from '../pay/schema';
import { ShopError, catalogForClient, entitlements, purchase } from '../pay/shop';
import { formatMicroUsdt } from '../pay/tron/amount';
import { usdtContract } from '../pay/tron/contracts';
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
