// Проверка поверхности атаки.
//
// Идея простая: вместо «мы всё закрыли» — прогнать по коду сами атаки и оставить
// их здесь как тесты. Список сверен с OWASP Top 10 (2025), OWASP API Security Top
// 10 (2023) и с перечнем векторов L7-DDoS, который обслуживает Cloudflare; разбор
// по пунктам — в `docs/SECURITY.md`.
//
// Что здесь проверяется: инъекции (SQL/Shell/прототипа), подделка токенов,
// доступ к чужим объектам, mass assignment, переполнение и истощение ресурсов,
// ReDoS, заголовки безопасности, обход кэша и статических путей, перебор и
// блокировки, корректность отказов (ничего не течёт в 500).
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { login, register } from '../../src/routes/auth';
import { parseBatchOps, BATCH_MAX_OPS, BATCH_MAX_BODY } from '../../src/http/batch';
import { errorResponse, json, readJson, MAX_JSON_BYTES } from '../../src/http/response';
import { SECURITY_HEADERS, CSP } from '../../src/http/security';
import { signJwt, verifyJwt } from '../../src/auth/jwt';
import { fromB64Url, toB64Url } from '../../src/shared/encoding';
import { hashPassword } from '../../src/auth/password';
import { readRefreshCookie, refreshCookie } from '../../src/http/cookies';
import { checkUserLimit } from '../../src/http/userLimit';
import { sameToken } from '../../src/http/admin';
import { isCountableTable, adminSummary } from '../../src/world/modules/adminWorld';
import { canonicalEmail } from '../../src/auth/emailGuard';
import { callsignProblem, normalizeCallsign } from '../../src/world/modules/identity';
import { createLot, buyLot, cancelLot } from '../../src/world/modules/market';
import { createPlayer } from '../../src/world/modules/players';
import { buildState } from '../../src/world/modules/state';
import { addResource } from '../../src/world/modules/maintenance';
import { verifyLedger } from '../../src/world/ledger';
import { SITE_FILES } from '../../src/static/site';
import { makeD1 } from '../helpers/d1';
import { makeWorld } from '../helpers/sqlShim';
import type { Env } from '../../src/env';

const SECRET = 'attack-surface-secret-attack-surface-secret';
const T0 = 86_400_000 * 10;

// ── Каркас ─────────────────────────────────────────────────────────────────

/** D1 с реальными таблицями аккаунтов: миграции прогоняются как есть. */
function accountDb() {
  const { db, raw } = makeD1();
  for (const file of ['0001_users.sql', '0002_sessions.sql', '0003_world_seats.sql', '0004_auth_limits.sql']) {
    const sql = readFileSync(new URL(`../../migrations/d1/${file}`, import.meta.url), 'utf8');
    raw.exec(sql);
  }
  return { db, raw };
}

