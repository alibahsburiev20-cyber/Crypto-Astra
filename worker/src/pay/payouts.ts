// Выплаты: заявка → проверка → резерв → подпись → отправка → подтверждение.
//
// На этом этапе подписи и отправки в сети ещё нет (она в Signer-контуре), зато
// есть всё, что не даёт потерять или удвоить деньги:
//   * строгий автомат состояний: `requested → approved → reserved → broadcasting
//     → sent → confirmed`, и только `failed`/`manual` в сторону;
//   * переход выполняется одним `UPDATE … WHERE status = <ожидаемое>`: если
//     статус уже сменился, запрос ничего не делает и возвращает конфликт;
//   * `idem_key` уникален — повторная заявка не создаёт вторую выплату;
//   * `txid` уникален — один перевод в сети не может закрыть две заявки;
//   * деньги списываются с баланса в момент резерва и возвращаются компенсирующей
//     записью при отказе. Журнал append-only, поэтому «правок» не бывает.
//
// Первая версия — только ручное подтверждение: `approve` вызывает админ.

import { TronAddressError, normalizeAddress } from './tron/address';
import { isEvmAddress, toChecksumAddress } from './evm/address';
import type { PayChain } from './units';
import { formatMicroUsdt } from './tron/amount';
import { payBalanceMicro, appendPayLedger } from './ledger';

export const MIN_WITHDRAW_MICRO = 5_000_000; // 5 USDT: ниже комиссия съедает смысл

/**
 * Минимальная заявка по сетям разная, и это не щедрость, а цена перевода:
 * TRON жрёт ~15 TRX (~4 $) за `transfer`, если энергия не арендована, и планка
 * 5 USDT стоит ровно затем, чтобы вывод не оказался дороже самого вывода.
 * BEP-20 стоит доли цента, и держать там ту же планку — значит «запретить
 * мелкие выводы» без всякой причины.
 */
export const MIN_WITHDRAW_MICRO_BY_CHAIN: Record<PayChain, number> = {
  tron: 5_000_000,
  bsc: 1_000_000,
};

export function minWithdrawMicro(chain: PayChain = 'tron'): number {
  return MIN_WITHDRAW_MICRO_BY_CHAIN[chain] ?? MIN_WITHDRAW_MICRO;
}
export const MAX_WITHDRAW_MICRO = 5_000_000_000; // 5 000 USDT за одну заявку
export const DAILY_LIMIT_MICRO = 20_000_000_000; // 20 000 USDT в сутки на игрока
const DAY = 86_400_000;

export type WithdrawalStatus =
  | 'requested' | 'approved' | 'reserved' | 'broadcasting' | 'sent' | 'confirmed' | 'failed' | 'manual';

/** Разрешённые переходы. Всё, чего здесь нет, — запрещено. */
export const TRANSITIONS: Record<WithdrawalStatus, WithdrawalStatus[]> = {
  requested: ['approved', 'manual', 'failed'],
  approved: ['reserved', 'manual', 'failed'],
  reserved: ['broadcasting', 'manual', 'failed'],
  broadcasting: ['sent', 'manual', 'failed'],
  sent: ['confirmed', 'manual'],
  confirmed: [],
  failed: [],
  manual: ['approved', 'failed'],
};

export class PayoutError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'PayoutError';
    this.code = code;
  }
}

export interface WithdrawalRow {
  id: string;
  user_id: string;
  address: string;
  amount_micro: number;
  fee_micro: number;
  status: WithdrawalStatus;
  idem_key: string;
  created_at: number;
  decided_at: number | null;
  txid: string | null;
}

/**
 * Адрес получателя проверяется по активной цепи, а не «по любому формату».
 *
 * Иначе получается самый плохой из вариантов: заявка принята, деньги зарезервированы,
 * а в сети такой адрес не существует. Нижнее регистрование для EVM — не косметика:
 * `pay_addresses` хранит ту же форму, и сверка идёт сравнением строк.
 */
export function normalizeWithdrawAddress(chain: PayChain, raw: string): string {
  const text = String(raw ?? '').trim();
  if (chain === 'bsc') {
    if (!isEvmAddress(text)) throw new PayoutError('bad_address');
    return toChecksumAddress(text).toLowerCase();
  }
  try {
    return normalizeAddress(text);
  } catch (e) {
    if (e instanceof TronAddressError) throw new PayoutError('bad_address');
    throw e;
  }
}

export interface RequestInput {
  userId: string;
  /** Активная цепь: от неё зависит формат адреса. По умолчанию — TRON. */
  chain?: PayChain;
  address: string;
  amountMicro: number;
  /** Ключ от клиента: повтор заявки не создаёт вторую. */
  idemKey: string;
}

