// Деньги в Astra Pay — всегда целые микро-USDT (1 USDT = 1 000 000).
//
// Плавающая точка в деньгах — это подарок самому себе в виде расхождений на
// копейку и споров «куда делся цент». Поэтому здесь только строки и `number`,
// который обязан быть целым и не больше 2^53 (это ~9 миллиардов USDT, с запасом).

export const MICRO = 1_000_000;
export const USDT_DECIMALS = 6;
/** Больше этого числа микро-единиц JS не различает точно — дальше только BigInt. */
export const MAX_SAFE_MICRO = Number.MAX_SAFE_INTEGER;

export class AmountError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'AmountError';
    this.code = code;
  }
}

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

/** Значение из блокчейна (строка микро-единиц) → целое. Ноль и мусор отвергаются. */
export function microFromChainValue(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!/^\d{1,16}$/.test(text)) throw new AmountError('bad_chain_value');
  const micro = Number(text);
  if (!Number.isSafeInteger(micro) || micro <= 0) throw new AmountError('bad_chain_value');
  return micro;
}

export function isMicroAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
