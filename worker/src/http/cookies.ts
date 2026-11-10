const NAME = 'astra_refresh';
const MAX_AGE = 30 * 24 * 60 * 60;

// HttpOnly + Secure + SameSite=Lax; кука действует только на /auth.
export function refreshCookie(token: string): string {
  return `${NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=${MAX_AGE}`;
}

export function clearRefreshCookie(): string {
  return `${NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0`;
}

export function readRefreshCookie(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === NAME) return v.join('=') || null;
  }
  return null;
}
