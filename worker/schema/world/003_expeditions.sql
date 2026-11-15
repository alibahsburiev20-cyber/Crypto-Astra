-- Рабочая копия с IF NOT EXISTS — worker/src/world/schema.ts.
-- Существующий мир получает эти таблицы при следующем старте объекта.

CREATE TABLE IF NOT EXISTS expeditions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players (id),
  ship_id TEXT NOT NULL,
  planet TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('short', 'medium', 'long')),
  status TEXT NOT NULL CHECK (status IN ('flying', 'waiting_choice', 'completed', 'cancelled')),
  seed TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  fuel_spent INTEGER NOT NULL,
  event_bonus_bp INTEGER NOT NULL DEFAULT 1000,
  extra_wear INTEGER NOT NULL DEFAULT 0,
  reward_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expeditions_player ON expeditions (player_id, status);

CREATE TABLE IF NOT EXISTS expedition_events (
  id TEXT PRIMARY KEY,
  expedition_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,
  opens_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'waiting', 'resolved')),
  choice TEXT,
  UNIQUE (expedition_id, idx)
);

CREATE TABLE IF NOT EXISTS daily_counters (
  player_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  expeditions INTEGER NOT NULL DEFAULT 0,
  fuel_bought INTEGER NOT NULL DEFAULT 0,
  points_gained INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day)
);
