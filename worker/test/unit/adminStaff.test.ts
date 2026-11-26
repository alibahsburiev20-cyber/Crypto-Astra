// Доступы админки: приглашение младшего админа ссылкой с ключом, отзыв, журнал.
//
// Проверяем на настоящей SQLite (node:sqlite), а не на моках: ровно потому, что
// безопасность здесь живёт в схеме — `key_hash UNIQUE`, `CHECK (role IN …)`,
// `CHECK (grant_limit BETWEEN 1 AND 20000)`. Мок этих ограничений не знает, и
// «всё зелёное» означало бы ничего.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADMIN_KEY_BYTES, adminInviteLink, createAdminInvite, hashAdminKey, listAdminAccounts,
  lookupAdminKey, newAdminKey, parseInviteInput, readAdminAudit, revokeAdminAccount,
  touchAdminAccount, writeAdminAudit } from '../../src/admin/accounts';
import { ADMIN_SCHEMA_STATEMENTS, ensureAdminSchema, resetAdminSchemaForTests } from '../../src/admin/schema';
import { makeD1 } from '../helpers/d1';
import type { DatabaseSync } from 'node:sqlite';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 17, 12, 0, 0);

function adminDb(): { db: D1Database; raw: DatabaseSync } {
  const fake = makeD1();
  fake.raw.exec(readFileSync(new URL('../../migrations/d1/0011_admin_accounts.sql', import.meta.url), 'utf8'));
  return { db: fake.db, raw: fake.raw };
}

beforeEach(() => {
  // Флаг «схема уже готова» — модульный: без сброса второй тест в файле
  // донастраивал бы базу после первого, и проверка DDL терялась бы.
  resetAdminSchemaForTests();
});

describe('миграция 0011 и рантайм дают одну схему доступов', () => {
  const structure = (raw: DatabaseSync) => [...raw.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'admin%' OR name LIKE 'idx_admin%' ORDER BY name",
  ).all()].map((r) => {
    const row = r as { type: string; name: string; sql: string };
    // Сравниваем структуру, а не буквы: DDL в миграции и в коде различается
    // переносами строк и комментариями.
    const sql = String(row.sql).replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').replace(/\s+\)/g, ')').trim();
    return `${row.type}|${row.name}|${sql}`;
  });

  it('код создаёт те же таблицы и индексы, что миграция', () => {
    const { raw } = makeD1();
    raw.exec(ADMIN_SCHEMA_STATEMENTS.join('\n;\n'));
    const { raw: fromMigration } = adminDb();
    expect(structure(raw)).toEqual(structure(fromMigration));
    expect(structure(raw).length).toBe(4);
  });

  it('повторный прогон ничего не ломает', async () => {
    const { db, raw } = adminDb();
    expect(await ensureAdminSchema(db)).toBe(true);
    raw.prepare(`INSERT INTO admin_accounts (id, label, created_at) VALUES ('a1', 'Помощник', ?)`).run(T0);
    expect(() => raw.exec(ADMIN_SCHEMA_STATEMENTS.join('\n;\n'))).not.toThrow();
    expect(raw.prepare('SELECT COUNT(*) AS n FROM admin_accounts').get()).toEqual({ n: 1 });
  });

  it('схема недоступна — ensureAdminSchema отвечает false, а не «пусто»', async () => {
    const broken = {
      prepare() { throw new Error('no database'); },
    } as unknown as D1Database;
    expect(await ensureAdminSchema(broken)).toBe(false);
  });

  it('роль и потолок проверяются схемой, а не только кодом', () => {
    const { raw } = adminDb();
    expect(() => raw.prepare(`INSERT INTO admin_accounts (id, label, role, created_at) VALUES ('x', 'X', 'root', ?)`).run(T0)).toThrow(/CHECK/);
    expect(() => raw.prepare(`INSERT INTO admin_accounts (id, label, grant_limit, created_at) VALUES ('y', 'Y', 999999, ?)`).run(T0)).toThrow(/CHECK/);
  });
});

