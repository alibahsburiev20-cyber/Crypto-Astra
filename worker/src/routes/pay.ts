import type { AuthContext } from '../auth/guards';
import type { Env } from '../env';
import { json, readJsonSoft } from '../http/response';
import { addressMatchesChain, displayAddress, ensureAddress, findAddress, signerDeriver } from '../pay/addresses';
import { chainSpec, chainSpecFor, enabledChains, evmChainSpecs, type ChainSpec } from '../pay/chain';
import { payFlags, publicFlags, walletState } from '../pay/flags';
import { depositTxidFromRef, payBalanceMicro, payHistory } from '../pay/ledger';
import { qrPng } from '../pay/qr';
import { prizeSharePercent, usdtPoolBlock } from '../pay/pool';
import { SWEEP_FEE_SUN, accountBalances, sweepChainDeps, sweepPlan } from '../pay/sweep';
import { evmChainId } from '../pay/evm/config';
import { BroadcastError as EvmBroadcastError, DEFAULT_MAX_GAS_PRICE_WEI, evmRpcFor, evmSignerClient, payoutGas, sendUsdtEvm } from '../pay/evm/broadcast';
import { evmAccountBalances, evmHotWalletState, formatBnb, gasCostWei } from '../pay/evm/balances';
import { releaseNonce, reserveNonce } from '../pay/evm/payouts';
import { evmSweepPlan, formatSweepTotals } from '../pay/evm/sweep';
import { isTestnetNetwork } from '../pay/flags';
import { hotWalletState } from '../pay/hotwallet';
import { solvencySheet } from '../pay/solvency';
import {
  MAX_PRIZE_AWARD_MICRO, PrizeError, awardPrize, listPrizes, prizeSummary,
} from '../pay/prize';
import { ensurePaySchema, PAY_SCHEMA_VERSION, PAY_TABLES } from '../pay/schema';
import { ShopError, catalogForClient, entitlements, premiumStatus, purchase } from '../pay/shop';
import { formatMicroUsdt, isMicroAmount, parseUsdtToMicro } from '../pay/tron/amount';
import { usdtContract } from '../pay/tron/contracts';
import { parsePayChain, type PayChain } from '../pay/units';
import { readCursor } from '../pay/evm/deposits';
import { requireAdmin, requireOwner } from '../http/admin';
import {
  DAILY_LIMIT_MICRO, MIN_WITHDRAW_MICRO, PayoutError, approveWithdrawal, confirmWithdrawal, minWithdrawMicro,
  failWithdrawal, listWithdrawals, markBroadcast, markSent, requestWithdrawal, reserveWithdrawal,
  withdrawalQueue,
} from '../pay/payouts';
import { isPayoutsStopped, reconcile, setPayoutsStop } from '../pay/reconcile';
import { ownedCosmetics } from '../pay/cosmetics';
import { BroadcastError, sendUsdt, signerClient, trongridTransport } from '../pay/broadcast';
import { trongridFetcher } from '../pay/monitor';
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
  // Всё, что касается сети, — из одного места (`pay/chain.ts`). Раньше `decimals`
  // и `contract` были записаны здесь руками, и при появлении второй сети это
  // стало бы «показываем игроку одну сеть, а смотрим другую».
  const spec = chainSpec(env, flags);
  // Базу трогаем только когда это осмысленно: при выключенных деньгах запрос не
  // должен стоить ни одного DDL-запроса к D1.
  const touchDb = flags.payments || flags.schemaCheck;
  const ready = touchDb ? await ensurePaySchema(env.DB) : null;
  return json({
    ok: true,
    service: 'astra-pay',
    version: PAY_SCHEMA_VERSION,
    network: flags.network,
    chain: spec.chain,
    networkLabel: spec.label,
    asset: 'USDT',
    decimals: spec.decimals,
    contract: spec.contract,
    // Что из денежного контура реально готово на этой цепи: «сеть выбрана» и
    // «код умеет» — разные вещи, и игрок должен видеть вторую.
    rail: spec.ready,
    confirmations: spec.confirmations,
    // Все сети, которые игрок может выбрать: витрина рисует переключатель по
    // этому списку, а не по своему предположению. `chainConfigError` при этом
    // означает «список пуст, потому что в names опечатка» — и говорит причину.
    networks: payNetworks(env, flags),
    railError: flags.chainConfigError ? flags.chainConfigDetail : '',
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
/**
 * Сети, доступные игроку, в том виде, как их рисует витрина.
 *
 * Отдельная функция потому, что список нужен и в `/pay/status.json`, и в
 * `/pay/products`: расхождение в нём = «магазин предлагает сеть, которой нет».
 * Активная цепь идёт первой — её клиент выбирает по умолчанию.
 */
export function payNetworks(env: Env, flags = payFlags(env)): Array<Record<string, unknown>> {
  const specs = enabledChains(env).chains.map((chain) => chainSpecFor(env, chain, flags));
  return specs.map((spec) => ({
    chain: spec.chain,
    label: spec.label,
    asset: 'USDT',
    decimals: spec.decimals,
    confirmations: spec.confirmations,
    contract: spec.contract,
    // Готовность именно этой сети: «BNB работает, Polygon ещё нет» — нормальное
    // состояние на время раскатки, и витрина обязана показать её неактивной, а не
    // прятать или, хуже того, давать адрес, по которому никто не смотрит.
    ready: spec.ready.deposits && Boolean(spec.contract),
    rail: spec.ready,
    explorer: { name: spec.explorerName, url: spec.explorer },
  }));
}

export async function payProducts(env: Env): Promise<Response> {
  const flags = payFlags(env);
  // Выключенный контур не должен выглядеть как «магазин с пустыми полками»:
  // 200 с пустым каталогом индексируется поисковиками, цитируется игроками как
  // «магазин сломался» и вообще ничем не отличается от реальной пустоты.
  // Включённые покупки при пустом каталоге — другое дело: это честное «товаров
  // пока нет», оно остаётся 200.
  if (!flags.payments) throw new ApiError(503, 'payments_disabled');
  return json({
    ok: true,
    purchasesEnabled: flags.purchases,
    wallets: walletState(env, flags),
    // Витрина обязана назвать сеть: адрес `0x…` игрок может по ошибке выбрать в
    // Ethereum или Polygon, и тогда деньги застрянут (ключ-то наш, а газа нет).
    asset: 'USDT',
    chain: chainSpec(env, flags).chain,
    networkLabel: chainSpec(env, flags).label,
    networks: payNetworks(env, flags),
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
/**
 * Адрес пополнения текущего игрока — одна функция на `/pay/address.json` и на
 * `/pay/qr`. Разделять проверки нельзя: картинка, показанная там, где адрес
 * ещё не готов, отправляет деньги в никуда точно так же, как нажатая «Купить».
 */
async function depositAddress(
  env: Env, auth: AuthContext, requestedChain = '',
): Promise<{ address: string; spec: ChainSpec }> {
  const flags = payFlags(env);
  if (!flags.deposits) throw new ApiError(503, 'deposits_disabled');
  // Сеть «похожа на неизвестную» — это не «возьмём первую»: игрок может увидеть
  // адрес одной сети, а монитор будет смотреть другую. Молчать дороже.
  if (flags.chainConfigError) throw new ApiError(503, 'pay_chain_unknown');
  // Какую сеть показать, спрашиваем у витрины (`?chain=`), но только в пределах
  // настроенного: `?chain=ethereum` обязан дать 409, а не «выдали адрес, который
  // никто не сканирует». Индекс деривации при этом общий — адрес в другой сети
  // это тот же ключ, и второй семени у нас нет.
  const allowed = enabledChains(env).chains;
  let chain: PayChain | null = flags.chain;
  if (requestedChain) {
    chain = parsePayChain(requestedChain);
    if (!chain) throw new ApiError(400, 'bad_chain');
    if (!allowed.includes(chain)) throw new ApiError(409, 'chain_not_enabled');
  }
  // Адрес выдаём только когда рельс этой цепи дописан от конца до конца:
  // выдать адрес в сети, где монитор ещё не умеет искать переводы, — это
  // означает «игрок прислал деньги, а мы их не нашли».
  const spec = chainSpecFor(env, chain ?? flags.chain, flags);
  if (!spec.ready.addresses) throw new ApiError(503, spec.ready.reason || 'rail_not_ready');
  if (!spec.contract) throw new ApiError(503, 'usdt_contract_missing');
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');

  const existing = await findAddress(env.DB, auth.userId, spec.chain);
  if (existing) {
    if (!addressMatchesChain(existing.address, spec.chain)) {
      // Колонка `chain` говорит «этот адрес нашей цепи», а формат — что нет.
      // Такое возможно только после ручной правки базы; показывать его нельзя,
      // начисление на него невозможно, и молча перевыпустить тоже (старый
      // адрес мог уже светиться игроку).
      throw new ApiError(409, 'address_chain_mismatch');
    }
    return { address: displayAddress(spec.chain, existing.address), spec };
  }

  try {
    const created = await ensureAddress(
      env.DB, auth.userId, signerDeriver(env, spec.chain), Date.now(), spec.chain,
    );
    return { address: displayAddress(spec.chain, created.address), spec, index: created.index, isNew: created.created } as {
      address: string; spec: ChainSpec; index: number; isNew: boolean;
    };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const code = e instanceof Error ? e.message : 'signer_error';
    if (code === 'signer_not_configured') throw new ApiError(503, 'signer_not_configured');
    throw new ApiError(502, 'signer_unavailable');
  }
}

export async function payAddress(env: Env, auth: AuthContext, request?: Request): Promise<Response> {
  const flags = payFlags(env);
  const found = await depositAddress(env, auth, request ? new URL(request.url).searchParams.get('chain') ?? '' : '');
  const spec = found.spec;
  const created = 'isNew' in found ? found.isNew : false;
  return json({
    ok: true,
    address: found.address,
    index: 'index' in found ? found.index : undefined,
    created,
    network: flags.network, chain: spec.chain, networkLabel: spec.label,
    asset: 'USDT', contract: spec.contract,
    // Витрина печатает предупреждение про дробную часть только там, где она
    // правда отбрасывается, — поэтому знаки и подтверждения едут вместе с адресом.
    decimals: spec.decimals, confirmations: spec.confirmations,
    // Ссылка на эксплорер — не «украшение», а способ игрока проверить себя без
    // нашего слова: адрес и сеть он видит, а «записан ли перевод» — только в сети.
    explorer: { name: spec.explorerName, addressUrl: spec.addressUrl(found.address) },
  }, created ? 201 : 200);
}

/**
 * QR адреса пополнения. Рендерит сервер: клиентская библиотека QR означала бы,
 * что адрес игрока уходит на чужой CDN или что в бандле лежит ещё один
 * криптографический код, который никто не сверял. Сюда игрок попадает только со
 * своей сессией, и в картинке не может оказаться ничего, кроме его адреса.
 */
export async function payQr(env: Env, auth: AuthContext, request: Request): Promise<Response> {
  const found = await depositAddress(env, auth, new URL(request.url).searchParams.get('chain') ?? '');
  const url = new URL(request.url);
  const scale = Number.parseInt(url.searchParams.get('scale') ?? '6', 10);
  const png = await qrPng(found.address, { scale: Number.isFinite(scale) ? scale : undefined });
  return new Response(png, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // Приватное и без кэша: адрес игрока не должен остаться в общем кэше
      // прокси — и не пережить отзыв сессии.
      'Cache-Control': 'private, no-store',
      // Картинка генерируется под запрос, и любое её переиспользование — это
      // чужой попытка угадать ссылку. `nosniff` запрещает браузеру «догадаться»,
      // что в ответе не растр; CSP и DENY на всякий случай закрывают и просмотр
      // ответа как документа (вкладка «открыть картинку по ссылке»).
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Frame-Options': 'DENY',
    },
  });
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
  // Ссылка на перевод — для строк пополнения: `source_ref` депозита это
  // `dep:<txid>:<номер события>`, то есть идентификатор транзакции уже в базе, и
  // игроку не нужно ничего вставлять руками. Для остальных причин ссылки нет:
  // выдумывать её хуже, чем не показать.
  const spec = chainSpec(env, flags);
  const rows = history.map((row) => {
    const txid = row.reason === 'deposit' ? depositTxidFromRef(row.ref) : '';
    return txid ? { ...row, txUrl: spec.txUrl(txid) } : row;
  });
  return json({
    ok: true,
    asset: 'USDT',
    balanceMicro,
    balance: formatMicroUsdt(balanceMicro),
    purchasesEnabled: flags.purchases,
    history: rows,
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
    const result = await purchase(
      env.DB, { userId: auth.userId, productId, idemKey }, Date.now(),
      prizeSharePercent(env.POOL_PRIZE_SHARE),
    );
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
  // Через общий читатель: он обрывает тело на 16 КиБ до парсинга. Денежные
  // маршруты — самое место, где «а что если прислать 5 МеБ» задают не игроки.
  return readJsonSoft(request);
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
    // Планка зависит от сети: на BEP-20 она ниже, и игрок должен видеть ровно ту,
    // которая действует для выбранной им цепи.
    minAmountMicro: minWithdrawMicro(chainSpec(env, flags).chain),
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
  // Сеть заявки выбирает игрок (там, где их несколько), и она же записывается в
  // строку: платить потом надо по ней, а не по `PAY_CHAIN` момента отправки.
  // Иначе «мы включили Polygon» меняет сеть у уже созданной заявки.
  const { chains, error: chainsError } = enabledChains(env);
  if (chainsError) throw new ApiError(503, 'pay_chain_unknown');
  const requested = String(body.chain ?? '').trim();
  const chain = requested ? parsePayChain(requested) : chains[0] ?? null;
  if (!chain) throw new ApiError(400, requested ? 'bad_chain' : 'pay_chain_unknown');
  if (!chains.includes(chain)) throw new ApiError(409, 'chain_not_enabled');
  try {
    const result = await requestWithdrawal(env.DB, {
      userId: auth.userId,
      address: String(body.address ?? ''),
      amountMicro: Number(body.amountMicro ?? 0),
      idemKey,
      // Формат адреса — по цепи заявки: TRON и EVM проверяются по-разному, и
      // «примем любой» означает «зарезервируем деньги на несуществующий адрес».
      chain,
    }, Date.now());
    return json({
      ok: true,
      withdrawal: result.withdrawal,
      amount: formatMicroUsdt(result.withdrawal.amount_micro),
      chain,
      // Минимум и потолок называем вслух: игрок выбирает сеть, и «в этой сети
      // можно от 1 USDT» он должен увидеть, а не вычислять по отказу 422.
      minAmount: formatMicroUsdt(minWithdrawMicro(chain)),
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
  const flags = payFlags(env);
  const spec = chainSpec(env, flags);
  const [report, queue, poolBlock, cursor, addrSplit] = await Promise.all([
    reconcile(env.DB, now), withdrawalQueue(env.DB, 50), usdtPoolBlock(env.DB, now),
    // Где стоит сканер: по курсору видно, что приём встал (нода молчит, сеть
    // выросла, а мы всё ещё на старом блоке).
    readCursor(env.DB, spec.chain, spec.contract).catch(() => 0),
    // Сколько активных адресов относится к активной цепи: при переезде это
    // единственное число, по которому видно, что игрокам надо выдать новые.
    // Считается по колонке `chain`, а не по маске адреса: «T%»/«0x%» — эвристика
    // формата, `chain` — утверждение, сделанное при выдаче.
    env.DB.prepare(
      // Разбивка по всем трём цепям: с двумя EVM-сетями «остальное = tron»
      // перестало быть истиной, и polygon-адреса исчезли бы из отчёта.
      `SELECT SUM(CASE WHEN chain = 'bsc' THEN 1 ELSE 0 END) AS bsc,
              SUM(CASE WHEN chain = 'polygon' THEN 1 ELSE 0 END) AS polygon,
              SUM(CASE WHEN chain = 'tron' THEN 1 ELSE 0 END) AS tron
         FROM pay_addresses WHERE active = 1`,
    ).first<{ bsc: number | null; polygon: number | null; tron: number | null }>(),
  ]);
  return json({
    ok: true,
    flags: publicFlags(flags),
    chain: {
      name: spec.chain, label: spec.label, network: spec.network,
      decimals: spec.decimals, contract: spec.contract, confirmations: spec.confirmations,
      cursor, ready: spec.ready,
      addresses: {
        active: Number(addrSplit?.[spec.chain] ?? 0),
        // «Другая цепь» — сумма по остальным: их может быть две (старый TRON плюс
        // вторая EVM), и админ обязан увидеть, что адреса живы, а не «потеряны».
        otherChain: Number(addrSplit?.tron ?? 0) + Number(addrSplit?.bsc ?? 0)
          + Number(addrSplit?.polygon ?? 0) - Number(addrSplit?.[spec.chain] ?? 0),
      },
    },
    reconcile: report,
    queue,
    // Призовой фонд сезона: доля выручки магазина (POOL_PRIZE_SHARE), не взносы.
    pool: poolBlock,
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
  // Движение денег: не для помощника. Младший доступ видит очередь и сверку,
  // но одобрять, отправлять и снимать стоп может только владелец.
  requireOwner(await requireAdmin(request, env));
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
  // Движение денег: не для помощника. Младший доступ видит очередь и сверку,
  // но одобрять, отправлять и снимать стоп может только владелец.
  requireOwner(await requireAdmin(request, env));
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
  // Движение денег: не для помощника. Младший доступ видит очередь и сверку,
  // но одобрять, отправлять и снимать стоп может только владелец.
  requireOwner(await requireAdmin(request, env));
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');

  const body = await readJsonObject(request);
  const id = String(body.id ?? '');
  if (!id) throw new ApiError(400, 'bad_id');

  const row = await env.DB.prepare(
    'SELECT id, user_id, address, chain, amount_micro, status, txid FROM pay_withdrawals WHERE id = ?',
  ).bind(id).first<{
    id: string; user_id: string; address: string; chain: string | null;
    amount_micro: number; status: string; txid: string | null;
  }>();
  if (!row) throw new ApiError(404, 'not_found');
  if (row.status !== 'reserved') throw new ApiError(409, 'not_reserved');

  const flags = payFlags(env);
  // Сеть берём из строки заявки, а не из `PAY_CHAIN`: активная цепь может
  // смениться между «игрок подал заявку» и «админ нажал отправить», а деньги
  // обязаны уйти туда, куда их просили. Для старых строк без колонки — активная.
  const sendChain = parsePayChain(row.chain ?? '') ?? flags.chain;
  const { chains: sendChains } = enabledChains(env);
  if (!sendChains.includes(sendChain)) throw new ApiError(503, 'chain_not_enabled');
  const sendSpec = chainSpecFor(env, sendChain, flags);
  const owner = String(env.PAY_HOT_ADDRESS ?? '');
  // Сначала то, что чинится одной строчкой в секретах, потом «рельс не готов»:
  // среди причин 503 самая полезная та, по которой оператор может что-то сделать.
  if (!owner) throw new ApiError(503, 'hot_wallet_missing');
  if (!env.SIGNER) throw new ApiError(503, 'signer_not_configured');
  if (!sendSpec.ready.payouts) throw new ApiError(503, sendSpec.ready.reason || 'payouts_unavailable');
  // В EVM адрес получателя обязан пройти формат активной цепи: заявка
  // могла быть создана, когда сеть была другая.
  if (sendSpec.chain !== 'tron' && !sendSpec.isAddress(String(row.address ?? '').trim())) {
    throw new ApiError(409, 'address_chain_mismatch');
  }

  const attemptRow = await env.DB.prepare('SELECT COUNT(*) AS c FROM pay_payouts WHERE withdrawal_id = ?')
    .bind(id).first<number>('c');
  const attempt = Number(attemptRow ?? 0) + 1;

  if (sendSpec.chain !== 'tron') {
    return await sendEvmPayout(env, sendSpec, row.id, row.address, Number(row.amount_micro), attempt);
  }

  // Платить нечем — говорим сразу и оставляем заявку в `reserved`.
  // Раньше такой перевод уходил в сеть и падал там, а игрок видел «отправляется».
  const wallet = await hotWalletState(
    sweepChainDeps(trongridFetcher(env.TRONGRID_API_KEY), flags.network, env),
    owner,
    Number(row.amount_micro),
  );
  if (wallet.blocker) {
    // 409, а не 502: ничего не сломалось, просто нечем платить. Заявка остаётся
    // `reserved`, деньги с баланса игрока уже списаны и не потеряны.
    return json({
      ok: false,
      error: wallet.blocker,
      withdrawal: { id: row.id, status: row.status, amount: formatMicroUsdt(Number(row.amount_micro)) },
      wallet: {
        address: wallet.address,
        usdt: wallet.usdt,
        shortfall: wallet.shortfall,
        trxSun: wallet.trxSun,
        needTrxSun: SWEEP_FEE_SUN,
      },
    }, 409);
  }

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


/**
 * Выплата в BNB Chain: газ, кошелёк, замок на nonce, подпись, отправка.
 *
 * Порядок такой специально: сначала «нечем платить» (409, заявка остаётся
 * `reserved`), и только потом занимаем nonce и что-либо подписываем. Разрыв
 * между «подписали» и «отправили» — единственное место, где деньги могут
 * застрять, и он должен быть как можно короче.
 */
async function sendEvmPayout(
  env: Env, spec: ChainSpec, id: string, address: string, amountMicro: number, attempt: number,
): Promise<Response> {
  const flags = payFlags(env);
  const owner = String(env.PAY_HOT_ADDRESS ?? '').trim();
  const recipient = spec.normalizeAddress(String(address ?? ''));
  if (!spec.isAddress(recipient)) throw new ApiError(422, 'bad_destination_chain');

  // Ноду берём СПЕКУ заявки, а не активную цепь: `PAY_CHAIN` может измениться
  // между «игрок подал заявку на Polygon» и «админ нажал отправить», и тогда
  // через BNB-RPC мы искали бы квитанцию polygon-перевода — «заявка висит в
  // sent» при деньгах, которые уже ушли.
  const rpc = evmRpcFor(env, fetch, spec);
  // `chainId` берём из спеки активной сети (BNB 56/97, Polygon 137/80002):
  // харкод «BSC_MAINNET» здесь означал бы подпись для 56, отправленную в Polygon.
  const chainId = spec.chainId ?? evmChainId(spec.chain === 'polygon' ? 'polygon' : 'bnb', isTestnetNetwork(flags.network));

  let gas: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  try {
    gas = await payoutGas(rpc, owner, gasPriceCap(env));
  } catch (e) {
    if (e instanceof EvmBroadcastError) throw new ApiError(502, e.code);
    throw e;
  }

  // «Нечем платить» говорим сразу и ничего не подписываем.
  const wallet = await evmHotWalletState(rpc, spec.contract, owner, amountMicro, gasCostWei(gas.maxFeePerGas), spec.chain);
  if (wallet.blocker) {
    return json({
      ok: false,
      error: wallet.blocker,
      withdrawal: { id, status: 'reserved', amount: formatMicroUsdt(amountMicro) },
      wallet: {
        address: wallet.address, usdt: wallet.usdt, shortfall: wallet.shortfall,
        bnb: wallet.bnb, needBnb: formatBnb(gasCostWei(gas.maxFeePerGas)),
      },
    }, 409);
  }

  let reservation: { nonce: number; key: string } | null = null;
  // Отправляли ли мы что-то в сеть: после успешной отправки замок держать НЕЧЕГО,
  // он уже «израсходован» самим nonce. Освобождать его можно только до отправки.
  let broadcastStarted = false;
  try {
    reservation = await reserveNonce(env.DB, rpc, chainId, owner, Date.now());
    const sent = await sendUsdtEvm(rpc, evmSignerClient(env), {
      owner, recipient, amountMicro, contract: spec.contract, chainId, chain: spec.chain,
      nonce: reservation.nonce, maxGasPriceWei: gasPriceCap(env),
    });
    broadcastStarted = true;
    const updated = await markBroadcast(env.DB, id, { txid: sent.txid, attempt }, Date.now());
    return json({
      ok: true, txid: sent.txid, withdrawal: updated,
      explorer: spec.txUrl(sent.txid), nonce: sent.nonce, maxGasCost: sent.maxCostWei.toString(),
    });
  } catch (e) {
    // В сеть ничего не ушло — замок освобождаем, иначе этот nonce зарезервирован
    // навечно и следующая отправка уйдёт с номером через один.
    if (reservation && !broadcastStarted) await releaseNonce(env.DB, reservation.key);
    if (e instanceof EvmBroadcastError) {
      await markBroadcast(env.DB, id, { attempt, error: e.message }, Date.now()).catch(() => null);
      throw new ApiError(502, e.code);
    }
    if (e instanceof PayoutError) throw new ApiError(409, e.code);
    throw e;
  }
}

/**
 * Баланс кошелька для отчёта о фонде. Поля названы как у TRON (`trxSun`), чтобы
 * не переписывать вывод: в EVM это wei, и ниже по коду оно не используется.
 */
async function evmPrizeBalances(env: Env, owner: string): Promise<{ usdtMicro: number; trxSun: number }> {
  const spec = chainSpec(env, payFlags(env));
  const balances = await evmAccountBalances(evmRpcFor(env), spec.contract, owner, spec.chain);
  return { usdtMicro: balances.usdtMicro, trxSun: Number(balances.gasWei / 10n ** 10n) };
}

/** Потолок ставки газа: заградитель против «нода посоветовала 500 gwei». */
function gasPriceCap(env: Env): bigint {
  const raw = String(env.PAY_MAX_GAS_PRICE_WEI ?? '').trim();
  if (!/^\d{1,24}$/.test(raw)) return DEFAULT_MAX_GAS_PRICE_WEI;
  const cap = BigInt(raw);
  return cap > 0n ? cap : DEFAULT_MAX_GAS_PRICE_WEI;
}

// --- План сбора (sweep): только чтение ---------------------------------------

/**
 * Что можно собрать в кошелёк владельца и сколько для этого нужно TRX.
 * Ничего не подписывает и не отправляет: сначала цифры, потом решение.
 */
export async function adminPaySweepPlan(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const flags = payFlags(env);
  const spec = chainSpec(env, flags);
  const destination = String(env.PAY_HOT_ADDRESS ?? '').trim();

  if (spec.chain !== 'tron') {
    const plan = await evmSweepPlan({
      db: env.DB,
      rpc: evmRpcFor(env),
      contract: spec.contract,
      network: flags.network,
      chain: spec.chain,
      destination,
      sweepEnabled: flags.sweep,
      // Оценка «хватит ли BNB» на худшем случае. Ставку берём минимально
      // правдоподобную (1 gwei): план показывает структуру, а не цену момента —
      // цена нужна в `/sign`, где она читается из сети прямо перед подписью.
      maxFeePerGas: 1_000_000_000n,
    });
    return json({
      ok: true,
      flags: { sweep: flags.sweep, payouts: flags.payouts, network: flags.network, chain: spec.chain },
      plan: { ...plan, totals: { ...plan.totals, gasWei: plan.totals.gasWei.toString(), gasNeededWei: plan.totals.gasNeededWei.toString(), feePerSweepWei: plan.totals.feePerSweepWei.toString() }, rows: plan.rows.map((row) => ({ ...row, gasWei: row.gasWei.toString() })), display: formatSweepTotals(plan) },
    }, 200, { 'Cache-Control': 'no-store' });
  }

  const plan = await sweepPlan({
    db: env.DB,
    deps: sweepChainDeps(trongridFetcher(env.TRONGRID_API_KEY), flags.network, env),
    network: flags.network,
    destination,
    sweepEnabled: flags.sweep,
  });

  return json({
    ok: true,
    flags: { sweep: flags.sweep, payouts: flags.payouts, network: flags.network, chain: spec.chain },
    plan,
  }, 200, { 'Cache-Control': 'no-store' });
}


// --- Призы из фонда сезона ----------------------------------------------------
//
// Фонд = 40 % выручки магазина. Приз списывается из фонда и зачисляется на
// баланс игрока; дальше деньги уходят обычным выводом. Здесь нет ни подписи, ни
// отправки — только «записать приз в деньги игрока».
//
// Главное ограничение зашито в SQL: `prize_budget >= сумма`. Пообещать больше,
// чем накоплено, нельзя даже двумя одновременными запросами.

/** Что в фонде, что уже выдано и чем реально можно платить (USDT на кошельке). */
export async function adminPayPrize(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const now = Date.now();
  const flags = payFlags(env);
  const owner = String(env.PAY_HOT_ADDRESS ?? '').trim();

  const [summary, awards] = await Promise.all([
    prizeSummary(env.DB, now),
    listPrizes(env.DB, 20),
  ]);

  // Баланс кошелька читаем, только если он задан: без адреса это бессмысленный
  // запрос в сеть на каждый просмотр админки.
  let wallet: { address: string; usdtMicro: number; usdt: string; trxSun: number; error: string | null } | null = null;
  if (owner) {
    try {
      const balances = chainSpec(env, flags).chain !== 'tron'
        ? await evmPrizeBalances(env, owner)
        : await accountBalances(
          sweepChainDeps(trongridFetcher(env.TRONGRID_API_KEY), flags.network, env), owner,
        );
      wallet = {
        address: owner,
        usdtMicro: balances.usdtMicro,
        usdt: formatMicroUsdt(balances.usdtMicro),
        trxSun: balances.trxSun,
        error: null,
      };
    } catch (e) {
      wallet = { address: owner, usdtMicro: 0, usdt: '0.00', trxSun: 0, error: 'chain_error' };
    }
  }

  return json({
    ok: true,
    prize: summary,
    awards,
    wallet,
    flags: { payouts: flags.payouts, network: flags.network },
    now,
  }, 200, { 'Cache-Control': 'no-store' });
}

/**
 * Начислить приз. `dryRun` (по умолчанию `true`) показывает, что произойдёт, и
 * ничего не пишет: первый вызов должен быть проверкой, а не списанием.
 */
export async function adminPayPrizeAward(request: Request, env: Env): Promise<Response> {
  // Движение денег: не для помощника. Младший доступ видит очередь и сверку,
  // но одобрять, отправлять и снимать стоп может только владелец.
  requireOwner(await requireAdmin(request, env));
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');

  const body = await readJsonObject(request);
  const userId = String(body.userId ?? '').trim();
  const rawAmount = body.amountMicro ?? body.amount ?? 0;
  let amountMicro: number;
  try {
    amountMicro = isMicroAmount(body.amountMicro) ? Number(body.amountMicro) : parseUsdtToMicro(rawAmount as string | number);
  } catch {
    throw new ApiError(400, 'bad_amount');
  }
  const note = String(body.note ?? '').slice(0, 200);
  const idemKey = String(request.headers.get('Idempotency-Key') ?? body.idemKey ?? '').trim();
  const dryRun = body.dryRun !== false;

  if (amountMicro > MAX_PRIZE_AWARD_MICRO) throw new ApiError(422, 'above_maximum');
  if (!idemKey) throw new ApiError(400, 'bad_idem_key');

  const now = Date.now();
  const summary = await prizeSummary(env.DB, now);

  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      willAward: {
        userId,
        amountMicro,
        amount: formatMicroUsdt(amountMicro),
        note,
        // Сколько останется в фонде, если приз пройдёт.
        budgetAfterMicro: summary.budgetMicro - amountMicro,
        budgetAfter: formatMicroUsdt(summary.budgetMicro - amountMicro),
        enough: summary.budgetMicro >= amountMicro,
      },
      prize: summary,
      now,
    }, 200, { 'Cache-Control': 'no-store' });
  }

  try {
    const award = await awardPrize(env.DB, { userId, amountMicro, note, idemKey }, now);
    return json({ ok: true, dryRun: false, award }, award.duplicated ? 200 : 201);
  } catch (e) {
    if (e instanceof PrizeError) {
      const status = e.code === 'insufficient_prize_fund' ? 409
        : e.code === 'above_maximum' ? 422
        : e.code === 'no_open_cycle' ? 409
        : 400;
      throw new ApiError(status, e.code);
    }
    throw e;
  }
}


// --- Баланс целиком: обязательства против блокчейна ---------------------------
//
// «Можно всё суммировать?» — деньги и так лежат в одном контуре, но важен не
// факт, а сравнение: сколько мы должны игрокам и сколько реально есть. Если
// обязательств больше, чем активов, выплаты финансируются будущими взносами,
// и это надо видеть ДО того, как первый игрок нажмёт «вывести».

export async function adminPaySolvency(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  if (!(await ensurePaySchema(env.DB))) throw new ApiError(503, 'pay_unavailable');
  const flags = payFlags(env);
  const owner = String(env.PAY_HOT_ADDRESS ?? '').trim();
  const spec = chainSpec(env, flags);
  const deps = sweepChainDeps(trongridFetcher(env.TRONGRID_API_KEY), flags.network, env);

  // В EVM активы читаются тем же планом сбора, но баланс кошелька — через
  // `eth_call`: у TronGrid и RPC разные ответы на «контракт не найден», и сводить
  // их в одну функцию значит получить «ноль» там, где на самом деле «не прочитали».
  if (spec.chain !== 'tron') {
    const rpc = evmRpcFor(env, fetch, spec);
    const plan = await evmSweepPlan({
      db: env.DB, rpc, contract: spec.contract, network: flags.network, chain: spec.chain,
      destination: owner, sweepEnabled: flags.sweep, maxFeePerGas: 1_000_000_000n,
    });
    const chainErrors = plan.rows.filter((row) => row.blocker === 'chain_error').length;
    const hot = owner ? await evmHotWalletState(rpc, spec.contract, owner, 0, 0n, spec.chain) : null;
    const sheet = await solvencySheet(env.DB, {
      // Неполный набор адресов = «мы не знаем», а не «столько и есть»: иначе
      // отчёт показал бы «покрыто» по половине баланса.
      addressesMicro: chainErrors > 0 || plan.truncated ? null : plan.totals.usdtMicro,
      hotMicro: hot && !hot.error ? hot.usdtMicro : null,
      addresses: plan.addresses,
      chainErrors,
    });
    return json({
      ok: true, sheet,
      plan: {
        chain: plan.chain, addresses: plan.addresses, truncated: plan.truncated, chainErrors,
        // BigInt в JSON не живёт: наружу отдаём десятичные строки.
        totals: {
          usdtMicro: plan.totals.usdtMicro,
          gasWei: plan.totals.gasWei.toString(),
          gasNeededWei: plan.totals.gasNeededWei.toString(),
          sweepableMicro: plan.totals.sweepableMicro,
          belowMinMicro: plan.totals.belowMinMicro,
        },
        ready: plan.ready, reason: plan.reason,
      },
    }, 200, { 'Cache-Control': 'no-store' });
  }

  const plan = await sweepPlan({
    db: env.DB,
    deps,
    network: flags.network,
    destination: owner,
    sweepEnabled: flags.sweep,
  });
  const chainErrors = plan.rows.filter((row) => row.blocker === 'chain_error').length;

  const hot = owner ? await hotWalletState(deps, owner, 0) : null;

  const sheet = await solvencySheet(env.DB, {
    // Часть адресов не прочиталась (или их больше, чем мы смотрели) — активы
    // неполные, и «покрыто» утверждать нельзя.
    addressesMicro: chainErrors > 0 || plan.truncated ? null : plan.totals.usdtMicro,
    hotMicro: hot && !hot.error ? hot.usdtMicro : null,
    addresses: plan.addresses,
    chainErrors,
  });

  return json({
    ok: true,
    sheet,
    plan: {
      addresses: plan.addresses,
      chainErrors,
      totals: plan.totals,
      ready: plan.ready,
      reason: plan.reason,
    },
  }, 200, { 'Cache-Control': 'no-store' });
}
