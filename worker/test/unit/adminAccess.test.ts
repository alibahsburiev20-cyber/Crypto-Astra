// Доступ в админку по ключу помощника и границы его прав.
//
// Проверяем три вещи, которые нельзя «проверить на глаз»:
//   1) ключ работает только вместе с включённым `ADMIN_TOKEN` (иначе «помощнику
//      доступ дали, а секрета владельца нет» = открытая админка);
//   2) отозванный и просроченный доступ не пускает, и отказ называется своим
//      кодом — оператор должен понять, что делать;
//   3) младший админ не может там, где деньги, доступы и чужие аккаунты.
import { beforeEach, describe, expect, it } from 'vitest';
import { adminTestDb } from '../helpers/adminDb';
import { requireAdmin, requireOwner, ADMIN_IP_MAX, ADMIN_TOKEN_MIN } from '../../src/http/admin';
import { adminAccountInvite, adminAccounts, adminFreeze, adminGrant, adminPlayer, adminPlayerBlock, adminSession } from '../../src/routes/admin';
import { errorResponse } from '../../src/http/response';
import { ApiError } from '../../src/world/errors';
import { createAdminInvite } from '../../src/admin/accounts';
import { resetAdminSchemaForTests } from '../../src/admin/schema';
import { makeD1 } from '../helpers/d1';
import type { Env } from '../../src/env';
import type { DatabaseSync } from 'node:sqlite';

const ADMIN_TOKEN = 'test-admin-token-for-unit-32ch';
const OWNER_EMAIL = 'owner@example.com';
// Отсчёт «сегодня»: у доступа есть срок, и фиксированная дата превратила бы
// тесты в «ключ протух» ровно в тот момент, когда песочница перешагнёт её.
const T0 = Date.now();

function worldStub(log: { grants: unknown[][]; players: string[]; identity: string[] } = { grants: [], players: [], identity: [] }) {
  return {
    idFromName: (name: string) => ({ name }),
    get: (stub: { name: string }) => ({
      async grant(actor: string, playerId: string, astra: number, reason: string) {
        log.grants.push([actor, playerId, astra, reason, stub.name]);
        return { playerId, granted: astra, astra: 500 + astra, reason };
      },
      async adminPlayer(playerId: string) {
        log.players.push(playerId);
        return { id: playerId, label: 'Пилот', level: 7, xp: 10, astra: 250, points: 4, ships: 2, frozen: false };
      },
      async clearIdentity(playerId: string) { log.identity.push(playerId); return { ok: true }; },
    }),
  };
}

function build(opts: { users?: { id: string; email?: string | null; worldId?: string | null }[] } = {}) {
  const { db, raw } = adminTestDb(opts.users ?? [{ id: 'player-1', email: 'pilot@example.com', worldId: 'w1' }], [], T0);
  const log = { grants: [] as unknown[][], players: [] as string[], identity: [] as string[] };
  const env = { DB: db, ADMIN_TOKEN, ADMIN_EMAIL: OWNER_EMAIL, WORLD: worldStub(log) } as unknown as Env;
  return { env, raw, log };
}

const req = (path: string, init: RequestInit = {}) => new Request(`https://astra.example${path}`, init);
const adminHeaders = (extra: Record<string, string> = {}) => ({
  'X-Admin-Token': ADMIN_TOKEN, 'X-Admin-Email': OWNER_EMAIL, ...extra,
});

async function run(handler: (request: Request, env: Env) => Promise<Response>, request: Request, env: Env) {
  try {
    return await handler(request, env);
  } catch (e) {
    return errorResponse(e);
  }
}

/** Выпустить рабочий ключ помощника прямо в базе теста. */
async function invite(env: Env, over: { label?: string; email?: string; days?: number; grantLimit?: number } = {}) {
  return createAdminInvite(env.DB, {
    label: over.label ?? 'Никита', email: over.email, days: over.days ?? 7,
    grantLimit: over.grantLimit ?? 100, actor: 'owner', now: T0,
  });
}

beforeEach(() => resetAdminSchemaForTests());