describe('ключи и ссылки', () => {
  it('ключ длинный, случайный и с префиксом', () => {
    const a = newAdminKey(() => new Uint8Array(ADMIN_KEY_BYTES).fill(1));
    const b = newAdminKey(() => new Uint8Array(ADMIN_KEY_BYTES).fill(2));
    expect(a.startsWith('astra-admin_')).toBe(true);
    expect(a).not.toBe(b);
    expect(hashAdminKey(a)).not.toBe(hashAdminKey(b));
    // base64url: 32 байта → 43 символа без `=`; в URL и в заголовке безопасно.
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('ссылка несёт ключ во фрагменте, а не в строке запроса', () => {
    const link = adminInviteLink('https://astra.test/', 'astra-admin_abc');
    expect(link).toBe('https://astra.test/admin#k=astra-admin_abc');
    // `?k=` — это история браузера, Referer и логи прокси.
    expect(link.includes('?k=')).toBe(false);
    // `/admin/` ловит 307 от Assets — лишний шаг, на котором фрагмент могут и
    // потерять; адрес без косой черты отвечает сразу.
    expect(link).not.toContain('/admin/');
  });
});

describe('приглашение', () => {
  it('создаёт доступ и отдаёт ключ ровно один раз', async () => {
    const { db, raw } = adminDb();
    const created = await createAdminInvite(db, { label: 'Никита', days: 7, grantLimit: 3000, note: 'саппорт', actor: 'owner', now: T0 });
    expect(created.key.startsWith('astra-admin_')).toBe(true);
    expect(created.expiresAt).toBe(T0 + 7 * DAY);

    const row = raw.prepare('SELECT * FROM admin_accounts').get() as Record<string, unknown>;
    // Открытого ключа в базе нет: только хеш. Это и есть ответ на «утёк дамп D1».
    expect(JSON.stringify(row)).not.toContain(created.key);
    expect(row.key_hash).toBe(hashAdminKey(created.key));
    expect(row.role).toBe('junior');
    expect(row.status).toBe('active');
    expect(row.grant_limit).toBe(3000);
    expect(row.created_by).toBe('owner');

    const found = await lookupAdminKey(db, created.key, T0 + 1000);
    expect(found.status).toBe('ok');
  });

  it('два ключа не могут совпасть: key_hash UNIQUE', async () => {
    const { db } = adminDb();
    await createAdminInvite(db, { label: 'A', actor: 'owner', now: T0 });
    const same = newAdminKey(() => new Uint8Array(ADMIN_KEY_BYTES).fill(7));
    const second = await createAdminInvite(db, { label: 'B', actor: 'owner', now: T0 });
    expect(second.key).not.toBe(same);
    // Прямая вставка дубликата хеша обязана упасть.
    const hash = (await db.prepare('SELECT key_hash AS h FROM admin_accounts WHERE label = ?').bind('A').first<{ h: string }>()).h;
    expect(() => (db as unknown as { __raw: DatabaseSync }).__raw
      .prepare('INSERT INTO admin_accounts (id, label, key_hash, created_at) VALUES (?, ?, ?, ?)')
      .run('dup', 'C', hash, T0)).toThrow(/UNIQUE/);
  });

  it('отзыв работает и повторяющийся отзыв не притворяется успехом', async () => {
    const { db } = adminDb();
    const { id, key } = await createAdminInvite(db, { label: 'A', actor: 'owner', now: T0 });
    expect(await revokeAdminAccount(db, id, 'owner', T0 + DAY)).toBe(true);
    expect((await lookupAdminKey(db, key, T0 + DAY)).status).toBe('revoked');
    expect(await revokeAdminAccount(db, id, 'owner', T0 + DAY)).toBe(false);
    expect(await revokeAdminAccount(db, 'adm_missing', 'owner', T0)).toBe(false);
  });

  it('срок вышел — вход закрыт, но оператор видит, что это именно срок', async () => {
    const { db } = adminDb();
    const { key } = await createAdminInvite(db, { label: 'A', days: 1, actor: 'owner', now: T0 });
    expect((await lookupAdminKey(db, key, T0 + DAY - 1)).status).toBe('ok');
    const late = await lookupAdminKey(db, key, T0 + DAY);
    expect(late.status).toBe('expired');
  });

  it('чужой ключ — unknown, без деталей', async () => {
    const { db } = adminDb();
    await createAdminInvite(db, { label: 'A', actor: 'owner', now: T0 });
    const res = await lookupAdminKey(db, `astra-admin_${'x'.repeat(43)}`, T0);
    expect(res.status).toBe('unknown');
    expect('account' in res).toBe(false);
    // Слишком короткий не идёт даже в запрос: «1» не должен становиться строкой в D1.
    expect((await lookupAdminKey(db, '1', T0)).status).toBe('unknown');
  });

  it('список показывает срок, потолок и «не используется», но не хеши', async () => {
    const { db } = adminDb();
    const { key, id } = await createAdminInvite(db, { label: 'Никита', days: 7, actor: 'owner', now: T0 });
    const list = await listAdminAccounts(db, T0 + DAY);
    expect(list).toHaveLength(1);
    const item = list[0];
    expect(item).toMatchObject({ id, label: 'Никита', role: 'junior', status: 'active', stale: true, expired: false });
    expect(JSON.stringify(item)).not.toContain(key);
    expect(JSON.stringify(item)).not.toContain(hashAdminKey(key));
    expect(item.hasKey).toBe(true);

    await touchAdminAccount(db, id, T0 + DAY, '203.0.113.7');
    const after = await listAdminAccounts(db, T0 + DAY);
    expect(after[0]).toMatchObject({ stale: false, lastUsedAt: T0 + DAY, lastIp: '203.0.113.7' });
  });

  it('touch не пишет чаще, чем раз в 5 минут', async () => {
    const { db, raw } = adminDb();
    const { id } = await createAdminInvite(db, { label: 'A', actor: 'owner', now: T0 });
    await touchAdminAccount(db, id, T0, '1.1.1.1');
    await touchAdminAccount(db, id, T0 + 60_000, '2.2.2.2');
    const row = raw.prepare('SELECT last_used_at, last_ip FROM admin_accounts').get() as Record<string, unknown>;
    expect(row.last_used_at).toBe(T0);
    expect(row.last_ip).toBe('1.1.1.1');
  });
});

describe('разбор тела приглашения', () => {
  const ok = { label: 'Никита' };
  it('поля по умолчанию — 7 дней и 5 000 ASTRA', () => {
    const parsed = parseInviteInput(ok);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual({ label: 'Никита', days: 7, grantLimit: 5000, note: '', email: undefined });
  });
  it('срок и потолок вне диапазона, имя короче 2 символов, кривая почта — свои коды', () => {
    expect(parseInviteInput({ ...ok, days: 0 })).toEqual({ ok: false, error: 'bad_days' });
    expect(parseInviteInput({ ...ok, days: 91 })).toEqual({ ok: false, error: 'bad_days' });
    expect(parseInviteInput({ ...ok, days: 1.5 })).toEqual({ ok: false, error: 'bad_days' });
    expect(parseInviteInput({ ...ok, grantLimit: 0 })).toEqual({ ok: false, error: 'bad_grant_limit' });
    expect(parseInviteInput({ ...ok, grantLimit: 20_001 })).toEqual({ ok: false, error: 'bad_grant_limit' });
    expect(parseInviteInput({ ...ok, label: 'Н' })).toEqual({ ok: false, error: 'bad_label' });
    expect(parseInviteInput({ ...ok, email: 'nik' })).toEqual({ ok: false, error: 'bad_email' });
  });
  it('пробелы схлопнуты, почта в нижнем регистре, длины обрезаны', () => {
    const parsed = parseInviteInput({ label: '  Никита   Модератор ', email: ' Nik@Example.COM ', note: 'x'.repeat(300) });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.label).toBe('Никита Модератор');
      expect(parsed.value.email).toBe('nik@example.com');
      expect((parsed.value.note ?? '').length).toBe(120);
    }
  });
});

