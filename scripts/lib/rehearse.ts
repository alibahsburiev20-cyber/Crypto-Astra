// Решения сквозной проверки BSC-тестнета (`scripts/pay-bsc-rehearsal.ts`).
//
// Здесь нет ни сети, ни базы: только ответы на вопросы «готово ли окружение к
// прогону», «зачислилось ли ровно то, что пришло», «ту ли транзакцию мы
// подписали», «можно ли сверять квитанцию» и «сошёлся ли баланс». Вынесено в
// отдельный чистый файл, потому что решение должно проверяроваться без живой
// ноды: сам прогон требует доступа к сети, а эти правила работают в любой
// песочнице и в CI (см. `payBscRehearseRules.test.ts`).
//
// Каждый вердикт — `{ status: 'ok' | 'skip' | 'fail', reason }`. `skip`
// означает «этот шаг сейчас не проверяем, и мы знаем почему». Тихого «всё
// хорошо» вместо непроверенного шага здесь нет намеренно: ровно на этом
// расхождении «зелёный скрипт / пустой кошелёк» ловят не тесты, а неделю
// поддержки.

import { parsePayChain, usdtDecimals } from '../../worker/src/pay/units';
import {
  evmActiveKeys, evmActiveKeysError, evmChainId, evmConfirmations, evmMeta, evmNetwork, evmRpcUrl, evmUsdtContract,
} from '../../worker/src/pay/evm/config';

/** `'testnet' | 'mainnet'` — то, что понимает прогон; всё, кроме mainnet, тест. */
function testnetOf(network: string): 'testnet' | 'mainnet' {
  return String(network).trim().toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet';
}

/** Статус шага прогона. */
export type VerdictStatus = 'ok' | 'skip' | 'fail';

export interface RehearseCheck {
  step: string;
  status: VerdictStatus;
  reason: string;
  /** Провал этого шага делает дальнейший прогон бессмысленным. */
  fatal?: boolean;
}

export interface RehearseEnv {
  PAY_CHAIN?: string;
  PAY_NETWORK?: string;
  PAY_EVM_CONTRACT?: string;
  PAY_EVM_RPC?: string;
  PAY_EVM_CONFIRMATIONS?: string;
  PAY_HOT_ADDRESS?: string;
  PAYOUTS_ENABLED?: string;
  SWEEP_ENABLED?: string;
  POOL_ENABLED?: string;
  SIGNER_PRIVATE_KEY?: string;
  SIGNER_EVM_CONTRACT?: string;
  SIGNER_EVM_CHAIN_IDS?: string;
  SIGNER_MAX_TX_MICRO?: string;
  [key: string]: string | undefined;
}

/** Милли-единицы USDT (6 знаков) в «raw» сети с `decimals` знаками. */
export function microToRaw(micro: number, decimals = 18): bigint {
  const m = BigInt(Math.trunc(Number(micro) || 0));
  return m * 10n ** BigInt(decimals - 6);
}

/**
 * Шаг 1: что говорит конфигурация.
 *
 * Порядок проверок — от «деньги вообще выключены» к «включены, но не туда»:
 * незнакомая сеть и пустой контракт выключают приём сами (см. `pay/chain.ts`),
 * и прогон в такой конфигурации не проверяет ничего.
 *
 * Сети проверяются ОДНИМ кодом: `bsc` и `polygon` отличаются только числами из
 * `pay/evm/config.ts` (контракт, RPC, подтверждения, `chainId`, шкала знаков), и
 * прогон обязан читать именно их. Если бы Polygon проверялся «похожей функцией»,
 * расхождение конфигурации и проверки стало бы находкой само по себе.
 */
export interface RehearseChainConfig {
  fatal: boolean;
  checks: RehearseCheck[];
  /** Внутренняя цепь: `bsc` / `polygon`. */
  chain: 'bsc' | 'polygon';
  /** Ключ конфигурации: `bnb` / `polygon`. */
  key: 'bnb' | 'polygon';
  network: 'testnet' | 'mainnet';
  contract: string;
  /** Знаки USDT в этой сети: 18 в BNB, 6 в Polygon. */
  decimals: number;
  /** Подтверждений ждём столько же, сколько боевой код. */
  confirmations: number;
  /** Какое `chainId` обязана отдать нода. */
  expectedChainId: number;
  /** Как называть нативную монету для газа: BNB или POL. */
  gasSymbol: string;
}

