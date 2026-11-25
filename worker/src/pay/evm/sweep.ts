// План сбора (sweep) в BNB Chain: только чтение, ничего не подписывает.
//
// В чём разница с TRON и почему это отдельный файл. На TRON комиссию можно
// делегировать энергией, и у нас заведомо есть TRX на адресе игрока — мы сами
// их туда заводим вместе с депозитом (нет). На BSC газа в чужом кошельке нет
// никогда: игрок присылает USDT, а BNB там не появляется. Значит «собрать»
// означает сначала «занести BNB», и это отдельное решение с отдельной ценой, а
// не техническая деталь.
//
// Поэтому план здесь — это три списка: что можно забрать прямо сейчас, что
// уперлось в газ, и сколько BNB на это нужно. Итоговая сумма «sweepable» —
// ровно то, что уйдёт без внешнего вмешательства.

import { formatMicroUsdt } from '../tron/amount';
import { GAS_TOPUP_WEI, SWEEP_MIN_MICRO, evmAccountBalances, formatBnb, gasCostWei } from './balances';
import type { EvmRpc } from './rpc';
import type { PayNetwork } from '../flags';

/**
 * Сколько адресов читаем за проход. Для списка в админке хватило бы и 20, но
 * отчёт о платёжеспособности считает этим же планом «все активные», поэтому
 * лимит — верхняя граница полной сводки, а не «первые N».
 */
export const SWEEP_PLAN_LIMIT = 500;

export interface EvmSweepRow {
  address: string;
  userId: string | null;
  usdtMicro: number;
  gasWei: bigint;
  /** Балансы прочитались, и BNB хватает на один `transfer`. */
  enoughGas: boolean;
  blocker: 'no_usdt' | 'below_min' | 'bnb_missing' | 'chain_error' | null;
  sweepable: boolean;
  error: string | null;
}

export interface EvmSweepPlan {
  chain: 'bsc';
  network: PayNetwork;
  destination: string;
  addresses: number;
  rows: EvmSweepRow[];
  totals: {
    usdtMicro: number;
    /** Сколько BNB лежит на адресах игроков (wei). */
    gasWei: bigint;
    /** Сколько BNB нужно занести, чтобы собрать то, что уперлось в газ. */
    gasNeededWei: bigint;
    sweepableMicro: number;
    belowMinMicro: number;
    /** Комиссия на один перевод — чтобы цена сбора была видна до решения. */
    feePerSweepWei: bigint;
  };
  ready: boolean;
  /**
   * Часть адресов в план не попала (их больше, чем лимит). Для списка это норма,
   * для отчёта о платёжеспособности — нет: «покрыто» по неполным данным сказать нельзя.
   */
  truncated: boolean;
  reason: 'hot_wallet_missing' | 'sweep_disabled' | null;
  updatedAt: number;
}

export interface EvmSweepInput {
  db: D1Database;
  rpc: Pick<EvmRpc, 'call' | 'balance'>;
  contract: string;
  network: PayNetwork;
  destination: string;
  sweepEnabled: boolean;
  /** Ставка газа, из которой считается «хватит ли BNB». */
  maxFeePerGas: bigint;
  now?: number;
  limit?: number;
}

/**
 * Адреса, с которых имеет смысл что-то забирать: `0x`-формат и `active = 1`.
 *
 * Фильтр по `chain` — не косметика: в той же таблице лежат адреса прошлой цепи
 * (они остаются активными, пока на них деньги), и попытка прочитать `T…` как
 * EVM-адрес уронила бы весь план.
 */
export interface ActiveAddressSet {
  rows: Array<{ address: string; user_id: string | null }>;
  /** Активных адресов этой цепи всего — если больше, чем `rows`, сводка неполная. */
  total: number;
}

/**
 * Активные адреса EVM-цепи — те, у которых `chain = 'bsc'`. Сортировка по сети,
 * а не по маске адреса: формат говорит «похоже на EVM», колонка — «мы выдали
 * его под EVM и сами его сканируем». План без этого фильтра выглядел бы как
 * «балансов нет», а не «не та сеть».
 */
