-- Аркада (этап 18): десять мини-игр. Зерно забега хранится, потому что счёт
-- считается сервером из зерна и трассы игрока: строку забега можно пересчитать
-- и наказать подлог. ASTRA аркада не выдаёт никогда — это развлечение, а не
-- четвёртый способ фармить мир; награда — опыт (он не двигает экономику) и
-- медали-факты. Суточный потолок опыта в arcade_daily нужен, чтобы десять игр
-- не сложились в бесконечный гринд уровня.
CREATE TABLE IF NOT EXISTS arcade_runs (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players (id),
  game       TEXT NOT NULL CHECK (game IN
               ('maze', 'sudoku', 'memory', 'sequence', 'reaction',
                'runner', 'breakout', 'snake', 'aim', 'catch')),
  seed       INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ends_at    INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished', 'expired')),
  score      INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 600),
  win        INTEGER NOT NULL DEFAULT 0 CHECK (win IN (0, 1)),
  detail     TEXT NOT NULL DEFAULT '{}',
  xp         INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0)
);

CREATE INDEX IF NOT EXISTS idx_arcade_runs_player ON arcade_runs (player_id, status);
CREATE INDEX IF NOT EXISTS idx_arcade_runs_score ON arcade_runs (status, win, score);

-- Суточный счётчик: попытки, победы и выданный опыт. Отдельная строка на день,
-- чтобы отказ «попыток нет» не блокировал повтор запроса через сутки.
CREATE TABLE IF NOT EXISTS arcade_daily (
  player_id TEXT NOT NULL REFERENCES players (id),
  day       INTEGER NOT NULL,
  runs      INTEGER NOT NULL DEFAULT 0 CHECK (runs >= 0),
  wins      INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  xp        INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  PRIMARY KEY (player_id, day)
);

-- Разовые награды: медали за победы, недельная цель и «все десять игр».
CREATE TABLE IF NOT EXISTS arcade_awards (
  player_id TEXT NOT NULL REFERENCES players (id),
  award     TEXT NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (player_id, award)
);
