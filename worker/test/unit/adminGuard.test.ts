// Админка на бесплатном домене: токен + блокировка подбора по IP.
//
// Домен и Cloudflare Access стоят денег, поэтому основной сценарий — `*.workers.dev`,
// где перед админкой нет ничего, кроме нашей проверки. Значит она обязана
// выдерживать перебор и при этом не запирать владельца навсегда.
import { describe, expect, it } from 'vitest';
import { requireAdmin, ADMIN_IP_MAX } from '../../src/http/admin';
import type { Env } from '../../src/env';

interface Row { key: string; attempts: number; window_start: number; blocked_until: number }

/** Минимальный D1 для auth_limits: только то, что использует охрана. */
function fakeDb() {
  const rows = new Map<string, Row>();
  const db = {
    prepare(sql: string) {
      let params: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          params = args;
          return this;
        },
        async first<T>() {
          if (!sql.includes('FROM auth_limits')) throw new Error(`unexpected sql: ${sql}`);
          const row = rows.get(String(params[0]));
          return (row ? { ...row } : null) as T | null;
        },
        async run() {
          if (sql.includes('INSERT INTO auth_limits')) {
            rows.set(String(params[0]), {
              key: String(params[0]),
              attempts: Number(params[1]),
              window_start: Number(params[2]),
              blocked_until: Number(params[3]),
            });
            return { success: true };
          }
          if (sql.includes('DELETE FROM auth_limits')) {
            rows.delete(String(params[0]));
            return { success: true };
          }
          throw new Error(`unexpected sql: ${sql}`);
        },
      };
    },
  };
  return { db: db as unknown as D1Database, rows };
}

function env(db: D1Database, extra: Partial<Env> = {}): Env {
  return { DB: db, ADMIN_TOKEN: 'a'.repeat(40), ...extra } as unknown as Env;
}

function request(token: string | null, ip = '203.0.113.7', email?: string): Request {
  const headers = new Headers({ 'CF-Connecting-IP': ip });
  if (token !== null) headers.set('X-Admin-Token', token);
  if (email) headers.set('X-Admin-Email', email);
  return new Request('https://example.com/admin/pool', { headers });
}

const status = async (fn: () => Promise<void>): Promise<number> => {
  try {
    await fn();
    return 200;
  } catch (e) {
    return (e as { status: number }).status;
  }
};

describe('охрана админки', () => {
  it('без секрета отвечает 503, без токена — 401', async () => {
    expect(await status(() => requireAdmin(request('x'), env(fakeDb().db, { ADMIN_TOKEN: '' })))).toBe(503);
    expect(await status(() => requireAdmin(request(null), env(fakeDb().db)))).toBe(401);
  });

  it('верный токен пропускает и сбрасывает счётчик', async () => {
    const { db, rows } = fakeDb();
    expect(await status(() => requireAdmin(request('a'.repeat(40)), env(db)))).toBe(200);
    expect(rows.size).toBe(0);
  });

  it('после 10 неверных токенов с одного IP — 429 на 15 минут', async () => {
    const { db, rows } = fakeDb();
    const e = env(db);
    for (let i = 1; i < ADMIN_IP_MAX; i += 1) {
      expect(await status(() => requireAdmin(request('bad'.repeat(10)), e))).toBe(403);
    }
    expect(await status(() => requireAdmin(request('bad'.repeat(10)), e))).toBe(429);
    // Блокировка общая: даже верный токен ждёт, пока не истечёт окно.
    expect(await status(() => requireAdmin(request('a'.repeat(40)), e))).toBe(429);
    expect([...rows.values()][0].blocked_until).toBeGreaterThan(Date.now());
  });

  it('другой IP не страдает от блокировки соседа', async () => {
    const { db } = fakeDb();
    const e = env(db);
    for (let i = 0; i <= ADMIN_IP_MAX; i += 1) {
      await status(() => requireAdmin(request('bad'.repeat(10), '198.51.100.1'), e));
    }
    expect(await status(() => requireAdmin(request('a'.repeat(40), '198.51.100.2'), e))).toBe(200);
  });

  it('пустой токен не считается попыткой подбора', async () => {
    const { db, rows } = fakeDb();
    const e = env(db);
    for (let i = 0; i < ADMIN_IP_MAX + 3; i += 1) {
      expect(await status(() => requireAdmin(request(null), e))).toBe(401);
    }
    expect(rows.size).toBe(0);
  });

  it('ADMIN_EMAIL проверяется и участвует в счётчике', async () => {
    const { db } = fakeDb();
    const e = env(db, { ADMIN_EMAIL: 'owner@example.com' });
    expect(await status(() => requireAdmin(request('a'.repeat(40), '203.0.113.9', 'owner@example.com'), e))).toBe(200);
    expect(await status(() => requireAdmin(request('a'.repeat(40), '203.0.113.9'), e))).toBe(403);
  });
});
