-- Этап 17: серверная личность игрока.
-- Позывной и выбранная косметика больше не живут в браузере: их читают
-- лидерборд, список гильдии, сезонный рейтинг и админка.
CREATE TABLE player_identity (
  player_id     TEXT PRIMARY KEY REFERENCES players (id),
  callsign      TEXT,
  callsign_key   TEXT,
  callsign_at   INTEGER,
  frame         TEXT,
  trail         TEXT,
  badge         TEXT,
  premium_until INTEGER
);

-- Уникальность без учёта регистра: «Астра» и «астра» — один позывной.
-- SQLite lower() не трогает кириллицу, поэтому ключ считается в JS и лежит рядом.
CREATE UNIQUE INDEX idx_identity_callsign ON player_identity (callsign_key) WHERE callsign_key IS NOT NULL;
