import { fromB64Url, toB64Url } from '../shared/encoding';

export interface AccessClaims { sub: string; w: string; iat: number; exp: number }

export const ACCESS_TTL_SEC = 15 * 60;
const HEADER = toB64Url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signJwt(claims: { sub: string; w: string }, secret: string, nowSec: number, ttlSec = ACCESS_TTL_SEC): Promise<string> {
  const payload = toB64Url(new TextEncoder().encode(JSON.stringify({ sub: claims.sub, w: claims.w, iat: nowSec, exp: nowSec + ttlSec })));
  const data = `${HEADER}.${payload}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), new TextEncoder().encode(data));
  return `${data}.${toB64Url(new Uint8Array(sig))}`;
}

// Принимает только HS256. Любая ошибка — null.
export async function verifyJwt(token: string, secret: string, nowSec: number): Promise<AccessClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(fromB64Url(parts[0])));
    if (header.alg !== 'HS256') return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), fromB64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(fromB64Url(parts[1])));
    if (typeof c.sub !== 'string' || typeof c.w !== 'string' || typeof c.exp !== 'number' || c.exp <= nowSec) return null;
    return c as AccessClaims;
  } catch {
    return null;
  }
}
