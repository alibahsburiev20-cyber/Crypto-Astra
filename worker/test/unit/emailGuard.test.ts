// Проверка почты при регистрации: выдуманный адрес не должен проходить вовсе.
//
// Здесь три уровня: формат, списки (помойки/свои домены) и DNS (MX). Плюс
// нормализация алиасов — она же защита от «второй аккаунт тем же ящиком».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalEmail, clearMxCache, domainAcceptsMail, emailProblem, isKnownProvider, signupGuardEnabled,
} from '../../src/auth/emailGuard';
import { readFileSync } from 'node:fs';
import { makeD1 } from '../helpers/d1';
import type { Env } from '../../src/env';

const SECRET = 'email-guard-secret-email-guard-secret-1';

function accountDb() {
  const { db, raw } = makeD1();
  for (const file of ['0001_users.sql', '0002_sessions.sql', '0003_world_seats.sql', '0004_auth_limits.sql']) {
    raw.exec(readFileSync(new URL(`../../migrations/d1/${file}`, import.meta.url), 'utf8'));
  }
  return { db, raw };
}

/** Окружение, где регистрация доходит до конца: лобби даёт место, мир создаёт игрока. */
function env(overrides: Partial<Env> = {}): Env {
  const { db, raw } = accountDb();
  const lobby = {
    reserve: async () => ({ reservationId: 'r1', worldId: 'w1' }),
    release: async () => undefined,
    confirm: async () => undefined,
  };
  return {
    DB: db,
    JWT_SECRET: SECRET,
    // Секрет задан специально: регистрация обязана проходить и без токена Turnstile.
    TURNSTILE_SECRET: 'turnstile-secret-value',
    SIGNUP_GUARD: 'off',
    __raw: raw,
    LOBBY: { idFromName: () => 'lobby', get: () => lobby } as unknown as Env['LOBBY'],
    WORLD: { idFromName: () => 'world', get: () => ({ createPlayer: async () => undefined }) } as unknown as Env['WORLD'],
    ...overrides,
  } as unknown as Env;
}

/**
 * Через настоящий роутер: он же и превращает `ApiError` в ответ. Мерять поведение
 * функции-обработчика напрямую — значит проверять не то, что видит клиент.
 */
async function call(request: Request, e: Env): Promise<Response> {
  const { route } = await import('../../src/http/router');
  return route(request, e);
}

