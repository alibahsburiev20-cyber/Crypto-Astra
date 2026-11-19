-- Этап 3: глобальная история сезонов и архив снимков миров.
-- В D1 попадают только итоги закрытых сезонов и снимки для аудита: игровые
-- данные живут в Durable Object, здесь — отчётность и резервные копии.

CREATE TABLE season_history (
  world_id       TEXT NOT NULL,
  season_id      TEXT NOT NULL,
  season_number  INTEGER NOT NULL,
  starts_at      INTEGER NOT NULL,
  ends_at        INTEGER NOT NULL,
  closed_at      INTEGER NOT NULL,
  players        INTEGER NOT NULL,
  points_total   INTEGER NOT NULL,
  rewards_total  INTEGER NOT NULL,
  top_json       TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (world_id, season_id)
);

CREATE INDEX idx_season_history_closed ON season_history (closed_at);

CREATE TABLE world_snapshots (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  season_id   TEXT,
  created_at  INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  storage     TEXT NOT NULL CHECK (storage IN ('r2', 'd1')),
  r2_key      TEXT,
  head_seq    INTEGER,
  head_hash   TEXT,
  ok          INTEGER NOT NULL,
  payload     TEXT
);

CREATE INDEX idx_world_snapshots_world ON world_snapshots (world_id, created_at);