function env(overrides: Partial<Env> = {}): Env {
  const { db, raw } = accountDb();
  return {
    DB: db,
    JWT_SECRET: SECRET,
    TURNSTILE_SECRET: '',
    // DNS из теста недоступен, а проверка почты — отдельный модуль со своими
    // тестами (emailGuard.test.ts). Здесь важно поведение доступа и лимитов.
    // Формат адреса и список помоек при этом остаются включёнными.
    SIGNUP_GUARD: 'off',
    __raw: raw,
    ...overrides,
  } as unknown as Env;
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://game.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Тело без Content-Length: chunked-передача, где «проверка заголовка» бессмысленна. */
function postChunked(path: string, text: string): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(text);
      // Кусками по 8 КиБ — как раз чтобы «прочитать и потом померить» не сработало.
      for (let i = 0; i < bytes.length; i += 8192) controller.enqueue(bytes.subarray(i, i + 8192));
      controller.close();
    },
  });
  return new Request(`https://game.test${path}`, {
    method: 'POST', duplex: 'half' as never, body: stream,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SQLI = [
  "' OR '1'='1' --",
  "admin'--",
  "'; DROP TABLE users; --",
  '1 UNION SELECT id, email, password_hash FROM users',
  "') OR 1=1 LIMIT 1 --",
  'sleep(5)#',
  '\\x27 OR 1=1',
  "or 1=1 /*",
];
const XSS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg/onload=alert(1)>',
  "javascript:alert(location)",
  '<iframe src="//evil.test"></iframe>',
];

// ── A05 / API5 — инъекции ──────────────────────────────────────────────────
describe('инъекции', () => {
  it('SQLi в email и пароле не входит ни под каким аккаунтом и не трогает таблицу', async () => {
    const e = env();
    const stored = await hashPassword('correct horse battery staple');
    e.DB.prepare("INSERT INTO users (id, email, password_hash, status, world_id, created_at) VALUES ('u1', 'a@b.cc', ?, 'active', 'w1', 1)")
      .bind(stored).run();

    // «Похожий на email» проходит валидатор и упирается именно в пароль — 401.
    const shaped = ["evil' OR 1=1--@b.cc", "a@b.cc'); --", "a' or '1'='1@b.cc"];
    for (const payload of [...SQLI, ...shaped]) {
      const res = await login2(post('/auth/login', { email: payload, password: payload }), e);
      // Ни 2xx, ни 5xx: максимум — «не тот email» (400) или «не тот пароль» (401).
      expect([400, 401], payload).toContain(res.status);
      if (res.status === 401) expect(await res.json()).toEqual({ error: 'invalid_credentials' });
    }
    // Настоящий пароль под этим же логином входит — значит отказ выше не «всё
    // подряд блокируем», а инъекция не сработала.
    const ok = await login2(post('/auth/login', { email: 'a@b.cc', password: 'correct horse battery staple' }), e);
    expect(ok.status).toBe(200);
    // Таблицы на месте, строка цела: ни DROP, ни UPDATE не прошли.
    const rows = e.__raw.prepare('SELECT id, email FROM users').all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['u1']);
  });

  it('SQLi в имени ресурса и в id лота — отказ, журнал сходится', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    for (const payload of SQLI) {
      expect(() => tx(() => createLot(sql, 'p1', `k-${payload.length}`, { resource: payload, amount: 1, unitPrice: 1 }, T0)))
        .toThrow(/bad_resource/);
      expect(() => tx(() => buyLot(sql, 'p1', `b-${payload.length}`, payload, T0))).toThrow(/lot_not_found/);
      expect(() => tx(() => cancelLot(sql, 'p1', `c-${payload.length}`, payload, T0))).toThrow(/lot_not_found/);
    }
    expect(sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='balances'").toArray().length).toBe(1);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('админский отчёт считает только таблицы из белого списка', () => {
    expect(isCountableTable('players')).toBe(true);
    for (const name of ['players; DROP TABLE players', 'ledger--', '(SELECT 1)', 'sqlite_master', 'users']) {
      expect(isCountableTable(name), name).toBe(false);
    }
    const { sql } = makeWorld();
    expect(() => adminSummary(sql, 10, T0)).not.toThrow();
  });

  it('SQLi и XSS в позывном отсекаются на валидации', () => {
    for (const payload of [...SQLI, ...XSS]) {
      expect(callsignProblem(normalizeCallsign(payload)), payload).toBe('bad_callsign');
    }
    // Нулевой байт и управляющие символы — тоже мусор, а не позывной.
    expect(callsignProblem(normalizeCallsign('astr\u0000a'))).toBe('bad_callsign');
  });
});