describe('requireAdmin: вход по ключу помощника', () => {
  it('ключ даёт роль junior с потолком и подписью', async () => {
    const { env } = build();
    const { key } = await invite(env, { grantLimit: 250 });
    // Только ключ: с ним в заголовках токен владельца — и победил бы он.
    const who = await requireAdmin(req('/admin/world', { headers: { 'X-Admin-Key': key } }), env);
    expect(who).toMatchObject({ role: 'junior', label: 'Никита', grantLimit: 250 });
    expect(Number.isFinite(who.grantLimit)).toBe(true);
  });

  it('токен владельца — роль owner без потолка', async () => {
    const { env } = build();
    const who = await requireAdmin(req('/admin/world', { headers: adminHeaders() }), env);
    expect(who.role).toBe('owner');
    expect(who.grantLimit).toBe(Number.POSITIVE_INFINITY);
  });

  it('оба способа в одном запросе не конфликтуют: токен побеждает', async () => {
    const { env } = build();
    const { key } = await invite(env);
    const who = await requireAdmin(req('/admin/world', { headers: adminHeaders({ 'X-Admin-Key': key }) }), env);
    expect(who.role).toBe('owner');
  });

  it('без ADMIN_TOKEN ключ не работает — админка выключена для всех', async () => {
    const { env } = build();
    const { key } = await invite(env);
    const bare = { ...env, ADMIN_TOKEN: '' } as Env;
    await expect(requireAdmin(req('/admin/world', { headers: { 'X-Admin-Key': key } }), bare)).rejects.toThrow(/admin_disabled/);
    const weak = { ...env, ADMIN_TOKEN: 'a'.repeat(ADMIN_TOKEN_MIN - 1) } as Env;
    await expect(requireAdmin(req('/admin/world', { headers: { 'X-Admin-Key': key } }), weak)).rejects.toThrow(/admin_weak_token/);
  });

  it('просроченный и отозванный ключи отказывают своими кодами', async () => {
    const { env, raw } = build();
    const expired = await invite(env, { label: 'Вчера' });
    raw.prepare('UPDATE admin_accounts SET expires_at = ? WHERE id = ?').run(T0 - 1, expired.id);
    await expect(requireAdmin(req('/admin/world', { headers: { 'X-Admin-Key': expired.key } }), env)).rejects.toThrow(/admin_key_expired/);

    const revoked = await invite(env, { label: 'Уволен' });
    raw.prepare(`UPDATE admin_accounts SET status = 'revoked' WHERE id = ?`).run(revoked.id);
    await expect(requireAdmin(req('/admin/world', { headers: { 'X-Admin-Key': revoked.key } }), env)).rejects.toThrow(/admin_key_revoked/);
  });

  it('ключ привязан к почте доступа: чужой ящик — отказ', async () => {
    const { env } = build();
    const { key } = await invite(env, { email: 'helper@example.com' });
    await expect(requireAdmin(req('/admin/world', {
      headers: { 'X-Admin-Key': key, 'X-Admin-Email': 'thief@example.com' },
    }), env)).rejects.toThrow(/admin_email_forbidden/);
    // Без почты вообще — тоже отказ: «не знаю, кто ты» не пустоту пропускаем.
    await expect(requireAdmin(req('/admin/world', { headers: { 'X-Admin-Key': key } }), env)).rejects.toThrow(/admin_email_forbidden/);
    const ok = await requireAdmin(req('/admin/world', {
      headers: { 'X-Admin-Key': key, 'X-Admin-Email': 'HELPER@example.com' },
    }), env);
    expect(ok.role).toBe('junior');
  });

  it('админский ADMIN_EMAIL не разрешает вход чужому ключу', async () => {
    const { env } = build();
    const { key } = await invite(env, { email: 'helper@example.com' });
    // Почта владельца не «подставляет» себя вместо почты доступа.
    await expect(requireAdmin(req('/admin/world', {
      headers: { 'X-Admin-Key': key, 'X-Admin-Email': OWNER_EMAIL },
    }), env)).rejects.toThrow(/admin_email_forbidden/);
  });

  it('несовпадающий ключ считается попыткой подбора и упирается в лимит по IP', async () => {
    const { env } = build();
    const headers = { 'X-Forwarded-For': '203.0.113.5', 'X-Admin-Key': `astra-admin_${'z'.repeat(43)}` };
    for (let i = 0; i < ADMIN_IP_MAX - 1; i += 1) {
      await expect(requireAdmin(req('/admin/world', { headers }), env)).rejects.toThrow(/admin_key_unknown/);
    }
    // Ровно на ADMIN_IP_MAX-й ошибке срабатывает блокировка — тот же 429, что и для токена.
    await expect(requireAdmin(req('/admin/world', { headers }), env)).rejects.toThrow(/too_many_attempts/);
    const { key } = await invite(env);
    // Запертый адрес не пропускается даже верным ключом: блокировка — про IP,
    // и «правильный ключ с чужого адреса» не должен её обходить. Помощнику —
    // ждать 15 минут или зайти с другой сети; это та же цена, что у входа по токену.
    await expect(requireAdmin(req('/admin/world', { headers: { ...headers, 'X-Admin-Key': key } }), env))
      .rejects.toThrow(/too_many_attempts/);
  });

  it('пустые заголовки — это «не вошли», а не попытка подбора', async () => {
    const { env, raw } = build();
    await expect(requireAdmin(req('/admin/world', { headers: {} }), env)).rejects.toThrow(/admin_token_required/);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM auth_limits').get()).toEqual({ n: 0 });
  });

  it('если база доступов лежит — 503, а не «ключ не подошёл»', async () => {
    const { env } = build();
    const { key } = await invite(env);
    env.DB = {
      prepare(sql: string) {
        if (sql.includes('admin_accounts')) throw new Error('d1 down');
        return { bind() { return this; }, async first() { return null; }, async run() { return { success: true }; } };
      },
    } as unknown as D1Database;
    await expect(requireAdmin(req('/admin/world', { headers: { 'X-Admin-Key': key } }), env)).rejects.toThrow(/admin_store_unavailable/);
  });
});

