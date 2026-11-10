CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  password_hash TEXT,
  telegram_id   TEXT UNIQUE,
  world_id      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'blocked', 'deleted')),
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_users_world ON users (world_id);
