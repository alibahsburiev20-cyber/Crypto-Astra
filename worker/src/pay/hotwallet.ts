// Состояние горячего кошелька: чем реально можно платить прямо сейчас.
//
// Выплата — это не «списать с баланса игрока», а отправить USDT из кошелька.
// Поэтому перед подписью нужно знать две вещи:
//   * хватает ли на кошельке самого USDT под сумму перевода;
//   * есть ли TRX на комиссию (перевод TRC-20 жжёт ~15 TRX, если нет энергии).
//
// Без этой проверки заявка уходила в сеть и падала уже там: игрок видел «в
// обработке», а админ — ошибку сети вместо «на кошельке нет денег».
//
// Проверка не отменяет отправку, если сеть недоступна: тогда решает сама сеть.
// Смысл здесь — не пропустить заведомо провальный перевод и назвать причину.

import { SWEEP_FEE_SUN, accountBalances, type ChainBalances, type SweepChainDeps } from './sweep';
import { formatMicroUsdt } from './tron/amount';

export type HotWalletBlocker = 'hot_wallet_insufficient_usdt' | 'hot_wallet_no_trx';

export interface HotWalletState {
  address: string;
  usdtMicro: number;
  usdt: string;
  trxSun: number;
  /** Что мешает отправить `needMicro`. `null` — можно. */
  blocker: HotWalletBlocker | null;
  /** Сколько USDT не хватает под перевод (0 — хватает). */
  shortfallMicro: number;
  shortfall: string;
  /** Ошибка сети при чтении баланса; тогда `blocker` не выставляется. */
  error: string | null;
}

/** Правило «можно ли платить» — чистая функция, без сети. */
export function payoutBlocker(
  balances: Pick<ChainBalances, 'usdtMicro' | 'trxSun'>,
  needMicro: number,
): HotWalletBlocker | null {
  if (Number(balances.usdtMicro) < Number(needMicro)) return 'hot_wallet_insufficient_usdt';
  // USDT есть, но перевести нечем: без TRX (или делегированной энергии) сеть
  // откажет ещё до подписи.
  if (Number(balances.trxSun) < SWEEP_FEE_SUN) return 'hot_wallet_no_trx';
  return null;
}

/** Баланс и вердикт по конкретному переводу. */
export async function hotWalletState(
  deps: SweepChainDeps,
  address: string,
  needMicro: number,
): Promise<HotWalletState> {
  const empty: HotWalletState = {
    address,
    usdtMicro: 0,
    usdt: '0.00',
    trxSun: 0,
    blocker: null,
    shortfallMicro: Math.max(0, needMicro),
    shortfall: formatMicroUsdt(Math.max(0, needMicro)),
    error: 'chain_error',
  };
  if (!address) return { ...empty, error: 'hot_wallet_missing' };

  let balances: ChainBalances;
  try {
    balances = await accountBalances(deps, address);
  } catch {
    // Сеть молчит — не выдумываем вердикт. Отправку это не блокирует.
    return empty;
  }

  const shortfallMicro = Math.max(0, needMicro - balances.usdtMicro);
  return {
    address,
    usdtMicro: balances.usdtMicro,
    usdt: formatMicroUsdt(balances.usdtMicro),
    trxSun: balances.trxSun,
    blocker: payoutBlocker(balances, needMicro),
    shortfallMicro,
    shortfall: formatMicroUsdt(shortfallMicro),
    error: null,
  };
}
