-- Гараж и журнал оператора (этапы 14–15). Зеркало worker/src/world/schema.ts.
CREATE TABLE IF NOT EXISTS garage_slots (
  player_id TEXT PRIMARY KEY REFERENCES players (id),
  extra INTEGER NOT NULL DEFAULT 0 CHECK (extra >= 0),
  updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS admin_log (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
  target TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_admin_log_at ON admin_log (created_at);
