// Доступы в админку: ключи, роли, сроки и журнал действий.
//
// Модель такая (и она сознательно меньше, чем «пользователи с паролями»):
//
//   * владелец — это секрет `ADMIN_TOKEN` в Worker. Он не хранится в базе,
//     поэтому дамп D1 не делает кому-то «владельца»;
//   * младший админ — строка в `admin_accounts` с SHA-256 от своего ключа.
//     Ключ показывается один раз при создании ссылки: ни список, ни повторный
//     запрос его не вернут. Теряете — создайте новый, это одна кнопка;
//   * у доступа есть роль, потолок одной выдачи ASTRA, срок и статус. Отзыв —
//     одна строка, и он работает немедленно: проверка идёт по базе на каждом
//     запросе, кэшей доступа нет.
//
// Почему ссылку отдаём фрагментом (`/admin#k=…`), а не `?k=`. Строка запроса
// попадает в историю браузера, в `Referer` на внешние картинки и в логи прокси;
// фрагмент — нет. Ключ админки того не заслуживает.

import { sha256Hex } from '../shared/sha256';
import { toB64Url } from '../shared/encoding';

/** Длина ключа: 32 байта → 43 символа base64url. Перебору не подлежит. */
export const ADMIN_KEY_BYTES = 32;
export const KEY_PREFIX = 'astra-admin_';

export const DEFAULT_INVITE_DAYS = 7;
/** Дольше трёх месяцев «времянка для помощника» жить не должна: это не роль, а гостевой доступ. */
export const MAX_INVITE_DAYS = 90;
/** Потолок ASTRA за одну выдачу/списание у младшего админа (владелец — без потолка). */
export const JUNIOR_GRANT_LIMIT_DEFAULT = 5_000;
export const JUNIOR_GRANT_LIMIT_MAX = 20_000;
/** Сколько времени ключ может не использоваться, прежде чем мы назовём его забытым. */
export const STALE_KEY_DAYS = 14;
/** Частота записи `last_used_at`: писать на каждый запрос — это лишние записи D1. */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type AdminRole = 'owner' | 'junior';

/** Что знает о себе тот, кто в админке. `grantLimit` — потолок одной выдачи. */
export interface AdminPrincipal {
  role: AdminRole;
  /** Подпись в журнале: `owner` или id доступа. */
  id: string;
  label: string;
  grantLimit: number;
  /** Email, привязанный к доступу (для младшего) — вторая щеколда, если задан. */
  email: string;
  expiresAt: number | null;
}

export const OWNER_PRINCIPAL: AdminPrincipal = {
  role: 'owner', id: 'owner', label: 'Владелец', grantLimit: Number.POSITIVE_INFINITY, email: '', expiresAt: null,
};

export interface AdminAccountRow {
  id: string;
  label: string;
  role: AdminRole;
  email: string | null;
  status: 'active' | 'revoked';
  grantLimit: number;
  createdAt: number;
  createdBy: string;
  expiresAt: number | null;
  lastUsedAt: number | null;
  lastIp: string | null;
  revokedAt: number | null;
  note: string;
  /** Только для «сколько ключей вообще завели»: сам хеш наружу не отдаём. */
  hasKey: boolean;
}

export function newAdminKey(rand: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(ADMIN_KEY_BYTES))): string {
  return `${KEY_PREFIX}${toB64Url(rand())}`;
}

/** То, что лежит в базе. Открытый ключ не сохраняется нигде. */
export function hashAdminKey(key: string): string {
  return sha256Hex(key);
}

/**
 * Ссылка-приглашение: ключ во фрагменте, см. комментарий в шапке файла.
 *
 * Без косой черты после `admin`: Assets канонализует `/admin/` редиректом 307 на
 * `/admin`, а лишние три секунды на переадресации — это лишняя возможность
 * потерять фрагмент в кривом браузере. Проверено на живом `wrangler dev`.
 */
export function adminInviteLink(origin: string, key: string): string {
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/admin#k=${key}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InviteInput {
  label: string;
  email?: string;
  days?: number;
  grantLimit?: number;
  note?: string;
  actor: string;
  now: number;
}

export type InviteError = 'bad_label' | 'bad_email' | 'bad_days' | 'bad_grant_limit' | 'bad_note';

