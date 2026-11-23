// Пул в USDT: отдельный контур, отдельно от фиатного `pool_entries`.
//
// Фиат в пуле считается в центах (`pool_entries`), USDT — в микро-USDT здесь.
// Складывать евро и доллары нельзя, поэтому в публичном отчёте два блока.
//
// Формула, которую нельзя менять без тестов:
//
//   Available = Confirmed − Reserved − Paid − Locked
//
//   Confirmed — сколько USDT реально пришло и уже подтверждено;
//   Reserved  — сколько зарезервировано под заявки на выплату;
//   Paid      — сколько уже отправлено и подтверждено сетью;
//   Locked    — сколько «в полёте»: подписано или отправлено, но не подтверждено.
//
// Отрицательное `Available` — авария, а не норма: значит, кто-то пообещал
// больше, чем есть. В этом случае админка обязана включить стоп-флаг выплат.

import { formatMicroUsdt } from './tron/amount';

export interface PoolCycleRow {
  id: string;
  period_start: number;
  period_end: number;
  confirmed_in: number;
  ops_reserved: number;
  prize_budget: number;
  reserved: number;
  paid: number;
  locked: number;
  status: 'open' | 'closed';
  created_at: number;
  closed_at: number | null;
}

export const CYCLE_DAYS = 30;

/**
 * Доля выручки магазина, которая уходит в призовой фонд сезона.
 *
 * Важно, откуда деньги: это доля **нашей** выручки от продажи косметики, а не
 * взносы игроков. Взносов в пул нет и не будет — пул, куда люди вкладывают
 * деньги в расчёте на выплаты, это инвестиционная схема, а не механика игры.
 * Поэтому призовой фонд считается только из покупок и не может превысить их.
 */
export const PRIZE_SHARE_DEFAULT = 40;

/** Доля из `POOL_PRIZE_SHARE` (0–100, по умолчанию 40). Кривое значение — 40. */
export function prizeSharePercent(value: string | undefined | null): number {
  const raw = String(value ?? '').trim();
  if (!raw) return PRIZE_SHARE_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return PRIZE_SHARE_DEFAULT;
  return Math.round(n);
}

/** Сколько из цены товара попадёт в призовой фонд. Округление — вниз, до микро. */
export function prizeFromPrice(priceMicro: number, percent = PRIZE_SHARE_DEFAULT): number {
  if (!Number.isSafeInteger(priceMicro) || priceMicro <= 0) return 0;
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const share = Math.min(100, percent);
  return Math.floor((priceMicro * share) / 100);
}

/** Начислить призовой фонд. Возвращает новое значение или ноль, если цикла нет. */
export async function addPrizeBudget(db: D1Database, micro: number, now: number): Promise<number> {
  if (!Number.isSafeInteger(micro) || micro <= 0) return 0;
  const cycle = await ensureOpenCycle(db, now);
  await db.prepare('UPDATE pay_pool_cycles SET prize_budget = prize_budget + ? WHERE id = ?')
    .bind(micro, cycle.id).run();
  const row = await db.prepare('SELECT prize_budget FROM pay_pool_cycles WHERE id = ?')
    .bind(cycle.id).first<number>('prize_budget');
  return Number(row ?? 0);
}
const DAY = 86_400_000;

export function availableMicro(cycle: Pick<PoolCycleRow, 'confirmed_in' | 'reserved' | 'paid' | 'locked'>): number {
  return Number(cycle.confirmed_in) - Number(cycle.reserved) - Number(cycle.paid) - Number(cycle.locked);
}

/** Открытый цикл или `null`. Одновременно открыт только один — это держит индекс в схеме. */
export async function openCycle(db: D1Database): Promise<PoolCycleRow | null> {
  const row = await db.prepare("SELECT * FROM pay_pool_cycles WHERE status = 'open' LIMIT 1")
    .first<PoolCycleRow>();
  return row ? normalizeCycle(row) : null;
}

export async function ensureOpenCycle(db: D1Database, now: number): Promise<PoolCycleRow> {
  const current = await openCycle(db);
  if (current) return current;
  const id = `pc_${now}`;
  await db.prepare(
    `INSERT INTO pay_pool_cycles (id, period_start, period_end, status, created_at)
     VALUES (?, ?, ?, 'open', ?)
     ON CONFLICT DO NOTHING`,
  ).bind(id, now, now + CYCLE_DAYS * DAY, now).run();
  const created = await openCycle(db);
  if (!created) throw new Error('pool_cycle_missing');
  return created;
}

