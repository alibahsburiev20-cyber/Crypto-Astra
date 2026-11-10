import { IDEM_TTL_MS } from '../shared/constants';
import { sha256Hex } from '../shared/sha256';
import { ApiError } from './errors';

// Повтор с тем же ключом и тем же телом возвращает сохранённый ответ и ничего не меняет.
// Тот же ключ с другим телом или маршрутом — 409. fn вызывается внутри транзакции мира.
// Если fn вернула store=false (отказ по правилам), ответ не запоминается.
export function withIdempotency<T>(
  sql: SqlStorage, playerId: string, route: string, key: string, body: unknown, now: number,
  fn: () => { value: T; store: boolean },
): T {
  if (!key || key.length > 128) throw new ApiError(400, 'idempotency_key_required');
  const bodyHash = sha256Hex(JSON.stringify(body ?? null));
  const hit = sql.exec('SELECT route, body_hash, response FROM idempotency_keys WHERE player_id = ? AND key = ?', playerId, key).toArray();
  if (hit.length) {
    if (hit[0].route !== route || hit[0].body_hash !== bodyHash) throw new ApiError(409, 'idempotency_key_reused');
    return JSON.parse(String(hit[0].response)) as T;
  }
  const { value, store } = fn();
  if (store) {
    sql.exec(
      'INSERT INTO idempotency_keys (key, player_id, route, body_hash, response, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      key, playerId, route, bodyHash, JSON.stringify(value), now,
    );
  }
  return value;
}

export function cleanupIdempotency(sql: SqlStorage, now: number): void {
  sql.exec('DELETE FROM idempotency_keys WHERE created_at < ?', now - IDEM_TTL_MS);
}
