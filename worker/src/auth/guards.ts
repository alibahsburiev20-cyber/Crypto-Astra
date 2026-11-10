import type { Env } from '../env';
import { ApiError } from '../world/errors';
import { verifyJwt } from './jwt';

export interface AuthContext { userId: string; worldId: string }

export function requireSecret(env: Env): string {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new ApiError(500, 'server_misconfigured');
  return env.JWT_SECRET;
}

export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const secret = requireSecret(env);
  const h = request.headers.get('Authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const claims = token ? await verifyJwt(token, secret, Math.floor(Date.now() / 1000)) : null;
  if (!claims) throw new ApiError(401, 'unauthorized');
  return { userId: claims.sub, worldId: claims.w };
}
