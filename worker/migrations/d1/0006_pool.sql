-- Этап 5, срезы 5.1–5.2: учёт пула и публичный отчёт.
-- Пул — это деньги на призы и операции, а не игровая валюта. ASTRA живёт в Ledger
-- мира и с этой таблицей не связана: купить или вывести ASTRA нельзя.
-- Таблица append-only: исправление — новая запись с обратным знаком, а не правка.

CREATE TABLE pool_entries (
  id          TEXT PRIMARY KEY,
  -- in  — взнос в пул; out — выплата приза; ops — расходы на операции.
  kind        TEXT NOT NULL CHECK (kind IN ('in', 'out', 'ops')),
  -- Сумма в минимальных единицах валюты: для EUR/USD — центы.
  amount      INTEGER NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL CHECK (currency IN ('EUR', 'USD')),
  -- Внешний идентификатор операции (номер платежа у провайдера). Уникален:
  -- повторная запись того же платежа не удвоит отчёт.
  ref         TEXT NOT NULL UNIQUE,
  -- Публичное пояснение. Публикуется на /pool.html без имён и адресов.
  note        TEXT NOT NULL DEFAULT '',
  season_id   TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_pool_entries_created ON pool_entries (created_at);
CREATE INDEX idx_pool_entries_kind ON pool_entries (kind, created_at);

CREATE TRIGGER pool_entries_no_update BEFORE UPDATE ON pool_entries
  BEGIN SELECT RAISE(ABORT, 'pool entries are append-only'); END;

CREATE TRIGGER pool_entries_no_delete BEFORE DELETE ON pool_entries
  BEGIN SELECT RAISE(ABORT, 'pool entries are append-only'); END;
