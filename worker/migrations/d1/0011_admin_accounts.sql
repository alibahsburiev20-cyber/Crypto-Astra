-- Админ-доступы: «младший админ по ссылке и ключу» и журнал админ-действий.
--
-- Почему это в D1, а не в секретах Worker. Секрет `ADMIN_TOKEN` — один на весь
-- воркер: им владеет владелец, и «отозвать» его можно только перевыпустив секрет
-- (что выкинет из админки всех сразу). Чтобы позвать помощника и иметь возможность
-- выключить именно его, ключ обязан быть строкой в базе: своя запись, свой срок,
-- своя отмена, свой журнал.
--
-- Почему `key_hash`, а не `key`. Ключ выдаётся один раз и больше нигде не
-- показывается: в базе лежит только SHA-256 от него. Отдельный pepper или HMAC
-- не нужны: это не пароль человека, который могут придумать коротким, а 32
-- случайных байта — перебирать нечего. Хранить сам ключ в базе было бы ошибкой:
-- дамп D1 не должен превращаться в список действующих доступов.
--
-- `grant_limit` — потолок одной выдачи/списания ASTRA для этого доступа. Он здесь,
-- а не в коде, потому что смысл у него хозяйственный: «помощнику — до 5 000,
-- себе — без потолка», и менять это должно решение владельца, а не релиз.
--
-- `admin_audit` — то, чего раньше не было: действия в админке писались только в
-- журнал мира (`admin_log` внутри DO), а отзывы доступов и закрытия аккаунтов —
-- нигде. Отдельная таблица в D1, потому что эти события вне конкретного мира.

CREATE TABLE IF NOT EXISTS admin_accounts (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'junior' CHECK (role IN ('owner', 'junior')),
  key_hash     TEXT UNIQUE,
  email        TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  grant_limit  INTEGER NOT NULL DEFAULT 5000 CHECK (grant_limit BETWEEN 1 AND 20000),
  created_at   INTEGER NOT NULL,
  created_by   TEXT NOT NULL DEFAULT 'owner',
  expires_at   INTEGER,
  last_used_at INTEGER,
  last_ip      TEXT,
  revoked_at   INTEGER,
  note         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_admin_accounts_status ON admin_accounts (status, expires_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  actor_role TEXT NOT NULL DEFAULT 'owner',
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  payload    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit (created_at DESC);
