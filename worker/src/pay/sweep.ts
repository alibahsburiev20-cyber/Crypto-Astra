// План сбора USDT с адресов игроков (sweep) — только чтение, ничего не двигает.
//
// Зачем отдельный шаг: у каждого игрока свой адрес со своим ключом, выведенным из
// семени. Чтобы забрать с него USDT, нужно подписать перевод этим ключом, а ещё
// на адресе должен быть TRX на комиссию. Поэтому «собрать всё в кошелёк» — не
// галочка, а операция на реальные деньги, и начинать её надо с честного плана:
// сколько лежит, сколько TRX есть, сколько не хватает.
//
// Этот модуль ничего не подписывает и не отправляет. Он только считает.

import type { PayNetwork } from './flags';
import { tronApiBase, usdtContract } from './tron/contracts';

/** Комиссия за перевод USDT с пустого адреса: ~31.9k энергии + байты. */
export const SWEEP_FEE_SUN = 15_000_000; // 15 TRX
/** Сколько адресов проверяем за один вызов: TronGrid не любит шквал запросов. */
export const SWEEP_PLAN_LIMIT = 50;
/**
 * Меньше этого не собираем: комиссия съест смысл.
 *
 * 15 TRX по курсу ≈ 0.3 $ за TRX — это около 4.5 $ за один перевод. Собирать
 * 2–3 USDT с адреса означало бы платить за перевод больше, чем переводишь.
 * Поэтому «мелкие» адреса копятся, пока на них не наберётся сумма, которую есть
 * смысл двигать.
 */
export const SWEEP_MIN_MICRO = 10_000_000; // 10 USDT

export interface SweepChainDeps {
  fetchJson: (url: string) => Promise<unknown>;
  apiBase: string;
  contract: string;
}

export interface ChainBalances {
  trxSun: number;
  usdtMicro: number;
}

export interface SweepRow {
  address: string;
  userId: string;
  usdtMicro: number;
  trxSun: number;
  /** Хватает ли TRX на перевод этой суммы. */
  enoughTrx: boolean;
  /** Что мешает собрать: null — можно. */
  blocker: 'no_usdt' | 'below_min' | 'trx_missing' | 'chain_error' | null;
  /** Можно ли собирать прямо сейчас (деньги есть, их хватает на комиссию). */
  sweepable: boolean;
  error: string | null;
}

export interface SweepPlan {
  network: PayNetwork;
  destination: string;
  addresses: number;
  rows: SweepRow[];
  totals: {
    usdtMicro: number;
    trxSun: number;
    /** Сколько TRX нужно докупить, чтобы собрать всё найденное. */
    trxShortfallSun: number;
    /** Сумма по адресам, которые можно собрать прямо сейчас. */
    sweepableMicro: number;
    /** Сумма ниже порога `SWEEP_MIN_MICRO`: копится, не собирается. */
    belowMinMicro: number;
  };
  /** Можно ли вообще собирать: включён флаг и задан кошелёк. */
  ready: boolean;
  reason: string | null;
  updatedAt: number;
}

/** Разбор ответа TronGrid `/v1/accounts/{address}`. Ничего не додумываем. */
export function parseBalances(payload: unknown, contract: string): ChainBalances {
  const data = (payload as { data?: unknown })?.data;
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  const trxSun = Number(first?.balance ?? 0) || 0;
  const trc20 = (first?.trc20 as Array<Record<string, unknown>> | undefined) ?? [];
  let usdtMicro = 0;
  for (const entry of trc20) {
    const raw = entry?.[contract];
    if (raw !== undefined) usdtMicro += Number(raw) || 0;
  }
  return { trxSun, usdtMicro };
}

export async function accountBalances(deps: SweepChainDeps, address: string): Promise<ChainBalances> {
  const url = `${deps.apiBase}/v1/accounts/${encodeURIComponent(address)}`;
  const payload = await deps.fetchJson(url);
  return parseBalances(payload, deps.contract);
}

export interface SweepPlanInput {
  db: D1Database;
  deps: SweepChainDeps;
  network: PayNetwork;
  destination: string;
  sweepEnabled: boolean;
  now?: number;
  limit?: number;
}

/**
 * План сбора: по каждому активному адресу — сколько USDT и TRX, хватает ли на
 * комиссию. Ошибка сети по одному адресу не отменяет план по остальным.
 */
export async function sweepPlan(input: SweepPlanInput): Promise<SweepPlan> {
  const now = input.now ?? Date.now();
  const limit = input.limit ?? SWEEP_PLAN_LIMIT;

  const rows = await input.db.prepare(
    'SELECT address, user_id FROM pay_addresses WHERE active = 1 ORDER BY created_at DESC LIMIT ?',
  ).bind(limit).all<{ address: string; user_id: string }>();
  const found = (rows.results ?? []) as Array<{ address: string; user_id: string }>;

  const planRows: SweepRow[] = [];
  for (const row of found) {
    try {
      const balances = await accountBalances(input.deps, row.address);
      const enoughTrx = balances.trxSun >= SWEEP_FEE_SUN;
      const blocker: SweepRow['blocker'] = balances.usdtMicro <= 0
        ? 'no_usdt'
        : balances.usdtMicro < SWEEP_MIN_MICRO ? 'below_min'
          : enoughTrx ? null : 'trx_missing';
      planRows.push({
        address: row.address, userId: row.user_id,
        usdtMicro: balances.usdtMicro, trxSun: balances.trxSun,
        enoughTrx, blocker, sweepable: blocker === null, error: null,
      });
    } catch (e) {
      planRows.push({
        address: row.address, userId: row.user_id,
        usdtMicro: 0, trxSun: 0, enoughTrx: false, blocker: 'chain_error', sweepable: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  let usdtMicro = 0;
  let trxSun = 0;
  let sweepableMicro = 0;
  let belowMinMicro = 0;
  let trxShortfallSun = 0;
  for (const row of planRows) {
    usdtMicro += row.usdtMicro;
    trxSun += row.trxSun;
    if (row.usdtMicro <= 0) continue;
    if (row.blocker === null) sweepableMicro += row.usdtMicro;
    if (row.blocker === 'below_min') belowMinMicro += row.usdtMicro;
    // Комиссию считаем только там, где сбор вообще имеет смысл.
    if (row.blocker !== 'below_min' && !row.enoughTrx) trxShortfallSun += SWEEP_FEE_SUN - row.trxSun;
  }

  const reason = !input.destination
    ? 'hot_wallet_missing'
    : !input.sweepEnabled ? 'sweep_disabled' : null;

  return {
    network: input.network,
    destination: input.destination,
    addresses: planRows.length,
    rows: planRows,
    totals: { usdtMicro, trxSun, trxShortfallSun, sweepableMicro, belowMinMicro },
    ready: reason === null,
    reason,
    updatedAt: now,
  };
}

/** Сеть и контракт для плана — из конфигурации Worker. */
export function sweepChainDeps(
  fetchJson: (url: string) => Promise<unknown>,
  network: PayNetwork,
  env: { PAY_USDT_CONTRACT?: string },
): SweepChainDeps {
  return {
    fetchJson,
    apiBase: tronApiBase(network),
    contract: usdtContract(env as never, network),
  };
}
