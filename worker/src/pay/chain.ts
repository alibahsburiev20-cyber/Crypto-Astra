// Единственное место, где платёжный слой отвечает на вопрос «какая сеть».
//
// Пока сеть была одна, ответ был размазан по файлам: контракт — в
// `tron/contracts.ts`, адрес API — в `monitor.ts`, сборка транзакции — в
// `broadcast.ts`, шкала — в `tron/amount.ts`. С появлением BNB Chain такой
// распад опасен: достаточно пропустить одно место, и игрок увидит адрес из
// одной сети, а монитор будет смотреть другую. Деньги в таком случае не
// «терняются с ошибкой» — они просто никогда не находятся.
//
// Поэтому дальше любой код, которому нужно знать про сеть, спрашивает её здесь.
// `PAY_CHAIN` — единственный переключатель: `tron` (значение по умолчанию) или
// `bsc`.

import type { Env } from '../env';
import { isTestnetNetwork, readChain, type PayFlags } from './flags';
import {
  evmActiveKeys, evmActiveKeysError, evmChainId, evmConfirmations, evmMeta, evmNetwork, evmRpcUrl, evmUsdtContract,
  type EvmNetworkKey,
} from './evm/config';
import { isEvmAddress, toChecksumAddress } from './evm/address';
import {
  TRON_API_MAINNET, TRON_API_NILE, USDT_MAINNET, USDT_NILE, usdtContract as tronUsdtContract,
} from './tron/contracts';
import { isValidAddress as isTronAddress, normalizeAddress as normalizeTronAddress, addressToHex } from './tron/address';
import { payNetwork as payNetworkName } from './flags';
import { MICRO, usdtDecimals, type PayChain } from './units';

/** Признак того, что рельс этой цепи готов принимать деньги в этой сборке. */
export interface RailReadiness {
  /** Выдача адресов игроку: без этого покупать нечего. */
  addresses: boolean;
  /** Мониторинг депозитов: без этого пришедшие деньги не находятся. */
  deposits: boolean;
  /** Отправка выплат и сбора. */
  payouts: boolean;
  /** Причина словами, если чего-то нет. */
  reason: string;
}

export interface ChainSpec {
  chain: PayChain;
  /** Среда: тестнет или прод. Для TRON это `nile`/`mainnet`, для BSC — testnet/mainnet. */
  network: PayNetworkLike;
  /** Знаки USDT в этой сети: 6 в TRON, 18 в BNB Chain. */
  decimals: number;
  /** Контракт USDT. Пустая строка — принимать нечего, рельс выключен. */
  contract: string;
  /** База API (TronGrid) или JSON-RPC эндпоинт. */
  apiBase: string;
  /** Ждём столько подтверждений, прежде чем считать деньги пришедшими. */
  confirmations: number;
  /** Как называть сеть игроку: он выбирает её в кошельке и должен выбрать верно. */
  label: string;
  /**
   * Число сети для подписи (`eth_chainId`). Только у EVM-цепей; TRON его не
   * использует. Нужен, чтобы Signer и нода называли одну и ту же сеть: сверка
   * `chainId` — единственная защита от «подписали для 137, отправили в 56».
   */
  chainId?: number;
  /** Формат адреса зависит от сети, и это единственный способ проверить ввод. */
  isAddress(value: string): boolean;
  /** Канонический вид адреса (TRON — base58, BSC — `0x…` в нижнем регистре). */
  normalizeAddress(value: string): string;
  /** Значение для колонки `pay_addresses.hex`. */
  addressHex(value: string): string;
  /** Ссылка на транзакцию в эксплорере — её игрок видит в квитанции. */
  txUrl(txid: string): string;
  /** Страница адреса: по ней игрок проверяет, что перевод увиден сетью. */
  addressUrl(address: string): string;
  explorer: string;
  /** Как называть эксплорер в интерфейсе: игроку важна не ссылка, а «куда мне
   * смотреть, чтобы проверить себя». */
  explorerName: string;
  /** Готовность рельса в этой сборке: «сеть сконфигурирована» ≠ «код дописан». */
  ready: RailReadiness;
}

/** Среда — то же union, что и в `flags.ts`; назван отдельно, чтобы модули сети
 * не тянули весь файл флагов ради типа. */
export type PayNetworkLike = PayFlags['network'];

/** TRON: то, что работало до появления второй сети, без изменений. */
function tronSpec(env: Env, network: PayNetworkLike): ChainSpec {
  const testnet = isTestnetNetwork(network);
  return {
    chain: 'tron',
    network,
    decimals: usdtDecimals('tron'),
    contract: tronUsdtContract(env, network),
    apiBase: testnet ? TRON_API_NILE : TRON_API_MAINNET,
    // TRON: считаем деньги пришедшими после 20 блоков (~1 минута).
    confirmations: 20,
    label: testnet ? 'TRON Nile (тестнет)' : 'TRON (TRC-20)',
    isAddress: isTronAddress,
    normalizeAddress: normalizeTronAddress,
    addressHex: addressToHex,
    txUrl: (txid) => `${testnet ? 'https://nile.tronscan.org' : 'https://tronscan.org'}/#/transaction/${txid}`,
    addressUrl: (address) => `${testnet ? 'https://nile.tronscan.org' : 'https://tronscan.org'}/#/address/${address}`,
    explorer: testnet ? 'https://nile.tronscan.org' : 'https://tronscan.org',
    explorerName: testnet ? 'Tronscan (Nile)' : 'Tronscan',
    ready: { addresses: true, deposits: true, payouts: true, reason: '' },
  };
}

