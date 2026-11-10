import { CLAIM_INTERVAL_MS, START_ASTRA, START_FUEL, WORLD_CAPACITY } from '../../shared/constants';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';

export function playerExists(sql: SqlStorage, playerId: string): boolean {
  return sql.exec('SELECT 1 FROM players WHERE id = ?', playerId).toArray().length > 0;
}

// Вызывать внутри транзакции. Повторный вызов безопасен.
export function createPlayer(sql: SqlStorage, playerId: string, now: number): { created: boolean } {
  if (!playerId) throw new ApiError(400, 'player_id_required');
  if (playerExists(sql, playerId)) return { created: false };
  const n = Number(sql.exec('SELECT COUNT(*) AS c FROM players').toArray()[0].c);
  if (n >= WORLD_CAPACITY) throw new ApiError(409, 'world_full');

  sql.exec('INSERT INTO players (id, level, xp, created_at) VALUES (?, 1, 0, ?)', playerId, now);
  sql.exec(`INSERT INTO balances (player_id, asset, amount, version) VALUES (?, 'points', 0, 0)`, playerId);
  sql.exec(`INSERT INTO ships (id, player_id, type, durability, status) VALUES (?, ?, 'scout', 100, 'idle')`, crypto.randomUUID(), playerId);
  applyDelta(sql, { playerId, asset: 'astra', delta: START_ASTRA, reason: 'start_bonus', sourceRef: 'start' }, now);
  applyDelta(sql, { playerId, asset: 'fuel', delta: START_FUEL, reason: 'start_bonus', sourceRef: 'start' }, now);
  return { created: true };
}

export function getPlayerState(sql: SqlStorage, playerId: string) {
  const p = sql.exec('SELECT id, level, xp, guild_id, created_at FROM players WHERE id = ?', playerId).toArray();
  if (!p.length) throw new ApiError(404, 'player_not_found');
  const c = sql.exec('SELECT last_claim_at FROM claim_state WHERE player_id = ?', playerId).toArray();
  return {
    id: playerId, level: Number(p[0].level), xp: Number(p[0].xp),
    balances: {
      astra: getBalance(sql, playerId, 'astra'), fuel: getBalance(sql, playerId, 'fuel'), points: getBalance(sql, playerId, 'points'),
    },
    ships: sql.exec('SELECT id, type, durability, status FROM ships WHERE player_id = ?', playerId).toArray(),
    nextClaimAt: c.length ? Number(c[0].last_claim_at) + CLAIM_INTERVAL_MS : null,
  };
}
