import type { AuthContext } from '../auth/guards';
import type { Env } from '../env';
import { json, readJson } from '../http/response';
import { ApiError } from '../world/errors';
import { isKind } from '../world/modules/expeditions';

function world(env: Env, a: AuthContext) {
  return env.WORLD.get(env.WORLD.idFromName(a.worldId));
}

function idemKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key') ?? '';
  if (!key) throw new ApiError(400, 'idempotency_key_required');
  return key;
}

export async function me(env: Env, a: AuthContext): Promise<Response> {
  return json({ world_id: a.worldId, ...(await world(env, a).getState(a.userId)) });
}

// Idempotency-Key создаёт клиент один раз на действие и хранит до ответа. Суммы клиент не передаёт.
export async function claim(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const r = await world(env, a).claim(a.userId, idemKey(request));
  if (r.ok) return json({ reward: r.reward, balance: r.balance, next_claim_at: r.nextClaimAt });
  return json({ error: r.code, next_claim_at: r.nextClaimAt }, 429);
}

export async function startExpedition(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const key = idemKey(request);
  const body = await readJson(request);
  if (!isKind(body.kind)) throw new ApiError(400, 'bad_expedition_kind');
  const shipId = typeof body.ship_id === 'string' ? body.ship_id : null;
  const r = await world(env, a).startExpedition(a.userId, key, { kind: body.kind, shipId });
  return json({ expedition_id: r.id, kind: r.kind, ship_id: r.shipId, started_at: r.startedAt, ends_at: r.endsAt, fuel: r.fuel });
}

export async function collectExpedition(request: Request, env: Env, a: AuthContext, expeditionId: string): Promise<Response> {
  const r = await world(env, a).collectExpedition(a.userId, idemKey(request), expeditionId);
  if (r.ok) return json({ expedition_id: r.id, kind: r.kind, reward: r.reward, balance: r.balance });
  return json({ error: r.code, ends_at: r.endsAt }, 409);
}
