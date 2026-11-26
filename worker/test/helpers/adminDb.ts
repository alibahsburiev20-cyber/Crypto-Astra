// База админки для тестов: пользователи, сессии, деньги и доступы — как в проде,
// только в памяти и на настоящем SQLite.
//
// Отдельный помощник (а не моки) по той же причине, что и у `makeD1`: границы
// «младшему нельзя» и «игрока с деньгами не удаляем» держатся на схеме — CHECK,
// UNIQUE, NOT NULL. Мок их не знает, и зелёный тест ничего не значил бы.
import { readFileSync } from 'node:fs';
import { makeD1 } from './d1';
import type { DatabaseSync } from 'node:sqlite';

export interface SeedUser {
  id: string;
  email?: string | null;
  worldId?: string | null;
  status?: string;
  telegramId?: string | null;
  passwordHash?: string | null;
  createdAt?: number;
}

export interface SeedSession {
  userId: string;
  /** `null` — отозванная. */
  revokedAt?: number | null;
  expiresAt?: number;
}

/** Порядок важен: 0008–0010 перестраивают то, что создала 0007. */
const MIGRATIONS = [
  '0001_users.sql', '0002_sessions.sql', '0007_astra_pay.sql', '0008_pay_addresses_chain.sql',
  '0009_pay_addresses_polygon.sql', '0010_pay_withdrawals_chain.sql', '0011_admin_accounts.sql',
];

const DIR = new URL('../../migrations/d1/', import.meta.url);

export interface AdminTestDb {
  db: D1Database;
  raw: DatabaseSync;
}

export function adminTestDb(users: SeedUser[] = [], sessions: SeedSession[] = [], now = Date.now()): AdminTestDb {
  const fake = makeD1();
  for (const name of MIGRATIONS) fake.raw.exec(readFileSync(new URL(name, DIR), 'utf8'));
  // Охране админки (лимит по IP) нужна эта таблица; в проде её создаёт 0005.
  fake.raw.exec(`CREATE TABLE IF NOT EXISTS auth_limits (
    key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0)`);
  for (const u of users) {
    fake.raw.prepare(
      `INSERT INTO users (id, email, password_hash, telegram_id, world_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(u.id, u.email ?? null, u.passwordHash ?? 'hash', u.telegramId ?? null, u.worldId ?? 'w1',
      u.status ?? 'active', u.createdAt ?? now);
  }
  for (const [i, s] of sessions.entries()) {
    fake.raw.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`s${i}`, s.userId, `h${i}`, s.expiresAt ?? now + 30 * 24 * 3600_000, s.revokedAt ?? null, now - 1000);
  }
  return { db: fake.db as D1Database, raw: fake.raw };
}

/** Пополнение игрока: одна строка `pay_ledger` = `delta` micro-USDT на балансе. */
/**
 * Проводка по балансу. `reason` — любой из разрешённых схемой: журнал `pay_ledger`
 * append-only (триггер), поэтому «отменить» начисление можно только обратной
 * строкой, и тесты обязаны делать то же самое.
 */
export function credit(raw: DatabaseSync, userId: string, deltaMicro: number, idem = `k${Math.random().toString(36).slice(2, 8)}`, createdAt = Date.now(), reason = 'deposit'): void {
  raw.prepare(
    `INSERT INTO pay_ledger (id, user_id, asset, delta, reason, source_ref, idem_key, prev_hash, hash, created_at)
     VALUES (?, ?, 'USDT', ?, ?, 'tx1', ?, ?, ?, ?)`,
  ).run(`pl_${idem}`, userId, deltaMicro, reason, idem, `p_${idem}`, `h_${idem}`, createdAt);
}

/** Заявка на выплату в данном состоянии. */
export function withdrawal(raw: DatabaseSync, userId: string, status = 'requested', id = `w${Math.random().toString(36).slice(2, 8)}`): string {
  raw.prepare(
    `INSERT INTO pay_withdrawals (id, user_id, address, amount_micro, status, idem_key, chain, created_at)
     VALUES (?, ?, '0x1111111111111111111111111111111111111111', 1000000, ?, ?, 'polygon', ?)`,
  ).run(id, userId, status, `wd:${id}`, Date.now());
  return id;
}

export function payAddress(raw: DatabaseSync, userId: string, address = '0x2222222222222222222222222222222222222222', chain = 'polygon'): void {
  raw.prepare(
    `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, active, last_scanned_ts, created_at)
     VALUES (?, ?, ?, ?, 'aa', 1, 1, ?, ?)`,
  ).run(`pa_${chain}_${userId}`, userId, chain, address, Date.now(), Date.now());
}
