import type { Env } from '../env';
import { requireAdmin } from '../http/admin';
import { json, readJson } from '../http/response';
import { ApiError } from '../world/errors';

// Админка мира (этап 15). Доступ — заголовок `X-Admin-Token` (или Cloudflare
// Access в будущем): маршрут не принимает игроков вообще. Мир выбирается
// параметром `?world=w1`, потому что объектов может быть несколько.

function worldId(url: URL): string {
  const id = (url.searchParams.get('world') ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) throw new ApiError(400, 'bad_world');
  return id;
}

function worldOf(env: Env, url: URL) {
  return env.WORLD.get(env.WORLD.idFromName(worldId(url)));
}

export async function adminWorld(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  return json({ ok: true, world: worldId(url), ...(await worldOf(env, url).adminWorld()) });
}

export async function adminFreeze(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const body = await readJson(request);
  if (typeof body.frozen !== 'boolean') throw new ApiError(400, 'bad_request');
  const res = await worldOf(env, url).setFrozen(body.frozen);
  return json({ ok: true, world: worldId(url), ...res });
}

export async function adminGrant(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const body = await readJson(request);
  const playerId = typeof body.playerId === 'string' ? body.playerId : '';
  const astra = Number(body.astra);
  const reason = typeof body.reason === 'string' ? body.reason : '';
  if (!playerId) throw new ApiError(400, 'bad_target');
  if (!Number.isInteger(astra) || astra === 0) throw new ApiError(400, 'bad_amount');
  if (!reason.trim()) throw new ApiError(400, 'bad_request');
  // Причина обязательна: компенсация без причины — это подарок.
  const res = await worldOf(env, url).grant('admin', playerId, astra, reason);
  return json({ ok: true, world: worldId(url), ...res });
}
