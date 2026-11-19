-- Этап 4 «Социальное»: гильдии, рефералы, миссии и Astra Pass.
-- Всё живёт внутри мира (Durable Object): это игровые данные, а не отчётность.
-- Глобальная D1 здесь не участвует — гильдии и рефералы не выходят за пределы мира.

CREATE TABLE IF NOT EXISTS guilds (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tag         TEXT NOT NULL,
  leader_id   TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_members (
  player_id TEXT PRIMARY KEY,
  guild_id  TEXT NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('leader', 'officer', 'member')),
  joined_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members (guild_id);

CREATE TABLE IF NOT EXISTS referral_codes (
  player_id  TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referrals (
  id           TEXT PRIMARY KEY,
  inviter_id   TEXT NOT NULL,
  invitee_id   TEXT NOT NULL UNIQUE,
  code         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified')),
  created_at   INTEGER NOT NULL,
  qualified_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals (inviter_id, status);

-- Прогресс миссий не хранится: он считается по журналу и таблицам игры,
-- поэтому подделать его из клиента нельзя. Здесь только отметки о награде.
CREATE TABLE IF NOT EXISTS mission_claims (
  player_id  TEXT NOT NULL,
  period     TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, period, mission_id)
);

-- Уровни Pass привязаны к сезону: в новом сезоне очки сбрасываются, значит
-- награды можно забрать снова. Второй слот крафта при этом остаётся навсегда.
CREATE TABLE IF NOT EXISTS pass_claims (
  player_id  TEXT NOT NULL,
  level      INTEGER NOT NULL,
  season_id  TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, level, season_id)
);
