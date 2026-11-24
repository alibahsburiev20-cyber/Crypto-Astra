-- Патрули авиазвена (этап 6). Машина летает сама, приносит закладку ресурсов и
-- иногда находит ещё одну машину. ASTRA патрулём не начисляется никогда — иначе
-- звеном можно было бы фармить мир в обход рейсов; ресурсы и опыт идут в ledger
-- при сдаче (reason = plane_salvage, source_ref = id патруля). Seed хранится,
-- чтобы находку можно было пересчитать: строка после возврата не меняется.
CREATE TABLE IF NOT EXISTS plane_patrols (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players (id),
  plane      TEXT NOT NULL,
  seed       TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ends_at    INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'flying' CHECK (status IN ('flying', 'done')),
  found      TEXT,
  claimed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_plane_patrols_player ON plane_patrols (player_id, status);
