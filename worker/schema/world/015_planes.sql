-- Авиазвено (этап 6): коллекция машин, которые падают из боксов.
-- Это не корабли: ячейки гаража они не занимают, рейсов не делают и ASTRA не
-- приносят. Счётчик нужен, чтобы дубликаты не «сгорали».
CREATE TABLE IF NOT EXISTS player_planes (
  player_id TEXT NOT NULL REFERENCES players (id),
  plane     TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  first_at  INTEGER NOT NULL,
  last_at   INTEGER NOT NULL,
  PRIMARY KEY (player_id, plane)
);

CREATE INDEX IF NOT EXISTS idx_player_planes_player ON player_planes (player_id);