function post(body: unknown, ip = '203.0.113.7'): Request {
  return new Request('https://game.test/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

function dnsAnswer(data: string, type = 15): Response {
  return new Response(JSON.stringify({ Status: 0, TC: false, RD: true, RA: true, Answer: [{ name: 'x', type, TTL: 300, data }] }));
}

beforeEach(() => clearMxCache());
afterEach(() => {
  vi.unstubAllGlobals();
  clearMxCache();
});

describe('формат адреса', () => {
  it('настоящие адреса проходят', () => {
    for (const ok of [
      'a@b.io', 'john.smith@gmail.com', 'user+tag@gmx.de', 'x-9@mail.ru', 'name@sub.domain.co.uk',
      "who!'e@sub-a.net", 'ab@cd.net', 'axb@example.org',
    ]) {
      expect(emailProblem(ok), ok).toBeNull();
    }
  });

  it('выдуманные и мусорные — bad_email', () => {
    for (const bad of [
      'a@b', 'a@b.', 'a@b.c', '@b.cc', 'a@@b.cc', 'a b@c.com', 'a@b..com', '.a@b.com', 'a.@b.com',
      'a@-b.com', 'a@b-.com', 'a@b_c.com', 'a@1.2.3.4', 'a@b,com', 'a@b.cc extra', 'a@b.c1',
      `${'a'.repeat(65)}@b.com`, 'a@'.concat('b'.repeat(260), '.com'), '<script>@b.com',
      'a@b.c(m', 'a@b..', 'a@.com', 'a@', 'plainword',
    ]) {
      expect(emailProblem(bad), bad).toBe('bad_email');
    }
  });

  it('пустая локальная часть после отрезания `+хвоста` — не адрес', () => {
    expect(emailProblem('+tag@gmail.com')).toBe('bad_email');
    // Тот же адрес без хвоста — нормальный.
    expect(emailProblem('tag@gmail.com')).toBeNull();
  });

  it('одноразовые ящики отсекаются списком', () => {
    expect(emailProblem('x@mailinator.com')).toBe('disposable_email');
    expect(emailProblem('x@10minutemail.com')).toBe('disposable_email');
    expect(emailProblem('x@sharklasers.com')).toBe('disposable_email');
    expect(emailProblem('x@guerrillamail.com')).toBe('disposable_email');
    // Обычный домен с похожим именем не задевает.
    expect(emailProblem('x@mail.com')).toBeNull();
    expect(isKnownProvider('gmail.com')).toBe(true);
    expect(isKnownProvider('new-mail-startup.ru')).toBe(false);
  });
});

describe('нормализация алиасов', () => {
  it('Gmail: точки и `+хвост` не создают второй ящик', () => {
    expect(canonicalEmail('John.Smith+shop@gmail.com')).toBe('johnsmith@gmail.com');
    expect(canonicalEmail('john.smith@gmail.com')).toBe('johnsmith@gmail.com');
    expect(canonicalEmail('john@gmail.com')).toBe('john@gmail.com');
    expect(canonicalEmail('a@googlemail.com')).toBe('a@gmail.com');
  });

  it('остальным почтовикам точки не трогаем, `+хвост` режем всем', () => {
    expect(canonicalEmail('first.last@web.de')).toBe('first.last@web.de');
    expect(canonicalEmail('first.last+x@web.de')).toBe('first.last@web.de');
    expect(canonicalEmail('a+b@example.com')).toBe('a@example.com');
    // Пустая локальная часть — не нормализуем в мусор, оставляем как есть.
    expect(canonicalEmail('+b@example.com')).toBe('+b@example.com');
  });
});

describe('MX через DoH', () => {
  it('MX есть — домен принимается, ответ кэшируется', async () => {
    const fetchImpl = vi.fn(async () => dnsAnswer('10 smtp.gmail.com.')) as unknown as typeof fetch;
    await expect(domainAcceptsMail('gmail.com', fetchImpl)).resolves.toEqual({ ok: true });
    await expect(domainAcceptsMail('gmail.com', fetchImpl)).resolves.toEqual({ ok: true });
    // Один запрос на домен, а не на регистрацию: иначе DDoS за наш счёт.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('нет ответов — no_mx', async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ Status: 0, TC: false, RD: true, RA: true }))) as unknown as typeof fetch;
    await expect(domainAcceptsMail('notemail.test', empty)).resolves.toEqual({ ok: false, reason: 'no_mx' });
  });

  it('`null MX` (RFC 7505) — домен сам отказался принимать почту', async () => {
    const nullMx = vi.fn(async () => dnsAnswer('0 .')) as unknown as typeof fetch;
    await expect(domainAcceptsMail('nope.example', nullMx)).resolves.toEqual({ ok: false, reason: 'no_mx' });
  });

  it('NXDOMAIN — домена нет', async () => {
    const nx = vi.fn(async () => new Response(JSON.stringify({ Status: 3, TC: false, RD: true, RA: true }))) as unknown as typeof fetch;
    await expect(domainAcceptsMail('asdkjh12312.com', nx)).resolves.toEqual({ ok: false, reason: 'no_mx' });
  });

  it('DNS молчит — email_check_unavailable, и это не кэшируется', async () => {
    const down = vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
    await expect(domainAcceptsMail('gmail.com', down)).resolves.toEqual({ ok: false, reason: 'email_check_unavailable' });
    // Повтор игрока не должен упереться в закешированный сбой: следующий вызов идёт в сеть.
    const up = vi.fn(async () => dnsAnswer('10 smtp.gmail.com.')) as unknown as typeof fetch;
    await expect(domainAcceptsMail('gmail.com', up)).resolves.toEqual({ ok: true });
    expect(up).toHaveBeenCalledTimes(1);
  });

  it('строгий контур включён, пока не сказано явно «off»', () => {
    expect(signupGuardEnabled({})).toBe(true);
    expect(signupGuardEnabled({ SIGNUP_GUARD: 'on' })).toBe(true);
    expect(signupGuardEnabled({ SIGNUP_GUARD: 'off' })).toBe(false);
    expect(signupGuardEnabled({ SIGNUP_GUARD: 'OFF' })).toBe(false);
  });
});

describe('регистрация', () => {
  it('капча больше не нужна, а почта — да', async () => {
    // TURNSTILE_SECRET в окружении задан: раньше это значило «403 turnstile_required».
    const e = env();
    const res = await call(post({ email: 'pilot@web.de', password: 'correct horse battery' }), e);
    expect(res.status).toBe(200);
    const body = await res.json() as { access_token?: string; user?: { world_id?: string } };
    expect(typeof body.access_token).toBe('string');
    expect(body.user?.world_id).toBe('w1');
    // В базе — канонический адрес.
    expect(e.__raw.prepare('SELECT email FROM users').all().map((r: { email: string }) => r.email))
      .toEqual(['pilot@web.de']);
  });

  it('одноразовый ящик — 400, строка в users не появляется', async () => {
    const e = env();
    const res = await call(post({ email: 'junk@mailinator.com', password: 'correct horse battery' }), e);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'disposable_email' });
    expect(e.__raw.prepare('SELECT id FROM users').all()).toEqual([]);
  });

  it('домен без MX — 400 no_mx', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ Status: 0, Answer: [] })));
    vi.stubGlobal('fetch', fetchImpl);
    const e = env({ SIGNUP_GUARD: 'on' });
    const res = await call(post({ email: 'qwe@asdasd-12312.com', password: 'correct horse battery' }), e);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'no_mx' });
    expect(e.__raw.prepare('SELECT id FROM users').all()).toEqual([]);
  });

  it('DNS не ответил — 503 и «повтори», а не «почты нет»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('dns down'); }));
    const e = env({ SIGNUP_GUARD: 'on' });
    const res = await call(post({ email: 'someone@gmail.com', password: 'correct horse battery' }), e);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'email_check_unavailable' });
  });

  it('алиас уже занятого ящика не создаёт второй аккаунт', async () => {
    const e = env();
    expect((await call(post({ email: 'pilot@gmail.com', password: 'correct horse battery' }), e)).status).toBe(200);
    const alias = await call(post({ email: 'pi.lot+shop@gmail.com', password: 'correct horse battery' }, '198.51.100.5'), e);
    expect(alias.status).toBe(409);
    expect(await alias.json()).toEqual({ error: 'email_taken' });
    expect(e.__raw.prepare('SELECT email FROM users').all().map((r: { email: string }) => r.email))
      .toEqual(['pilot@gmail.com']);
  });

  it('с неизвестного домена больше семи регистраций в час — 429', async () => {
    // Домен выдуманный, поэтому MX подменяем: иначе тест падал бы на DNS, а не на потолок.
    vi.stubGlobal('fetch', vi.fn(async () => dnsAnswer('10 mx.small-crew.example.')));
    const e = env({ SIGNUP_GUARD: 'on' });
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) {
      const res = await call(post({ email: `pilot${i}@small-crew.example`, password: 'correct horse battery' }, `203.0.${113 + i}.1`), e);
      statuses.push(res.status);
    }
    // Лимит на домен (8) срабатывает раньше, чем на IP (10), и каждый раз своим IP.
    expect(statuses.filter((s) => s === 200).length).toBe(7);
    expect(statuses[7]).toBe(429);
    const body = await call(post({ email: 'pilot99@small-crew.example', password: 'correct horse battery' }, '198.51.100.9'), e);
    expect(await body.json()).toEqual({ error: 'too_many_signup_from_domain' });
  });

  it('большому почтовику потолок на домен не мешает', async () => {
    // Строгий контур включён: важно, что 8 регистраций с одного крупного домена
    // проходят, хотя с неизвестного на восьмой уже был бы 429.
    vi.stubGlobal('fetch', vi.fn(async () => dnsAnswer('10 mx.web.de.')));
    const e = env({ SIGNUP_GUARD: 'on' });
    for (let i = 0; i < 8; i++) {
      const res = await call(post({ email: `pilot${i}@web.de`, password: 'correct horse battery' }, `203.0.${113 + (i % 3)}.${i + 1}`), e);
      // 8 разных адресов с одного крупного домена: ни одного 429 по домену.
      expect(res.status, `попытка ${i}`).toBe(200);
    }
  });

  it('вход по алиасу находит основной аккаунт', async () => {
    const e = env();
    expect((await call(post({ email: 'pilot@gmail.com', password: 'correct horse battery' }), e)).status).toBe(200);
    const res = await call(new Request('https://game.test/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.30' },
      body: JSON.stringify({ email: 'Pi.Lot+news@gmail.com', password: 'correct horse battery' }),
    }), e);
    expect(res.status).toBe(200);
  });

  it('старый аккаунт, записанный с `+хвостом`, не теряется', async () => {
    const e = env();
    e.__raw.exec(`INSERT INTO users (id, email, password_hash, status, world_id, created_at) VALUES ('legacy1', 'old.user+old@gmail.com', 'x', 'active', 'w1', 1)`);
    const res = await call(new Request('https://game.test/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.31' },
      body: JSON.stringify({ email: 'old.user+old@gmail.com', password: 'whatever-but-long' }),
    }), e);
    // Пароль не подходит — но аккаунт найден: отказ «не та пара», а не «нет такого».
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_credentials' });
  });
});
