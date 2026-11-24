// Деньги в Astra Pay — всегда целые микро-USDT (1 USDT = 1 000 000).
//
// Плавающая точка в деньгах — это подарок самому себе в виде расхождений на
// копейку и споров «куда делся цент». Поэтому здесь только строки и `number`,
// который обязан быть целым и не больше 2^53 (это ~9 миллиардов USDT, с запасом).
//
// Единицы, шкала и класс ошибки живут в `../units` — одном месте для всех сетей.
// Здесь остались только TRON-обёртки: в TRON у USDT 6 знаков, поэтому число из
// сети и есть micro, и пересчёт вырождается в проверку.

import { AmountError, MAX_SAFE_MICRO, MICRO, chainValueToMicro } from '../units';

export { MICRO, MAX_SAFE_MICRO, AmountError } from '../units';

/** Знаки USDT в TRON. Число из сети совпадает с micro, пересчёт не нужен. */
export const USDT_DECIMALS = 6;

/** `"1.5"` → `1500000`. Строго: без экспоненты, минуса, пробелов и лишних знаков. */
export function parseUsdtToMicro(input: string | number): number {
  const text = typeof input === 'number' ? String(input) : String(input ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(text)) throw new AmountError('bad_amount');
  const [whole, frac = ''] = text.split('.');
  const micro = BigInt(whole) * BigInt(MICRO) + BigInt(frac.padEnd(USDT_DECIMALS, '0'));
  if (micro <= 0n) throw new AmountError('amount_not_positive');
  if (micro > BigInt(MAX_SAFE_MICRO)) throw new AmountError('amount_too_big');
  return Number(micro);
}

/** `1500000` → `"1.5"`. Хвостовые нули убираются, но минимум два знака остаются: `"1.50"`. */
export function formatMicroUsdt(micro: number, minDecimals = 2): string {
  if (!Number.isInteger(micro)) throw new AmountError('not_integer');
  const negative = micro < 0;
  const abs = Math.abs(micro);
  const whole = Math.floor(abs / MICRO);
  const frac = String(abs % MICRO).padStart(USDT_DECIMALS, '0').replace(/0+$/, '');
  const padded = frac.padEnd(minDecimals, '0');
  const body = padded ? `${whole}.${padded}` : String(whole);
  return negative ? `-${body}` : body;
}

/**
 * Значение из блокчейна (строка микро-единиц) → целое. Ноль и мусор отвергаются.
 *
 * Для TRON это просто проверка: 6 знаков сети совпадают с нашей шкалой.
 * На сети с другими знаками так нельзя — там делитель другой, см. `../units`.
 */
export function microFromChainValue(value: unknown): number {
  return chainValueToMicro(value, 'tron');
}

export function isMicroAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
