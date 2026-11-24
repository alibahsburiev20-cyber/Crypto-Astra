-- Боксы (этап 5): таймеры бесплатных и журнал открытий.
CREATE TABLE IF NOT EXISTS box_state (
  player_id    TEXT NOT NULL REFERENCES players (id),
  box          TEXT NOT NULL,
  last_open_at INTEGER NOT NULL,
  opens        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, box)
);

CREATE TABLE IF NOT EXISTS box_opens (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players (id),
  box        TEXT NOT NULL,
  seed       TEXT NOT NULL,
  cost       INTEGER NOT NULL,
  drops_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_box_opens_player ON box_opens (player_id, created_at);
