import { signJwt } from '../auth/jwt';
import { requireSecret } from '../auth/guards';
import { hashPassword, verifyPassword } from '../auth/password';
import { createSession, revokeSession, rotateSession } from '../auth/sessions';
import { verifyTurnstile } from '../auth/turnstile';
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

async function checkTurnstile(env: Env, request: Request, body: Record<string, unknown>): Promise<void> {
  // Если секрет Turnstile не задан, проверка пропускается. Это только для локальной разработки:
  // перед публичным запуском секрет обязательно задать (wrangler secret put TURNSTILE_SECRET).
  if (!env.TURNSTILE_SECRET) return;
  const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, request.headers.get('CF-Connecting-IP'));
  if (!ok) throw new ApiError(403, 'turnstile_failed');
}

async function issue(env: Env, userId: string, worldId: string, now: number): Promise<Response> {
  const access = await signJwt({ sub: userId, w: worldId }, requireSecret(env), Math.floor(now / 1000));
  const refresh = await createSession(env.DB, userId, now);
  return json({ access_token: access, user: { id: userId, world_id: worldId } }, 200, { 'Set-Cookie': refreshCookie(refresh) });
}

// Регистрация по шагам из концепции (II.2):
// 1) учётная запись pending, 2) резерв места в WorldLobby, 3) World.createPlayer, 4) active + подтверждение места.
export async function register(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const { email, password } = creds(body);
  await checkTurnstile(env, request, body);

  const now = Date.now();
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  try {
    await env.DB
      .prepare(`INSERT INTO users (id, email, password_hash, status, created_at) VALUES (?, ?, ?, 'pending', ?)`)
      .bind(userId, email, passwordHash, now)
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new ApiError(409, 'email_taken');
    throw e;
  }

  const lobby = env.LOBBY.get(env.LOBBY.idFromName('main'));
  let reservationId: string | null = null;
  let worldId: string;
  try {
    const ref = typeof body.ref === 'string' && body.ref.length <= 32 ? body.ref : undefined;
    const r = await lobby.reserve(userId, ref);
    reservationId = r.reservationId;
    worldId = r.worldId;
    await env.WORLD.get(env.WORLD.idFromName(worldId)).createPlayer(userId);
    await lobby.confirm(reservationId);
  } catch (e) {
    // Шаг не прошёл: место возвращается в лобби, учётная запись удаляется.
    if (reservationId) await lobby.release(reservationId).catch(() => {});
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    throw e;
  }

  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET world_id = ?, status = 'active' WHERE id = ?`).bind(worldId, userId),
    env.DB
      .prepare(`INSERT INTO world_seats (world_id, capacity, taken, updated_at) VALUES (?, 100, 1, ?)
                ON CONFLICT (world_id) DO UPDATE SET taken = taken + 1, updated_at = excluded.updated_at`)
      .bind(worldId, now),
  ]);
  return issue(env, userId, worldId, now);
}

export async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const { email, password } = creds(body);
  const row = await env.DB
    .prepare('SELECT id, password_hash, world_id, status FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; password_hash: string | null; world_id: string | null; status: string }>();

  const ok = row?.password_hash ? await verifyPassword(password, row.password_hash) : (await verifyPassword(password, DUMMY_HASH), false);
  if (!row || !ok || row.status !== 'active' || !row.world_id) throw new ApiError(401, 'invalid_credentials');
  return issue(env, row.id, row.world_id, Date.now());
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