/**
 * Одна EVM-сеть: BNB (`bsc`) или Polygon. Тело общее, отличаются только числа
 * из `pay/evm/config.ts` — и это принципиально: вторая сеть обязана пройти через
 * тот же сканер, тот же замок `nonce` и ту же сверку квитанции, а не через
 * «похожий кусок кода, дописанный рядом».
 *
 * Контракт, RPC и подтверждения читаются ПО СЕТИ (`PAY_EVM_CONTRACT_BNB`,
 * `PAY_EVM_RPC_POL`, …), с откатом на легаси-переменные: одна общая
 * `PAY_EVM_CONTRACT` на две сети означала бы «контракт от Polygon в слоте BNB»,
 * а это не ошибка отчёта, а потерянные деньги.
 */
function evmSpec(env: Env, network: PayNetworkLike, key: EvmNetworkKey): ChainSpec {
  const testnet = isTestnetNetwork(network);
  const meta = evmMeta(key);
  const config = evmNetwork(key, testnet);
  const chainId = evmChainId(key, testnet);
  const contract = evmUsdtContract(key, testnet, env as unknown as Record<string, string | undefined>);
  const addressOk = isEvmAddress(contract);
  return {
    chain: meta.chain,
    network,
    decimals: usdtDecimals(meta.chain),
    // Пустой контракт = приём выключен: в тестнете каждый крутит свой токен.
    //
    // Канон для EVM — нижний регистр с `0x`. Не «красивый» EIP-55, а именно
    // нижний: событие из ноды приходит в нижнем регистре, и ровно та же строка
    // лежит в `pay_addresses.address`. Сверка идёт сравнением строк, поэтому
    // «красивый» чексум в базе означал бы «депозит не найден, деньги сироты».
    // Чексум включаем только там, где адрес видит человек (витрина, QR).
    contract: addressOk ? contract.toLowerCase() : '',
    apiBase: evmRpcUrl(key, testnet, env as unknown as Record<string, string | undefined>),
    confirmations: evmConfirmations(key, testnet, env as unknown as Record<string, string | undefined>),
    label: testnet ? meta.labelTestnet : meta.label,
    chainId,
    isAddress: isEvmAddress,
    normalizeAddress: (value: string) => `0x${toChecksumAddress(value).slice(2).toLowerCase()}`,
    // В EVM «hex» — это адрес без `0x`: тот же смысл, что и у TRON-колонок.
    addressHex: (value: string) => toChecksumAddress(value).slice(2).toLowerCase(),
    txUrl: (txid) => `${config.explorer}/tx/${txid}`,
    addressUrl: (address) => `${config.explorer}/address/${address}`,
    explorer: config.explorer,
    explorerName: testnet ? meta.explorerNameTestnet : meta.explorerName,
    ready: evmReadiness(key, addressOk, chainId),
  };
}

/** BNB Chain (BEP-20). USDT здесь — Binance-Peg BSC-USD, 18 знаков. */
function bscSpec(env: Env, network: PayNetworkLike): ChainSpec {
  return evmSpec(env, network, 'bnb');
}

/** Polygon PoS. USDT здесь — USDT0, 6 знаков (как в TRON, не как в BNB). */
function polygonSpec(env: Env, network: PayNetworkLike): ChainSpec {
  return evmSpec(env, network, 'polygon');
}

/**
 * Что уже дописано в EVM-рельсе.
 *
 * Держим это здесь, а не в переменной окружения, специально: «включить сеть» не
 * должно означать «пообещать игроку то, чего код ещё не умеет». Каждый пункт
 * переключается на `true` в том же коммите, где появляется код, а не позже.
 */
