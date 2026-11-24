import { signJwt } from '../auth/jwt';
import { requireSecret } from '../auth/guards';
import { hashPassword, verifyPassword } from '../auth/password';
import {
  LOGIN_EMAIL_POLICY, LOGIN_IP_POLICY, REGISTER_DOMAIN_POLICY, REGISTER_IP_POLICY,
  clearAttempts, currentBlock, ipOf, loginKeys, recordAttempt, registerDomainKey, registerKeys,
} from '../auth/rateLimit';
import { createSession, revokeSession, rotateSession } from '../auth/sessions';
import {
  canonicalEmail, domainAcceptsMail, emailProblem, isKnownProvider, signupGuardEnabled,
} from '../auth/emailGuard';
import { turnstileEnabled } from '../auth/turnstile';
import { WORLD_CAPACITY } from '../shared/constants';
import { adsConfig } from '../ads/config';
import type { Env } from '../env';
import { clearRefreshCookie, readRefreshCookie, refreshCookie } from '../http/cookies';
import { json, readJson } from '../http/response';
import { ApiError } from '../world/errors';

// Формат валиден, пароль не подходит ни кому: нужен, чтобы вход неизвестного email
// занимал столько же времени, сколько и вход с неверным паролем.
const DUMMY_HASH = `pbkdf2$100000$${'A'.repeat(22)}$${'A'.repeat(43)}`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function creds(body: Record<string, unknown>): { email: string; password: string } {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!EMAIL_RE.test(email) || email.length > 254) throw new ApiError(400, 'invalid_email');
  if (password.length < 8 || password.length > 128) throw new ApiError(400, 'invalid_password');
  return { email, password };
}

// Публичная конфигурация клиента: site key Turnstile и серверное время.
export function config(env: Env): Response {
  const siteKey = turnstileEnabled(env) && env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY.trim() : '';
  return json(
    {
      // site key нужен только бонусному шлюзу (Claim и бесплатные боксы): вход и
      // регистрация проверку больше не требуют.
      turnstile_site_key: siteKey || null,
      server_time: Date.now(),
      ads: adsConfig(env),
    },
    200,
    { 'Cache-Control': 'public, max-age=300' },
  );
}

async function issue(env: Env, userId: string, worldId: string, now: number): Promise<Response> {
  const access = await signJwt({ sub: userId, w: worldId }, requireSecret(env), Math.floor(now / 1000));
  const refresh = await createSession(env.DB, userId, now);
  return json({ access_token: access, user: { id: userId, world_id: worldId } }, 200, { 'Set-Cookie': refreshCookie(refresh) });
}

