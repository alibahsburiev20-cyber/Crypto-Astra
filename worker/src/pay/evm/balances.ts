// Балансы в EVM: сколько USDT лежит на адресе и есть ли чем заплатить за газ.
//
// Здесь всё, что нужно обоим «денежным» отчётам — сбору (sweep) и платёжеспособности
// (solvency), — плюс проверка кошелька перед выплатой.
//
// Про газ. На TRON комиссия платится в TRX, и на BNB Chain — так же в своей
// монете (BNB). USDT сам себя перевести не может. Отсюда два числа, а не одно:
// `usdtMicro` — что можно отдать, `gasWei` — на что это отправить.
//
// Ошибка сети здесь не превращается в «ноль»: баланс `null` означает «мы не
// знаем», и отчёт обязан сказать именно это, а не «покрыто».

import { chainValueToMicro, type PayChain } from '../units';
import { formatMicroUsdt } from '../tron/amount';
import { toChecksumAddress } from './address';
import { PAYOUT_GAS_LIMIT } from './broadcast';
import type { EvmRpc } from './rpc';

/** Селектор `balanceOf(address)`. */
export const BALANCE_OF_SELECTOR = '70a08231';

/** 0.005 BNB — сколько нужно на адресе, чтобы оплатить один `transfer`. */
export const GAS_TOPUP_WEI = 5_000_000_000_000_000n;

/** Мелочь, ниже которой собирать бессмысленно: та же планка, что и на TRON (10 USDT). */
export const SWEEP_MIN_MICRO = 10_000_000;

export const BNB_UNITS = 10n ** 18n;

export interface EvmBalances {
  usdtMicro: number;
  gasWei: bigint;
}

/**
 * Ответ `eth_call` — это 32-байтное слово, а не строка и не число в JSON: ноды
 * отдают `0x…`, некоторые — `null`, если контракта по адресу нет. `null` у нас
 * превращается в ошибку, а не в «ноль»: пустой баланс и «мы не дочитались» —
 * разные вещи, и по-разному лечатся.
 */
export function parseBalanceWord(value: unknown): bigint {
  const text = String(value ?? '').trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{1,64}$/.test(text)) throw new Error('bad_balance_word');
  return BigInt(`0x${text}`);
}

export function pad32(hex: string): string {
  return hex.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

export function balanceOfCalldata(address: string): string {
  return `0x${BALANCE_OF_SELECTOR}${pad32(toChecksumAddress(address).slice(2))}`;
}

/** Два баланса адреса одним батчем: нода видит один запрос, мы — одну цену лимитов. */
/** Нужны ровно два метода — поэтому `Pick`, а не весь клиент: тесты подделывают их,
 * не изображая всю RPC. */
export async function evmAccountBalances(
  rpc: Pick<EvmRpc, 'call' | 'balance'>,
  contract: string,
  address: string,
  chain: PayChain = 'bsc',
): Promise<EvmBalances> {
  const [token, native] = await Promise.all([
    rpc.call(contract, balanceOfCalldata(address)),
    rpc.balance(address),
  ]);
  // Шкала берётся СЕТЬЮ, а не контрактом: `balanceOf` на 6-значном USDT0 в
  // Polygon, прочитанный как 18-значный BSC-USD, — «на кошельке 0.000000000005
  // USDT», то есть «платить нечем» там, где деньги есть.
  return { usdtMicro: chainValueToMicro(parseBalanceWord(token).toString(), chain), gasWei: native };
}

export function formatBnb(wei: bigint): string {
  const whole = wei / BNB_UNITS;
  const frac = (wei % BNB_UNITS).toString().padStart(18, '0').slice(0, 4);
  return `${whole.toString()}.${frac}`;
}

/** Худшая цена перевода в wei: лимит газа × максимальная ставка. */
export function gasCostWei(maxFeePerGas: bigint, gasLimit: bigint = PAYOUT_GAS_LIMIT): bigint {
  if (maxFeePerGas <= 0n) throw new Error('bad_gas_price');
  return gasLimit * maxFeePerGas;
}

export type EvmPayoutBlocker = 'hot_wallet_insufficient_usdt' | 'hot_wallet_no_bnb';

/** Правило «можно ли платить» — чистая функция, без сети (как `payoutBlocker` на TRON). */
export function evmPayoutBlocker(
  balances: EvmBalances,
  needMicro: number,
  costWei: bigint,
): EvmPayoutBlocker | null {
  if (Number(balances.usdtMicro) < Number(needMicro)) return 'hot_wallet_insufficient_usdt';
  if (balances.gasWei < costWei) return 'hot_wallet_no_bnb';
  return null;
}

/** Сколько USDT лежит на адресе — для сверки «что мы должны» с «что есть». */
export async function usdtBalanceMicro(
  rpc: Pick<EvmRpc, 'call'>,
  contract: string,
  address: string,
  chain: PayChain = 'bsc',
): Promise<number> {
  const word = await rpc.call(contract, balanceOfCalldata(address));
  return chainValueToMicro(parseBalanceWord(word).toString(), chain);
}

export interface EvmHotWalletState {
  address: string;
  usdtMicro: number;
  usdt: string;
  gasWei: bigint;
  bnb: string;
  blocker: EvmPayoutBlocker | null;
  shortfallMicro: number;
  shortfall: string;
  error: string | null;
}

/**
 * Кошелёк владельца перед выплатой: USDT хватает, и есть чем заплатить газ.
 *
 * Ошибка сети не блокирует отправку (решает сеть), но и вердикт «нечем платить»
 * мы не выдумываем — тогда `error` и `blocker === null`.
 */
export async function evmHotWalletState(
  rpc: Pick<EvmRpc, 'call' | 'balance'>,
  contract: string,
  address: string,
  needMicro: number,
  costWei: bigint,
  chain: PayChain = 'bsc',
): Promise<EvmHotWalletState> {
  const empty: EvmHotWalletState = {
    address, usdtMicro: 0, usdt: '0.00', gasWei: 0n, bnb: '0',
    blocker: null, shortfallMicro: Math.max(0, needMicro),
    shortfall: formatMicroUsdt(Math.max(0, needMicro)), error: 'chain_error',
  };
  if (!address) return { ...empty, error: 'hot_wallet_missing' };

  let balances: EvmBalances;
  try {
    balances = await evmAccountBalances(rpc, contract, address, chain);
  } catch {
    return empty;
  }

  const shortfallMicro = Math.max(0, needMicro - balances.usdtMicro);
  return {
    address,
    usdtMicro: balances.usdtMicro,
    usdt: formatMicroUsdt(balances.usdtMicro),
    gasWei: balances.gasWei,
    bnb: formatBnb(balances.gasWei),
    blocker: evmPayoutBlocker(balances, needMicro, costWei),
    shortfallMicro,
    shortfall: formatMicroUsdt(shortfallMicro),
    error: null,
  };
}
