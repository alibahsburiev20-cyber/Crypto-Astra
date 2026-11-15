import { applyDelta } from './balances';

// Короткая версия рейса (status active/collected, колонка sector) уже могла создаться в живом мире.
// Возвращаем топливо за незавершённый рейс и пересоздаём таблицу под схему с планетами.
export function migrateLegacyExpeditions(sql: SqlStorage, now: number): void {
  const cols = sql.exec('PRAGMA table_info(expeditions)').toArray();
  if (!cols.length) return;
  const names = new Set(cols.map((c) => String(c.name)));
  if (names.has('planet') || !names.has('sector')) return;

  const active = sql.exec(`SELECT id, player_id, ship_id FROM expeditions WHERE status = 'active'`).toArray();
  for (const row of active) {
    applyDelta(sql, {
      playerId: String(row.player_id), asset: 'fuel', delta: 1,
      reason: 'expedition_cancel', sourceRef: String(row.id),
    }, now);
    sql.exec(`UPDATE ships SET status = 'idle' WHERE id = ?`, String(row.ship_id));
  }
  sql.exec(`UPDATE ships SET status = 'idle' WHERE status = 'away'`);
  sql.exec('DROP TABLE expeditions');
}
