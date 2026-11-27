-- 0012: журнал сборов (sweep) с депозитных адресов в EVM.
--
-- План сбора (`/admin/pay/sweep/plan`) был и раньше, но он только читал баланс
-- и ничего не подписывал. Исполнение обязано иметь свой журнал по той же причине, по какой у
-- выплат есть `pay_withdrawals`: между «мы решили увести 40 USDT с адреса» и
-- «сеть приняла транзакцию» есть окно, в котором процесс может умереть. Без
-- строки в базе это окно превращается в «повторить с тем же nonce? а вдруг
-- первая ушла» — то есть в двойное списание или в вечный `queued`.
--
-- Что здесь принципиально:
--
--   * `chain` и `contract` — пара, а не «возьмём активную сеть»: адрес игрока в
--     BNB Chain и в Polygon выглядит одинаково (то же семя, тот же индекс), и
--     «уточнили не ту сеть» означает «увели не в тот токен».
--   * `amount_micro` фиксируется в момент сборки и больше не меняется: пересчёт
--     «а теперь на адресе столько-то» — это способ увести лишнее, когда игрок
--     успел перевести ещё.
--   * `destination` — куда увели. Сверяется с `PAY_HOT_ADDRESS` и с
--     `SIGNER_SWEEP_DESTINATION` на другой стороне; записать одно, отправить в
--     другое не получится: подпись не выдадут.
--   * `idem_key` UNIQUE — «нажали кнопку дважды» обязано дать ту же строку, а не
--     второй перевод.
--   * сумма, адрес, сеть и получатель неизменяемы (триггер ниже): движется только
--     `status`, `txid` и отметки времени. Иначе «поправим сумму на лету»
--     превращает журнал в черновик.
--
-- Баланс игрока этот журнал не трогает и не должен: деньги зачтены по событию
-- сети (`pay_deposits` → `pay_ledger`), а сбор — это перекладывание USDT внутри
-- нашего хранения. Проводка `adjust` сюда не пишется, и ровно поэтому списать
-- чужой баланс «случайной сборкой» невозможно.

CREATE TABLE IF NOT EXISTS pay_sweeps (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL CHECK (chain IN ('bsc', 'polygon')),
  address TEXT NOT NULL,
  user_id TEXT,
  derivation_index INTEGER NOT NULL CHECK (derivation_index >= 0),
  contract TEXT NOT NULL,
  destination TEXT NOT NULL,
  amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
  gas_limit INTEGER NOT NULL CHECK (gas_limit > 0),
  max_fee_wei TEXT NOT NULL DEFAULT '',
  nonce INTEGER,
  txid TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'broadcasting', 'sent', 'confirmed', 'failed')),
  error TEXT NOT NULL DEFAULT '',
  idem_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pay_sweeps_status ON pay_sweeps (status, created_at);
CREATE INDEX IF NOT EXISTS idx_pay_sweeps_address ON pay_sweeps (chain, address, created_at);

CREATE TRIGGER IF NOT EXISTS pay_sweeps_intent_immutable
  BEFORE UPDATE OF chain, address, user_id, derivation_index, contract, destination, amount_micro, idem_key
  ON pay_sweeps
  BEGIN SELECT RAISE(ABORT, 'pay_sweeps intent is immutable'); END;