describe('журнал админ-действий', () => {
  it('создание и отзыв доступа видны в журнале', async () => {
    const { db } = adminDb();
    const { id } = await createAdminInvite(db, { label: 'A', days: 3, grantLimit: 100, actor: 'owner', now: T0 });
    await revokeAdminAccount(db, id, 'owner', T0 + 1000);
    const entries = await readAdminAudit(db, 10);
    expect(entries.map((e) => e.action)).toEqual(['invite_revoke', 'invite_create']);
    expect(entries[1].payload).toEqual({ label: 'A', email: '', days: 3, grantLimit: 100 });
    expect(entries[1].actor).toBe('owner');
  });

  it('кривой payload читается как пусто, а не падает', async () => {
    const { db, raw } = adminDb();
    await writeAdminAudit(db, { actor: 'owner', role: 'owner', action: 'grant', target: 'p1', payload: { astra: -50 }, now: T0 });
    raw.prepare(`UPDATE admin_audit SET payload = '{'`).run();
    const [entry] = await readAdminAudit(db, 5);
    expect(entry).toMatchObject({ action: 'grant', target: 'p1', payload: {} });
  });

  it('неисправная база не ломает действие, уже совершённое над игроком', async () => {
    const broken = { prepare() { throw new Error('d1 down'); } } as unknown as D1Database;
    await expect(writeAdminAudit(broken, { actor: 'owner', role: 'owner', action: 'grant', target: 'p1', payload: {}, now: T0 })).resolves.toBeUndefined();
  });

  it('лимит выборки зажат: 100 записей — это потолок, а не «сколько попросили»', async () => {
    const { db } = adminDb();
    for (let i = 0; i < 3; i += 1) {
      await writeAdminAudit(db, { actor: 'owner', role: 'owner', action: `a${i}`, target: '', payload: {}, now: T0 + i });
    }
    expect(await readAdminAudit(db, 1000)).toHaveLength(3);
    expect(await readAdminAudit(db, 2)).toHaveLength(2);
    expect(await readAdminAudit(db, -5)).toHaveLength(1);
  });
});
