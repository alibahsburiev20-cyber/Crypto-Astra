-- Справочная копия схемы мира. Рабочая версия — worker/src/world/schema.ts.
-- Очередь крафта: один слот на игрока (второй будет за Astra Pass).
CREATE TABLE IF NOT EXISTS craft_jobs (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players (id),
  recipe     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done')),
  started_at INTEGER NOT NULL,
  ends_at    INTEGER NOT NULL,
  fee        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_craft_player ON craft_jobs (player_id, status);
