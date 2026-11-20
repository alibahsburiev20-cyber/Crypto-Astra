// HMAC на SHA-256 (RFC 2104). Нужен для детерминированной подписи ECDSA
// (RFC 6979): одинаковый ключ и одинаковое сообщение всегда дают одну подпись,
// поэтому сбой сети не превращается в «две разные подписи одной транзакции».

import { sha256Bytes } from '../../shared/sha256';

const BLOCK = 64;

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const k = new Uint8Array(BLOCK);
  if (key.length > BLOCK) k.set(sha256Bytes(key));
  else k.set(key);

  const inner = new Uint8Array(BLOCK + data.length);
  const outer = new Uint8Array(BLOCK + 32);
  for (let i = 0; i < BLOCK; i += 1) {
    inner[i] = k[i] ^ 0x36;
    outer[i] = k[i] ^ 0x5c;
  }
  inner.set(data, BLOCK);
  outer.set(sha256Bytes(inner), BLOCK);
  return sha256Bytes(outer);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new Error('bad_hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
