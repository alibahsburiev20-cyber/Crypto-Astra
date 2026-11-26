-- 0009: у адреса появляется Polygon.
--
-- `0008` закрыла `pay_addresses.chain` списком `('tron','bsc')`. С второй
-- EVM-рельсой этого мало: первая же polygon-строка упала бы
-- `CHECK constraint failed`, и игрок получил бы 502 вместо адреса — при том,
-- что вся остальная конфигурация верна.
--
-- CHECK в SQLite ослабить на месте нельзя, поэтому таблица перестраивается тем же
-- способом, что и в 0008: чистая заготовка → копирование → удаление старой →
-- переименование. `batch`/один файл = одна транзакция, так что «таблицу сняли, а
-- новую не создали» невозможно.
--
-- Все `CREATE` — с `IF NOT EXISTS`, повторный прогон безвреден: прод деплоится из
-- браузера, и `d1 migrations apply` могут запустить на базе, где таблицу уже
-- перестроил код (`upgradePayAddressChains` следит за формой CHECK сам).

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS pay_addresses_new (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  chain            TEXT NOT NULL DEFAULT 'tron' CHECK (chain IN ('tron', 'bsc', 'polygon')),
  address          TEXT NOT NULL UNIQUE,
  hex              TEXT NOT NULL UNIQUE,
  derivation_index INTEGER NOT NULL UNIQUE,
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_scanned_ts  INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);

-- Копия идёт как есть: метки сетей уже проставлены (0008), ничего не пересчитываем.
-- `INSERT` без `OR IGNORE` — при любом конфликте падает вся пачка, а не «тихо
-- потеряла строку»: потерянный адрес = потерянные деньги игрока.
INSERT INTO pay_addresses_new (
  id, user_id, chain, address, hex, derivation_index, active, last_scanned_ts, created_at
)
SELECT id, user_id, chain, address, hex, derivation_index, active, last_scanned_ts, created_at
  FROM pay_addresses;

DROP TABLE IF EXISTS pay_addresses;

ALTER TABLE pay_addresses_new RENAME TO pay_addresses;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_addresses_user_chain ON pay_addresses (user_id, chain);
CREATE INDEX IF NOT EXISTS idx_pay_addresses_active ON pay_addresses (active, created_at);

PRAGMA foreign_keys = ON;