export async function evmActiveAddresses(db: D1Database, limit: number): Promise<ActiveAddressSet> {
  const [rows, count] = await Promise.all([
    db.prepare(
      `SELECT address, user_id FROM pay_addresses
        WHERE active = 1 AND chain = 'bsc'
        ORDER BY created_at DESC LIMIT ?`,
    ).bind(limit).all<{ address: string; user_id: string | null }>(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM pay_addresses WHERE active = 1 AND chain = 'bsc'`,
    ).first<number>('n'),
  ]);
  const raw = Number(count ?? 0);
  if (!Number.isFinite(raw) || raw < 0) throw new Error('bad_address_count');
  return {
    rows: (rows.results ?? []) as Array<{ address: string; user_id: string | null }>,
    // «Неполно» считается по всему множеству, а не по «лимит + 1»: иначе ровно
    // 501 адрес выглядели бы как «мы всё прочитали».
    total: Number.isSafeInteger(raw) ? raw : Number.MAX_SAFE_INTEGER,
  };
}

export async function evmSweepPlan(input: EvmSweepInput): Promise<EvmSweepPlan> {
  const now = input.now ?? Date.now();
  const limit = input.limit ?? SWEEP_PLAN_LIMIT;
  const fee = gasCostWei(input.maxFeePerGas);

  const found = await evmActiveAddresses(input.db, limit);
  const rows: EvmSweepRow[] = [];

  for (const row of found.rows) {
    try {
      const balances = await evmAccountBalances(input.rpc, input.contract, row.address);
      const enoughGas = balances.gasWei >= fee;
      const blocker: EvmSweepRow['blocker'] = balances.usdtMicro <= 0
        ? 'no_usdt'
        : balances.usdtMicro < SWEEP_MIN_MICRO ? 'below_min'
          : enoughGas ? null : 'bnb_missing';
      rows.push({
        address: row.address, userId: row.user_id,
        usdtMicro: balances.usdtMicro, gasWei: balances.gasWei,
        enoughGas, blocker, sweepable: blocker === null, error: null,
      });
    } catch (e) {
      // Один unreadable адрес не отменяет план по остальным: сеть может отвечать
      // выборочно, а админ обязан увидеть картину целиком.
      rows.push({
        address: row.address, userId: row.user_id, usdtMicro: 0, gasWei: 0n,
        enoughGas: false, blocker: 'chain_error', sweepable: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  let usdtMicro = 0;
  let gasWei = 0n;
  let sweepableMicro = 0;
  let belowMinMicro = 0;
  // Сколько BNB не хватает там, где USDT есть, а газа нет. Считаем по верхней
  // оценке (полный лимит газа по максимальной ставке), а не по факту.
  let gasNeededWei = 0n;
  for (const row of rows) {
    usdtMicro += row.usdtMicro;
    gasWei += row.gasWei;
    if (row.usdtMicro <= 0) continue;
    if (row.blocker === null) sweepableMicro += row.usdtMicro;
    if (row.blocker === 'below_min') belowMinMicro += row.usdtMicro;
    if (row.blocker === 'bnb_missing') {
      const missing = fee - row.gasWei;
      gasNeededWei += missing > 0n ? missing : 0n;
    }
  }

  const reason = !input.destination
    ? 'hot_wallet_missing'
    : !input.sweepEnabled ? 'sweep_disabled' : null;

  return {
    chain: 'bsc',
    network: input.network,
    destination: input.destination,
    addresses: rows.length,
    truncated: found.total > rows.length,
    rows,
    totals: { usdtMicro, gasWei, gasNeededWei, sweepableMicro, belowMinMicro, feePerSweepWei: fee },
    ready: reason === null,
    reason,
    updatedAt: now,
  };
}

export function formatSweepTotals(plan: EvmSweepPlan): { usdt: string; bnb: string; bnbNeeded: string } {
  return {
    usdt: formatMicroUsdt(plan.totals.usdtMicro),
    bnb: formatBnb(plan.totals.gasWei),
    // Верхняя оценка худшего случая: «столько BNB надо занести, чтобы собрать всё».
    bnbNeeded: formatBnb(plan.totals.gasNeededWei + GAS_TOPUP_WEI * BigInt(plan.rows.filter((r) => r.blocker === 'bnb_missing').length)),
  };
}
