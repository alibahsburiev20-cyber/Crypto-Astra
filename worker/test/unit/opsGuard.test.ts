// Обёртка бюджета вокруг маршрутов.
//
// Смысл теста: при перегрузке игрок получает понятный 503 с временем ожидания,
// а не «что-то сломалось», и при этом деньги, вход и админка продолжают
// работать. Это ровно то, что отличает «сайт бережёт себя» от «сайт упал».
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../src/env';
import { withBudget, MODE_HEADER } from '../../src/ops/guard';
import { ensureOpsSchema, resetCounterForTests, resetOpsSchemaForTests, utcDay } from '../../src/ops/budget';
import { makeD1 } from '../helpers/d1';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

beforeEach(() => {
  resetCounterForTests();
  resetOpsSchemaForTests();
});

async function envWith(used: number, budget = '100'): Promise<Env> {
  const { db } = makeD1();
  await ensureOpsSchema(db);
  if (used > 0) {
    await db.prepare('INSERT INTO ops_usage (day, requests, updated_at) VALUES (?, ?, ?)')
      .bind(utcDay(NOW), used, NOW).run();
  }
  return { DB: db, REQUEST_BUDGET: budget } as unknown as Env;
}

function hit(path: string) {
  return new Response(JSON.stringify({ ok: true, path }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

async function call(env: Env, path: string) {
  let ran = false;
  const res = await withBudget(
    new Request(`https://astra.test${path}`),
    env,
    async () => { ran = true; return hit(path); },
    NOW,
  );
  return { res, ran };
}

describe('обычная работа', () => {
  it('запрос проходит, режим виден в заголовке', async () => {
    const env = await envWith(0);
    const { res, ran } = await call(env, '/me');
    expect(ran).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get(MODE_HEADER)).toBe('full');
  });

  it('критичные маршруты не тратят бюджет', async () => {
    const env = await envWith(0);
    await call(env, '/health');
    await call(env, '/ops/status');
    await call(env, '/auth/login');
    await call(env, '/pay/purchase');
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM ops_usage').first<number>('n');
    expect(Number(row)).toBe(0);
  });

  it('обычный запрос бюджет тратит', async () => {
    const env = await envWith(0);
    const { res } = await call(env, '/me');
    expect(res.headers.get(MODE_HEADER)).toBe('full');
    // Счётчик в памяти: значение видно сразу, до сброса в D1.
    const { peekBudget } = await import('../../src/ops/budget');
    expect((await peekBudget(env.DB, NOW, 100)).used).toBe(1);
  });
});

describe('деградация', () => {
  it('на 80 % отключаются витрины, игра живёт', async () => {
    const env = await envWith(81); // 81 из 100 = lite
    const market = await call(env, '/market');
    expect(market.ran).toBe(false);
    expect(market.res.status).toBe(503);
    expect((await market.res.json() as { error: string }).error).toBe('server_lite');
    expect(market.res.headers.get(MODE_HEADER)).toBe('lite');

    const me = await call(env, '/me');
    expect(me.ran).toBe(true);
    expect(me.res.status).toBe(200);
  });

  it('на 95 % остаются только деньги, вход и админка', async () => {
    const env = await envWith(96); // sleep
    const me = await call(env, '/me');
    expect(me.ran).toBe(false);
    expect(me.res.status).toBe(503);
    const body = await me.res.json() as { error: string; retryAfter: number; until: string };
    expect(body.error).toBe('server_sleep');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.until).toMatch(/T/);
    expect(me.res.headers.get('retry-after')).toBe(String(body.retryAfter));

    for (const path of ['/health', '/pay/purchase', '/admin/pay', '/auth/login']) {
      const res = await call(env, path);
      expect(res.ran).toBe(true);
      expect(res.res.status).toBe(200);
    }
  });

  it('в sleep заголовок режима тоже виден', async () => {
    const env = await envWith(99);
    const { res } = await call(env, '/claim');
    expect(res.headers.get(MODE_HEADER)).toBe('sleep');
  });

  it('критичный маршрут в sleep тоже говорит правду о режиме', async () => {
    // Иначе мониторинг по /health решил бы, что всё хорошо, когда сайт в sleep.
    const env = await envWith(99);
    const { res, ran } = await call(env, '/health');
    expect(ran).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers.get(MODE_HEADER)).toBe('sleep');
  });
});

describe('сломанный счётчик', () => {
  it('не блокирует игру: лучше работать без статистики, чем не работать', async () => {
    const broken = { DB: { prepare: () => { throw new Error('d1_down'); } } } as unknown as Env;
    const res = await withBudget(new Request('https://astra.test/me'), broken, async () => hit('/me'), NOW);
    expect(res.status).toBe(200);
  });
});
