import { REFERRAL_LIMIT, REFERRAL_QUALIFY_EXPEDITIONS, REFERRAL_REWARD } from '../../shared/constants';
import { applyDelta } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { ratingLabel } from './season';

// Рефералы (этап 4). Награда платится не за регистрацию, а за то, что человек
// реально играл: 5 завершённых рейсов. Иначе получается схема «приведи пустышку
// и получи ASTRA», которая интересна только ботам.

export const REFERRAL_CODE_LEN = 7;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** Код создаётся один раз. Вызывать внутри транзакции; повторный вызов безопасен. */
export function ensureCode(sql: SqlStorage, playerId: string, now: number): string {
  const rows = sql.exec('SELECT code FROM referral_codes WHERE player_id = ?', playerId).toArray();
  if (rows.length) return String(rows[0].code);
  let code = randomCode(REFERRAL_CODE_LEN);
  while (sql.exec('SELECT 1 FROM referral_codes WHERE code = ?', code).toArray().length > 0) code = randomCode(REFERRAL_CODE_LEN);
  sql.exec('INSERT INTO referral_codes (player_id, code, created_at) VALUES (?, ?, ?)', playerId, code, now);
  return code;
}

export function completedExpeditions(sql: SqlStorage, playerId: string): number {
  const rows = sql.exec(
    `SELECT COUNT(*) AS c FROM expeditions WHERE player_id = ? AND status = 'completed'`,
    playerId,
  ).toArray();
  return rows.length ? Number(rows[0].c) : 0;
}

export function referralView(sql: SqlStorage, playerId: string, now: number) {
  const code = ensureCode(sql, playerId, now);
  const rows = sql.exec(
    `SELECT invitee_id, status, created_at, qualified_at FROM referrals WHERE inviter_id = ? ORDER BY created_at DESC`,
    playerId,
  ).toArray().map((r) => ({
    label: ratingLabel(String(r.invitee_id)),
    status: String(r.status),
    createdAt: Number(r.created_at),
    qualifiedAt: r.qualified_at == null ? null : Number(r.qualified_at),
  }));
  const mine = sql.exec(
    `SELECT r.inviter_id, r.status, r.qualified_at FROM referrals r WHERE r.invitee_id = ?`,
    playerId,
  ).toArray();
  return {
    code,
    limit: REFERRAL_LIMIT,
    reward: REFERRAL_REWARD,
    qualifyAt: REFERRAL_QUALIFY_EXPEDITIONS,
    invited: rows,
    qualified: rows.filter((r) => r.status === 'qualified').length,
    earned: rows.filter((r) => r.status === 'qualified').length * REFERRAL_REWARD,
    myInviter: mine.length
      ? {
        label: ratingLabel(String(mine[0].inviter_id)),
        status: String(mine[0].status),
        qualifiedAt: mine[0].qualified_at == null ? null : Number(mine[0].qualified_at),
      }
      : null,
    myProgress: Math.min(completedExpeditions(sql, playerId), REFERRAL_QUALIFY_EXPEDITIONS),
  };
}

export function applyReferral(sql: SqlStorage, playerId: string, idemKey: string, rawCode: string, now: number): { inviter: string } {
  return withIdempotency(sql, playerId, 'referral:apply', idemKey, { code: rawCode }, now, () => {
    assertPlayable(sql);
    const code = String(rawCode ?? '').trim().toUpperCase();
    const rows = sql.exec('SELECT player_id FROM referral_codes WHERE code = ?', code).toArray();
    if (!rows.length) throw new ApiError(404, 'referral_not_found');
    const inviterId = String(rows[0].player_id);
    if (inviterId === playerId) throw new ApiError(400, 'self_referral');
    const already = sql.exec('SELECT 1 FROM referrals WHERE invitee_id = ?', playerId).toArray().length > 0;
    if (already) throw new ApiError(409, 'referral_already_applied');
    const count = Number(sql.exec('SELECT COUNT(*) AS c FROM referrals WHERE inviter_id = ?', inviterId).toArray()[0].c);
    if (count >= REFERRAL_LIMIT) throw new ApiError(409, 'referral_limit');
    sql.exec(
      `INSERT INTO referrals (id, inviter_id, invitee_id, code, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      crypto.randomUUID(), inviterId, playerId, code, now,
    );
    return { value: { inviter: ratingLabel(inviterId) }, store: true };
  });
}

/**
 * Вызывается после завершения рейса приглашённым. Если он налетал достаточно,
 * награда выплачивается обоим сразу — в той же транзакции мира, поэтому
 * приглашающий может быть офлайн, и это ничего не ломает.
 */
export function qualifyReferral(sql: SqlStorage, playerId: string, now: number): boolean {
  const rows = sql.exec(
    `SELECT id, inviter_id FROM referrals WHERE invitee_id = ? AND status = 'pending'`,
    playerId,
  ).toArray();
  if (!rows.length) return false;
  if (completedExpeditions(sql, playerId) < REFERRAL_QUALIFY_EXPEDITIONS) return false;
  const id = String(rows[0].id);
  const inviterId = String(rows[0].inviter_id);
  sql.exec(`UPDATE referrals SET status = 'qualified', qualified_at = ? WHERE id = ?`, now, id);
  applyDelta(sql, { playerId, asset: 'astra', delta: REFERRAL_REWARD, reason: 'referral_reward', sourceRef: id }, now);
  applyDelta(sql, { playerId: inviterId, asset: 'astra', delta: REFERRAL_REWARD, reason: 'referral_reward', sourceRef: id }, now);
  return true;
}
