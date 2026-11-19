-- Этап 3: сезоны, итоги закрытия и снимки мира.
-- Очки сезона не хранятся здесь: это актив `points` в balances и Ledger.
CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE,
  starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  closed_at INTEGER, players INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0);

CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons (status, number);

CREATE TABLE IF NOT EXISTS season_results (
  season_id TEXT NOT NULL REFERENCES seasons (id), player_id TEXT NOT NULL,
  rank INTEGER NOT NULL, points INTEGER NOT NULL, level INTEGER NOT NULL,
  xp INTEGER NOT NULL, reward INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (season_id, player_id));

CREATE INDEX IF NOT EXISTS idx_season_results_rank ON season_results (season_id, rank);

CREATE TABLE IF NOT EXISTS season_snapshots (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, season_id TEXT,
  created_at INTEGER NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
  head_seq INTEGER, head_hash TEXT, ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  exported INTEGER NOT NULL DEFAULT 0 CHECK (exported IN (0, 1)), payload TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_season_snapshots_pending ON season_snapshots (exported, created_at);
