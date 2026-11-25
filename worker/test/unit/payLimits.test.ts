import { describe, expect, it } from 'vitest';
import { ACCESS_TTL_SEC, signJwt } from '../../src/auth/jwt';
import { route } from '../../src/http/router';
import type { Env } from '../../src/env';

// Денежные маршруты игрока — `/pay/*` — стоят под `requireAuth`, но вне
// `enforceUserLimit` не должны оставаться: `/pay/qr` на каждый запрос рисует PNG
// и гоняет его через deflate (CPU изолята), а `/pay/withdraw` и `/pay/purchase`
// дёргают D1 пятью-шестью запросами. Суточный бюджет их не бережёт — `/pay/`
// помечен критичным маршрутом, чтобы деградация не отрезала игроку его деньги.
// Значит личный потолок обязан быть здесь.

const SECRET = 'unit-test-secret-unit-test-secret';

function env(attempts: number): Env {
  const db = {
    prepare(sql: string) {
      const api = {
        bind() { return api; },
        async first() {
          if (/FROM auth_limits/.test(sql)) return { attempts, window_start: Date.now() };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
      return api;
    },
  } as unknown as D1Database;
  return { DB: db, JWT_SECRET: SECRET } as unknown as Env;
}

async function authHeader(): Promise<string> {
  const token = await signJwt({ sub: 'u1', w: 'w1' }, SECRET, Math.floor(Date.now() / 1000), ACCESS_TTL_SEC);
  return `Bearer ${token}`;
}

async function call(path: string, method: 'GET' | 'POST', attempts: number): Promise<Response> {
  return route(new Request(`https://astra.example${path}`, {
    method,
    headers: { Authorization: await authHeader(), 'CF-Connecting-IP': '203.0.113.7' },
  }), env(attempts));
}

describe('частотный потолок на денежных маршрутах', () => {
  it('перебор `/pay/qr` упирается в 429, а не в очередь рендера', async () => {
    const res = await call('/pay/qr', 'GET', 10_000);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'too_many_requests' });
  });

  it('запись тоже считается: `/pay/withdraw` под потолком', async () => {
    const res = await call('/pay/withdraw', 'POST', 10_000);
    expect(res.status).toBe(429);
  });

  it('пока потолок не тронут, маршрут идёт дальше — и честно отвечает про флаги', async () => {
    // 503 `payouts_disabled`, а не 429: значит лимит не превратился в «закрыть
    // деньги всем». Пустой attempts = свежий счётчик.
    const res = await call('/pay/withdraw', 'POST', 0);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'payouts_disabled' });
  });

  it('без токена — 401 до всякого лимита', async () => {
    const res = await route(new Request('https://astra.example/pay/qr'), env(10_000));
    expect(res.status).toBe(401);
  });
});
