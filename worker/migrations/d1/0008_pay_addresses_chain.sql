-- Astra Pay, этап 1 переезда: у адреса появляется сеть.
--
-- До этой миграции `pay_addresses` имела `user_id UNIQUE` на уровне таблицы:
-- «один адрес на игрока вообще». Для переезда TRON -> BSC этого мало — нужно,
-- чтобы у одного игрока жило по адресу на цепь (старый не выбрасываем: на нём
-- лежат деньги и его сканирует старая цепь), а гарантия неповторимости адреса
-- оставалась в силе внутри сети.
--
-- SQLite не умеет ни выбрасывать инлайн-UNIQUE, ни добавлять колонку с CHECK
-- одним ALTER, поэтому единственная корректная форма — перестройка таблицы:
-- создать новую, скопировать, старую удалить, переименовать. Так делают и
-- официальные миграции SQLite.
--
-- `derivation_index` остаётся глобально уникальным и копируется как есть:
-- одному индексу семени соответствует ровно один адрес, поэтому адрес второй
-- цепи для игрока выдаётся СЛЕДУЮЩИМ свободным индексом, а не тем же номером.
-- Повторить индекс — значит выдать двум игрокам одну и ту же цепочку адресов
-- в разных сетях и потерять границу «адрес -> игрок».
--
-- Все запросы `IF NOT EXISTS`/`IF EXISTS`: журнал `d1_migrations` в проде
-- отстает от фактической схемы (см. шапку 0007), и прогон по базе, где колонка
-- уже есть (её добавил код `ensurePaySchema`), обязан быть no-op.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS pay_addresses_new (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  chain            TEXT NOT NULL DEFAULT 'tron' CHECK (chain IN ('tron', 'bsc')),
  address          TEXT NOT NULL UNIQUE,
  hex              TEXT NOT NULL UNIQUE,
  derivation_index INTEGER NOT NULL UNIQUE,
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_scanned_ts  INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);

-- Метку сети берём не «на глаз по истории», а из самого адреса: `0x` существует
-- только в EVM, `T` — только в TRON (тот же критерий, что и `addressChain()` в
-- коде). Это делает повторный прогон безвредным: если в таблице уже успели
-- появиться BSC-адреса, они получат свою метку, а не «tron по умолчанию».
INSERT OR IGNORE INTO pay_addresses_new (
  id, user_id, chain, address, hex, derivation_index, active, last_scanned_ts, created_at
)
SELECT id, user_id,
       CASE WHEN address LIKE '0x%' THEN 'bsc' ELSE 'tron' END,
       address, hex, derivation_index, active, last_scanned_ts, created_at
  FROM pay_addresses;

DROP TABLE IF EXISTS pay_addresses;

ALTER TABLE pay_addresses_new RENAME TO pay_addresses;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_addresses_user_chain ON pay_addresses (user_id, chain);
CREATE INDEX IF NOT EXISTS idx_pay_addresses_active ON pay_addresses (active, created_at);

PRAGMA foreign_keys = ON;

-- Проверка, которую стоит глазами прочитать до включения приёма:
--   1) строк стало не меньше, чем было;
--   2) у одного игрока не появилось двух адресов одной цепи;
--   3) `derivation_index` по-прежнему уникален.
-- SELECT COUNT(*) AS total, COUNT(DISTINCT user_id) AS users,
--        COUNT(DISTINCT derivation_index) AS indexes FROM pay_addresses;
