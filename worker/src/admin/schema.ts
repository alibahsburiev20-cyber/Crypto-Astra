// Схема админ-доступов в D1: таблицы создаёт сам код (self-heal), как в `pay`.
//
// Прод деплоится из браузера, поэтому таблицы создаёт код, а журнал
// `d1_migrations` может отставать (таблица есть, записи о миграции нет). Тот же
// приём, что у `pay/schema.ts` и `ensureOpsSchema`: один `CREATE TABLE IF NOT
// EXISTS` на объект, идемпотентно, без «удалить и создать заново».
//
// DDL обязан совпадать с `worker/migrations/d1/0011_admin_accounts.sql` — за этим
// следит `adminSchema.test.ts`, потому что расхождение «миграция vs рантайм» в
// схеме с CHECK-ограничениями всплывает только на первой реальной записи.

import { ApiError } from '../world/errors';

/** Один запрос — одна инструкция (D1 не исполняет пакет одним `prepare`). */
export const ADMIN_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS admin_accounts (
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
   )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_accounts_status ON admin_accounts (status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS admin_audit (
     id         TEXT PRIMARY KEY,
     actor      TEXT NOT NULL,
     actor_role TEXT NOT NULL DEFAULT 'owner',
     action     TEXT NOT NULL,
     target     TEXT NOT NULL DEFAULT '',
     payload    TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_at ON admin_audit (created_at DESC)`,
] as const;

let schemaReady = false;

/**
 * Гарантирует таблицы. Возвращает `false`, если D1 не ответила: маршрут тогда
 * отвечает 503, а не «пустой список». Молчаливый пустой список админов — это
 * «похоже, доступов нет», и на этом легко принять неверное решение.
 */
export async function ensureAdminSchema(db: D1Database): Promise<boolean> {
  if (schemaReady) return true;
  try {
    for (const sql of ADMIN_SCHEMA_STATEMENTS) await db.prepare(sql).run();
    schemaReady = true;
    return true;
  } catch (e) {
    console.error('admin schema unavailable', e);
    return false;
  }
}

export function resetAdminSchemaForTests(): void {
  schemaReady = false;
}

/** Одинаковая проверка для всех админ-маршрутов: база схемы недоступна → 503. */
export async function requireAdminSchema(db: D1Database): Promise<void> {
  if (!(await ensureAdminSchema(db))) throw new ApiError(503, 'admin_store_unavailable');
}
