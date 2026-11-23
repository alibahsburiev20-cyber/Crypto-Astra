// Сети EVM, которые нас интересуют: BNB Chain (BEP-20).
//
// Почему BNB Chain, а не Solana: ключи secp256k1 у нас уже есть (TRON их
// использует), формат адреса и подписи стандартный, а комиссия — доли цента
// против ~15 TRX. Solana дешевле, но её криптографию (ed25519) пришлось бы
// писать с нуля.
//
// USDT в BNB Chain — это не «родной» Tether, а Binance-Peg (BSC-USD). Для игрока
// разницы нет, но в отчётах и в поддержке это надо называть точно.

import type { PayNetwork } from '../flags';

export interface EvmNetworkConfig {
  chainId: number;
  /** Публичный RPC. Ключ не нужен: чтение и отправка подписанных транзакций. */
  rpc: string;
  /** Контракт USDT. Пустая строка — сеть не настроена, деньги не принимаем. */
  usdt: string;
  explorer: string;
  /** Сколько подтверждений ждём до «деньги пришли». */
  confirmations: number;
}

/** BNB Smart Chain mainnet. */
export const BSC_MAINNET: EvmNetworkConfig = {
  chainId: 56,
  rpc: 'https://bsc-dataseed.bnbchain.org',
  // BSC-USD (Binance-Peg). Другой контракт = другие деньги, поэтому адрес фиксирован.
  usdt: '0x55d398326f99059fF775485246999027B3197955',
  explorer: 'https://bscscan.com',
  confirmations: 15,
};

/**
 * Тестовая сеть BSC (chainId 97).
 *
 * Контракт USDT в тестнете не фиксируем: тестовые токены у каждого свои, и
 * «угаданный» адрес означал бы приём чужого токена за деньги. Пока контракт не
 * задан явно (`PAY_USDT_CONTRACT`), приём в тестнете выключен.
 */
export const BSC_TESTNET: EvmNetworkConfig = {
  chainId: 97,
  rpc: 'https://bsc-testnet-rpc.publicnode.com',
  usdt: '',
  explorer: 'https://testnet.bscscan.com',
  confirmations: 3,
};

export function evmConfig(network: PayNetwork): EvmNetworkConfig {
  return network === 'mainnet' ? BSC_MAINNET : BSC_TESTNET;
}

/** Контракт USDT для сети EVM: из конфигурации или стандартный. */
export function evmUsdtContract(network: PayNetwork, configured?: string): string {
  const fromEnv = String(configured ?? '').trim();
  return fromEnv || evmConfig(network).usdt;
}

/** Готов ли приём: без контракта принимать нечего. */
export function evmReady(network: PayNetwork, configured?: string): boolean {
  const contract = evmUsdtContract(network, configured);
  return /^0x[0-9a-fA-F]{40}$/.test(contract);
}
