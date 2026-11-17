-- Справочная копия схемы мира. Рабочая версия — worker/src/world/schema.ts.
-- claim_state создавалась только в коде и выпадала из этого каталога.
CREATE TABLE IF NOT EXISTS claim_state (
  player_id     TEXT PRIMARY KEY REFERENCES players (id),
  last_claim_at INTEGER NOT NULL,
  day           INTEGER NOT NULL,
  count         INTEGER NOT NULL
);
