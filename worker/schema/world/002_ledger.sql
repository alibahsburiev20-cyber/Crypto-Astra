-- Журнал только на добавление, с хеш-цепочкой.
CREATE TABLE ledger (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  TEXT NOT NULL,
  asset      TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  source_ref TEXT,
  idem_key   TEXT,
  created_at INTEGER NOT NULL,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL
);

CREATE INDEX idx_ledger_player ON ledger (player_id, asset);

CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
