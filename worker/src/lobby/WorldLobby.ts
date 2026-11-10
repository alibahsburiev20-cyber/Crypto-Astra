import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { RESERVATION_TTL_MS, WORLD_CAPACITY } from '../shared/constants';
import { ApiError } from '../world/errors';

const LOBBY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS lobby_worlds (
     world_id TEXT PRIMARY KEY, n INTEGER NOT NULL UNIQUE, capacity INTEGER NOT NULL,
     taken INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS lobby_reservations (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'released', 'expired')),
     expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_lobby_res_user ON lobby_reservations (user_id, status)`,
];

export interface Reservation { reservationId: string; worldId: string; preferred: boolean }

// Единственный источник истины по местам. Объект один (имя «main»), запросы идут по очереди,
// поэтому два игрока не займут последнее место одновременно.
export class WorldLobby extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      for (const s of LOBBY_SCHEMA) this.sql.exec(s);
    });
  }

  // preferredWorldId — мир пригласившего. Если там нет места, игрок получает любой другой мир,
  // а реферальная связь не засчитывается (preferred = false).
  reserve(userId: string, preferredWorldId?: string): Reservation {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      this.expireStale(now);

      const mine = this.sql.exec(
        `SELECT id, world_id FROM lobby_reservations WHERE user_id = ? AND status = 'pending'`, userId).toArray();
      if (mine.length) {
        const w = String(mine[0].world_id);
        return { reservationId: String(mine[0].id), worldId: w, preferred: w === preferredWorldId };
      }

      let worldId: string | null = null;
      if (preferredWorldId) {
        const p = this.sql.exec(
          'SELECT world_id FROM lobby_worlds WHERE world_id = ? AND taken + reserved < capacity', preferredWorldId).toArray();
        if (p.length) worldId = String(p[0].world_id);
      }
      if (!worldId) {
        const f = this.sql.exec('SELECT world_id FROM lobby_worlds WHERE taken + reserved < capacity ORDER BY n LIMIT 1').toArray();
        if (f.length) worldId = String(f[0].world_id);
      }
      if (!worldId) {
        const n = Number(this.sql.exec('SELECT COALESCE(MAX(n), 0) + 1 AS n FROM lobby_worlds').toArray()[0].n);
        worldId = `w${n}`;
        this.sql.exec('INSERT INTO lobby_worlds (world_id, n, capacity) VALUES (?, ?, ?)', worldId, n, WORLD_CAPACITY);
      }

      const id = crypto.randomUUID();
      this.sql.exec('UPDATE lobby_worlds SET reserved = reserved + 1 WHERE world_id = ?', worldId);
      this.sql.exec(
        `INSERT INTO lobby_reservations (id, user_id, world_id, status, expires_at, created_at) VALUES (?, ?, ?, 'pending', ?, ?)`,
        id, userId, worldId, now + RESERVATION_TTL_MS, now);
      return { reservationId: id, worldId, preferred: worldId === preferredWorldId };
    });
  }

  // Шаг 3 регистрации прошёл (World.createPlayer): резерв становится местом.
  confirm(reservationId: string): void {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.expireStale(now);
      const r = this.sql.exec('SELECT world_id, status FROM lobby_reservations WHERE id = ?', reservationId).toArray();
      if (!r.length) throw new ApiError(404, 'reservation_not_found');
      if (r[0].status === 'confirmed') return;
      if (r[0].status !== 'pending') throw new ApiError(409, 'reservation_expired');
      this.sql.exec('UPDATE lobby_worlds SET reserved = reserved - 1, taken = taken + 1 WHERE world_id = ?', String(r[0].world_id));
      this.sql.exec(`UPDATE lobby_reservations SET status = 'confirmed' WHERE id = ?`, reservationId);
    });
  }

  // Шаг 3 не прошёл: место возвращается сразу, не дожидаясь таймаута.
  release(reservationId: string): void {
    this.ctx.storage.transactionSync(() => {
      const r = this.sql.exec('SELECT world_id, status FROM lobby_reservations WHERE id = ?', reservationId).toArray();
      if (!r.length || r[0].status !== 'pending') return;
      this.sql.exec('UPDATE lobby_worlds SET reserved = reserved - 1 WHERE world_id = ?', String(r[0].world_id));
      this.sql.exec(`UPDATE lobby_reservations SET status = 'released' WHERE id = ?`, reservationId);
    });
  }

  seats() {
    return this.sql.exec('SELECT world_id, capacity, taken, reserved FROM lobby_worlds ORDER BY n').toArray();
  }

  private expireStale(now: number): void {
    const stale = this.sql.exec(`SELECT id, world_id FROM lobby_reservations WHERE status = 'pending' AND expires_at <= ?`, now).toArray();
    for (const s of stale) {
      this.sql.exec('UPDATE lobby_worlds SET reserved = reserved - 1 WHERE world_id = ?', String(s.world_id));
      this.sql.exec(`UPDATE lobby_reservations SET status = 'expired' WHERE id = ?`, String(s.id));
    }
  }
}