/**
 * Разбор и нормализация приглашения. Отдельная чистая функция — потому что
 * «сколько дней живёт гостевой доступ» и «какой потолок выдачи» есть решения,
 * которые надо уметь тестировать без базы.
 */
export function parseInviteInput(body: Record<string, unknown>): { ok: true; value: Omit<InviteInput, 'actor' | 'now'> } | { ok: false; error: InviteError } {
  const label = String(body.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (label.length < 2) return { ok: false, error: 'bad_label' };

  const rawEmail = String(body.email ?? '').trim().toLowerCase();
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(rawEmail)) return { ok: false, error: 'bad_email' };

  const days = body.days === undefined || body.days === null || body.days === '' ? DEFAULT_INVITE_DAYS : Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_INVITE_DAYS) return { ok: false, error: 'bad_days' };

  const limit = body.grantLimit === undefined || body.grantLimit === null || body.grantLimit === ''
    ? JUNIOR_GRANT_LIMIT_DEFAULT : Number(body.grantLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > JUNIOR_GRANT_LIMIT_MAX) return { ok: false, error: 'bad_grant_limit' };

  const note = String(body.note ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return { ok: true, value: { label, email: rawEmail || undefined, days, grantLimit: limit, note } };
}

/** Создать доступ. Возвращает ключ ОДИН РАЗ — повторить его нечем. */
export async function createAdminInvite(db: D1Database, input: InviteInput): Promise<{ id: string; key: string; expiresAt: number }> {
  const key = newAdminKey();
  const id = `adm_${toB64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const expiresAt = input.now + (input.days ?? DEFAULT_INVITE_DAYS) * DAY_MS;
  await db.prepare(
    `INSERT INTO admin_accounts (id, label, role, key_hash, email, status, grant_limit, created_at, created_by, expires_at, note)
     VALUES (?, ?, 'junior', ?, ?, 'active', ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.label, hashAdminKey(key), input.email ?? null, input.grantLimit ?? JUNIOR_GRANT_LIMIT_DEFAULT,
    input.now, input.actor, expiresAt, input.note ?? '',
  ).run();
  await writeAdminAudit(db, {
    actor: input.actor, role: 'owner', action: 'invite_create', target: id,
    payload: { label: input.label, email: input.email ?? '', days: input.days ?? DEFAULT_INVITE_DAYS, grantLimit: input.grantLimit ?? JUNIOR_GRANT_LIMIT_DEFAULT },
    now: input.now,
  });
  return { id, key, expiresAt };
}

export type KeyLookup =
  | { status: 'ok'; account: AdminAccountRow; principal: AdminPrincipal }
  /** `account` есть и при `revoked`/`expired`: это СВОЙ доступ, оператор имеет
   * право знать, какой именно и когда истёк. `unknown` — никогда с деталями. */
  | { status: 'revoked' | 'expired'; account: AdminAccountRow }
  | { status: 'unknown' };

/**
 * Проверка ключа. Отдельно `unknown` / `revoked` / `expired`: оператор обязан
 * видеть разницу («не тот ключ» и «ключ просрочен» решаются разными действиями),
 * и это не подсказка для подбора — угадать хеш 32 случайных байт не выход.
 */
export async function lookupAdminKey(db: D1Database, key: string, now: number): Promise<KeyLookup> {
  const raw = String(key ?? '').trim();
  if (raw.length < KEY_PREFIX.length + 20) return { status: 'unknown' };
  const hash = hashAdminKey(raw);
  const row = await db.prepare(
    `SELECT id, label, role, email, status, grant_limit, created_at, created_by, expires_at,
            last_used_at, last_ip, revoked_at, note, key_hash
       FROM admin_accounts WHERE key_hash = ? LIMIT 1`,
  ).bind(hash).first<Record<string, unknown>>();
  if (!row) return { status: 'unknown' };
  const account = mapAccount(row);
  if (account.status === 'revoked') return { status: 'revoked', account };
  if (account.expiresAt !== null && account.expiresAt <= now) return { status: 'expired', account };
  return {
    status: 'ok',
    account,
    principal: {
      role: 'junior', id: account.id, label: account.label, grantLimit: account.grantLimit,
      email: account.email ?? '', expiresAt: account.expiresAt,
    },
  };
}

