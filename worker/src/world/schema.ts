// Схема мира. Зеркалит worker/schema/world/*.sql, но с IF NOT EXISTS: применяется при старте объекта.
// Каждый элемент — одна инструкция (в триггерах есть «;» внутри BEGIN...END).
export const WORLD_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS players (
     id TEXT PRIMARY KEY, level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0,
     guild_id TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS balances (
     player_id TEXT NOT NULL REFERENCES players (id),
     asset TEXT NOT NULL CHECK (asset IN ('astra', 'fuel', 'points')),
     amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
     version INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (player_id, asset))`,
  `CREATE TABLE IF NOT EXISTS ships (
     id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players (id), type TEXT NOT NULL,
     durability INTEGER NOT NULL DEFAULT 100 CHECK (durability BETWEEN 0 AND 100),
     status TEXT NOT NULL DEFAULT 'idle')`,
  `CREATE TABLE IF NOT EXISTS resources (
     player_id TEXT NOT NULL REFERENCES players (id), resource TEXT NOT NULL,
     amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
     PRIMARY KEY (player_id, resource))`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     key TEXT NOT NULL, player_id TEXT NOT NULL, route TEXT NOT NULL, body_hash TEXT NOT NULL,
     response TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY (player_id, key))`,
  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY, run_at INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
     attempts INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs (status, run_at)`,
  `CREATE TABLE IF NOT EXISTS claim_state (
     player_id TEXT PRIMARY KEY REFERENCES players (id),
     last_claim_at INTEGER NOT NULL, day INTEGER NOT NULL, count INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ledger (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, asset TEXT NOT NULL,
     delta INTEGER NOT NULL, reason TEXT NOT NULL, source_ref TEXT, idem_key TEXT,
     created_at INTEGER NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_player ON ledger (player_id, asset)`,
  `CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
     BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
     BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END`,
];