export function checkChainEnv(env: RehearseEnv): RehearseChainConfig {
  const rawChain = String(env.PAY_CHAIN ?? 'tron').trim().toLowerCase();
  const network = String(env.PAY_NETWORK ?? 'mainnet').trim().toLowerCase();
  const out: RehearseCheck[] = [];
  const chain = parsePayChain(rawChain);
  const push = (step: string, status: VerdictStatus, reason: string, extra: Partial<RehearseCheck> = {}): void => {
    out.push({ step, status, reason, ...extra });
  };
  const result = (fatal: boolean, resolved?: { contract: string; confirmations: number }): RehearseChainConfig => ({
    fatal,
    checks: out,
    chain: (chain ?? 'bsc') as 'bsc' | 'polygon',
    key: (chain === 'polygon' ? 'polygon' : 'bnb') as 'bnb' | 'polygon',
    network: testnetOf(network),
    contract: String(resolved?.contract ?? env.PAY_EVM_CONTRACT ?? '').trim().toLowerCase(),
    decimals: chain ? usdtDecimals(chain) : 18,
    confirmations: Number(resolved?.confirmations ?? Number(env.PAY_EVM_CONFIRMATIONS ?? 0) ?? 0),
    expectedChainId: chain ? evmChainId(chain === 'polygon' ? 'polygon' : 'bnb', testnetOf(network) !== 'mainnet') : 56,
    gasSymbol: chain === 'polygon' ? 'POL' : 'BNB',
  });

  // TRON в этом прогоне быть не должно: рельс заморожен, и «проверили TRON» в
  // отчёте выглядело бы как «проверили USDT-рельс», чего он не подтверждает.
  if (chain !== 'bsc' && chain !== 'polygon') {
    push('сеть', 'fail', `PAY_CHAIN="${rawChain}" — прогон проверяет EVM-рельс USDT (\`bsc\` или \`polygon\`), прогонять нечего`, { fatal: true });
    return result(true);
  }
  const key: 'bnb' | 'polygon' = chain === 'polygon' ? 'polygon' : 'bnb';
  const testnet = network !== 'mainnet';
  push('сеть', 'ok', `PAY_CHAIN="${chain}" — ${evmMeta(key).label}${testnet ? ' (тестнет)' : ''}`);

  if (network !== 'testnet' && network !== 'mainnet') {
    push('среды', 'fail', `PAY_NETWORK="${network}" — неизвестное значение, деньги выключены`, { fatal: true });
    return result(true);
  }
  push('среды', 'ok', testnet
    ? `PAY_NETWORK="${network}" — сеть ${evmChainId(key, true)}, боевые настройки на неё не действуют`
    : `PAY_NETWORK="mainnet" — сеть ${evmChainId(key, false)}, прогон не отправит ни одной транзакции (см. --send)`);

  // Контракт, RPC, подтверждения и `chainId` берём из боевого резолвера, а не
  // читаем переменные руками: прогон обязан проверять ровно ту конфигурацию,
  // с которой воркер выйдет в сеть, включая приоритет `*_POL` над общей.
  const contract = evmUsdtContract(key, testnet, env);
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
    push('контракт', 'fail', contract
      ? `контракт USDT (${chain === 'polygon' ? 'PAY_EVM_CONTRACT_POL' : 'PAY_EVM_CONTRACT'})="${contract}" — не адрес`
      : `контракт USDT не задан (${chain === 'polygon' ? 'PAY_EVM_CONTRACT_POL' : 'PAY_EVM_CONTRACT'}): приём сам выключается (${chain}_contract_missing)`, { fatal: true });
    return result(true);
  }
  push('контракт', 'ok', `контракт USDT задан: ${contract}`);

  const rpc = evmRpcUrl(key, testnet, env);
  if (!rpc) {
    push('нода', 'fail', 'RPC пуст — читать сеть нечем', { fatal: true });
    return result(true);
  }
  push('нода', 'ok', `RPC=${rpc}, chainId ${evmChainId(key, testnet)}, знаков ${usdtDecimals(chain)}`);

  // Список сетей сканера: если активной цепи в нём нет, `pay/chain.ts` не отдаст
  // ни одной спеки, и «прогон зелёный» означал бы «мы ничего не смотрели».
  //
  // Проверка обязательна и когда переменной нет вовсе: `PAY_CHAIN=polygon` без
  // `PAY_EVM_CHAINS` — это «адреса выдаём в Polygon, а сканер по умолчанию
  // смотрит BNB». Молча зелёный прогон тут хуже падения: ровно так теряют
  // пополнения на второй сети.
  const listError = evmActiveKeysError(env);
  const active = evmActiveKeys(env);
  if (listError) {
    push('список сетей', 'fail', `PAY_EVM_CHAINS="${env.PAY_EVM_CHAINS}" — ${listError}: деньги стоят`, { fatal: true });
  } else if (!active.includes(key)) {
    push('список сетей', 'fail', `${String(env.PAY_EVM_CHAINS ?? '').trim() ? `PAY_EVM_CHAINS="${env.PAY_EVM_CHAINS}"` : 'PAY_EVM_CHAINS не задан (по умолчанию только bnb)'} — сети ${key} нет: адреса выдаём, а сканер их не смотрит. Задайте PAY_EVM_CHAINS=${active.concat(key).join(',')}`, { fatal: true });
  } else {
    push('список сетей', 'ok', `${String(env.PAY_EVM_CHAINS ?? '').trim() ? `PAY_EVM_CHAINS=${active.join(',')}` : 'PAY_EVM_CHAINS не задан — по умолчанию одна сеть, bnb'}; ${key} включена`);
  }

  // Читаем СЫРОЕ значение переменной, а не только то, что вернул
  // `evmConfirmations`: боевой код округляет «0» и «-5» до единицы (деньги тогда
  // всё же ждут один блок), и прогон, сверяющий только итог, назвал бы такую
  // конфигурацию нормальной. Опечатка в лимите подтверждений — это находка.
  const rawConfirmations = String(
    env[key === 'polygon' ? 'PAY_EVM_CONFIRMATIONS_POL' : 'PAY_EVM_CONFIRMATIONS_BNB']
      ?? env.PAY_EVM_CONFIRMATIONS ?? '',
  ).trim();
  const confirmations = evmConfirmations(key, testnet, env);
  // Нижняя граница на проде зависит от сети: в Polygon реорги дороже, поэтому
  // там боевое значение 64, а «12» из конфига BNB было бы дырой.
  const minMainnet = chain === 'polygon' ? 24 : 12;
  if (rawConfirmations && (!/^(0|[1-9]\d*)$/.test(rawConfirmations) || Number(rawConfirmations) < 1)) {
    push('подтверждения', 'fail',
      `значение «${rawConfirmations}» не годится: нужно целое не меньше 1 (боевой код округлит его до ${confirmations}, и деньги будут ждать один блок — это не то, что вы просили)`,
      { fatal: true });
  } else if (!Number.isInteger(confirmations) || confirmations < 1) {
    push('подтверждения', 'fail', `подтверждений ${confirmations} — нужно целое число не меньше 1`, { fatal: true });
  } else if (!testnet && confirmations < minMainnet) {
    push('подтверждения', 'fail', `${confirmations} подтверждений на проде мало для ${evmMeta(key).label}: нужно не меньше ${minMainnet} (боевое значение по умолчанию ${evmNetwork(key, false).confirmations})`, { fatal: true });
  } else {
    push('подтверждения', 'ok', `${confirmations} подтверждений`);
  }

  const hot = String(env.PAY_HOT_ADDRESS ?? '').trim();
  if (!hot) {
    push('кошелёк', 'fail', 'PAY_HOT_ADDRESS пуст — смотреть баланс и слать выплаты некуда', { fatal: true });
  } else if (hot.startsWith('T')) {
    push('кошелёк', 'fail', 'PAY_HOT_ADDRESS в форме TRON (T…) — в BSC это чужой адрес, USDT уйдут в никуда', { fatal: true });
  } else if (!/^0x[0-9a-fA-F]{40}$/.test(hot)) {
    push('кошелёк', 'fail', `PAY_HOT_ADDRESS="${hot}" — не 0x-адрес`, { fatal: true });
  } else {
    push('кошелёк', 'ok', `PAY_HOT_ADDRESS=${hot}`);
  }

  // Флаги выплат и сбора на тестнете не включают: прогон проверяет код, а не
  // разрешение платить. Отдельное «skip» здесь — чтобы это выглядело решением,
  // а не забытой строкой.
  const on = ['PAYOUTS_ENABLED', 'SWEEP_ENABLED', 'POOL_ENABLED'].filter((f) => String(env[f] ?? '').trim() === 'true');
  if (network === 'testnet' && on.length) {
    push('флаги', 'skip', `включены ${on.join(', ')} — прогон их не отключает и не проверяет: решение о флагах только за владельцем`);
  } else {
    push('флаги', 'ok', 'боевые флаги выплат выключены — прогон ничего не платит сам');
  }

  return result(out.some((c) => c.status === 'fail' && c.fatal));
}

