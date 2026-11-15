CREATE TABLE expeditions (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players (id), ship_id TEXT NOT NULL REFERENCES ships (id),
  kind TEXT NOT NULL CHECK (kind IN ('short', 'medium', 'long')), sector INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'collected')),
  reward_astra INTEGER, collected_at INTEGER);
CREATE INDEX idx_expeditions_player ON expeditions (player_id, status);