function evmReadiness(key: EvmNetworkKey, contractConfigured: boolean, chainId: number): RailReadiness {
  void chainId;
  const wired = {
    // Выдача адресов `0x…` из семени Signer (`pay/evm/derivation.ts`, `/address`
    // с `chain: "bsc"` или `"polygon"`), индекс — тот же, что у адреса другой сети.
    addresses: true,
    // `eth_getLogs` по `Transfer` + подтверждения + курсор по блокам
    // (`pay/evm/deposits.ts`) — один и тот же код на обе EVM-сети.
    deposits: true,
    // EIP-1559-транзакция, подпись в Signer, `eth_sendRawTransaction`, сверка
    // квитанции в cron (`pay/evm/broadcast.ts`, `pay/evm/payouts.ts`).
    payouts: true,
  };
  // Сеть выбрана, а USDT не указан — принимать и платить нечем: контракт в EVM
  // это часть адреса денег, угадать его нельзя. Причина называется внутренней
  // цепью (`bsc_contract_missing`), а не именем конфигурации: её читают
  // `/pay/status.json`, алерты и прошлые отчёты.
  if (!contractConfigured) {
    return { addresses: true, deposits: false, payouts: false, reason: `${chainOfKey(key)}_contract_missing` };
  }
  // Совпадение `chainId` и контракта проверяет Signer (у него свой allowlist) —
  // здесь мы не имеем права запрещать выплаты по переменной, которой у Worker
  // может и не быть: это ровно тот случай, когда «проверка конфигурации» сама
  // становилась бы причиной простоя.
  void chainId;
  return { ...wired, reason: '' };
}

/** Конфигурация активной цепи. Всё остальное обязано брать её отсюда. */
export function chainSpec(env: Env, flags: Partial<Pick<PayFlags, 'network' | 'chain'>> = {}): ChainSpec {
  const network = flags.network ?? payNetworkName(env);
  const chain = flags.chain ?? readChain(env.PAY_CHAIN).chain;
  if (chain === 'polygon') return polygonSpec(env, network);
  return chain === 'bsc' ? bscSpec(env, network) : tronSpec(env, network);
}

/**
 * Все активные EVM-сети разом. Нужно там, где деньги принимаются: адрес игрока
 * выводится из одного семени по одному индексу, поэтому «две сети» — это две
 * строки в `pay_addresses` и два скана за проход, а не две копии воркера.
 */
export function evmChainSpecs(env: Env, flags: Partial<Pick<PayFlags, 'network' | 'chain'>> = {}): ChainSpec[] {
  const network = flags.network ?? payNetworkName(env);
  const envRec = env as unknown as Record<string, string | undefined>;
  // Сначала опечатки: `bnb,polygn` даёт «одна сеть из двух», и сканировать её —
  // значит делать вид, что всё в порядке, пока polygon-депозиты не всплывут.
  if (evmActiveKeysError(envRec)) return [];
  const keys = evmActiveKeys(envRec);
  // Пустой список при непустом `PAY_EVM_CHAINS` означает «в списке одни
  // опечатки». Откатываться на BNB нельзя: сети перепутаны, а сканер делает
  // вид, что всё в порядке. `chainConfigError` в `payFlags` на этом же основании
  // останавливает и выдачу адресов, так что пустой ответ — это «стоим», а не
  // «нечего смотреть».
  return keys.map((key) => evmSpec(env, network, key));
}

function chainOfKey(key: EvmNetworkKey): PayChain {
  return evmMeta(key).chain;
}

/**
 * Конфигурация конкретной цепи — для всего, что выбирается на строку, а не на
 * воркер: у заявки на выплату сеть своя, и «возьмём активную» отправляет деньги
 * в другую цепь (адрес-то совпадает).
 */
export function chainSpecFor(
  env: Env, chain: PayChain, flags: Partial<Pick<PayFlags, 'network' | 'chain'>> = {},
): ChainSpec {
  return chainSpec(env, { network: flags.network, chain });
}

/**
 * Сети, в которых деньги вообще возможны в этой сборке: активная цепь плюс все
 * включённые EVM-сети.
 *
 * `error` — причина, по которой список пуст. Возвращаем его, а не бросаем:
 * `/pay/status.json` обязан отвечать и объяснять, а не падать на опечатке в env.
 */
export function enabledChains(env: Env): { chains: PayChain[]; error: string } {
  const envRec = env as unknown as Record<string, string | undefined>;
  const listError = evmActiveKeysError(envRec);
  if (listError) return { chains: [], error: listError };
  const active = readChain(env.PAY_CHAIN);
  if (active.unknown) return { chains: [], error: `unknown_pay_chain:${String(env.PAY_CHAIN ?? '')}` };
  const chains: PayChain[] = [active.chain];
  for (const key of evmActiveKeys(envRec)) {
    const chain = evmMeta(key).chain;
    if (!chains.includes(chain)) chains.push(chain);
  }
  return { chains, error: '' };
}

/** Активная цепь по окружению. `unknown` — если `PAY_CHAIN` содержит мусор. */
export function activeChain(env: Env): { chain: PayChain; unknown: boolean } {
  return readChain(env.PAY_CHAIN);
}

/**
 * Сколько USDT игрок должен прислать, чтобы это вообще имело смысл.
 *
 * Мельче 1 micro (то есть 1e-6 USDT) зачислить нельзя, а на 18-значной сети
 * в хвосте перевода теряется ещё и пыль: `1.0000000000005` USDT зачислится как
 * ровно `1`. Отсюда и требование «целое число» на витрине.
 */
export function minDepositMicro(): number {
  return MICRO;
}

export { USDT_MAINNET, USDT_NILE };