describe('requireOwner', () => {
  it('младшему — отказ, владельцу — тот же принципал', () => {
    expect(() => requireOwner({ role: 'junior', id: 'adm_1', label: 'A', grantLimit: 10, email: '', expiresAt: null }))
      .toThrow(/owner_only/);
    const owner = { role: 'owner', id: 'owner', label: 'Владелец', grantLimit: Number.POSITIVE_INFINITY, email: '', expiresAt: null };
    expect(requireOwner(owner)).toBe(owner);
  });
});

describe('границы прав младшего админа', () => {
  it('/admin/session отвечает ролью и потолком, а не секретами', async () => {
    const { env } = build();
    const { key } = await invite(env, { grantLimit: 100 });
    const res = await run(adminSession, req('/admin/session', { headers: { 'X-Admin-Key': key } }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, role: 'junior', label: 'Никита', grantLimit: 100 });
    expect(JSON.stringify(body)).not.toContain(key);
  });

  it('список доступов и приглашение — только владельцу', async () => {
    const { env } = build();
    const { key } = await invite(env);
    const junior = { headers: { 'X-Admin-Key': key } };
    expect((await run(adminAccounts, req('/admin/accounts', junior), env)).status).toBe(403);
    expect((await run(adminAccountInvite, req('/admin/accounts/invite', { method: 'POST', body: '{}' }), env)).status).toBe(401);
    expect((await run(adminAccountInvite, req('/admin/accounts/invite', { method: 'POST', body: '{}', headers: junior.headers }), env)).status).toBe(403);
    // Владелец видит список.
    const asOwner = await run(adminAccounts, req('/admin/accounts', { headers: adminHeaders() }), env);
    expect(asOwner.status).toBe(200);
    const listed = await asOwner.json() as { accounts: { label: string }[] };
    expect(listed.accounts[0].label).toBe('Никита');
  });

  it('заморозка мира младшему недоступна', async () => {
    const { env } = build();
    const { key } = await invite(env);
    const res = await run(adminFreeze, req('/admin/world/freeze?world=w1', {
      method: 'POST', body: JSON.stringify({ frozen: true }), headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json' },
    }), env);
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe('owner_only');
  });

  it('выдача сверх потолка отсекается, в пределах — проходит', async () => {
    const { env, log } = build();
    const { key } = await invite(env, { grantLimit: 100 });
    const call = (astra: number) => run(adminGrant, req('/admin/world/grant?world=w1', {
      method: 'POST',
      headers: { 'X-Admin-Key': key, 'X-Admin-Email': 'helper@Example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'pilot@example.com', astra, reason: 'компенсация' }),
    }), { ...env, ADMIN_EMAIL: '' } as Env);

    const tooBig = await call(101);
    expect(tooBig.status).toBe(409);
    expect((await tooBig.json() as { error: string }).error).toBe('grant_limit');
    expect(log.grants).toEqual([]);

    const ok = await call(-100);
    expect(ok.status).toBe(200);
    // Списание под потолок тоже считается по модулю: «минус» не лазейка.
    expect(log.grants[0][2]).toBe(-100);
    // Журнал видит помощника по id доступа, а не «admin» — иначе «кто выдал» неотличимо.
    expect(String(log.grants[0][0])).toMatch(/^adm_/);
    const audit = env.DB.prepare('SELECT action, actor_role, payload FROM admin_audit ORDER BY created_at DESC LIMIT 1');
    const row = await audit.first() as { action: string; actor_role: string; payload: string };
    expect(row).toMatchObject({ action: 'grant', actor_role: 'junior' });
    expect(JSON.parse(row.payload)).toMatchObject({ astra: -100, reason: 'компенсация' });
  });

  it('журнал недоступен — выдача всё равно считается успешной', async () => {
    // Иначе «монеты уже начислены, а админ видит отказ» и он нажимает повторно.
    const { env, log } = build();
    const real = env.DB;
    env.DB = {
      prepare(sql: string) {
        if (sql.includes('admin_audit') || sql.includes('CREATE TABLE IF NOT EXISTS admin')) throw new Error('d1 busy');
        return real.prepare(sql);
      },
    } as unknown as D1Database;
    const res = await run(adminGrant, req('/admin/world/grant?world=w1', {
      method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'pilot@example.com', astra: 10, reason: 'компенсация' }),
    }), env);
    expect(res.status).toBe(200);
    expect(log.grants).toHaveLength(1);
  });

  it('владелец не ограничен потолком', async () => {
    const { env, log } = build();
    const res = await run(adminGrant, req('/admin/world/grant?world=w1', {
      method: 'POST', headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'pilot@example.com', astra: 5_000, reason: 'приз' }),
    }), env);
    expect(res.status).toBe(200);
    expect(log.grants).toHaveLength(1);
  });

  it('карточку игрока помощник увидеть может — это его рабочий инструмент', async () => {
    const { env, log } = build();
    const { key } = await invite(env);
    const res = await run(adminPlayer, req('/admin/player?player=pilot@example.com', {
      headers: { 'X-Admin-Key': key },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { player: Record<string, unknown> };
    expect(body.player).toMatchObject({ id: 'player-1', status: 'active', payBalanceMicro: 0, openWithdrawals: 0 });
    expect(log.players).toEqual(['player-1']);
  });

  it('блокировка игрока — только владельцу', async () => {
    const { env } = build();
    const { key } = await invite(env);
    const res = await run(adminPlayerBlock, req('/admin/player/block', {
      method: 'POST', headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: 'pilot@example.com', action: 'block', reason: 'чит' }),
    }), env);
    expect(res.status).toBe(403);
  });

  it('несуществующий игрок в карточке — 404, а не «внутренняя ошибка»', async () => {
    const { env } = build();
    const res = await run(adminPlayer, req('/admin/player?player=nope@example.com', { headers: adminHeaders() }), env);
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe('player_not_found');
  });
});

describe('ошибка без ApiError не прячется', () => {
  it('мир недоступен — карточка всё равно выходит, но без игровой части', async () => {
    const { env } = build();
    env.WORLD = {
      idFromName: () => ({ name: 'w1' }),
      get: () => ({ async adminPlayer() { throw new Error('DO down'); } }),
    } as unknown as Env['WORLD'];
    const res = await run(adminPlayer, req('/admin/player?player=player-1', { headers: adminHeaders() }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { world: unknown; player: Record<string, unknown> };
    expect(body.world).toBeNull();
    expect(body.player.game).toBeNull();
  });
});