export interface DepositVerdictInput {
  expectedMicro: number;
  creditedMicro: number;
  events: number;
  rejected?: number;
  error?: string | null;
  cursor?: number | null;
}

/**
 * Шаг 4: что нарыл сканер.
 *
 * `expectedMicro` — сколько игрок отправил, `creditedMicro` — сколько зачлось.
 * Сверка идёт в микро-единицах: 18-значная шкала сети и 6-значная шкала баланса
 * игрока обязаны сойтись ровно, до последней единицы.
 */
export function depositVerdict(input: DepositVerdictInput): { status: VerdictStatus; reason: string; hint?: string } {
  if (input.error) return { status: 'fail', reason: `сканер вернул ошибку: ${input.error}` };
  if (input.events === 0) {
    return {
      status: 'skip',
      reason: 'в отсканированном окне переводов на адрес игрока нет',
      hint: 'отправьте USDT тестовой сети на адрес игрока и повторите с --wait',
    };
  }
  const expected = BigInt(Math.trunc(Number(input.expectedMicro) || 0));
  const credited = BigInt(Math.trunc(Number(input.creditedMicro) || 0));
  if (credited === 0n) {
    return { status: 'fail', reason: `событий ${input.events}, а зачислено 0: владелец адреса не найден (orphan) или событию не хватает подтверждений` };
  }
  if (credited !== expected) {
    const diff = credited - expected;
    return {
      status: 'fail',
      reason: `зачислено ${credited} микро, ожидалось ${expected} (разница ${diff > 0n ? '+' : ''}${diff}) — шкала знаков или фильтр адресов врёт`,
    };
  }
  return {
    status: 'ok',
    reason: `зачислено ровно ${expected} микро (${formatUsdt(expected)} USDT) по событий: ${input.events}${input.rejected ? `, отброшено чужих: ${input.rejected}` : ''}`,
  };
}

