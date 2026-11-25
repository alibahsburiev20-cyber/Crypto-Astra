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
import { BSC_MAINNET, BSC_TESTNET, evmUsdtContract } from './evm/config';
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
  /** Формат адреса зависит от сети, и это единственный способ проверить ввод. */
  isAddress(value: string): boolean;
  /** Канонический вид адреса (TRON — base58, BSC — `0x…` в нижнем регистре). */
  normalizeAddress(value: string): string;
  /** Значение для колонки `pay_addresses.hex`. */
  addressHex(value: string): string;
  /** Ссылка на транзакцию в эксплорере — её игрок видит в квитанции. */
  txUrl(txid: string): string;
  explorer: string;
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
    explorer: testnet ? 'https://nile.tronscan.org' : 'https://tronscan.org',
    ready: { addresses: true, deposits: true, payouts: true, reason: '' },
  };
}

/** BNB Chain (BEP-20). USDT здесь — Binance-Peg BSC-USD, 18 знаков. */
function bscSpec(env: Env, network: PayNetworkLike): ChainSpec {
  const testnet = isTestnetNetwork(network);
  const config = testnet ? BSC_TESTNET : BSC_MAINNET;
  // Отдельная переменная, а не `PAY_USDT_CONTRACT`: у TRON и EVM разные форматы
  // адреса, и одна общая переменная означала бы «включил BSC — получил base58-строку
  // в слоте контракта». Формат мы всё равно проверяем, и приём тогда выключается.
  const contract = evmUsdtContract(network, env.PAY_EVM_CONTRACT);
  const addressOk = isEvmAddress(contract);
  return {
    chain: 'bsc',
    network,
    decimals: usdtDecimals('bsc'),
    // Пустой контракт = приём выключен: в тестнете каждый крутит свой токен.
    //
    // Канон для EVM — нижний регистр с `0x`. Не «красивый» EIP-55, а именно
    // нижний: событие из ноды приходит в нижнем регистре, и ровно та же строка
    // лежит в `pay_addresses.address`. Сверка идёт сравнением строк, поэтому
    // «красивый» чексум в базе означал бы «депозит не найден, деньги сироты».
    // Чексум включаем только там, где адрес видит человек (витрина, QR).
    contract: addressOk ? contract.toLowerCase() : '',
    apiBase: String(env.PAY_EVM_RPC ?? '').trim() || config.rpc,
    confirmations: config.confirmations,
    label: testnet ? `BSC testnet (chainId ${BSC_TESTNET.chainId})` : 'BNB Smart Chain (BEP-20)',
    isAddress: isEvmAddress,
    normalizeAddress: (value: string) => `0x${toChecksumAddress(value).slice(2).toLowerCase()}`,
    // В EVM «hex» — это адрес без `0x`: тот же смысл, что и у TRON-колонок.
    addressHex: (value: string) => toChecksumAddress(value).slice(2).toLowerCase(),
    txUrl: (txid) => `${config.explorer}/tx/${txid}`,
    explorer: config.explorer,
    ready: bscReadiness(addressOk),
  };
}

/**
 * Что уже дописано в BSC-рельсе.
 *
 * Держим это здесь, а не в переменной окружения, специально: «включить сеть» не
 * должно означать «пообещать игроку то, чего код ещё не умеет». Каждый пункт
 * переключается на `true` в том же коммите, где появляется код, а не позже.
 */
function bscReadiness(contractConfigured: boolean): RailReadiness {
  const wired = {
    // Выдача адресов `0x…` из семени Signer (`pay/evm/derivation.ts`, `/address`
    // с `chain: "bsc"`), индекс — тот же, что у TRON-адреса игрока.
    addresses: true,
    // `eth_getLogs` по `Transfer` + подтверждения + курсор (`pay/evm/deposits.ts`).
    deposits: true,
    // EIP-1559-транзакция, подпись в Signer, `eth_sendRawTransaction`, сверка
    // квитанции в cron (`pay/evm/broadcast.ts`, `pay/evm/payouts.ts`).
    payouts: true,
  };
  // Сеть выбрана, а USDT не указан — принимать и платить нечем: контракт в EVM
  // это часть адреса денег, угадать его нельзя.
  if (!contractConfigured) {
    return { addresses: true, deposits: false, payouts: false, reason: 'bsc_contract_missing' };
  }
  return { ...wired, reason: '' };
}

/** Конфигурация активной цепи. Всё остальное обязано брать её отсюда. */
export function chainSpec(env: Env, flags: Partial<Pick<PayFlags, 'network' | 'chain'>> = {}): ChainSpec {
  const network = flags.network ?? payNetworkName(env);
  const chain = flags.chain ?? readChain(env.PAY_CHAIN).chain;
  return chain === 'bsc' ? bscSpec(env, network) : tronSpec(env, network);
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
