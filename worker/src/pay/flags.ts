// Astra Pay: переключатели денежного контура.
//
// Главное правило: по умолчанию ВСЁ ВЫКЛЮЧЕНО. Платежи, депозиты, магазин, пул
// USDT, выплаты и консолидация включаются только явным значением `"on"` в
// переменной окружения. Опечатка, пустая строка, `"true"`, `"1"` или забытая
// переменная означают «выключено»: включить деньги случайно нельзя, только
// намеренно.
//
// Флаги читаются из `[vars]` (wrangler.toml) или из секретов. Значения не
// кэшируются на изоляте: `env` приходит в каждый запрос, а цена разбора —
// несколько сравнений строк.

import type { Env } from '../env';
import { isPayChain, type PayChain } from './units';

/**
 * Среда: `nile` — тестовая, `mainnet` — боевая.
 *
 * Имена остались TRON'овские исторически (сеть TRON была первая), но
 * используются они как «тестнет/прод» для любой цепи: для BSC `nile` значит
 * `bsc-testnet`. Конкретную цепь задаёт `PAY_CHAIN`, см. `chain`.
 */
export type PayNetwork = 'nile' | 'mainnet';

export interface PayFlags {
  /** Общий тумблер: без него не работает ничего из `pay_*`. */
  payments: boolean;
  /** Приём USDT на депозитные адреса (монитор блокчейна). */
  deposits: boolean;
  /** Покупки товаров за баланс `pay_ledger`. */
  purchases: boolean;
  /** USDT-блок в отчёте пула. */
  pool: boolean;
  /** Выплаты игрокам. Даже при `on` первая версия — только с ручным подтверждением. */
  payouts: boolean;
  /** Консолидация депозитных адресов в казну. */
  sweep: boolean;
  /** Создавать таблицы `pay_*`, даже когда деньги выключены (проверка схемы). */
  schemaCheck: boolean;
  network: PayNetwork;
  /** Какую цепь использовать. См. `pay/chain.ts`. */
  chain: PayChain;
  /** `PAY_CHAIN` задан, но значение незнакомо: деньги обязаны стоять. */
  chainConfigError: boolean;
}

/** Единственное «включено» — строка `on`. Всё остальное выключено. */
function isOn(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'on';
}

export function payNetwork(env: Env): PayNetwork {
  return String(env.PAY_NETWORK ?? '').trim().toLowerCase() === 'mainnet' ? 'mainnet' : 'nile';
}

/**
 * Как трактовать `PAY_NETWORK` после появления второй цепи.
 *
 * Значения исторически называются по-tron'овски (`nile` = тестнет), но смысл у
 * них один: «тестовая среда» или «боевая». Для BSC `nile` читается как
 * `bsc-testnet` — см. `pay/chain.ts`. Переименовывать значение в `mainnet`
 * одним махом нельзя: оно лежит в секретах прод-воркера, и опечатка выключила
 * бы приём денег.
 */
export function isTestnetNetwork(network: PayNetwork): boolean {
  return network !== 'mainnet';
}

/**
 * `PAY_CHAIN`: `tron` (по умолчанию) или `bsc`.
 *
 * Незнакомое значение — это `chainConfigError`, и деньги тогда не двигаются
 * вообще: «опечатался в имени сети» не должно означать «принимали USDT не там,
 * где показывали игроку».
 */
export function readChain(value: unknown): { chain: PayChain; unknown: boolean } {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return { chain: 'tron', unknown: false };
  return isPayChain(text) ? { chain: text, unknown: false } : { chain: 'tron', unknown: true };
}

export function payFlags(env: Env): PayFlags {
  const payments = isOn(env.PAYMENTS_ENABLED);
  // Дочерние флаги не могут быть включены при выключенном общем: это защита от
  // «включил депозиты и забыл общий тумблер» в обе стороны.
  const child = (value: unknown): boolean => payments && isOn(value);
  const chain = readChain(env.PAY_CHAIN);
  return {
    payments,
    deposits: child(env.DEPOSITS_ENABLED),
    purchases: child(env.PURCHASES_ENABLED),
    pool: child(env.POOL_ENABLED),
    payouts: child(env.PAYOUTS_ENABLED),
    sweep: child(env.SWEEP_ENABLED),
    schemaCheck: isOn(env.PAY_SCHEMA_CHECK),
    network: payNetwork(env),
    chain: chain.chain,
    chainConfigError: chain.unknown,
  };
}

/**
 * Готов ли контур к выдаче кошельков. Адрес игрока выводит Signer: без его
 * биндинга и токена оплата включается, но купить нечего — деньги просто некуда
 * прислать. Флаг публичный: клиент честно говорит «кошелёк ещё не выдан».
 */
export function signerReady(env: Env): boolean {
  return Boolean(env.SIGNER) && String(env.SIGNER_TOKEN ?? '').trim().length > 0;
}

/** Готовность денежного контура словами — для клиента и статуса. */
export function walletState(
  env: Env, flags: PayFlags,
): 'off' | 'signer_required' | 'ready' | 'chain_misconfigured' {
  if (!flags.payments) return 'off';
  // Сеть «не та» опаснее, чем «не выбран»: адрес игроку всё равно покажем,
  // а деньги придём смотреть в другой блокчейн.
  if (flags.chainConfigError) return 'chain_misconfigured';
  return signerReady(env) ? 'ready' : 'signer_required';
}

/**
 * Публичное представление флагов для `/pay/status.json`. Ничего секретного:
 * адреса, ключи и суммы сюда не попадают.
 */
export function publicFlags(flags: PayFlags): Record<string, boolean> {
  return {
    payments: flags.payments,
    deposits: flags.deposits,
    purchases: flags.purchases,
    pool: flags.pool,
    payouts: flags.payouts,
    sweep: flags.sweep,
  };
}
