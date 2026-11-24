// Шкала денег и пересчёт «число из блокчейна ↔ микрорубли… то есть micro-USDT».
//
// Внутри проекта сумма всегда в `micro`: 1 USDT = 1 000 000 micro. Журнал
// (`pay_ledger`), цены товаров, лимиты выплат и остатки — всё в этих единицах,
// и сеть на них не влияет.
//
// А вот *в блокчейне* у USDT разное число знаков:
//
//   * TRON (TRC-20)   — 6 знаков, то есть 1 USDT = 1 000 000 → совпадает с micro;
//   * Ethereum/Polygon — 6 знаков, то же самое;
//   * BNB Chain (BEP-20, Binance-Peg BSC-USD) — **18 знаков**: 1 USDT = 1e18.
//
// Именно поэтому переезд на BSC начинается отсюда, а не с «поменять константу
// сети»: на 18-значной сети TRON-парсер либо отвергает нормальную сумму
// (у него потолок 16 цифр), либо — что хуже — читает её в триллион раз меньше.
//
// Все пересчёты идут через `BigInt`. `number` здесь не годится: 1e18 больше
// `Number.MAX_SAFE_INTEGER`, и на `number` разряды терялись бы молча.

/** Внутренняя единица: 1 USDT. */
export const MICRO = 1_000_000;

/** Больше этого числа микро-единиц JS не различает точно — дальше только BigInt. */
export const MAX_SAFE_MICRO = Number.MAX_SAFE_INTEGER;

/** Сеть, по которой ходят деньги. Порядок ключей — порядок в `PAY_CHAIN`. */
export type PayChain = 'tron' | 'bsc';

/** Знаки USDT в сети. Единственный источник правды для всех пересчётов. */
export const USDT_ONCHAIN_DECIMALS: Record<PayChain, number> = {
  tron: 6,
  bsc: 18,
};

export function isPayChain(value: unknown): value is PayChain {
  return value === 'tron' || value === 'bsc';
}

export function usdtDecimals(chain: PayChain): number {
  const decimals = USDT_ONCHAIN_DECIMALS[chain];
  // Не «undefined, поделим на 1»: неизвестная сеть обязана остановить расчёт.
  if (!Number.isInteger(decimals)) throw new AmountError('unknown_chain');
  return decimals;
}

export class AmountError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'AmountError';
    this.code = code;
  }
}

/**
 * Во сколько раз одно on-chain-единица меньше одного micro.
 *
 * Для 6-значной сети это 1 (числа из сети и есть micro), для 18-значной — 1e12.
 */
export function scalePerMicro(chain: PayChain): bigint {
  const decimals = usdtDecimals(chain);
  if (decimals < 6) throw new AmountError('chain_decimals_too_small');
  return 10n ** BigInt(decimals - 6);
}

function digits(value: unknown): string | null {
  const text = typeof value === 'number'
    ? (Number.isInteger(value) ? String(value) : '')
    : String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  return text.replace(/^0+(?=\d)/, '');
}

/**
 * Сырое значение перевода из сети → micro. Округление всегда вниз.
 *
 * Обрезаем хвост, а не округляем к ближайшему: «округление вверх» означало бы,
 * что игрок прислал меньше, чем мы зачислили, и расхождение пришлось бы искать
 * руками в блокчейне.
 */
export function chainValueToMicro(value: unknown, chain: PayChain): number {
  const text = digits(value);
  if (!text) throw new AmountError('bad_chain_value');
  // 40 цифр — запас на «мусор от чужого контракта» и на очень крупные суммы;
  // столько BigInt выдерживает спокойно, а дальше всё равно отсечём по safe-integer.
  if (text.length > 40) throw new AmountError('chain_value_too_long');
  const scale = scalePerMicro(chain);
  const raw = BigInt(text);
  const micro = raw / scale;
  if (micro <= 0n) throw new AmountError('amount_below_precision');
  if (micro > BigInt(MAX_SAFE_MICRO)) throw new AmountError('amount_too_big');
  return Number(micro);
}

/** Остаток после пересчёта: то, что сгорело из-за разницы шкал. В деньгах — доли micro. */
export function chainValueRemainder(value: unknown, chain: PayChain): bigint {
  const text = digits(value);
  if (!text) throw new AmountError('bad_chain_value');
  return BigInt(text) % scalePerMicro(chain);
}

/**
 * Перевод ровно целое число micro (без хвоста).
 *
 * Депозиты с хвостом — главный источникsupport-вопросов на 18-значной сети:
 * игрок отправляет `1.0000000000005`, мы зачисляем `1.000000`, и он идёт искать
 * полтриллионной доли USDT. Витрина обязана просить целое число.
 */
export function isExactMicro(value: unknown, chain: PayChain): boolean {
  try {
    return chainValueRemainder(value, chain) === 0n;
  } catch {
    return false;
  }
}

/** micro → сырое число сети. Обратная операция для `transfer(address,uint256)`. */
export function microToChainValue(micro: unknown, chain: PayChain): bigint {
  const text = digits(micro);
  if (!text) throw new AmountError('not_integer');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) throw new AmountError('bad_amount');
  return BigInt(value) * scalePerMicro(chain);
}

/** Строка для отладки и для JSON-ответов: сумма сети с её знаками, без float. */
export function formatChainValue(value: unknown, chain: PayChain): string {
  const text = digits(value);
  if (!text) throw new AmountError('bad_chain_value');
  const decimals = usdtDecimals(chain);
  const padded = text.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