/** Шаг 5: повторный проход не должен добавлять ни копейки. */
export function idempotencyVerdict(input: {
  secondCredited: number;
  balanceAfterSecond: number;
  balanceAfterFirst: number;
}): { status: VerdictStatus; reason: string } {
  if (input.secondCredited !== 0) {
    return { status: 'fail', reason: `второй проход зачислил ещё ${input.secondCredited} — ключ идемпотентности не работает` };
  }
  if (input.balanceAfterSecond !== input.balanceAfterFirst) {
    return { status: 'fail', reason: `баланс после второго прохода изменился: ${input.balanceAfterFirst} → ${input.balanceAfterSecond}` };
  }
  return { status: 'ok', reason: 'второй проход: зачислено 0, баланс не изменился' };
}

/** Разобрать `transfer(address,uint256)`; не наш формат — null. */
export function parseTransferData(data: string): { to: string; amountRaw: bigint } | null {
  const clean = String(data ?? '').replace(/^0x/i, '').toLowerCase();
  if (!clean.startsWith('a9059cbb') || clean.length < 8 + 128) return null;
  return {
    to: `0x${clean.slice(8 + 24, 8 + 64)}`,
    amountRaw: BigInt(`0x${clean.slice(8 + 64, 8 + 128)}`),
  };
}

