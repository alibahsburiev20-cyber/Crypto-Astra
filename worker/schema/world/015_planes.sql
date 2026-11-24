-- Авиазвено (этап 6): коллекция машин, которые падают из боксов и летают патрули.
-- Это не корабли: ячейки гаража они не занимают, рейсов к планетам не делают и
-- ASTRA не приносят — закладку патруля (ресурсы и опыт) несёт в экономику таблица
-- plane_patrols. Счётчик оставлен как страховка: боксы и патрули повторов не
-- выдают, так что count обычно 1.
CREATE TABLE IF NOT EXISTS player_planes (
  player_id TEXT NOT NULL REFERENCES players (id),
  plane     TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  first_at  INTEGER NOT NULL,
  last_at   INTEGER NOT NULL,
  PRIMARY KEY (player_id, plane)
);

CREATE INDEX IF NOT EXISTS idx_player_planes_player ON player_planes (player_id);
