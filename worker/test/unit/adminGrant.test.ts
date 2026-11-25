// Ручное начисление ASTRA из админки.
//
// Жалоба владельца: «не могу начислить другому монеты, даже причину пишу — никак».
// Причина была не в причине: игроки живут внутри конкретного мира, а админка
// всегда стучалась в `w1` и ждала полный id. Ниже закреплено поведение, при
// котором мир берётся у самого игрока, а искать можно по id, началу id и email.
import { describe, expect, it, vi } from 'vitest';
import { adminGrant, findUserByRef, parseGrantInput } from '../../src/routes/admin';
import { errorResponse } from '../../src/http/response';
import { ApiError } from '../../src/world/errors';
import { makeD1 } from '../helpers/d1';
import type { Env } from '../../src/env';

// Длиннее планки ADMIN_TOKEN_MIN (24): короткий токен админка считать не будет.
const ADMIN_TOKEN = 'test-admin-token-for-unit-32ch';
const ADMIN_EMAIL = 'owner@example.com';

function envWithUsers(users: { id: string; email: string | null; world_id: string | null }[]) {
  const { db } = makeD1();
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, telegram_id TEXT UNIQUE,
    world_id TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
  )`);
  // auth_limits нужен охране админки: без таблицы она пишет в лог «read failed».
  db.exec(`CREATE TABLE auth_limits (
    key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0
  )`);
  for (const u of users) {
    db.prepare('INSERT INTO users (id, email, world_id, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(u.id, u.email, u.world_id, 'active', Date.now()).run();
  }

  const calls: { world: string; playerId: string; astra: number; reason: string }[] = [];
  const env = {
    DB: db,
    ADMIN_TOKEN,
    ADMIN_EMAIL,
    WORLD: {
      idFromName: (name: string) => ({ name }),
      get: (stub: { name: string }) => ({
        // маршрут передаёт ('admin', playerId, astra, reason) — первый аргумент актор
        async grant(...args: unknown[]) {
          const [, pid, amount, why] = args as [string, string, number, string];
          const known = users.some((u) => u.id === pid && (u.world_id ?? 'w1') === stub.name);
          calls.push({ world: stub.name, playerId: pid, astra: amount, reason: why });
          if (!known) throw new ApiError(404, 'player_not_found');
          return { playerId: pid, granted: amount, astra: 1000 + amount, reason: why };
        },
      }),
    },
  } as unknown as Env;
  return { env, calls };
}

// Router ловит ApiError и превращает его в JSON — здесь повторяем ту же обвязку.
async function run(req: Request, env: Env): Promise<Response> {
  try {
    return await adminGrant(req, env);
  } catch (e) {
    return errorResponse(e);
  }
}

function request(body: unknown, world = 'w1') {
  return new Request(`https://astra.example/admin/world/grant?world=${world}`, {
    method: 'POST',
    headers: { 'X-Admin-Token': ADMIN_TOKEN, 'X-Admin-Email': ADMIN_EMAIL, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('parseGrantInput', () => {
  it('принимает player/astra/reason и обрезает пробелы', () => {
    expect(parseGrantInput({ player: '  abc123  ', astra: 50, reason: '  компенсация ' }))
      .toEqual({ player: 'abc123', astra: 50, reason: 'компенсация' });
  });

  it('понимает старые поля playerId и amount', () => {
    expect(parseGrantInput({ playerId: 'abc123', amount: -25, reason: 'штраф' }))
      .toEqual({ player: 'abc123', astra: -25, reason: 'штраф' });
  });

  it('называет отказы своими кодами', () => {
    const code = (body: Record<string, unknown>) => {
      try {
        parseGrantInput(body);
        return 'ok';
      } catch (e) {
        return e instanceof ApiError ? e.code : 'other';
      }
    };
    expect(code({ astra: 10, reason: 'x' })).toBe('bad_target');
    expect(code({ player: ' ', astra: 10, reason: 'x' })).toBe('bad_target');
    expect(code({ player: 'abc123', astra: 0, reason: 'x' })).toBe('bad_amount');
    expect(code({ player: 'abc123', astra: 1.5, reason: 'x' })).toBe('bad_amount');
    expect(code({ player: 'abc123', astra: 200_000, reason: 'x' })).toBe('bad_amount');
    expect(code({ player: 'abc123', astra: 10, reason: '' })).toBe('reason_required');
    expect(code({ player: 'abc123', astra: 10, reason: 'ок' })).toBe('ok');
  });
});

describe('findUserByRef', () => {
  const users = [
    { id: 'aaaaaaaa-1111-2222-3333-444444444444', email: 'Pilot@Example.com', world_id: 'w3' },
    { id: 'bbbbbbbb-1111-2222-3333-444444444444', email: 'other@example.com', world_id: 'w2' },
    { id: 'bbbbbbbb-9999-2222-3333-444444444444', email: null, world_id: 'w1' },
  ];

  it('находит по email без учёта регистра', async () => {
    const { env } = envWithUsers(users);
    expect(await findUserByRef(env.DB, 'pilot@example.com'))
      .toEqual({ ok: true, id: users[0].id, worldId: 'w3', by: 'email' });
  });

  it('находит по полному id', async () => {
    const { env } = envWithUsers(users);
    expect(await findUserByRef(env.DB, users[1].id))
      .toEqual({ ok: true, id: users[1].id, worldId: 'w2', by: 'id' });
  });

  it('находит по началу id — так игрок показан в списке', async () => {
    const { env } = envWithUsers(users);
    const ref = await findUserByRef(env.DB, users[0].id.slice(0, 8));
    expect(ref.ok && ref.id).toBe(users[0].id);
  });

  it('не угадывает, если начало id подходит нескольким', async () => {
    const { env } = envWithUsers(users);
    expect(await findUserByRef(env.DB, 'bbbbbbbb')).toEqual({ ok: false, error: 'ambiguous_player' });
  });

  it('возвращает player_not_found на мусор', async () => {
    const { env } = envWithUsers(users);
    expect(await findUserByRef(env.DB, 'nobody@example.com')).toEqual({ ok: false, error: 'player_not_found' });
    expect(await findUserByRef(env.DB, '')).toEqual({ ok: false, error: 'player_not_found' });
  });
});

describe('adminGrant', () => {
  const pilot = { id: 'aaaaaaaa-1111-2222-3333-444444444444', email: 'pilot@example.com', world_id: 'w3' };

  it('начисляет по email в мир игрока, а не в world из админки', async () => {
    const { env, calls } = envWithUsers([pilot]);
    const res = await run(request({ player: pilot.email, astra: 100, reason: 'компенсация' }, 'w1'), env);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toMatchObject({ ok: true, world: 'w3', playerId: pilot.id, resolvedBy: 'email', granted: 100, astra: 1100 });
    expect(calls).toEqual([{ world: 'w3', playerId: pilot.id, astra: 100, reason: 'компенсация' }]);
  });

  it('начисляет по началу id', async () => {
    const { env, calls } = envWithUsers([pilot]);
    const res = await run(request({ player: pilot.id.slice(0, 8), astra: 5, reason: 'тест' }), env);
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ world: 'w3', playerId: pilot.id, astra: 5 });
  });

  it('без причины отказывает понятным кодом и не трогает мир', async () => {
    const { env, calls } = envWithUsers([pilot]);
    const res = await run(request({ player: pilot.id, astra: 10 }), env);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('reason_required');
    expect(calls).toHaveLength(0);
  });

  it('чужой id отдаёт player_not_found, а не «что-то сломалось»', async () => {
    const { env } = envWithUsers([pilot]);
    const res = await run(request({ player: 'deadbeefdeadbeef', astra: 10, reason: 'x' }), env);
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe('player_not_found');
  });

  it('неоднозначное начало id — 409', async () => {
    const { env, calls } = envWithUsers([
      pilot,
      { id: 'aaaaaaaa-9999-2222-3333-444444444444', email: 'second@example.com', world_id: 'w1' },
    ]);
    const res = await run(request({ player: 'aaaaaaaa', astra: 10, reason: 'x' }), env);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe('ambiguous_player');
    expect(calls).toHaveLength(0);
  });

  it('без токена не начисляет', async () => {
    const { env, calls } = envWithUsers([pilot]);
    const req = new Request('https://astra.example/admin/world/grant?world=w1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: pilot.id, astra: 10, reason: 'x' }),
    });
    const res = await run(req, env);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
