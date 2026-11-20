// Финансовый Ledger Astra Pay.
//
// Отдельно от игрового Ledger мира: ASTRA и USDT не смешиваются никогда.
// Записи только добавляются; каждая содержит хеш предыдущей, поэтому задним
// числом незаметно переписать историю не получится — та же схема, что уже
// работает в игре (`world/ledger.ts`), но для денег.
//
// Инварианты:
//   * `delta` — целое и не ноль; сумма всех `delta` игрока и есть его баланс;
//   * `idem_key` уникален: одна и та же операция не может попасть дважды;
//   * зачисление депозита, запись в журнал и аудит идут одной пачкой (`batch`
//     в D1 атомарен), поэтому «половины» операции не бывает.

import { sha256Hex } from '../shared/sha256';
import { formatMicroUsdt } from './tron/amount';

export const PAY_GENESIS = '0'.repeat(64);

export type PayReason = 'deposit' | 'purchase' | 'payout' | 'fee' | 'adjust' | 'pool' | 'sweep';

export interface PayLedgerInput {
  userId: string;
  delta: number;
  reason: PayReason;
  sourceRef?: string;
  idemKey: string;
  createdAt: number;
}

/** Каноническая строка для хеша. Порядок полей менять нельзя — сломается сверка. */
export function payCanonical(input: PayLedgerInput, prevHash: string): string {
  return prevHash + JSON.stringify([
    input.userId, 'USDT', input.delta, input.reason, input.sourceRef ?? '', input.idemKey, input.createdAt,
  ]);
}

