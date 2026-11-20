import { resetPaySchemaForTests } from '../pay/schema';

// Само-лечение схемы D1. Миграции в `worker/migrations/d1` остаются каноном, но
// деплой идёт из браузера (Cloudflare Workers Builds), а `wrangler d1 migrations
// apply --remote` оттуда недоступен. Поэтому таблицы создаются идемпотентно при
// первом обращении: `CREATE TABLE IF NOT EXISTS` на уже мигрированной базе — no-op.
//
// Так же поступает `WorldLobby` со своими таблицами. Ошибка DDL не валит весь
// воркер: вызывающий код решает, что показать. Память промиса — на изолят, чтобы
// не гонять DDL на каждый запрос.

/** Пул: таблица и индексы. Триггеры создаём отдельно — не всякая DDL-форма проходит. */
const POOL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS pool_entries (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('in', 'out', 'ops')),
     amount INTEGER NOT NULL CHECK (amount > 0),
     currency TEXT NOT NULL CHECK (currency IN ('EUR', 'USD')),
     ref TEXT NOT NULL UNIQUE,
     note TEXT NOT NULL DEFAULT '',
     season_id TEXT,
     created_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_pool_entries_created ON pool_entries (created_at)',
  'CREATE INDEX IF NOT EXISTS idx_pool_entries_kind ON pool_entries (kind, created_at)',
];

const POOL_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS pool_entries_no_update BEFORE UPDATE ON pool_entries
     BEGIN SELECT RAISE(ABORT, 'pool entries are append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS pool_entries_no_delete BEFORE DELETE ON pool_entries
     BEGIN SELECT RAISE(ABORT, 'pool entries are append-only'); END`,
];

/** Архив этапа 3: история сезонов и снимки. Нужен cron'у, а не игроку. */
const ARCHIVE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS season_history (
     world_id TEXT NOT NULL, season_id TEXT NOT NULL, season_number INTEGER NOT NULL,
     starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, closed_at INTEGER NOT NULL,
     players INTEGER NOT NULL, points_total INTEGER NOT NULL, rewards_total INTEGER NOT NULL,
     top_json TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY (world_id, season_id))`,
  'CREATE INDEX IF NOT EXISTS idx_season_history_closed ON season_history (closed_at)',
  `CREATE TABLE IF NOT EXISTS world_snapshots (
     id TEXT PRIMARY KEY, world_id TEXT NOT NULL, kind TEXT NOT NULL, season_id TEXT,
     created_at INTEGER NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
     storage TEXT NOT NULL CHECK (storage IN ('r2', 'd1')), r2_key TEXT,
     head_seq INTEGER, head_hash TEXT, ok INTEGER NOT NULL, payload TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_world_snapshots_world ON world_snapshots (world_id, created_at)',
];

async function apply(db: D1Database, statements: string[], triggers: string[] = []): Promise<boolean> {
  for (const statement of statements) await db.prepare(statement).run();
  for (const trigger of triggers) {
    try {
      await db.prepare(trigger).run();
    } catch (e) {
      // Без триггеров учёт работает, но append-only держится только кодом.
      console.error('d1 trigger failed', e);
    }
  }
  return true;
}

let poolReady: Promise<boolean> | null = null;
let archiveReady: Promise<boolean> | null = null;

/** true — таблицы пула на месте. Повторный вызов после ошибки пробует снова. */
export function ensurePoolSchema(db: D1Database): Promise<boolean> {
  if (!poolReady) {
    poolReady = apply(db, POOL_STATEMENTS, POOL_TRIGGERS).catch((e) => {
      console.error('pool schema bootstrap failed', e);
      poolReady = null;
      return false;
    });
  }
  return poolReady;
}

export function ensureArchiveSchema(db: D1Database): Promise<boolean> {
  if (!archiveReady) {
    archiveReady = apply(db, ARCHIVE_STATEMENTS).catch((e) => {
      console.error('archive schema bootstrap failed', e);
      archiveReady = null;
      return false;
    });
  }
  return archiveReady;
}

/** Только для тестов: сбрасывает память промисов между сценариями. */
export function resetD1BootstrapForTests(): void {
  poolReady = null;
  archiveReady = null;
  resetPaySchemaForTests();
}
