-- Мини-игра «Астероидный залп» (этап 13). Зеркало worker/src/world/schema.ts.
CREATE TABLE IF NOT EXISTS minigame_runs (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players (id),
  seed INTEGER NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished', 'expired')),
  score INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0,
  picks INTEGER NOT NULL DEFAULT 0, win INTEGER NOT NULL DEFAULT 0,
  astra INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_minigame_runs_player ON minigame_runs (player_id, status, started_at);

CREATE TABLE IF NOT EXISTS minigame_daily (
  player_id TEXT NOT NULL, day INTEGER NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  astra INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day));

CREATE TABLE IF NOT EXISTS minigame_awards (
  player_id TEXT NOT NULL, award TEXT NOT NULL, wins INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (player_id, award));
