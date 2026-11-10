import { DAY_MS } from '../shared/constants';
import { toB64Url } from '../shared/encoding';
import { sha256Hex } from '../shared/sha256';

export const REFRESH_TTL_MS = 30 * DAY_MS;

function newToken(): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// В D1 лежит только хеш refresh-токена. Сам токен знает только браузер (cookie HttpOnly).
export async function createSession(db: D1Database, userId: string, now: number): Promise<string> {
  const token = newToken();
  await db
    .prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, sha256Hex(token), now + REFRESH_TTL_MS, now)
    .run();
  return token;
}

export type RotateResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; reason: 'invalid' | 'reuse' };

// Ротация: каждый refresh-токен работает один раз. Повторное использование старого токена
// отзывает все сессии игрока.
export async function rotateSession(db: D1Database, presented: string, now: number): Promise<RotateResult> {
  const row = await db
    .prepare('SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?')
    .bind(sha256Hex(presented))
    .first<{ id: string; user_id: string; expires_at: number; revoked_at: number | null }>();
  if (!row) return { ok: false, reason: 'invalid' };

  if (row.revoked_at !== null) {
    await db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, row.user_id).run();
    return { ok: false, reason: 'reuse' };
  }
  if (row.expires_at <= now) return { ok: false, reason: 'invalid' };

  // Условие revoked_at IS NULL защищает от двух одновременных обновлений одним токеном.
  const upd = await db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, row.id).run();
  if (upd.meta.changes !== 1) return { ok: false, reason: 'reuse' };

  return { ok: true, userId: row.user_id, token: await createSession(db, row.user_id, now) };
}

export async function revokeSession(db: D1Database, presented: string, now: number): Promise<void> {
  await db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').bind(now, sha256Hex(presented)).run();
}
