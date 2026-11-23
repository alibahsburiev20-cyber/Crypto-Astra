-- Astra Pay Core, этап 1: схема денежного контура.
--
-- Отдельно от игрового Ledger мира и отдельно от фиатного `pool_entries`:
-- здесь только USDT TRC-20, суммы — целые микро-USDT (1 USDT = 1 000 000).
-- ASTRA и USDT не смешиваются никогда.
--
-- Таблицы создаются и кодом (`worker/src/pay/schema.ts`, `ensurePaySchema`),
-- потому что прод деплоится из браузера и `wrangler d1 migrations apply --remote`
-- оттуда не запустить. Эта миграция — канон для локальной разработки и для тех,
-- у кого есть терминал.
--
-- Следствие, из-за которого здесь везде `IF NOT EXISTS`: журнал `d1_migrations`
-- может отставать от фактической схемы (таблицы уже есть, записи о миграции нет).
-- Повторный прогон на такой базе должен быть no-op, иначе T1 превращается в
-- «удалить и создать заново» — а это потеря данных.
--
-- Деньги по умолчанию выключены: таблицы есть, операций нет.

CREATE TABLE IF NOT EXISTS pay_addresses (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL UNIQUE,
  address          TEXT NOT NULL UNIQUE,
  hex              TEXT NOT NULL UNIQUE,
  derivation_index INTEGER NOT NULL UNIQUE,
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  -- До какого времени мы уже просмотрели историю этого адреса (курсор монитора).
  last_scanned_ts  INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pay_addresses_active ON pay_addresses (active, created_at);

CREATE TABLE IF NOT EXISTS pay_invoices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  product_id   TEXT,
  amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
  status       TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'paid', 'expired', 'cancelled', 'manual')),
  address      TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  paid_at      INTEGER,
  deposit_txid TEXT
);

