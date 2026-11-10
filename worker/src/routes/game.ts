import type { AuthContext } from '../auth/guards';
import type { Env } from '../env';
import { json } from '../http/response';
import { ApiError } from '../world/errors';

function world(env: Env, a: AuthContext) {
  return env.WORLD.get(env.WORLD.idFromName(a.worldId));
}

export async function me(env: Env, a: AuthContext): Promise<Response> {
  return json({ world_id: a.worldId, ...(await world(env, a).getState(a.userId)) });
}

// Idempotency-Key создаёт клиент один раз на действие и хранит до ответа. Суммы клиент не передаёт.
export async function claim(request: Request, env: Env, a: AuthContext): Promise<Response> {
  const key = request.headers.get('Idempotency-Key') ?? '';
  if (!key) throw new ApiError(400, 'idempotency_key_required');
  const r = await world(env, a).claim(a.userId, key);
  if (r.ok) return json({ reward: r.reward, balance: r.balance, next_claim_at: r.nextClaimAt });
  return json({ error: r.code, next_claim_at: r.nextClaimAt }, 429);
}
