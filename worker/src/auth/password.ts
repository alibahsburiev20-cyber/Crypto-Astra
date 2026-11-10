import { fromB64Url, timingSafeEqual, toB64Url } from '../shared/encoding';

// Лимит WebCrypto в Workers для PBKDF2 — 100 000 итераций (проверить перед запуском, часть VII концепции).
// Если лимит изменится или понадобится больше, перейти на Argon2id через WASM.
export const PBKDF2_ITERATIONS = 100_000;
const MAX_ITERATIONS = 1_000_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

// Формат: pbkdf2$<итерации>$<соль>$<хеш>. Итерации хранятся с хешем, чтобы позже их можно было повысить.
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64Url(salt)}$${toB64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  try {
    const actual = await derive(password, fromB64Url(parts[2]), iterations);
    return timingSafeEqual(actual, fromB64Url(parts[3]));
  } catch {
    return false;
  }
}
