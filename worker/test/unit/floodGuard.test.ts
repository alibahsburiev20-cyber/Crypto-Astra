import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTH_PER_MIN, DEFAULT_GLOBAL_PER_MIN, EVICT_TO, MAX_KEYS,
  bucketKind, createFloodGuard, floodCheck, floodLimits, resetFloodGuardForTests, retryAfterSec, takeToken,
  type Bucket, type FloodLimit,
} from '../../src/http/floodGuard';

// Затвор от ливня — единственная защита анонимных маршрутов, которые сознательно
// не тратят суточный бюджет (`/auth/*`, `/health`, `/ops/*`, `/pay/status.json`).
// Проверяем три вещи: ливень он действительно отсекает, живого человека — никогда,
// и память изолята не разрастается под миллион ключей.

const MIN = 60_000;

describe('шаг бакета', () => {
  it('даёт всплеск, а потом отказывает', () => {
    const limit: FloodLimit = { perMin: 60, burst: 60 };
    let bucket: Bucket | null = null;
    for (let i = 0; i < 60; i += 1) {
      const step = takeToken(bucket, limit, 1_000);
      expect(step.allowed).toBe(true);
      bucket = step.bucket;
    }
    const denied = takeToken(bucket, limit, 1_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('возвращает токены шагами и открывает бакет снова', () => {
    // 30 в минуту при шаге 2 000 мс — ровно один токен на шаг.
    const limit: FloodLimit = { perMin: 30, burst: 30 };
    const empty: Bucket = { tokens: 0, filledAt: 0, seenAt: 0 };
    const one = takeToken(empty, limit, 2_000);
    expect(one.allowed).toBe(true);
    const none = takeToken(one.bucket, limit, 2_000);
    expect(none.allowed).toBe(false);
    // Подождали ровно шаг → опять можно.
    const later = takeToken(none.bucket, limit, 4_000);
    expect(later.allowed).toBe(true);
  });

  it('не копит бесконечный запас после простоя', () => {
    const limit = { perMin: 60, burst: 60 };
    const idle = takeToken({ tokens: 0, filledAt: 0, seenAt: 0 }, limit, 100 * MIN);
    expect(idle.allowed).toBe(true);
    expect(idle.bucket.tokens).toBe(limit.burst - 1);
  });

  it('retryAfter не бывает нулевым', () => {
    expect(retryAfterSec(0)).toBe(1);
    expect(retryAfterSec(1)).toBe(1);
    expect(retryAfterSec(1500)).toBe(2);
  });
});

describe('пороги', () => {
  it('по умолчанию рассчитаны на человека, а не на скрипт', () => {
    const limits = floodLimits({});
    expect(limits.auth.perMin).toBe(DEFAULT_AUTH_PER_MIN);
    expect(limits.global.perMin).toBe(DEFAULT_GLOBAL_PER_MIN);
    expect(limits.auth.burst).toBeGreaterThanOrEqual(limits.auth.perMin);
    expect(limits.refresh.perMin).toBeGreaterThan(limits.auth.perMin);
    expect(limits.global.perMin).toBeGreaterThan(limits.refresh.perMin);
  });

  it('мусор в конфиге — значение по умолчанию, а не ноль', () => {
    for (const raw of ['', 'abc', '0', '-5', 'NaN', Infinity]) {
      const limits = floodLimits({ FLOOD_AUTH_PER_MIN: raw as string, FLOOD_GLOBAL_PER_MIN: raw as string });
      expect(limits.auth.perMin).toBe(DEFAULT_AUTH_PER_MIN);
      expect(limits.global.perMin).toBe(DEFAULT_GLOBAL_PER_MIN);
    }
    expect(floodLimits({ FLOOD_GLOBAL_PER_MIN: '100000' }).global.perMin).toBe(100_000);
  });

  it('маршруты разложены по корзинам', () => {
    expect(bucketKind('/auth/login')).toBe('auth');
    expect(bucketKind('/auth/register')).toBe('auth');
    expect(bucketKind('/auth/refresh')).toBe('refresh');
    expect(bucketKind('/auth/logout')).toBe('refresh');
    // Всё остальное — в общую: статика, 404 и статусы.
    expect(bucketKind('/index.html')).toBe('global');
    expect(bucketKind('/nope')).toBe('global');
    expect(bucketKind('/pay/withdraw')).toBe('global');
  });
});

describe('затвор по IP', () => {
  const req = (path: string, ip: string | null) => new Request(`https://astra.example${path}`, {
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  });
  const env = { FLOOD_AUTH_PER_MIN: '5', FLOOD_REFRESH_PER_MIN: '5', FLOOD_GLOBAL_PER_MIN: '5' };

  it('без IP не карает никого', () => {
    resetFloodGuardForTests();
    for (let i = 0; i < 50; i += 1) expect(floodCheck(req('/auth/login', null), env, '/auth/login')).toBeNull();
  });

  it('ливень на вход упирается в 429, а не в PBKDF2', async () => {
    resetFloodGuardForTests();
    const request = req('/auth/login', '203.0.113.7');
    for (let i = 0; i < 10; i += 1) expect(floodCheck(request, env, '/auth/login')).toBeNull();
    const blocked = floodCheck(request, env, '/auth/login');
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get('Retry-After')).toBeTruthy();
    expect(blocked!.headers.get('X-Astra-Flood')).toBe('1');
    expect(blocked!.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await blocked!.json()).toMatchObject({ ok: false, error: 'too_many_requests', scope: 'flood' });
  });

  it('бакеты разных IP и разных корзин не пересекаются', () => {
    resetFloodGuardForTests();
    const a = req('/auth/login', '198.51.100.1');
    const b = req('/auth/login', '198.51.100.2');
    for (let i = 0; i < 10; i += 1) expect(floodCheck(a, env, '/auth/login')).toBeNull();
    expect(floodCheck(a, env, '/auth/login')).not.toBeNull();
    // Второй адрес ничего не заметил.
    expect(floodCheck(b, env, '/auth/login')).toBeNull();
    // И refresh — другая корзина того же адреса: лимит входа не должен ломать
    // продление сессий у всех, кто рядом.
    expect(floodCheck(a, env, '/auth/refresh')).toBeNull();
  });

  it('429 живёт ровно столько, сколько обещает Retry-After', async () => {
    resetFloodGuardForTests();
    const request = req('/auth/login', '192.0.2.9');
    // Пробиваем всплеск и попадаем в отказ.
    for (let i = 0; i < 40; i += 1) floodCheck(request, env, '/auth/login');
    const blocked = floodCheck(request, env, '/auth/login');
    expect(blocked).not.toBeNull();
    const body = await blocked!.json() as { retryAfter: number };
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
  });
});

describe('память изолята', () => {
  it('карта не растёт бесконечно', () => {
    const limits = floodLimits({});
    const guard = createFloodGuard(limits);
    // Каждый запрос — новый адрес: так выглядит спрей по подсети. Потолок
    // держит размер, а не «повезёт с вытеснением».
    const now = 1_700_000_000_000;
    for (let i = 0; i < MAX_KEYS + 10; i += 1) guard.check(`10.0.${Math.floor(i / 256)}.${i % 256}`, 'global', now + i);
    expect(guard.size()).toBeLessThanOrEqual(MAX_KEYS);
    // Ужимка идёт до 3/4 карты — иначе следующая же вставка звала бы чистку снова.
    expect(guard.size()).toBeLessThanOrEqual(EVICT_TO + 10);
    expect(guard.size()).toBeGreaterThan(EVICT_TO - 10);
    guard.reset();
    expect(guard.size()).toBe(0);
  });

  it('забытый IP начинает с чистого листа', () => {
    const limits = { auth: { perMin: 1, burst: 1 }, refresh: { perMin: 1, burst: 1 }, global: { perMin: 1, burst: 1 } };
    const guard = createFloodGuard(limits);
    expect(guard.check('192.0.2.1', 'auth', 1_000).allowed).toBe(true);
    expect(guard.check('192.0.2.1', 'auth', 1_000).allowed).toBe(false);
    // Сутки спустя тот же адрес снова человек.
    expect(guard.check('192.0.2.1', 'auth', 1_000 + 24 * 60 * MIN).allowed).toBe(true);
  });
});

describe('проводка', () => {
  // Затвор живёт в `index.ts` — до отдачи статики и до бюджета. Если его поставить
  // позже, ливень успевает потратить суточный лимит записей D1 ровно на то, чтобы
  // получить 429. Проверка по исходнику, а не по поведению: `index.ts` импортирует
  // `cloudflare:workers` и в юните не исполняется.
  const source = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');

  it('проверка стоит раньше статики и бюджета', () => {
    const at = source.indexOf('floodCheck(request, env');
    expect(at).toBeGreaterThan(-1);
    expect(source.indexOf('staticResponse(url.pathname')).toBeGreaterThan(at);
    expect(source.indexOf('withBudget(request, env')).toBeGreaterThan(at);
  });

  it('переменные окружения описаны в типе Env', () => {
    const env = readFileSync(new URL('../../src/env.ts', import.meta.url), 'utf8');
    for (const key of ['FLOOD_AUTH_PER_MIN', 'FLOOD_REFRESH_PER_MIN', 'FLOOD_GLOBAL_PER_MIN']) {
      expect(env).toContain(`${key}?: string;`);
    }
  });
});
