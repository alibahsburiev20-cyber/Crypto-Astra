// Схема мира. Зеркалит worker/schema/world/*.sql, но с IF NOT EXISTS: применяется при старте объекта.
// Каждый элемент — одна инструкция (в триггерах есть «;» внутри BEGIN...END).
export const WORLD_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS player_identity (
     player_id TEXT PRIMARY KEY REFERENCES players (id),
     callsign TEXT, callsign_key TEXT, callsign_at INTEGER,
     frame TEXT, trail TEXT, badge TEXT, premium_until INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_callsign
     ON player_identity (callsign_key) WHERE callsign_key IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS players (
     id TEXT PRIMARY KEY, level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0,
     guild_id TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS balances (
     player_id TEXT NOT NULL REFERENCES players (id),
     asset TEXT NOT NULL CHECK (asset IN ('astra', 'fuel', 'points')),
     amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
     version INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (player_id, asset))`,
  `CREATE TABLE IF NOT EXISTS ships (
     id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players (id), type TEXT NOT NULL,
     durability INTEGER NOT NULL DEFAULT 100 CHECK (durability BETWEEN 0 AND 100),
     status TEXT NOT NULL DEFAULT 'idle')`,
  `CREATE TABLE IF NOT EXISTS resources (
     player_id TEXT NOT NULL REFERENCES players (id), resource TEXT NOT NULL,
     amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
     PRIMARY KEY (player_id, resource))`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     key TEXT NOT NULL, player_id TEXT NOT NULL, route TEXT NOT NULL, body_hash TEXT NOT NULL,
     response TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY (player_id, key))`,
  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY, run_at INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
     attempts INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs (status, run_at)`,
  `CREATE TABLE IF NOT EXISTS expeditions (
     id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players (id), ship_id TEXT NOT NULL,
     planet TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('short', 'medium', 'long')),
     status TEXT NOT NULL CHECK (status IN ('flying', 'waiting_choice', 'completed', 'cancelled')),
     seed TEXT NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, fuel_spent INTEGER NOT NULL,
     event_bonus_bp INTEGER NOT NULL DEFAULT 1000, extra_wear INTEGER NOT NULL DEFAULT 0,
     reward_json TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_expeditions_player ON expeditions (player_id, status)`,
  `CREATE TABLE IF NOT EXISTS expedition_events (
     id TEXT PRIMARY KEY, expedition_id TEXT NOT NULL, idx INTEGER NOT NULL, kind TEXT NOT NULL,
     opens_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending', 'waiting', 'resolved')),
     choice TEXT, UNIQUE (expedition_id, idx))`,
  `CREATE TABLE IF NOT EXISTS daily_counters (
     player_id TEXT NOT NULL, day INTEGER NOT NULL,
     expeditions INTEGER NOT NULL DEFAULT 0, fuel_bought INTEGER NOT NULL DEFAULT 0, points_gained INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (player_id, day))`,
  `CREATE TABLE IF NOT EXISTS claim_state (
     player_id TEXT PRIMARY KEY REFERENCES players (id),
     last_claim_at INTEGER NOT NULL, day INTEGER NOT NULL, count INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ledger (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, asset TEXT NOT NULL,
     delta INTEGER NOT NULL, reason TEXT NOT NULL, source_ref TEXT, idem_key TEXT,
     created_at INTEGER NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_player ON ledger (player_id, asset)`,
  // Очередь крафта (этап 2, срез 3): один слот, второй будет за Astra Pass.
  `CREATE TABLE IF NOT EXISTS craft_jobs (
     id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players (id), recipe TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done')),
     started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, fee INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_craft_player ON craft_jobs (player_id, status)`,
  // Модули на кораблях (этап 2, срез 4). Снять модуль нельзя — только поставить
  // или улучшить, поэтому строка живёт до конца сезона.
  `CREATE TABLE IF NOT EXISTS ship_modules (
     ship_id TEXT NOT NULL REFERENCES ships (id), module TEXT NOT NULL,
     level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
     installed_at INTEGER NOT NULL,
     PRIMARY KEY (ship_id, module))`,
  // Рынок (этап 2, срез 6): лоты с эскроу, сделки для медианы и фрод-флаги.
  `CREATE TABLE IF NOT EXISTS market_lots (
     id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, resource TEXT NOT NULL,
     amount INTEGER NOT NULL CHECK (amount > 0), unit_price INTEGER NOT NULL CHECK (unit_price > 0),
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'cancelled')),
     buyer_id TEXT, created_at INTEGER NOT NULL, closed_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_market_open ON market_lots (status, resource, unit_price)`,
  `CREATE TABLE IF NOT EXISTS market_sales (
     id TEXT PRIMARY KEY, lot_id TEXT NOT NULL, seller_id TEXT NOT NULL, buyer_id TEXT NOT NULL,
     resource TEXT NOT NULL, amount INTEGER NOT NULL, unit_price INTEGER NOT NULL,
     gross INTEGER NOT NULL, tax INTEGER NOT NULL, at INTEGER NOT NULL)`,
  // Ручные операции оператора (этап 15): кто, что и когда сделал в админке.
  // Таблица не про деньги, а про «кто нажал кнопку»: без неё компенсации
  // невозможно отличить от подарка.
  `CREATE TABLE IF NOT EXISTS admin_log (
     id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
     target TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_admin_log_at ON admin_log (created_at)`,
  // Гараж (этап 14): купленные ячейки сверх базовых трёх. Одна строка на игрока.
  `CREATE TABLE IF NOT EXISTS garage_slots (
     player_id TEXT PRIMARY KEY REFERENCES players (id),
     extra INTEGER NOT NULL DEFAULT 0 CHECK (extra >= 0),
     updated_at INTEGER NOT NULL)`,
  // Мини-игра (этап 13). Забег живёт от старта до приёма трассы; если его не
  // прислали вовремя — статус expired, попытка не возвращается.
  `CREATE TABLE IF NOT EXISTS minigame_runs (
     id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players (id),
     seed INTEGER NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished', 'expired')),
     score INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0,
     picks INTEGER NOT NULL DEFAULT 0, win INTEGER NOT NULL DEFAULT 0,
     astra INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_minigame_runs_player ON minigame_runs (player_id, status, started_at)`,
  `CREATE TABLE IF NOT EXISTS minigame_daily (
     player_id TEXT NOT NULL, day INTEGER NOT NULL,
     runs INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
     astra INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (player_id, day))`,
  // Медали «победи 25/50/100 раз» — раз на игрока, награда выдаётся один раз.
  `CREATE TABLE IF NOT EXISTS minigame_awards (
     player_id TEXT NOT NULL, award TEXT NOT NULL, wins INTEGER NOT NULL, at INTEGER NOT NULL,
     PRIMARY KEY (player_id, award))`,
  `CREATE INDEX IF NOT EXISTS idx_market_sales ON market_sales (resource, at)`,
  `CREATE TABLE IF NOT EXISTS market_flags (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, seller_id TEXT NOT NULL, buyer_id TEXT NOT NULL,
     resource TEXT NOT NULL, gross INTEGER NOT NULL, at INTEGER NOT NULL)`,
  // Сезоны (этап 3). Очки живут в balances как актив points, а здесь только
  // рамки сезона и итоги закрытого: рейтинг считается по балансу, а не по счётчику.
  `CREATE TABLE IF NOT EXISTS seasons (
     id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE,
     starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
     closed_at INTEGER, players INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons (status, number)`,
  `CREATE TABLE IF NOT EXISTS season_results (
     season_id TEXT NOT NULL REFERENCES seasons (id), player_id TEXT NOT NULL,
     rank INTEGER NOT NULL, points INTEGER NOT NULL, level INTEGER NOT NULL,
     xp INTEGER NOT NULL, reward INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (season_id, player_id))`,
  `CREATE INDEX IF NOT EXISTS idx_season_results_rank ON season_results (season_id, rank)`,
  // Снимки мира для D1 и R2. `exported` ставит cron воркера после записи архива:
  // отметка внутри мира, а не в воркере, чтобы снимок не потерялся при сбое.
  `CREATE TABLE IF NOT EXISTS season_snapshots (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, season_id TEXT,
     created_at INTEGER NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
     head_seq INTEGER, head_hash TEXT, ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
     exported INTEGER NOT NULL DEFAULT 0 CHECK (exported IN (0, 1)), payload TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_season_snapshots_pending ON season_snapshots (exported, created_at)`,
  // История сверок по дням (UTC). Нужна гейту 1: семь дней подряд без расхождений.
  `CREATE TABLE IF NOT EXISTS ledger_checks (
     day INTEGER PRIMARY KEY, at INTEGER NOT NULL, ok INTEGER NOT NULL CHECK (ok IN (0, 1)))`,
  // Социальное (этап 4). Гильдии, рефералы, миссии и Astra Pass.
  // Членство дублируется в players.guild_id ради быстрых выборок, но источник
  // истины — guild_members: в нём роль и дата вступления.
  `CREATE TABLE IF NOT EXISTS guilds (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL,
     leader_id TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS guild_members (
     player_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('leader', 'officer', 'member')),
     joined_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members (guild_id)`,
  `CREATE TABLE IF NOT EXISTS referral_codes (
     player_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS referrals (
     id TEXT PRIMARY KEY, inviter_id TEXT NOT NULL, invitee_id TEXT NOT NULL UNIQUE,
     code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified')),
     created_at INTEGER NOT NULL, qualified_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals (inviter_id, status)`,
  // Прогресс миссий не хранится: он считается по журналу и таблицам игры.
  // Здесь только отметки о награде, ключ — (игрок, период, миссия).
  `CREATE TABLE IF NOT EXISTS mission_claims (
     player_id TEXT NOT NULL, period TEXT NOT NULL, mission_id TEXT NOT NULL,
     claimed_at INTEGER NOT NULL,
     PRIMARY KEY (player_id, period, mission_id))`,
  `CREATE TABLE IF NOT EXISTS pass_claims (
     player_id TEXT NOT NULL, level INTEGER NOT NULL, season_id TEXT NOT NULL,
     claimed_at INTEGER NOT NULL,
     PRIMARY KEY (player_id, level, season_id))`,
  // Боксы (этап 5). `box_state` — таймеры бесплатных, `box_opens` — журнал
  // открытий с seed: по нему видно, что выпало и можно ли это перепроверить.
  `CREATE TABLE IF NOT EXISTS box_state (
     player_id TEXT NOT NULL REFERENCES players (id), box TEXT NOT NULL,
     last_open_at INTEGER NOT NULL, opens INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (player_id, box))`,
  `CREATE TABLE IF NOT EXISTS box_opens (
     id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players (id), box TEXT NOT NULL,
     seed TEXT NOT NULL, cost INTEGER NOT NULL, drops_json TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_box_opens_player ON box_opens (player_id, created_at)`,
  // Авиазвено (этап 6). Коллекция машин из боксов: ни ячеек гаража, ни рейсов,
  // ни ASTRA. Хранится только счётчик, чтобы дубликаты не сгорали.
  `CREATE TABLE IF NOT EXISTS player_planes (
     player_id TEXT NOT NULL REFERENCES players (id), plane TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
     first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
     PRIMARY KEY (player_id, plane))`,
  `CREATE INDEX IF NOT EXISTS idx_player_planes_player ON player_planes (player_id)`,
  // Патрули звена (этап 6): seed хранится, чтобы находку можно было перепроверить.
  // Награды в экономике нет — ни ASTRA, ни ресурсов.
  `CREATE TABLE IF NOT EXISTS plane_patrols (
     id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players (id), plane TEXT NOT NULL,
     seed TEXT NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'flying' CHECK (status IN ('flying', 'done')),
     found TEXT, claimed_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_plane_patrols_player ON plane_patrols (player_id, status)`,
  `CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
     BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
     BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END`,
];