export interface PoolCloseResult {
  closed: PoolCycleRow;
  availableMicro: number;
  paidOutMicro: number;
}

/**
 * Закрыть цикл: всё, что не выплачено, переносится в следующий цикл как
 * `confirmed_in`. Так деньги не «исчезают» при закрытии периода.
 */
export async function closeCycle(db: D1Database, now: number): Promise<PoolCloseResult | null> {
  const current = await openCycle(db);
  if (!current) return null;
  const carry = Math.max(0, availableMicro(current));
  await db.prepare("UPDATE pay_pool_cycles SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'")
    .bind(now, current.id).run();
  const next = await ensureOpenCycle(db, now);
  if (carry > 0) {
    await db.prepare('UPDATE pay_pool_cycles SET confirmed_in = confirmed_in + ? WHERE id = ?')
      .bind(carry, next.id).run();
  }
  return {
    closed: { ...current, status: 'closed', closed_at: now },
    availableMicro: availableMicro(current),
    paidOutMicro: Number(current.paid),
  };
}

/** Начислить пулу подтверждённый доход (например, долю от покупок). */
export async function addPoolIncome(db: D1Database, micro: number): Promise<number> {
  if (!Number.isSafeInteger(micro) || micro <= 0) throw new Error('bad_pool_income');
  const cycle = await openCycle(db);
  if (!cycle) throw new Error('pool_cycle_missing');
  await db.prepare('UPDATE pay_pool_cycles SET confirmed_in = confirmed_in + ? WHERE id = ?')
    .bind(micro, cycle.id).run();
  return availableMicro({ ...cycle, confirmed_in: Number(cycle.confirmed_in) + micro });
}

/** Резерв под заявку на выплату. Резервировать больше, чем есть, нельзя. */
export async function reservePayout(db: D1Database, micro: number): Promise<boolean> {
  if (!Number.isSafeInteger(micro) || micro <= 0) throw new Error('bad_reserve');
  const cycle = await openCycle(db);
  if (!cycle) return false;
  if (availableMicro(cycle) < micro) return false;
  await db.prepare('UPDATE pay_pool_cycles SET reserved = reserved + ? WHERE id = ?').bind(micro, cycle.id).run();
  return true;
}

export interface UsdtPoolBlock {
  open: boolean;
  /** Призовой фонд из выручки магазина (не взносы игроков). */
  prizeBudget: number;
  prizeBudgetText: string;
  confirmedIn: number;
  reserved: number;
  paid: number;
  locked: number;
  available: number;
  confirmed: string;
  availableText: string;
  status: 'ok' | 'no_cycle' | 'deficit';
  updatedAt: number;
}

/** Блок USDT для публичного отчёта `/pool.json`. Без адресов и имён. */
export async function usdtPoolBlock(db: D1Database, now = Date.now()): Promise<UsdtPoolBlock> {
  const cycle = await openCycle(db);
  if (!cycle) {
    return {
      open: false, prizeBudget: 0, prizeBudgetText: '0.00',
      confirmedIn: 0, reserved: 0, paid: 0, locked: 0, available: 0,
      confirmed: '0.00', availableText: '0.00', status: 'no_cycle', updatedAt: now,
    };
  }
  const available = availableMicro(cycle);
  return {
    open: true,
    prizeBudget: Number(cycle.prize_budget),
    prizeBudgetText: formatMicroUsdt(Number(cycle.prize_budget)),
    confirmedIn: Number(cycle.confirmed_in),
    reserved: Number(cycle.reserved),
    paid: Number(cycle.paid),
    locked: Number(cycle.locked),
    available,
    confirmed: formatMicroUsdt(Number(cycle.confirmed_in)),
    availableText: formatMicroUsdt(available),
    status: available < 0 ? 'deficit' : 'ok',
    updatedAt: now,
  };
}

function normalizeCycle(row: PoolCycleRow): PoolCycleRow {
  return {
    ...row,
    period_start: Number(row.period_start),
    period_end: Number(row.period_end),
    confirmed_in: Number(row.confirmed_in),
    ops_reserved: Number(row.ops_reserved),
    prize_budget: Number(row.prize_budget),
    reserved: Number(row.reserved),
    paid: Number(row.paid),
    locked: Number(row.locked),
    created_at: Number(row.created_at),
    closed_at: row.closed_at === null ? null : Number(row.closed_at),
  };
}