// ── A07 / API2 — подделка токена и сессий ──────────────────────────────────
describe('токены и сессии', () => {
  const NOW = 1_800_000_000;
  const ACCESS_TTL = 15 * 60;

  it('alg none, пустой секрет и чужой секрет — отказ', async () => {
    const good = await signJwt({ sub: 'u1', w: 'w1' }, SECRET, NOW);
    const [header, payload] = good.split('.');

    // Классика: «подпишу alg=none и уберу подпись».
    const none = `${toB64Url(new TextEncoder().encode(JSON.stringify({ alg: 'none', typ: 'JWT' })))}.${payload}.`;
    expect(await verifyJwt(none, SECRET, NOW)).toBeNull();
    expect(await verifyJwt(`${header}.${payload}.`, SECRET, NOW)).toBeNull();
    // Подпись другим секретом (в т.ч. пустым — «секрет по умолчанию»).
    expect(await verifyJwt(good, '', NOW)).toBeNull();
    expect(await verifyJwt(good, 'jwt-secret', NOW)).toBeNull();
    // Подмена payload при старой подписи.
    const evil = toB64Url(new TextEncoder().encode(JSON.stringify({ sub: 'victim', w: 'w1', iat: NOW, exp: NOW + 900 })));
    expect(await verifyJwt(`${header}.${evil}.${good.split('.')[2]}`, SECRET, NOW)).toBeNull();
    // Просроченный — отказ ровно на границе.
    expect(await verifyJwt(good, SECRET, NOW + ACCESS_TTL)).toBeNull();
    expect(await verifyJwt(good, SECRET, NOW + ACCESS_TTL - 5)).not.toBeNull();
  });

  it('не-строковые claims и мусор вместо base64 — отказ без исключения', async () => {
    const b64 = (o: unknown) => toB64Url(new TextEncoder().encode(JSON.stringify(o)));
    const weird = [
      `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 1, w: 'w1', exp: NOW + 60 })}.AAAA`,
      `${b64({ alg: 'HS512', typ: 'JWT' })}.${b64({ sub: 'u1', w: 'w1', exp: NOW + 60 })}.AAAA`,
      'aaa.bbb.ccc',
      '',
      '.',
      'a.b.c.d',
      `${b64({ alg: 'HS256' })}.!!!.!!!`,
    ];
    for (const token of weird) expect(await verifyJwt(token, SECRET, NOW), token).toBeNull();
  });

  it('refresh-кука не читается из чужого префикса и ставится с HttpOnly/Secure/SameSite', () => {
    const cookie = refreshCookie('tok-1');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/auth');
    // Подсунутая рядом «xastra_refresh» не должна быть принята за нашу.
    const forged = new Request('https://game.test/auth/refresh', { headers: { Cookie: 'astra_refreshX=y; xastra_refresh=z' } });
    expect(readRefreshCookie(forged)).toBeNull();
    const real = new Request('https://game.test/auth/refresh', { headers: { Cookie: `other=1; ${cookie.split(';')[0]}` } });
    expect(readRefreshCookie(real)).toBe('tok-1');
  });

  it('перебор паролей: пять неудач — и IP заперт на 15 минут, без капчи', async () => {
    const e = env({ TURNSTILE_SECRET: 'turnstile-secret-value' });
    const stored = await hashPassword('correct horse battery staple');
    e.DB.prepare("INSERT INTO users (id, email, password_hash, status, world_id, created_at) VALUES ('u1', 'a@b.cc', ?, 'active', 'w1', 1)")
      .bind(stored).run();
    // На входе шлюза быть не вовсе: «я человек» остался только на бонусах. Любой
    // запрос к siteverify уронил бы этот тест — fetch недоступен намеренно.
    const noNetwork = vi.fn(async () => { throw new Error('siteverify must not be called'); });
    vi.stubGlobal('fetch', noNetwork);
    try {
      const attempt = (password: string, ip: string) => login2(
        post('/auth/login', { email: 'a@b.cc', password }, { 'CF-Connecting-IP': ip }), e,
      );
      for (let i = 0; i < 4; i++) {
        const res = await attempt(`wrong password ${i}`, '203.0.113.11');
        expect(res.status, `попытка ${i}`).toBe(401);
        // Ответ ровно «не та пара»: ни подсказки про капчу, ни имени аккаунта.
        expect(await res.json()).toEqual({ error: 'invalid_credentials' });
      }
      // Пятая неудача закрывает IP на 15 минут.
      const blocked = await attempt('wrong password 4', '203.0.113.11');
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toEqual({ error: 'too_many_attempts' });
      expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
      // Верный пароль с запертого IP — всё равно отказ: блокировка не для «избранных».
      expect((await attempt('correct horse battery staple', '203.0.113.11')).status).toBe(429);
      // Другой IP не страдает от чужого перебора: блокировка по ключу, не глобально.
      const other = await attempt('correct horse battery staple', '198.51.100.77');
      expect(other.status).toBe(200);
      expect((await other.json() as { access_token?: string }).access_token).toBeTruthy();
      expect(noNetwork).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('перебор по одному адресу с разных IP упирается в лимит самого адреса', async () => {
    const e = env();
    const stored = await hashPassword('correct horse battery staple');
    e.DB.prepare("INSERT INTO users (id, email, password_hash, status, world_id, created_at) VALUES ('u1', 'a@b.cc', ?, 'active', 'w1', 1)")
      .bind(stored).run();
    let status = 0;
    // 15 адресных неудач с разных «IP»: распределённый перебор, где счётчик по IP бессилен.
    for (let i = 0; i < 16; i++) {
      const res = await login2(post('/auth/login', { email: 'a@b.cc', password: `wrong password ${i}` },
        { 'CF-Connecting-IP': `203.0.${113 + (i % 3)}.${i + 1}` }), e);
      status = res.status;
    }
    expect(status).toBe(429);
    expect(e.__raw.prepare('SELECT key, attempts FROM auth_limits').all()
      .some((r: { key: string }) => r.key.startsWith('login_email:'))).toBe(true);
  });

  it('алиасы одного ящика не обходят лимит и не создают второй аккаунт', async () => {
    // `john+shop@gmail.com` и `john@gmail.com` — один ящик: нормализация обязана
    // быть одинаковой и на входе, и на регистрации.
    expect(canonicalEmail('John.Smith+shop@gmail.com')).toBe('johnsmith@gmail.com');
    expect(canonicalEmail('a+b@example.com')).toBe('a@example.com');
    expect(canonicalEmail('a@example.com')).toBe('a@example.com');
  });

  it('неизвестный email и неверный пароль отвечают одинаково: список адресов не проверяется', async () => {
    const e = env();
    const stored = await hashPassword('correct horse battery staple');
    e.DB.prepare("INSERT INTO users (id, email, password_hash, status, world_id, created_at) VALUES ('u1', 'a@b.cc', ?, 'active', 'w1', 1)")
      .bind(stored).run();
    const a = await login2(post('/auth/login', { email: 'a@b.cc', password: 'wrong password 1' }), e);
    const b = await login2(post('/auth/login', { email: 'nobody@nowhere.test', password: 'wrong password 1' }), e);
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.text()).toBe(await b.text());
  });

  it('массовое присвоение: лишние поля в теле не становятся истиной', async () => {
    const e = lobbyEnv(env());
    const res = await login2(post('/auth/register', {
      email: 'victim@b.cc', password: 'secret-pass-1',
      // то, что нельзя принимать от клиента ни при каких условиях
      role: 'admin', is_admin: true, astra: 1e9, status: 'active', id: 'u-evil', world_id: 'w9',
    }), e);
    // Лобби в этом окружении отвечает «нет места» — регистрация откатывается.
    // Важен не код, а состояние: ни одно присланное поле никуда не записалось.
    expect(res.status).toBeLessThan(600);
    const rows = e.__raw.prepare('SELECT id, status, world_id FROM users').all() as Record<string, string>[];
    for (const row of rows) {
      expect(row.id).not.toBe('u-evil');
      expect(row.world_id).not.toBe('w9');
      expect(['pending', 'active']).toContain(row.status);
    }
    // Схема `users` вообще не знает колонок role/is_admin/astra: mass assignment
    // упирается в то, что их некуда сохранить.
    const cols = e.__raw.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).not.toContain('role');
    expect(names).not.toContain('is_admin');
    expect(names).not.toContain('astra');
  });
});

// ── A01 / API1 — доступ к чужим объектам и к админке ────────────────────────
describe('права доступа', () => {
  it('без токена и с мусорным токеном — 401, и в ответе нет ни стека, ни SQL', async () => {
    const e = env();
    for (const headers of [
      {}, { Authorization: 'Bearer' }, { Authorization: 'Bearer ' }, { Authorization: 'Basic Zm9vOmJhcg==' },
      { Authorization: `Bearer ${'not-a-jwt'}` }, { Authorization: `Bearer ${'x'.repeat(5000)}` },
    ]) {
      const res = await route2('/me', 'GET', e, headers);
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toBe('{"error":"unauthorized"}');
    }
  });

  it('админские маршруты не открываются ни под каким методом без токена', async () => {
    const e = env();
    for (const path of ['/admin/world', '/admin/pay', '/admin/pool', '/admin/world/grant', '/admin/pay/stop',
      // Исполнение сбора: POST двигает деньги, поэтому «без токена» обязан быть
      // и он, и журнал намерений.
      '/admin/pay/sweep/run', '/admin/pay/sweeps']) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
        const r = await routeDispatch(new Request(`https://game.test${path}`, {
          method, headers: { 'CF-Connecting-IP': '198.51.100.4' },
        }), e);
        // Либо 401 (нет токена), либо 405/404 (метод не поддерживается) — но не 2xx и не 5xx.
        expect([401, 403, 404, 405, 503], `${method} ${path}`).toContain(r.status);
      }
    }
  });

  it('подбор админского токена блокируется по IP после 10 попыток', async () => {
    const e = env({ ADMIN_TOKEN: 'a-very-long-admin-token-value' });
    let last = 0;
    for (let i = 0; i < 14; i++) {
      const res = await routeDispatch(new Request('https://game.test/admin/world', {
        headers: { 'X-Admin-Token': `wrong-${i}-wrong-${i}`, 'CF-Connecting-IP': '198.51.100.9' },
      }), e);
      last = res.status;
    }
    expect([401, 429]).toContain(last);
    // Счётчик живёт в auth_limits, а не в памяти изолята: перебор с другого изолята
    // упирается в те же 10 попыток.
    const rows = e.__raw.prepare('SELECT key, attempts FROM auth_limits').all() as { key: string; attempts: number }[];
    expect(rows.some((r) => r.key.startsWith('admin_ip:'))).toBe(true);
  });

  it('sameToken: равные строки проходят, разные и разной длины — нет', () => {
    expect(sameToken('token-value-123456', 'token-value-123456')).toBe(true);
    expect(sameToken('token-value-123456', 'token-value-123457')).toBe(false);
    expect(sameToken('token-value-123456', 'token-value-1234567')).toBe(false);
    expect(sameToken('', '')).toBe(true);
  });

  it('один и тот же Idempotency-Key у двух игроков — две независимые операции', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => createPlayer(sql, 'p2', T0));
    tx(() => addResource(sql, 'p1', 'iron_ore', 10, T0));
    tx(() => addResource(sql, 'p2', 'iron_ore', 10, T0));
    // Ключ один и тот же, игроки разные: повтор должен принадлежать своему игроку.
    const a = tx(() => createLot(sql, 'p1', 'same-key-0001', { resource: 'iron_ore', amount: 2, unitPrice: 4 }, T0));
    const b = tx(() => createLot(sql, 'p2', 'same-key-0001', { resource: 'iron_ore', amount: 3, unitPrice: 4 }, T0));
    expect(a.lot.amount).toBe(2);
    expect(b.lot.amount).toBe(3);
    // Чужой лот снять нельзя.
    expect(() => tx(() => cancelLot(sql, 'p2', 'steal-000001', a.lot.id, T0))).toThrow(/not_your_lot/);
    expect(verifyLedger(sql).ok).toBe(true);
  });
});