export async function requestWithdrawal(
  db: D1Database,
  input: RequestInput,
  now: number,
): Promise<{ withdrawal: WithdrawalRow; duplicated: boolean }> {
  const address = normalizeWithdrawAddress(input.chain ?? 'tron', String(input.address ?? ''));

  const amount = Number(input.amountMicro);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new PayoutError('bad_amount');
  if (amount < minWithdrawMicro(input.chain ?? 'tron')) throw new PayoutError('below_minimum');
  if (amount > MAX_WITHDRAW_MICRO) throw new PayoutError('above_maximum');

  const rawKey = String(input.idemKey ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{8,64}$/.test(rawKey)) throw new PayoutError('bad_idem_key');
  const idemKey = `wd:${rawKey}`;

  const existing = await db.prepare('SELECT * FROM pay_withdrawals WHERE idem_key = ?')
    .bind(idemKey).first<WithdrawalRow>();
  if (existing) return { withdrawal: normalize(existing), duplicated: true };

  const balance = await payBalanceMicro(db, input.userId);
  if (balance < amount) throw new PayoutError('insufficient_funds');

  const dayStart = Math.floor(now / DAY) * DAY;
  const spent = await db.prepare(
    `SELECT COALESCE(SUM(amount_micro), 0) AS total FROM pay_withdrawals
      WHERE user_id = ? AND created_at >= ? AND status NOT IN ('failed')`,
  ).bind(input.userId, dayStart).first<number>('total');
  if (Number(spent ?? 0) + amount > DAILY_LIMIT_MICRO) throw new PayoutError('daily_limit');

  const id = `wd_${idemKey.slice(3)}`;
  await db.prepare(
    `INSERT INTO pay_withdrawals (id, user_id, address, amount_micro, fee_micro, status, idem_key, created_at)
     VALUES (?, ?, ?, ?, 0, 'requested', ?, ?)
     ON CONFLICT (idem_key) DO NOTHING`,
  ).bind(id, input.userId, address, amount, idemKey, now).run();

  const row = await db.prepare('SELECT * FROM pay_withdrawals WHERE idem_key = ?').bind(idemKey).first<WithdrawalRow>();
  if (!row) throw new PayoutError('request_failed');
  return { withdrawal: normalize(row), duplicated: false };
}

/**
 * Сменить состояние строго по таблице переходов.
 *
 * `UPDATE … WHERE status = ?` — единственный способ не проскочить два шага
 * одновременно при двух админах и двух воркерах.
 */
