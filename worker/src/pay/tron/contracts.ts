// Контракты USDT по сетям.
//
// mainnet — настоящий Tether; nile — его тестовая копия. Список передаётся
// монитору как allowlist: перевод любого другого токена деньгами не считается,
// даже если кто-то пришлёт «USDT» собственного выпуска.

import type { Env } from '../../env';
import type { PayNetwork } from '../flags';
import { normalizeAddress } from './address';

export const USDT_MAINNET = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
/** Тестовый USDT в сети Nile. */
export const USDT_NILE = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';

export function defaultContract(network: PayNetwork): string {
  return network === 'mainnet' ? USDT_MAINNET : USDT_NILE;
}

/** Контракт из конфигурации или стандартный для сети. */
export function usdtContract(env: Env, network: PayNetwork): string {
  const configured = String(env.PAY_USDT_CONTRACT ?? '').trim();
  return configured || defaultContract(network);
}

/** Allowlist для монитора: ровно один контракт, в каноническом виде. */
export function usdtContracts(env: Env, network: PayNetwork): string[] {
  const contract = usdtContract(env, network);
  try {
    return [normalizeAddress(contract)];
  } catch {
    // Опечатка в контракте не должна превращаться в «принимаем что угодно».
    return [];
  }
}
