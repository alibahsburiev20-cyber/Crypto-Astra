CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE players (
  id         TEXT PRIMARY KEY,
  level      INTEGER NOT NULL DEFAULT 1,
  xp         INTEGER NOT NULL DEFAULT 0,
  guild_id   TEXT,
  created_at INTEGER NOT NULL
);

-- Рабочий кэш. Истина находится в ledger.
CREATE TABLE balances (
  player_id TEXT NOT NULL REFERENCES players (id),
  asset     TEXT NOT NULL CHECK (asset IN ('astra', 'fuel', 'points')),
  amount    INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  version   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, asset)
);

CREATE TABLE ships (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players (id),
  type       TEXT NOT NULL,
  durability INTEGER NOT NULL DEFAULT 100 CHECK (durability BETWEEN 0 AND 100),
  status     TEXT NOT NULL DEFAULT 'idle'
);

CREATE TABLE resources (
  player_id TEXT NOT NULL REFERENCES players (id),
  resource  TEXT NOT NULL,
  amount    INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (player_id, resource)
);

CREATE TABLE idempotency_keys (
  key        TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  route      TEXT NOT NULL,
  body_hash  TEXT NOT NULL,
  response   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, key)
);

CREATE TABLE jobs (
  id       TEXT PRIMARY KEY,
  run_at   INTEGER NOT NULL,
  kind     TEXT NOT NULL,
  payload  TEXT NOT NULL,
  status   TEXT NOT NULL DEFAULT 'pending'
           CHECK (status IN ('pending', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_jobs_due ON jobs (status, run_at);