// Регистрация по шагам из концепции (II.2):
// 1) проверка почты, 2) учётная запись pending, 3) резерв места в WorldLobby,
// 4) World.createPlayer, 5) active + подтверждение места.
//
// В `users.email` кладём канонический адрес (без `+хвоста`, для Gmail — без
// точек), поэтому UNIQUE сам отсекает «второй аккаунт тем же ящиком».
export async function register(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  // Формат и списки проверяем до счётчиков и до «мягкого» `creds`: мусорный
  // адрес не должен ни тратить попытки с IP, ни дёргать DNS, ни получать
  // размытое «invalid_email» вместо внятной причины отказа.
  const typed = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const problem = emailProblem(typed);
  if (problem) throw new ApiError(400, problem);
  const { email, password } = creds(body);
  const now = Date.now();
  const key = canonicalEmail(email);
  const domain = key.slice(key.lastIndexOf('@') + 1);

  // Частоту считаем до дорогой проверки MX: иначе по DNS можно бить без ограничений.
  const gate = await recordAttempt(env.DB, registerKeys(ipOf(request)), now, REGISTER_IP_POLICY);
  if (gate.retryAfterSec > 0) throw new ApiError(429, 'too_many_attempts', gate.retryAfterSec);

  // Строгий контур: MX и потолок на домен. В локальном режиме и e2e он выключен
  // (там нет DNS, а регистрироваться приходится много раз в час); формат адреса,
  // список помоек и нормализация алиасов работают всегда.
  const strict = signupGuardEnabled(env);

  // Потолок регистраций на домен — только для незнакомых почтовиков: у Gmail или
  // mail.ru лимит бил бы по живым людям. Считается до MX, чтобы выдуманный домен
  // не гоняли через DNS сотнями.
  if (strict && !isKnownProvider(domain)) {
    const perDomain = await recordAttempt(env.DB, [registerDomainKey(domain)], now, REGISTER_DOMAIN_POLICY);
    if (perDomain.retryAfterSec > 0) {
      throw new ApiError(429, 'too_many_signup_from_domain', perDomain.retryAfterSec);
    }
  }

  // Домен обязан принимать почту: `a@b.cc` и выдуманные адреса отсекаются здесь.
  // Капчу «я человек» с регистрации сняли — она осталась только там, где выдаётся
  // бонус, а против фейковых аккаунтов работает проверка почты.
  if (strict) {
    const mx = await domainAcceptsMail(domain);
    if (!mx.ok) throw new ApiError(mx.reason === 'no_mx' ? 400 : 503, mx.reason ?? 'email_check_unavailable');
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  try {
    await env.DB
      .prepare(`INSERT INTO users (id, email, password_hash, status, created_at) VALUES (?, ?, ?, 'pending', ?)`)
      .bind(userId, key, passwordHash, now)
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new ApiError(409, 'email_taken');
    throw e;
  }

  const lobby = env.LOBBY.get(env.LOBBY.idFromName('main'));
  let reservationId: string | null = null;
  let worldId: string | null = null;
  let playerCreated = false;
  try {
    // ref — id мира пригласившего (реферальная ссылка). Формат проверяем, чтобы не тащить мусор в лобби.
    const ref = typeof body.ref === 'string' && /^[a-z0-9_-]{1,32}$/i.test(body.ref) ? body.ref : undefined;
    const r = await lobby.reserve(userId, ref);
    reservationId = r.reservationId;
    worldId = r.worldId;
    await env.WORLD.get(env.WORLD.idFromName(worldId)).createPlayer(userId);
    playerCreated = true;
  } catch (e) {
    // До создания игрока мир не изменился: место возвращается, учётная запись удаляется.
    if (reservationId) await lobby.release(reservationId).catch(() => {});
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run().catch(() => {});
    throw e;
  }

  const activate = async (): Promise<void> => {
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET world_id = ?, status = 'active' WHERE id = ?`).bind(worldId, userId),
      env.DB
        .prepare(`INSERT INTO world_seats (world_id, capacity, taken, updated_at) VALUES (?, ?, 1, ?)
                  ON CONFLICT (world_id) DO UPDATE SET taken = taken + 1, updated_at = excluded.updated_at`)
        .bind(worldId, WORLD_CAPACITY, now),
    ]);
  };

  let activated = false;
  try {
    await activate();
    activated = true;
    if (reservationId) await lobby.confirm(reservationId);
  } catch (e) {
    // Игрок в мире уже создан: удалять учётную запись нельзя, иначе останется сирота,
    // который навсегда занимает место и хранит стартовый баланс. Пробуем активацию ещё раз.
    console.error('registration activation failed', userId, worldId, e);
    if (!activated) {
      try {
        await activate();
        activated = true;
      } catch (e2) {
        console.error('registration retry failed', userId, worldId, e2);
      }
    }
    if (activated && reservationId) await lobby.confirm(reservationId).catch(() => {});
  }
  // Без active учётная запись не сможет войти и обновить сессию — лучше честная ошибка.
  if (!activated) throw new ApiError(503, 'registration_incomplete');
  return issue(env, userId, worldId, now);
}

export async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const { email, password } = creds(body);
  const now = Date.now();
  // Счётчики ведутся по каноническому адресу: перебор `a+1@`, `a+2@`, `a@` — это
  // один и тот же ящик, и тратить он должен один лимит, а не десять.
  const key = canonicalEmail(email);
  const keys = loginKeys(ipOf(request), key);

  const blocked = await currentBlock(env.DB, keys, now);
  if (blocked > 0) throw new ApiError(429, 'too_many_attempts', blocked);

  const row = await findUser(env, key, email);

  const ok = row?.password_hash ? await verifyPassword(password, row.password_hash) : (await verifyPassword(password, DUMMY_HASH), false);
  if (!row || !ok || row.status !== 'active' || !row.world_id) {
    const ip = await recordAttempt(env.DB, [keys[0]], now, LOGIN_IP_POLICY);
    const mail = await recordAttempt(env.DB, [keys[1]], now, LOGIN_EMAIL_POLICY);
    const retry = Math.max(ip.retryAfterSec, mail.retryAfterSec);
    if (retry > 0) throw new ApiError(429, 'too_many_attempts', retry);
    return json({ error: 'invalid_credentials' }, 401);
  }

  await clearAttempts(env.DB, [...keys, ...loginKeys(ipOf(request), email)]);
  return issue(env, row.id, row.world_id, Date.now());
}

/**
 * Аккаунт по адресу. Ищем по канонической форме, а если её нет — по той, что
 * прислали: аккаунты, созданные до нормализации, могли остаться с `+хвостом` или
 * точками внутри Gmail, и их владельцы не должны потерять вход.
 */
async function findUser(
  env: Env, key: string, raw: string,
): Promise<{ id: string; password_hash: string | null; world_id: string | null; status: string } | null> {
  const sql = 'SELECT id, password_hash, world_id, status FROM users WHERE email = ?';
  const found = await env.DB.prepare(sql).bind(key).first<{
    id: string; password_hash: string | null; world_id: string | null; status: string;
  }>();
  if (found || key === raw) return found;
  return env.DB.prepare(sql).bind(raw).first<{
    id: string; password_hash: string | null; world_id: string | null; status: string;
  }>();
}

export async function refresh(request: Request, env: Env): Promise<Response> {
  const presented = readRefreshCookie(request);
  if (!presented) throw new ApiError(401, 'no_session');
  const now = Date.now();
  const r = await rotateSession(env.DB, presented, now);
  if (!r.ok) {
    return json({ error: r.reason === 'reuse' ? 'session_reuse' : 'no_session' }, 401, { 'Set-Cookie': clearRefreshCookie() });
  }
  const user = await env.DB.prepare('SELECT world_id, status FROM users WHERE id = ?').bind(r.userId).first<{ world_id: string | null; status: string }>();
  if (!user || user.status !== 'active' || !user.world_id) {
    return json({ error: 'no_session' }, 401, { 'Set-Cookie': clearRefreshCookie() });
  }
  const access = await signJwt({ sub: r.userId, w: user.world_id }, requireSecret(env), Math.floor(now / 1000));
  return json({ access_token: access, user: { id: r.userId, world_id: user.world_id } }, 200, { 'Set-Cookie': refreshCookie(r.token) });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const presented = readRefreshCookie(request);
  if (presented) await revokeSession(env.DB, presented, Date.now());
  return json({ ok: true }, 200, { 'Set-Cookie': clearRefreshCookie() });
}