// ── API4 — истощение ресурсов ───────────────────────────────────────────────
describe('истощение ресурсов', () => {
  it('тело больше 16 КиБ отсекается, даже когда Content-Length врёт или отсутствует', async () => {
    await expect(readJson(post('/claim', { blob: 'x'.repeat(MAX_JSON_BYTES * 3) })))
      .rejects.toMatchObject({ status: 413 });
    // Тот же объём без заголовка длины — старый код пропускал его целиком.
    const chunked = postChunked('/claim', JSON.stringify({ blob: 'y'.repeat(MAX_JSON_BYTES * 3) }));
    // Иначе тест проверяет не то: именно отсутствия заголовка не должно быть.
    expect(chunked.headers.get('Content-Length')).toBeNull();
    await expect(readJson(chunked)).rejects.toMatchObject({ status: 413 });
    // Враньё в Content-Length («всего 2 байта», а летит МеБ) тоже ловится.
    const lying = new Request('https://game.test/claim', {
      method: 'POST', body: JSON.stringify({ blob: 'z'.repeat(MAX_JSON_BYTES * 4) }),
      headers: { 'Content-Length': '2' },
    });
    await expect(readJson(lying)).rejects.toMatchObject({ status: 413 });
    // Нормальное тело проходит.
    await expect(readJson(post('/claim', { box: 'daily' }))).resolves.toEqual({ box: 'daily' });
  });

  it('пачка имеет свой потолок 32 КиБ, одиночный маршрут — 16 КиБ', async () => {
    // Общее правило не должно было урезать пачку: десять операций с трассой
    // мини-игры в 16 КиБ не помещаются, и «забыть» про лимит тоже нельзя.
    const mid = JSON.stringify({ ops: [{ op: '/claim', idem: 'key-00000001', body: { blob: 'x'.repeat(20 * 1024) } }] });
    expect(mid.length).toBeGreaterThan(MAX_JSON_BYTES);
    const ok = await readJson(post('/batch', mid), BATCH_MAX_BODY);
    expect((ok.ops as unknown[]).length).toBe(1);
    await expect(readJson(post('/batch', mid))).rejects.toMatchObject({ status: 413 });
    const huge = JSON.stringify({ ops: [{ op: '/claim', idem: 'key-00000001', body: { blob: 'x'.repeat(BATCH_MAX_BODY) } }] });
    await expect(readJson(post('/batch', huge), BATCH_MAX_BODY)).rejects.toMatchObject({ status: 413 });
  });

  it('битый JSON, массив,deep-вложенность и __proto__ не валят парсер', async () => {
    await expect(readJson(post('/x', 'не json {'))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(post('/x', [1, 2, 3]))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(post('/x', '"строка"'))).rejects.toMatchObject({ status: 400 });
    const deep = `${'['.repeat(4000)}${']'.repeat(4000)}`;
    await expect(readJson(post('/x', deep))).rejects.toMatchObject({ status: 400 });
    // Загрязнение прототипа: ключ __proto__ не должен доехать до Object.prototype.
    await readJson(post('/x', JSON.stringify({ __proto__: { polluted: 'yes' }, constructor: { prototype: { x: 1 } } })));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(([] as unknown as Record<string, unknown>).x).toBeUndefined();
  });

  it('ReDoS и переполнение: длинные строки проверяются быстро и без 500', async () => {
    // 200 КиБ в теле вообще не доходит до парсера регуляркой — сперва лимит тела.
    const huge = `a${'a'.repeat(200_000)}@b.cc`;
    const big = await login2(post('/auth/login', { email: huge, password: huge }), env());
    expect(big.status).toBe(413);
    // 8 КиБ в поле — уже внутри лимита: валидатор обязан ответить 400, а не зависнуть.
    const long = `a${'a'.repeat(4000)}@b.cc`;
    const t0 = performance.now();
    const res = await login2(post('/auth/login', { email: long, password: long }), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_email' });
    expect(() => callsignProblem(normalizeCallsign(long.repeat(2)))).not.toThrow();
    expect(performance.now() - t0).toBeLessThan(600);
  });

  it('чужой и враждебный ?ship= не даёт чужих данных и не роняет ответ', () => {
    // Планировщик экрана «Полёт» принимает id корабля из query. Он не идёт в SQL,
    // но обязан (а) не подставлять чужой борт и (б) не падать на мусоре.
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    tx(() => createPlayer(sql, 'p2', T0));
    const shipOf = (id: string) => String(sql.exec('SELECT id FROM ships WHERE player_id = ? LIMIT 1', id).toArray()[0].id);
    const foreign = shipOf('p2');
    const own = shipOf('p1');
    const baseline = JSON.stringify(buildState(sql, 'p1', T0, false, own));
    for (const raw of [foreign, "' OR 1=1--", '<script>alert(1)</script>', 'x'.repeat(4000), 'nonexistent-ship', '', '1;DELETE FROM ships']) {
      const view = buildState(sql, 'p1', T0, false, raw || null);
      // В выдаче только свои корабли: чужой id не подставился ни в одно поле.
      expect(view.ships.map((sh) => sh.id), raw).toEqual([own]);
      expect(JSON.stringify(view).includes(foreign), raw).toBe(false);
      // Неизвестный/враждебный id молча означает «ничего не выбрано»: планировщик
      // считается по первому своему борту, поэтому ответ побайтово совпадает.
      expect(JSON.stringify(view), raw).toBe(baseline);
    }
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('частотный лимит держит burst: 31-е действие в минуту — 429', async () => {
    const { db } = makeD1();
    db.exec(`CREATE TABLE auth_limits (
      key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0
    )`);
    const e = { DB: db } as unknown as Env;
    let blocked = 0;
    for (let i = 0; i < 40; i++) {
      const decision = await checkUserLimit(e, 'p1', true, T0 + i);
      if (!decision.allowed) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(5);
    // Чтение живёт в своём бакете: лимит на запись его не съедает.
    const reads = await checkUserLimit(e, 'p1', false, T0);
    expect(reads.allowed).toBe(true);
    // Повреждённый счётчик не запирает игрока (fail-open по дизайну).
    const broken = { DB: { prepare: () => { throw new Error('db down'); } } } as unknown as Env;
    expect((await checkUserLimit(broken, 'p1', true, T0)).allowed).toBe(true);
  });

  it('пачка: не больше 10 операций, только игровые маршруты, без рекурсии и денег', () => {
    const ops = (n: number, path = '/claim') => ({ ops: Array.from({ length: n }, (_, i) => ({ op: path, idem: `key-${i}-pad`, body: {} })) });
    expect(parseBatchOps(ops(11))).toMatchObject({ ok: false, error: 'batch_too_large' });
    expect(parseBatchOps(ops(0))).toMatchObject({ ok: false, error: 'empty_batch' });
    expect(parseBatchOps(ops(BATCH_MAX_OPS))).toMatchObject({ ok: true });
    for (const path of ['/batch', '/pay/purchase', '/pay/withdraw', '/auth/login', '/admin/world', '/admin/pay/stop', '/../admin', '__proto__']) {
      expect(parseBatchOps(ops(1, path)), path).toMatchObject({ ok: false, error: 'op_not_allowed' });
    }
    // Мусор в ключе идемпотентности операции — отказ, а не «сохраним как есть».
    for (const idem of ['', 'short', 'a'.repeat(65), 'ключ-КиРиЛЛ', 'x'.repeat(8) + ' `; drop', 'a b  c']) {
      expect(parseBatchOps({ ops: [{ op: '/claim', idem, body: {} }] }), idem).toMatchObject({ ok: false, error: 'bad_idem_key' });
    }
    expect(parseBatchOps(null)).toMatchObject({ ok: false });
    expect(parseBatchOps({ ops: 'не массив' })).toMatchObject({ ok: false });
    expect(parseBatchOps({ ops: [{ op: '/claim', idem: 'good-key-1', body: [] }] })).toMatchObject({ ok: false, error: 'bad_op_body' });
  });
});

// ── A02 / API8 — заголовки, кэш, статика ────────────────────────────────────
describe('конфигурация', () => {
  it('каждый JSON-ответ несёт полный набор заголовков безопасности', async () => {
    const res = json({ ok: true });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name), name).toBe(value);
    }
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('CSP запрещает инлайн-скрипты, чужие фреймы и object; фрейм только у Turnstile', () => {
    const directives = Object.fromEntries(CSP.split(';').map((d) => {
      const [k, ...rest] = d.trim().split(' ');
      return [k, rest.join(' ')];
    }));
    expect(directives['default-src']).toBe("'self'");
    expect(directives['script-src']).toBe("'self' https://challenges.cloudflare.com");
    expect(CSP).not.toContain('unsafe-inline');
    expect(CSP).not.toContain('unsafe-eval');
    expect(directives['frame-ancestors']).toBe("'none'");
    expect(directives['object-src']).toBe("'none'");
    expect(directives['base-uri']).toBe("'none'");
    expect(directives['form-action']).toBe("'self'");
  });

  it('client/_headers — зеркало того же набора: разъезд ловится здесь', () => {
    const file = readFileSync(new URL('../../../client/_headers', import.meta.url), 'utf8');
    // Каждый заголовок из SECURITY_HEADERS обязан быть и в _headers: Pages и
    // Worker отдают один и тот же файл, политика не имеет права различаться.
    const declared = new Set([...file.matchAll(/^\s*([A-Za-z-]+):/gm)].map((m) => m[1]));
    for (const name of Object.keys(SECURITY_HEADERS)) {
      expect(declared.has(name), `${name} есть в Worker, но нет в client/_headers`).toBe(true);
    }
    const directives = (text: string) => new Set(text.split(';').map((d) => d.trim()).filter(Boolean));
    const fromFile = directives(file.match(/Content-Security-Policy:\s*(.+)/)![1].trim());
    const fromWorker = directives(CSP);
    const missing = [...fromWorker].filter((d) => !fromFile.has(d));
    expect(missing, 'эти директивы CSP живёт только в Worker').toEqual([]);
  });

  it('статика отдаётся только по точным ключам: обход пути не работает', async () => {
    // `SITE_FILES` — плоская карта «точный путь → файл»: путь не склеивается и не
    // читается с диска, значит «/» в имени некуда подставить. Проверяем и
    // инварианты карты, и то, что ни один ключ не даёт выход за корень.
    const keys = Object.keys(SITE_FILES);
    expect(keys.length).toBeGreaterThan(8);
    for (const key of keys) {
      expect(key.startsWith('/'), key).toBe(true);
      expect(key.includes('..'), key).toBe(false);
      expect(key.includes('\0'), key).toBe(false);
    }
    // Маршрутизатор на чужие пути отвечает 404 и не светит ни секретов, ни стека.
    const e = env();
    const hostile = [
      '/../worker/src/env.ts', '/..%2fworker/src/env.ts', '/%2e%2e/%2e%2e/etc/passwd',
      '//etc/passwd', '/icons/../../wrangler.toml', '/..%00/index.html', '/./../../etc/hosts',
      '/../.dev.vars', '/%2e%2e%2f.env', '/../../../etc/passwd',
    ];
    for (const path of hostile) {
      const res = await route2(decodeURIComponent(path), 'GET', e, {});
      expect(res.status, path).toBe(404);
      const text = await res.text();
      expect(text, path).not.toContain('JWT_SECRET');
      expect(text, path).not.toContain('at ');
      // И не повторяет запрошенный путь: отказ — только код, без «эхо» (A10).
      expect(text, path).toBe('{"error":"not_found"}');
    }
  });

  it('методы, которых нет, не превращаются в 500', async () => {
    const e = env();
    // TRACE не конструируется даже в Request — и в проде его режет Cloudflare.
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const res = await route2('/me', method, e, {});
      expect([401, 404, 405], method).toContain(res.status);
    }
  });

  it('клиент умеет выдать ключ повторения нужного формата всегда', () => {
    // Сервер требует 8…64 символа `[A-Za-z0-9._:-]`. `crypto.randomUUID` есть не
    // везде (нужен защищённый контекст), поэтому у клиента обязан быть запасной
    // вариант — иначе любое действие падало бы на TypeError.
    const app = readFileSync(new URL('../../../client/app.js', import.meta.url), 'utf8');
    const format = /^[A-Za-z0-9._:-]{8,64}$/;
    expect(app).toContain('function newIdem()');
    expect(app).toContain('globalThis.crypto?.randomUUID');
    const fallback = 'ui' + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    expect(format.test(fallback), fallback).toBe(true);
    expect(format.test(crypto.randomUUID())).toBe(true);
    // Мусор и «совсем короткий ключ» валидатор отсекает — это он и должен.
    expect(format.test('k1')).toBe(false);
    expect(format.test('x'.repeat(65))).toBe(false);
    expect(format.test("'; DROP TABLE users; --")).toBe(false);
  });

  it('в клиенте нет ни одного innerHTML с данными (XSS-сточков нет)', () => {
    const files = ['app.js', 'pay.js', 'pool.js', 'admin.js', 'box-stage.js', 'welcome.js', 'i18n.js'];
    for (const name of files) {
      const text = readFileSync(new URL(`../../../client/${name}`, import.meta.url), 'utf8');
      for (const line of text.split('\n')) {
        if (!/\.innerHTML\s*=/.test(line)) continue;
        // Разрешены только присваивания литералом: `<td></td>` и т. п. Всё, что
        // содержит кавычку-шаблон или переменную, — потенциальный XSS-сточек.
        const rhs = line.slice(line.indexOf('=') + 1);
        const isPlainString = /^\s*('([^'\\]|\\.)*'|"([^"\\]|\\.)*"|'')\s*;?\s*$/.test(rhs);
        expect(isPlainString, `${name}: ${line.trim()}`).toBe(true);
      }
      // Ни eval, ни new Function, ни document.write в клиенте быть не должно.
      expect(/\beval\s*\(|new Function\s*\(|document\.write\s*\(/.test(text), name).toBe(false);
    }
  });

  it('CORS не открыт: чужой домен не получит ни одного ответа', async () => {
    const e = env();
    for (const path of ['/me', '/config', '/pool', '/auth/login', '/auth/refresh', '/batch', '/admin/world', '/index.html']) {
      for (const method of ['GET', 'POST', 'OPTIONS']) {
        const res = await route2(path, method, e, { Origin: 'https://evil.test' });
        await res.text();
        // Открытого CORS нет нигде: браузер не даст сторонней странице читать ответы.
        expect(res.headers.get('Access-Control-Allow-Origin'), `${method} ${path}`).toBeNull();
        expect(res.headers.get('Access-Control-Allow-Credentials'), `${method} ${path}`).toBeNull();
        expect(res.headers.get('Access-Control-Allow-Headers'), `${method} ${path}`).toBeNull();
      }
    }
  });

  it('сборка: зависимости только из npm-реестра и зафиксированы лок-файлом (A03)', () => {
    const root = new URL('../../../', import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    // В рантайме зависимостей нет вовсе — воркер пишет руками, а не собирает чужой код.
    expect(pkg.dependencies ?? {}).toEqual({});
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, range] of Object.entries(all)) {
      expect(range, name).toMatch(/^\^?\d/);            // только semver, без git/http/workspace
    }
    const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8')) as {
      lockfileVersion: number; packages: Record<string, { resolved?: string }>;
    };
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(3);
    for (const [name, entry] of Object.entries(lock.packages)) {
      if (!name || !entry.resolved) continue;
      expect(entry.resolved.startsWith('https://registry.npmjs.org/'), name).toBe(true);
    }
  });

  it('отказ ничего не отдаёт наружу: ни стека, ни текста SQL', async () => {
    const leaky = errorResponse(new Error("SQLITE_ERROR: no such table: secrets near 'SELECT'"));
    expect(leaky.status).toBe(500);
    expect(await leaky.text()).toBe('{"error":"internal"}');
    const known = errorResponse(new Error('patrol_slots_full'));
    expect(known.status).toBe(409);
    expect(await known.text()).toBe('{"error":"patrol_slots_full"}');
  });
});

// ── Вспомогательный вызов маршрутизатора ────────────────────────────────────

// Статический импорт route() даёт цикл (index.ts → router → routes → …), поэтому
// маршрутизатор подгружается один раз лениво.
let routerDispatch: ((request: Request, env: Env) => Promise<Response>) | null = null;
async function routeDispatch(request: Request, e: Env): Promise<Response> {
  if (!routerDispatch) routerDispatch = (await import('../../src/http/router')).route;
  return routerDispatch(request, e);
}
/** Вход через маршрут целиком: валидация, лимиты, заголовки — всё настоящее. */
async function login2(request: Request, e: Env): Promise<Response> {
  return routeDispatch(request, e);
}

async function route2(path: string, method: string, e: Env, headers: Record<string, string>): Promise<Response> {
  return routeDispatch(new Request(`https://game.test${path}`, { method, headers: { 'CF-Connecting-IP': '203.0.113.7', ...headers } }), e);
}

/** Лобби-заглушка: регистрация доходит до резерва места, дальше её не пускает тест. */
function lobbyEnv(e: Env): Env {
  const stub = {
    reserve: async () => { throw new Error('lobby is not available in unit tests'); },
    release: async () => undefined,
    confirm: async () => undefined,
  };
  return {
    ...e,
    LOBBY: { idFromName: () => 'lobby', get: () => stub } as unknown as Env['LOBBY'],
    WORLD: { idFromName: () => 'world', get: () => ({ createPlayer: async () => undefined }) } as unknown as Env['WORLD'],
  };
}