/** Отметка «доступом воспользовались». Пишется не чаще раза в 5 минут на доступ. */
export async function touchAdminAccount(db: D1Database, id: string, now: number, ip: string): Promise<void> {
  try {
    await db.prepare(
      `UPDATE admin_accounts SET last_used_at = ?, last_ip = ?
        WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)`,
    ).bind(now, ip || '', id, now - TOUCH_INTERVAL_MS).run();
  } catch (e) {
    // Отметка — не условие входа: не записали, так и не записали.
    console.error('admin account touch failed', e);
  }
}

export async function revokeAdminAccount(db: D1Database, id: string, actor: string, now: number): Promise<boolean> {
  const res = await db.prepare(
    `UPDATE admin_accounts SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'`,
  ).bind(now, id).run();
  const changed = (res as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
  if (changed > 0) {
    await writeAdminAudit(db, { actor, role: 'owner', action: 'invite_revoke', target: id, payload: {}, now });
  }
  return changed > 0;
}

export async function listAdminAccounts(db: D1Database, now: number): Promise<(AdminAccountRow & { stale: boolean; expired: boolean })[]> {
  const { results } = await db.prepare(
    `SELECT id, label, role, email, status, grant_limit, created_at, created_by, expires_at,
            last_used_at, last_ip, revoked_at, note, key_hash
       FROM admin_accounts ORDER BY created_at DESC LIMIT 50`,
  ).all<Record<string, unknown>>();
  return (results ?? []).map((row) => {
    const account = mapAccount(row);
    return {
      ...account,
      expired: account.expiresAt !== null && account.expiresAt <= now,
      stale: account.lastUsedAt === null || now - account.lastUsedAt > STALE_KEY_DAYS * DAY_MS,
    };
  });
}

function mapAccount(row: Record<string, unknown>): AdminAccountRow {
  return {
    id: String(row.id),
    label: String(row.label ?? ''),
    role: row.role === 'junior' ? 'junior' : 'owner',
    email: row.email === null || row.email === undefined ? null : String(row.email),
    status: row.status === 'revoked' ? 'revoked' : 'active',
    grantLimit: Number(row.grant_limit ?? JUNIOR_GRANT_LIMIT_DEFAULT),
    createdAt: Number(row.created_at ?? 0),
    createdBy: String(row.created_by ?? 'owner'),
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
    lastUsedAt: row.last_used_at === null || row.last_used_at === undefined ? null : Number(row.last_used_at),
    lastIp: row.last_ip === null || row.last_ip === undefined ? null : String(row.last_ip),
    revokedAt: row.revoked_at === null || row.revoked_at === undefined ? null : Number(row.revoked_at),
    note: String(row.note ?? ''),
    hasKey: Boolean(row.key_hash),
  };
}

export interface AuditInput {
  actor: string;
  role: AdminRole;
  action: string;
  target: string;
  payload: Record<string, unknown>;
  now: number;
}

/**
 * Журнал админ-действий. Это не бухгалтерия (она в `pay_ledger` и в журнале мира),
 * а «кто нажал»: ответы на вопрос «откуда взялся этот ноль на счёте» должны
 * быть у владельца, а не в его памяти.
 */
export async function writeAdminAudit(db: D1Database, input: AuditInput): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO admin_audit (id, actor, actor_role, action, target, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `au_${crypto.randomUUID()}`, input.actor, input.role, input.action, input.target,
      JSON.stringify(input.payload ?? {}), input.now,
    ).run();
  } catch (e) {
    // Журнал не должен ломать действие, которое уже совершено. Но молчать нельзя:
    // в логах это останется, и по нему видно, что «доказательств нет».
    console.error('admin audit write failed', input.action, e);
  }
}

export async function readAdminAudit(db: D1Database, limit = 25): Promise<Record<string, unknown>[]> {
  const { results } = await db.prepare(
    'SELECT actor, actor_role, action, target, payload, created_at FROM admin_audit ORDER BY created_at DESC LIMIT ?',
  ).bind(Math.max(1, Math.min(100, limit))).all<Record<string, unknown>>();
  return (results ?? []).map((row) => ({
    actor: String(row.actor ?? ''),
    role: String(row.actor_role ?? 'owner'),
    action: String(row.action ?? ''),
    target: String(row.target ?? ''),
    payload: safeParse(row.payload),
    createdAt: Number(row.created_at ?? 0),
  }));
}

function safeParse(raw: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(raw ?? '{}')) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