export interface PayoutTxWant {
  contract: string;
  chainId: number;
  nonce: number;
  gasLimit?: bigint;
  recipient: string;
  amountMicro: number;
  decimals?: number;
  maxCostWei?: bigint;
  /** Как называть нативную монету для газа: `BNB` или `POL`. */
  gasSymbol?: string;
}

/**
 * Шаг 6: поля подписанной транзакции против того, что просили.
 *
 * Проверяем то, за что отвечают два независимых контура: сеть (chainId),
 * получатель, сумма, «value = 0 — всё в каллдейте» и потолок газа.
 */
export function payoutTxCheck(input: {
  got: { to?: string; chainId?: number; nonce?: number; gasLimit?: bigint | number; value?: bigint | number; data?: string; maxFeePerGas?: bigint | number };
  want: PayoutTxWant;
}): { status: VerdictStatus; checks: RehearseCheck[] } {
  const got = input.got;
  const want = input.want;
  const out: RehearseCheck[] = [];
  const eq = (step: string, a: unknown, b: unknown): void => {
    const same = String(a).toLowerCase() === String(b).toLowerCase() || BigInt(String(a ?? 0)) === BigInt(String(b ?? 0));
    out.push({
      step,
      status: same ? 'ok' : 'fail',
      reason: same ? `${step}: ${String(a)}` : `${step}: получили ${String(a)}, ожидали ${String(b)}`,
    });
  };
  eq('to', got.to, want.contract);
  eq('chainId', got.chainId, want.chainId);
  eq('nonce', got.nonce, want.nonce);
  eq('gasLimit', got.gasLimit, want.gasLimit ?? 80000n);
  eq('value', got.value, 0n);

  const dec = parseTransferData(String(got.data ?? ''));
  if (!dec) {
    out.push({ step: 'каллдейт', status: 'fail', reason: 'data не разбирается как transfer(address,uint256)' });
  } else {
    const toOk = dec.to.toLowerCase() === want.recipient.toLowerCase();
    out.push({
      step: 'получатель',
      status: toOk ? 'ok' : 'fail',
      reason: toOk ? `получатель в каллдейте: ${dec.to}` : `получатель в каллдейте ${dec.to}, а ждали ${want.recipient}`,
    });
    const expectedRaw = microToRaw(want.amountMicro, want.decimals ?? 18);
    out.push({
      step: 'сумма',
      status: dec.amountRaw === expectedRaw ? 'ok' : 'fail',
      reason: dec.amountRaw === expectedRaw
        ? `сумма в каллдейте: ${dec.amountRaw} raw (${formatUsdt(want.amountMicro)} USDT)`
        : `сумма в каллдейте ${dec.amountRaw}, ожидали ${expectedRaw} (${formatUsdt(want.amountMicro)} USDT) — 6/18 знаков перепутаны`,
    });
  }

  const maxCost = BigInt(got.gasLimit ?? 0) * BigInt(got.maxFeePerGas ?? 0);
  const cap = want.maxCostWei ?? 0n;
  // Газ оплачивается монетой СВОЕЙ сети: BNB в BNB Chain, POL в Polygon. Цифры
  // от этого не меняются (18 знаков там и там), а вот вывод «не хватает BNB»
  // про Polygon отправил бы оператора не туда.
  const gas = want.gasSymbol ?? 'BNB';
  out.push({
    step: 'потолок газа',
    // На тестнете потолок не выставляют: там газ бесплатный и любые числа ок.
    status: cap === 0n ? 'ok' : (maxCost <= cap ? 'ok' : 'fail'),
    reason: cap === 0n
      ? `стоимость газа ${formatEther(maxCost)} ${gas} (потолок не задан)`
      : `стоимость газа ${formatEther(maxCost)} ${gas}, потолок ${formatEther(cap)} ${gas}`,
  });
  return { status: out.some((c) => c.status === 'fail') ? 'fail' : 'ok', checks: out };
}

/**
 * Шаг 7: можно ли сверять квитанцию и что она показала.
 *
 * «Квитанции нет» и «квитанция есть, но глубина мала» — разные состояния, и оба
 * правильные: первая транзакция в мемпуле, вторая ещё не доросла до
 * `confirmations`. Ошибкой считается только реверт.
 */
