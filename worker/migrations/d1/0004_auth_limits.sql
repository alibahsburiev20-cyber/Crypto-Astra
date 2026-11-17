-- Счётчики неудачных входов и регистраций. Ключи: login_ip:<ip>, login_email:<sha256(email)>,
-- register_ip:<ip>. Таблица нужна только для ограничения частоты; истёкшие строки удаляет cron.
CREATE TABLE auth_limits (
  key           TEXT PRIMARY KEY,
  attempts      INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_auth_limits_blocked ON auth_limits (blocked_until);