async function transition(
  db: D1Database,
  id: string,
  from: WithdrawalStatus,
  to: WithdrawalStatus,
  now: number,
  patch: { txid?: string | null } = {},
): Promise<WithdrawalRow> {
  if (!TRANSITIONS[from].includes(to)) throw new PayoutError(`bad_transition:${from}->${to}`);
  const res = await db.prepare(
    `UPDATE pay_withdrawals SET status = ?, decided_at = ?, txid = COALESCE(?, txid)
      WHERE id = ? AND status = ?`,
  ).bind(to, now, patch.txid ?? null, id, from).run();
  const changes = Number((res as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (!changes) throw new PayoutError('status_changed');

  const row = await db.prepare('SELECT * FROM pay_withdrawals WHERE id = ?').bind(id).first<WithdrawalRow>();
  if (!row) throw new PayoutError('not_found');
  return normalize(row);
}

async function load(db: D1Database, id: string): Promise<WithdrawalRow> {
  const row = await db.prepare('SELECT * FROM pay_withdrawals WHERE id = ?').bind(id).first<WithdrawalRow>();
  if (!row) throw new PayoutError('not_found');
  return normalize(row);
}

/** Админ подтвердил заявку. Деньги пока не двигаются. */
export async function approveWithdrawal(db: D1Database, id: string, now: number): Promise<WithdrawalRow> {
  return transition(db, id, 'requested', 'approved', now);
}

/**
 * Резерв: деньги уходят с баланса в журнал (`reason = payout`).
 * Ровно один раз — ключ идемпотентности привязан к заявке.
 */
export async function reserveWithdrawal(db: D1Database, id: string, now: number): Promise<WithdrawalRow> {
  const current = await load(db, id);
  if (current.status !== 'approved') throw new PayoutError('status_changed');

  const balance = await payBalanceMicro(db, current.user_id);
  if (balance < current.amount_micro) throw new PayoutError('insufficient_funds');
  // Сначала состояние, потом деньги: так заявку нельзя исполнить дважды, а
  // если запись в журнал сорвётся, сверка это увидит и поднимет стоп-флаг.
  const reserved = await transition(db, id, 'approved', 'reserved', now);
  await appendPayLedger(db, {
    userId: current.user_id,
    delta: -current.amount_micro,
    reason: 'payout',
    sourceRef: current.id,
    idemKey: `wdres:${current.id}`,
    createdAt: now,
  });
  return reserved;
}

/** Подпись и отправка: сюда подключится Signer. Пока фиксируем попытку и txid. */
export async function markBroadcast(
  db: D1Database,
  id: string,
  input: { txid?: string; attempt?: number; error?: string },
  now: number,
): Promise<WithdrawalRow> {
  const current = await load(db, id);
  const txid = input.txid ? String(input.txid).toLowerCase() : null;
  if (txid && !/^[0-9a-f]{64}$/.test(txid)) throw new PayoutError('bad_txid');

  const attempt = Number(input.attempt ?? 1);
  if (!Number.isInteger(attempt) || attempt < 1) throw new PayoutError('bad_attempt');

  // Попытки нумеруются и не повторяются: упавшая попытка не переиспользуется.
  await db.prepare(
    `INSERT INTO pay_payouts (id, withdrawal_id, attempt, txid, signed_at, broadcast_at, result, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (withdrawal_id, attempt) DO NOTHING`,
  ).bind(
    `po_${current.id}_${attempt}`, current.id, attempt, txid, now, txid ? now : null,
    txid ? 'broadcast' : 'error', input.error ?? '',
  ).run();

  return transition(db, id, current.status, txid ? 'broadcasting' : 'failed', now, { txid });
}

/** Сеть приняла транзакцию (появился txid в блоке). */
export async function markSent(db: D1Database, id: string, txid: string, now: number): Promise<WithdrawalRow> {
  const clean = String(txid).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new PayoutError('bad_txid');
  return transition(db, id, 'broadcasting', 'sent', now, { txid: clean });
}

/** Транзакция подтверждена сетью — деньги дошли. */
export async function confirmWithdrawal(db: D1Database, id: string, now: number): Promise<WithdrawalRow> {
  const current = await load(db, id);
  if (current.status !== 'sent') throw new PayoutError('status_changed');
  await db.prepare('UPDATE pay_payouts SET solidified_at = ?, result = ? WHERE withdrawal_id = ?')
    .bind(now, 'confirmed', id).run();
  return transition(db, id, 'sent', 'confirmed', now);
}

/**
 * Отказ. Деньги, уже списанные в резерв, возвращаются компенсирующей записью —
 * журнал не правится, история остаётся видимой.
 */
export async function failWithdrawal(
  db: D1Database,
  id: string,
  reason: string,
  now: number,
): Promise<WithdrawalRow> {
  const current = await load(db, id);
  if (!TRANSITIONS[current.status].includes('failed')) throw new PayoutError('bad_transition');

  const failed = await transition(db, id, current.status, 'failed', now);
  if (current.status === 'reserved' || current.status === 'broadcasting') {
    // Возврат — отдельная запись с обратным знаком; ключ уникален, поэтому
    // повторный отказ не вернёт деньги дважды.
    await appendPayLedger(db, {
      userId: current.user_id,
      delta: current.amount_micro,
      reason: 'adjust',
      sourceRef: `${current.id}:refund`,
      idemKey: `wdrefund:${current.id}`,
      createdAt: now,
    });
  }
  await db.prepare(
    'INSERT INTO pay_audit_log (id, actor, action, target, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(`au_wd_${current.id}_${now}`, 'admin', 'withdrawal_failed', current.id, JSON.stringify({ reason }), now).run();

  return failed;
}

/** Заявки игрока для кабинета. */
export async function listWithdrawals(db: D1Database, userId: string, limit = 20) {
  const { results } = await db.prepare(
    `SELECT id, address, amount_micro, status, created_at, txid FROM pay_withdrawals
      WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).bind(userId, Math.max(1, Math.min(100, limit))).all<WithdrawalRow>();
  return (results ?? []).map((row) => ({
    id: String(row.id),
    address: String(row.address),
    amount: formatMicroUsdt(Number(row.amount_micro)),
    amountMicro: Number(row.amount_micro),
    status: String(row.status),
    createdAt: Number(row.created_at),
    txid: row.txid ?? null,
  }));
}

/** Очередь для админа: всё, что требует рук. */
export async function withdrawalQueue(db: D1Database, limit = 50) {
  const { results } = await db.prepare(
    `SELECT id, user_id, address, amount_micro, status, created_at FROM pay_withdrawals
      WHERE status IN ('requested', 'approved', 'reserved', 'broadcasting', 'manual')
      ORDER BY created_at LIMIT ?`,
  ).bind(Math.max(1, Math.min(200, limit))).all<WithdrawalRow>();
  return (results ?? []).map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    address: String(row.address),
    amount: formatMicroUsdt(Number(row.amount_micro)),
    amountMicro: Number(row.amount_micro),
    status: String(row.status),
    createdAt: Number(row.created_at),
  }));
}

function normalize(row: WithdrawalRow): WithdrawalRow {
  return {
    ...row,
    amount_micro: Number(row.amount_micro),
    fee_micro: Number(row.fee_micro),
    created_at: Number(row.created_at),
    decided_at: row.decided_at === null ? null : Number(row.decided_at),
    txid: row.txid ?? null,
  };
}