export function receiptVerdict(input: {
  receipt: { status?: boolean | number; blockNumber?: number | null; logs?: unknown[] } | null;
  head: number;
  confirmations: number;
}): { status: VerdictStatus; reason: string } {
  const receipt = input.receipt;
  if (!receipt) return { status: 'skip', reason: 'квитанции ещё нет — транзакция может лежать в мемпуле, это не ошибка' };
  if (!receipt.status) {
    return { status: 'fail', reason: 'квитанция со status = 0: сеть откатила транзакцию (реверт), заявка уйдёт в failed с возвратом резерва' };
  }
  const block = Number(receipt.blockNumber ?? 0);
  const depth = Number(input.head ?? 0) - block + 1;
  if (depth < Number(input.confirmations)) {
    return { status: 'skip', reason: `глубина ${depth} из ${input.confirmations} подтверждений — сверка догонит на следующем проходе cron` };
  }
  const logs = Array.isArray(receipt.logs) ? receipt.logs.length : 0;
  return { status: 'ok', reason: `квитанция в блоке ${block}, глубина ${depth}, логов ${logs} — выплата подтвердится по этому же пути` };
}

/**
 * Шаг 8: сходимость учёта.
 *
 * Формула одна: `остаток = зачислено − потрачено`. Плюс отдельная проверка
 * цепочки хешей реестра — без неё «баланс сошёлся» может означать «в таблице
 * просто поменяли цифру».
 */
export function ledgerVerdict(input: {
  beforeMicro: number;
  depositedMicro: number;
  paidOutMicro: number;
  afterMicro: number;
  ledgerOk: boolean;
}): { status: VerdictStatus; checks: RehearseCheck[] } {
  const before = BigInt(Math.trunc(Number(input.beforeMicro) || 0));
  const deposited = BigInt(Math.trunc(Number(input.depositedMicro) || 0));
  const paid = BigInt(Math.trunc(Number(input.paidOutMicro) || 0));
  const expected = before + deposited - paid;
  const actual = BigInt(Math.trunc(Number(input.afterMicro) || 0));
  const out: RehearseCheck[] = [{
    step: 'баланс',
    status: expected === actual ? 'ok' : 'fail',
    reason: expected === actual
      ? `${formatUsdt(before)} + ${formatUsdt(deposited)} − ${formatUsdt(paid)} = ${formatUsdt(actual)} USDT`
      : `ожидали ${expected} микро, в балансе ${actual} микро`,
  }];
  out.push({
    step: 'реестр',
    status: input.ledgerOk ? 'ok' : 'fail',
    reason: input.ledgerOk ? 'цепочка хешей pay_ledger цела' : 'цепочка хешей pay_ledger не сходится: запись правили мимо реестра',
  });
  return { status: out.some((c) => c.status === 'fail') ? 'fail' : 'ok', checks: out };
}

/**
 * Проверка локального подписанта — те же границы, что выставлены в Signer.
 *
 * Прогон подписывает тестовым ключом здесь (в бою ключ живёт только в Signer),
 * поэтому его обязанность — показать, что локальный путь проходит ровно те же
 * отсечки: чужой контракт, чужая сеть, сумма больше потолка, ключа нет.
 */