export async function payLedgerHead(db: D1Database): Promise<string> {
  const row = await db.prepare('SELECT hash FROM pay_ledger ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .first<{ hash: string }>('hash');
  return row ? String(row) : PAY_GENESIS;
}

export interface AppendResult {
  hash: string;
  duplicated: boolean;
}

/**
 * Добавить запись в журнал. Если `idem_key` уже есть — возвращаем `duplicated`
 * и ничего не пишем: повтор запроса от игрока не должен создавать деньги.
 */
export async function appendPayLedger(db: D1Database, input: PayLedgerInput): Promise<AppendResult> {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new Error('bad_delta');
  if (!input.idemKey) throw new Error('bad_idem_key');

  const existing = await db.prepare('SELECT hash FROM pay_ledger WHERE idem_key = ?')
    .bind(input.idemKey).first<{ hash: string }>('hash');
  if (existing) return { hash: String(existing), duplicated: true };

  const prev = await payLedgerHead(db);
  const hash = sha256Hex(payCanonical(input, prev));
  const id = `pl_${hash.slice(0, 24)}`;

  const res = await db.prepare(
    `INSERT INTO pay_ledger (id, user_id, asset, delta, reason, source_ref, idem_key, prev_hash, hash, created_at)
     VALUES (?, ?, 'USDT', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (idem_key) DO NOTHING`,
  ).bind(
    id, input.userId, input.delta, input.reason, input.sourceRef ?? '', input.idemKey, prev, hash, input.createdAt,
  ).run();

  const changes = Number((res as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (!changes) {
    const again = await db.prepare('SELECT hash FROM pay_ledger WHERE idem_key = ?')
      .bind(input.idemKey).first<{ hash: string }>('hash');
    return { hash: again ? String(again) : hash, duplicated: true };
  }
  return { hash, duplicated: false };
}

export async function payBalanceMicro(db: D1Database, userId: string): Promise<number> {
  const total = await db.prepare('SELECT COALESCE(SUM(delta), 0) AS total FROM pay_ledger WHERE user_id = ?')
    .bind(userId).first<number>('total');
  return Number(total ?? 0);
}

export interface DepositCreditInput {
  txid: string;
  eventIndex: number;
  userId: string;
  address: string;
  amountMicro: number;
  confirmations?: number;
}

export interface DepositCreditResult {
  credited: boolean;
  duplicated: boolean;
  hash: string | null;
  balanceMicro: number;
}

/**
 * Зачислить депозит ровно один раз.
 *
 * Ключ идемпотентности — `dep:<txid>:<event_index>`. Депозит, запись в журнал и
 * строка аудита попадают в одну пачку: либо всё, либо ничего.
 */
export async function creditDeposit(
  db: D1Database,
  input: DepositCreditInput,
  now: number,
): Promise<DepositCreditResult> {
  if (!input.txid || !Number.isInteger(input.eventIndex) || input.eventIndex < 0) throw new Error('bad_event');
  if (!Number.isSafeInteger(input.amountMicro) || input.amountMicro <= 0) throw new Error('bad_amount');

  const idemKey = `dep:${input.txid}:${input.eventIndex}`;
  const existing = await db.prepare('SELECT hash FROM pay_ledger WHERE idem_key = ?')
    .bind(idemKey).first<{ hash: string }>('hash');
  if (existing) {
    return {
      credited: false,
      duplicated: true,
      hash: String(existing),
      balanceMicro: await payBalanceMicro(db, input.userId),
    };
  }

  const prev = await payLedgerHead(db);
  const entry: PayLedgerInput = {
    userId: input.userId,
    delta: input.amountMicro,
    reason: 'deposit',
    sourceRef: `${input.txid}:${input.eventIndex}`,
    idemKey,
    createdAt: now,
  };
  const hash = sha256Hex(payCanonical(entry, prev));

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO pay_deposits (id, txid, event_index, user_id, address, amount_micro, confirmations, status, credited_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'credited', ?, ?)
         ON CONFLICT (txid, event_index) DO NOTHING`,
      ).bind(
        `dep_${input.txid}_${input.eventIndex}`, input.txid, input.eventIndex, input.userId, input.address,
        input.amountMicro, input.confirmations ?? 0, now, now,
      ),
      db.prepare(
        `INSERT INTO pay_ledger (id, user_id, asset, delta, reason, source_ref, idem_key, prev_hash, hash, created_at)
         VALUES (?, ?, 'USDT', ?, 'deposit', ?, ?, ?, ?, ?)`,
      ).bind(
        `pl_${hash.slice(0, 24)}`, input.userId, input.amountMicro, entry.sourceRef, idemKey, prev, hash, now,
      ),
      db.prepare(
        'INSERT INTO pay_audit_log (id, actor, action, target, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(
        `au_${hash.slice(0, 24)}`, 'monitor', 'deposit_credited', input.userId,
        JSON.stringify({ txid: input.txid, eventIndex: input.eventIndex, amountMicro: input.amountMicro }), now,
      ),
    ]);
  } catch (e) {
    // Гонка: параллельный запрос успел зачислить тот же депозит.
    const again = await db.prepare('SELECT hash FROM pay_ledger WHERE idem_key = ?')
      .bind(idemKey).first<{ hash: string }>('hash');
    if (again) {
      return {
        credited: false,
        duplicated: true,
        hash: String(again),
        balanceMicro: await payBalanceMicro(db, input.userId),
      };
    }
    throw e;
  }

  return {
    credited: true,
    duplicated: false,
    hash,
    balanceMicro: await payBalanceMicro(db, input.userId),
  };
}

export interface PayLedgerReport {
  ok: boolean;
  rows: number;
  head: string;
  brokenAt: string | null;
  /** Игроки, у которых сумма журнала не совпала с ожидаемой. */
  mismatches: { userId: string; ledger: number }[];
}

/**
 * Сверка журнала: проверяем хеш-цепочку от начала до конца.
 * `mismatches` остаётся пустым, пока журнал не правили в обход API.
 */
export async function verifyPayLedger(db: D1Database): Promise<PayLedgerReport> {
  const { results } = await db.prepare(
    `SELECT user_id, delta, reason, source_ref, idem_key, prev_hash, hash, created_at
     FROM pay_ledger ORDER BY created_at, rowid`,
  ).all<{
    user_id: string; delta: number; reason: PayReason; source_ref: string;
    idem_key: string; prev_hash: string; hash: string; created_at: number;
  }>();

  let prev = PAY_GENESIS;
  let brokenAt: string | null = null;
  const rows = results ?? [];
  const sums = new Map<string, number>();

  for (const row of rows) {
    if (brokenAt) break;
    const expected = sha256Hex(payCanonical({
      userId: row.user_id,
      delta: Number(row.delta),
      reason: row.reason,
      sourceRef: row.source_ref,
      idemKey: row.idem_key,
      createdAt: Number(row.created_at),
    }, prev));
    if (row.prev_hash !== prev || row.hash !== expected) brokenAt = row.hash;
    prev = row.hash;
    sums.set(row.user_id, (sums.get(row.user_id) ?? 0) + Number(row.delta));
  }

  const mismatches = [...sums.entries()]
    .map(([userId, ledger]) => ({ userId, ledger }))
    .filter((m) => !Number.isSafeInteger(m.ledger));

  return { ok: rows.length === 0 || (!brokenAt && mismatches.length === 0), rows: rows.length, head: prev, brokenAt, mismatches };
}

/** История игрока для кабинета: суммы, причины, без чужих данных. */
export async function payHistory(
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<{ delta: number; reason: PayReason; ref: string; amount: string; createdAt: number }[]> {
  const { results } = await db.prepare(
    `SELECT delta, reason, source_ref, created_at FROM pay_ledger
     WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  ).bind(userId, Math.max(1, Math.min(200, Math.trunc(limit)))).all<{
    delta: number; reason: PayReason; source_ref: string; created_at: number;
  }>();
  return (results ?? []).map((row) => ({
    delta: Number(row.delta),
    reason: row.reason,
    ref: row.source_ref,
    amount: formatMicroUsdt(Number(row.delta)),
    createdAt: Number(row.created_at),
  }));
}
