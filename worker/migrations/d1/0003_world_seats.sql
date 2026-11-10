-- Зеркало счётчика мест для отчётов. Источник истины по местам: WorldLobby.
CREATE TABLE world_seats (
  world_id   TEXT PRIMARY KEY,
  capacity   INTEGER NOT NULL DEFAULT 100,
  taken      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
