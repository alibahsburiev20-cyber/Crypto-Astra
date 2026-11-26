-- 0010: у заявки на выплату появляется своя сеть.
--
-- Пока рельс был один, «в какой сети платить» следовало из `PAY_CHAIN`. С двумя
-- EVM-сетями это опасная догадка: адрес игрока в BNB Chain и в Polygon выглядит
-- одинаково (семя и индекс те же), поэтому «берём активную сеть» означает
-- «выплата уехала не туда» — и молча: txid настоящий, баланс списан, а
-- подтверждение сверка никогда не увидит: оно ищет перевод в другой сети. Отсюда колонка: сеть
-- фиксируется в момент заявки и больше не меняется.
--
-- `ALTER TABLE ... ADD COLUMN chain` здесь не подходит: колонка нужна в середине
-- списка и с CHECK (SQLite не умеет ни то, ни другое на существующей таблице),
-- поэтому перестройка — тот же приём, что 0008/0009.
--
-- Старые строки получают метку из формата адреса: `0x…` — EVM (тогда она была
-- одна, BNB Chain), `T…` — TRON. Угадывать нечем, формат и есть запись.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS pay_withdrawals_new (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  address      TEXT NOT NULL,
  chain        TEXT NOT NULL DEFAULT 'tron' CHECK (chain IN ('tron', 'bsc', 'polygon')),
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

INSERT INTO pay_withdrawals_new (
  id, user_id, address, chain, amount_micro, fee_micro, status, idem_key, created_at, decided_at, txid
)
SELECT id, user_id, address,
       CASE WHEN address LIKE '0x%' THEN 'bsc' ELSE 'tron' END,
       amount_micro, fee_micro, status, idem_key, created_at, decided_at, txid
  FROM pay_withdrawals;

DROP TABLE IF EXISTS pay_withdrawals;

ALTER TABLE pay_withdrawals_new RENAME TO pay_withdrawals;

CREATE INDEX IF NOT EXISTS idx_pay_withdrawals_user ON pay_withdrawals (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_withdrawals_status ON pay_withdrawals (status, created_at);

PRAGMA foreign_keys = ON;