export function signerGuardsCheck(input: {
  env: RehearseEnv;
  contract: string;
  chainId: number;
  amountMicro: number;
  /** Для какой EVM-сети сверяем allowlist: у Signer он свой, по сетям. */
  key?: 'bnb' | 'polygon';
}): { status: VerdictStatus; checks: RehearseCheck[] } {
  const env = input.env;
  const key = input.key ?? 'bnb';
  const out: RehearseCheck[] = [];
  const push = (step: string, status: VerdictStatus, reason: string, extra: Partial<RehearseCheck> = {}): void => {
    out.push({ step, status, reason, ...extra });
  };

  if (!String(env.SIGNER_PRIVATE_KEY ?? '').trim()) {
    push('ключ', 'skip', 'SIGNER_PRIVATE_KEY нет — подпись поднимается локальным тестовым ключом, боковой контур не задействован');
  } else {
    push('ключ', 'ok', 'ключ подписи есть (в прогоне используется только локально, в сеть не передаётся)');
  }

  // Имена переменных Signer — те же, что у него в коде: `SIGNER_EVM_CONTRACT`
  // исторически описывает BNB, Polygon настраивается только `..._POL`. Сверять
  // polygon-выплату с общим контрактом — значит «allowlist совпал», хотя Signer
  // отказал бы на `contract_mismatch`.
  const varName = key === 'polygon' ? 'SIGNER_EVM_CONTRACT_POL' : 'SIGNER_EVM_CONTRACT';
  const allowContract = String(
    env[varName] ?? (key === 'polygon' ? '' : env.SIGNER_EVM_CONTRACT ?? ''),
  ).trim().toLowerCase();
  if (allowContract && allowContract !== String(input.contract).toLowerCase()) {
    push('allowlist контракта', 'fail', `${varName}=${allowContract}, а прогон шлёт на ${input.contract} — Signer бы отказал (contract_mismatch)`);
  } else if (!allowContract) {
    // Прогон подписывает локально, поэтому это НЕ провал: проверить нечего.
    // Но и «ok» врало бы: в бою пустой allowlist = `contract_misconfigured`,
    // то есть ни одна выплата не уйдёт. Поэтому skip с внятной причиной.
    push('allowlist контракта', 'skip',
      `${varName} не задан: в бою Signer не подпишет ни одну выплату этой сети (contract_misconfigured), в прогоне подпись локальная`);
  } else {
    push('allowlist контракта', 'ok', `${varName} совпадает с контрактом прогона`);
  }

  const allowChains = String(env.SIGNER_EVM_CHAIN_IDS ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean);
  if (allowChains.length && !allowChains.includes(Number(input.chainId))) {
    push('allowlist сети', 'fail', `SIGNER_EVM_CHAIN_IDS=${allowChains.join(',')} — сети ${input.chainId} нет, подпись не выдаётся`);
  } else {
    push('allowlist сети', 'ok', allowChains.length ? `сеть ${input.chainId} в allowlist` : 'SIGNER_EVM_CHAIN_IDS не задан');
  }

  const cap = Number(env.SIGNER_MAX_TX_MICRO ?? 0);
  if (cap > 0 && Number(input.amountMicro) > cap) {
    push('потолок суммы', 'fail', `сумма ${input.amountMicro} микро больше SIGNER_MAX_TX_MICRO=${cap} — подпись не выдаётся`);
  } else {
    push('потолок суммы', 'ok', cap > 0 ? `сумма ${input.amountMicro} микро в потолке ${cap}` : 'потолок не задан');
  }
  return { status: out.some((c) => c.status === 'fail') ? 'fail' : 'ok', checks: out };
}

/** Итог прогона: «всё хорошо» только если непроверенных шагов не осталось. */
export function summarize(steps: { step?: string; status: VerdictStatus }[]): {
  ok: number;
  skipped: number;
  failed: number;
  passed: boolean;
  exitCode: number;
  headline: string;
} {
  const ok = steps.filter((s) => s.status === 'ok').length;
  const skip = steps.filter((s) => s.status === 'skip');
  const fail = steps.filter((s) => s.status === 'fail');
  const passed = fail.length === 0;
  return {
    ok,
    skipped: skip.length,
    failed: fail.length,
    passed,
    // 2 — «сошлось, но не всё»: отдельный код, чтобы cron/CI не путал
    // неполную проверку с полной.
    exitCode: passed ? (skip.length ? 2 : 0) : 1,
    headline: fail.length
      ? `ПРОВАЛ: ${fail.length} шаг(ов) не сошлись — ${fail.map((s) => s.step).join(', ')}`
      : skip.length
        ? `Пройдено ${ok} шагов, ${skip.length} помечены «не тронули»: ${skip.map((s) => s.step).join(', ')}`
        : `Пройдено ${ok} шагов, непроверенных не осталось`,
  };
}

/** Микро-USDT в человекочитаемое число. */
export function formatUsdt(micro: number | bigint): string {
  const v = BigInt(Math.trunc(Number(micro) || 0));
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${abs / 1_000_000n}.${frac || '0'}`;
}

/** Wei в BNB с 6 знаками — для строк про газ. */
export function formatEther(wei: number | bigint): string {
  const w = BigInt(wei ?? 0);
  return `${w / 10n ** 18n}.${(w % 10n ** 18n).toString().padStart(18, '0').slice(0, 6)}`;
}