-- Один активный счёт на игрока: два открытых счёта — путь к двойной оплате.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_invoices_open ON pay_invoices (user_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS pay_chain_blocks (
  height         INTEGER PRIMARY KEY,
  block_id       TEXT NOT NULL,
  parent_id      TEXT NOT NULL DEFAULT '',
  solidified_at  INTEGER,
  processed_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pay_chain_events (
  txid         TEXT NOT NULL,
  event_index  INTEGER NOT NULL,
  block_height INTEGER NOT NULL,
  block_time   INTEGER,
  from_addr    TEXT NOT NULL,
  to_addr      TEXT NOT NULL,
  contract     TEXT NOT NULL,
  amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
  status       TEXT NOT NULL DEFAULT 'success',
  raw          TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (txid, event_index)
);

CREATE INDEX IF NOT EXISTS idx_pay_chain_events_block ON pay_chain_events (block_height);
CREATE INDEX IF NOT EXISTS idx_pay_chain_events_to ON pay_chain_events (to_addr, block_height);

CREATE TABLE IF NOT EXISTS pay_deposits (
  id            TEXT PRIMARY KEY,
  txid          TEXT NOT NULL,
  event_index   INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  address       TEXT NOT NULL,
  amount_micro  INTEGER NOT NULL CHECK (amount_micro > 0),
  confirmations INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected', 'confirmed', 'credited', 'manual', 'ignored')),
  credited_at   INTEGER,
  created_at    INTEGER NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  UNIQUE (txid, event_index)
);

CREATE INDEX IF NOT EXISTS idx_pay_deposits_user ON pay_deposits (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_deposits_status ON pay_deposits (status, created_at);

-- Финансовый Ledger. Append-only: исправление — новая строка с обратным знаком.
CREATE TABLE IF NOT EXISTS pay_ledger (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  asset      TEXT NOT NULL DEFAULT 'USDT' CHECK (asset = 'USDT'),
  delta      INTEGER NOT NULL CHECK (delta <> 0),
  reason     TEXT NOT NULL
    CHECK (reason IN ('deposit', 'purchase', 'payout', 'fee', 'adjust', 'pool', 'sweep')),
  source_ref TEXT NOT NULL DEFAULT '',
  idem_key   TEXT NOT NULL UNIQUE,
  prev_hash  TEXT NOT NULL DEFAULT '',
  hash       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pay_ledger_user ON pay_ledger (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_ledger_reason ON pay_ledger (reason, created_at);

CREATE TRIGGER IF NOT EXISTS pay_ledger_no_update BEFORE UPDATE ON pay_ledger
  BEGIN SELECT RAISE(ABORT, 'pay ledger is append-only'); END;

CREATE TRIGGER IF NOT EXISTS pay_ledger_no_delete BEFORE DELETE ON pay_ledger
  BEGIN SELECT RAISE(ABORT, 'pay ledger is append-only'); END;

CREATE TABLE IF NOT EXISTS pay_products (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('cosmetic', 'premium', 'service')),
  title        TEXT NOT NULL,
  price_micro  INTEGER NOT NULL CHECK (price_micro > 0),
  catalog_json TEXT NOT NULL DEFAULT '{}',
  enabled      INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  season_id    TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pay_entitlements (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  granted_at  INTEGER NOT NULL,
  expires_at  INTEGER,
  payload     TEXT NOT NULL DEFAULT '{}',
  UNIQUE (user_id, purchase_id)
);

-- Циклы пула в USDT: Available = confirmed_in - reserved - paid - locked.
CREATE TABLE IF NOT EXISTS pay_pool_cycles (
  id            TEXT PRIMARY KEY,
  period_start  INTEGER NOT NULL,
  period_end    INTEGER NOT NULL,
  confirmed_in  INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_in >= 0),
  ops_reserved  INTEGER NOT NULL DEFAULT 0 CHECK (ops_reserved >= 0),
  prize_budget  INTEGER NOT NULL DEFAULT 0 CHECK (prize_budget >= 0),
  reserved      INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  paid          INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  locked        INTEGER NOT NULL DEFAULT 0 CHECK (locked >= 0),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_pool_cycles_open ON pay_pool_cycles (status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS pay_withdrawals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  address      TEXT NOT NULL,
  amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
  fee_micro    INTEGER NOT NULL DEFAULT 0 CHECK (fee_micro >= 0),
  status       TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'reserved', 'broadcasting',
                      'sent', 'confirmed', 'failed', 'manual')),
  idem_key     TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  decided_at   INTEGER,
  txid         TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_pay_withdrawals_user ON pay_withdrawals (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_withdrawals_status ON pay_withdrawals (status, created_at);

CREATE TABLE IF NOT EXISTS pay_payouts (
  id            TEXT PRIMARY KEY,
  withdrawal_id TEXT NOT NULL,
  attempt       INTEGER NOT NULL CHECK (attempt >= 1),
  txid          TEXT,
  signed_at     INTEGER,
  broadcast_at  INTEGER,
  solidified_at INTEGER,
  result        TEXT NOT NULL DEFAULT '',
  error         TEXT NOT NULL DEFAULT '',
  UNIQUE (withdrawal_id, attempt)
);

CREATE TABLE IF NOT EXISTS pay_treasury (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('hot', 'cold', 'deposit')),
  address       TEXT NOT NULL,
  balance_micro INTEGER NOT NULL DEFAULT 0 CHECK (balance_micro >= 0),
  energy        INTEGER NOT NULL DEFAULT 0,
  bandwidth     INTEGER NOT NULL DEFAULT 0,
  trx_micro     INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  UNIQUE (kind, address)
);

CREATE TABLE IF NOT EXISTS pay_operations (
  scope        TEXT NOT NULL,
  idem_key     TEXT NOT NULL,
  user_id      TEXT,
  request_hash TEXT NOT NULL DEFAULT '',
  response     TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (scope, idem_key)
);

CREATE TABLE IF NOT EXISTS pay_audit_log (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pay_audit_log_created ON pay_audit_log (created_at);

CREATE TRIGGER IF NOT EXISTS pay_audit_log_no_update BEFORE UPDATE ON pay_audit_log
  BEGIN SELECT RAISE(ABORT, 'pay audit log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS pay_audit_log_no_delete BEFORE DELETE ON pay_audit_log
  BEGIN SELECT RAISE(ABORT, 'pay audit log is append-only'); END;
