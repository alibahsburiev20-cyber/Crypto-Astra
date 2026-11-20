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

/** Сеть TRON. По умолчанию тестнет: mainnet — только этап 12 и только вручную. */
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
}

/** Единственное «включено» — строка `on`. Всё остальное выключено. */
function isOn(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'on';
}

export function payNetwork(env: Env): PayNetwork {
  return String(env.PAY_NETWORK ?? '').trim().toLowerCase() === 'mainnet' ? 'mainnet' : 'nile';
}

export function payFlags(env: Env): PayFlags {
  const payments = isOn(env.PAYMENTS_ENABLED);
  // Дочерние флаги не могут быть включены при выключенном общем: это защита от
  // «включил депозиты и забыл общий тумблер» в обе стороны.
  const child = (value: unknown): boolean => payments && isOn(value);
  return {
    payments,
    deposits: child(env.DEPOSITS_ENABLED),
    purchases: child(env.PURCHASES_ENABLED),
    pool: child(env.POOL_ENABLED),
    payouts: child(env.PAYOUTS_ENABLED),
    sweep: child(env.SWEEP_ENABLED),
    schemaCheck: isOn(env.PAY_SCHEMA_CHECK),
    network: payNetwork(env),
  };
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
