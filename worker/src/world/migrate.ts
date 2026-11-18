import { applyDelta } from './balances';
import { appendLedger } from './ledger';

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

// Срез 1 этапа 2. Мир мог накопить ресурсы до того, как они начали попадать
// в журнал. Без обратной заливки первая же сверка увидит расхождение и заморозит
// мир, поэтому пишем по одной записи reason=migration на каждый остаток.
export function backfillResourceLedger(sql: SqlStorage, now: number): void {
  const done = sql.exec(`SELECT value FROM meta WHERE key = 'mig_resource_ledger'`).toArray();
  if (done.length && String(done[0].value) === '1') return;
  const hasResources = sql.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'resources'`).toArray().length > 0;
  if (hasResources) {
    const rows = sql.exec('SELECT player_id, resource, amount FROM resources WHERE amount > 0').toArray();
    for (const row of rows) {
      const journaled = sql.exec(
        'SELECT 1 FROM ledger WHERE player_id = ? AND asset = ? LIMIT 1',
        String(row.player_id), `res:${String(row.resource)}`,
      ).toArray();
      if (journaled.length) continue;
      appendLedger(sql, {
        playerId: String(row.player_id),
        asset: `res:${String(row.resource)}`,
        delta: Number(row.amount),
        reason: 'migration',
        sourceRef: 'backfill',
      }, now);
    }
  }
  sql.exec(
    `INSERT INTO meta (key, value) VALUES ('mig_resource_ledger', '1')
     ON CONFLICT (key) DO UPDATE SET value = '1'`,
  );
}
