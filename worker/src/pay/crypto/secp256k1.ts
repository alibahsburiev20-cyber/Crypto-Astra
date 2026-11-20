// secp256k1 и ECDSA — минимум, который нужен TRON.
//
// Что умеет:
//   * открытый ключ из приватного;
//   * адрес TRON из открытого ключа (keccak + base58check);
//   * детерминированная подпись (RFC 6979) с идентификатором восстановления;
//   * проверка подписи — чтобы тесты ловили ошибку сразу, а не в сети.
//
// Чего не умеет и не должен: хранить ключи. Ключ приходит аргументом и здесь не
// сохраняется. Генерация ключей — в Signer-контуре, не в основном Worker.
//
// Скорость: арифметика на BigInt, скалярное умножение «двойка-сложение».
// Для одной подписи это единицы миллисекунд — приемлемо.

import { sha256Bytes } from '../../shared/sha256';
import { addressFromPublicKeyHash } from '../tron/address';
import { bytesToHex, concatBytes, hexToBytes, hmacSha256 } from './hmac';
import { keccak256 } from './keccak';

export const P = (1n << 256n) - (1n << 32n) - 977n;
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
export const HALF_N = N >> 1n;
export const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
export const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

export interface Point { x: bigint; y: bigint }
export interface Signature { r: bigint; s: bigint; recovery: number; signature: string }

const mod = (value: bigint, m = P): bigint => ((value % m) + m) % m;

function invert(value: bigint, m = P): bigint {
  let a = mod(value, m);
  let b = m;
  let x0 = 1n;
  let x1 = 0n;
  while (b > 0n) {
    const q = a / b;
    [a, b] = [b, a % b];
    [x0, x1] = [x1, x0 - q * x1];
  }
  if (a !== 1n) throw new Error('not_invertible');
  return mod(x0, m);
}

export function pointAdd(a: Point | null, b: Point | null): Point | null {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x && mod(a.y + b.y) === 0n) return null;
  let lambda: bigint;
  if (a.x === b.x && a.y === b.y) {
    lambda = mod(3n * a.x * a.x * invert(2n * a.y));
  } else {
    lambda = mod((b.y - a.y) * invert(b.x - a.x));
  }
  const x = mod(lambda * lambda - a.x - b.x);
  const y = mod(lambda * (a.x - x) - a.y);
  return { x, y };
}

export function scalarMult(k: bigint, point: Point = { x: GX, y: GY }): Point | null {
  let n = mod(k, N);
  if (n === 0n) return null;
  let result: Point | null = null;
  let addend: Point | null = point;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  return result;
}

export function parsePrivateKey(hex: string): bigint {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error('bad_private_key');
  const d = BigInt(`0x${clean}`);
  if (d <= 0n || d >= N) throw new Error('bad_private_key');
  return d;
}

/** Открытый ключ: 64 байта x||y (без префикса 0x04) — так его ждёт TRON. */
export function publicKeyFromPrivate(privHex: string): Uint8Array {
  const point = scalarMult(parsePrivateKey(privHex));
  if (!point) throw new Error('bad_private_key');
  const out = new Uint8Array(64);
  out.set(hexToBytes(point.x.toString(16).padStart(64, '0')), 0);
  out.set(hexToBytes(point.y.toString(16).padStart(64, '0')), 32);
  return out;
}

/** Сжатый ключ (33 байта) — нужен для деривации BIP32. */
export function compressedPublicKey(privHex: string): Uint8Array {
  const point = scalarMult(parsePrivateKey(privHex));
  if (!point) throw new Error('bad_private_key');
  const prefix = point.y & 1n ? 0x03 : 0x02;
  return concatBytes(new Uint8Array([prefix]), hexToBytes(point.x.toString(16).padStart(64, '0')));
}

/** Адрес TRON `T…` из приватного ключа. */
export function addressFromPrivateKey(privHex: string): string {
  const hash = keccak256(publicKeyFromPrivate(privHex));
  return addressFromPublicKeyHash(hash.slice(12));
}

export function publicKeyToAddress(publicKey64: Uint8Array): string {
  const hash = keccak256(publicKey64);
  return addressFromPublicKeyHash(hash.slice(12));
}

/** RFC 6979: детерминированный k. Одинаковый вход — одинаковая подпись. */
function deterministicK(d: bigint, digest: Uint8Array, attempt = 0): bigint {
  const x = hexToBytes(d.toString(16).padStart(64, '0'));
  const h = hexToBytes(mod(BigInt(`0x${bytesToHex(digest)}`), N).toString(16).padStart(64, '0'));

  let v: Uint8Array = new Uint8Array(32).fill(0x01);
  let k: Uint8Array = new Uint8Array(32).fill(0x00);
  k = hmacSha256(k, concatBytes(v, new Uint8Array([0x00]), x, h));
  v = hmacSha256(k, v);
  k = hmacSha256(k, concatBytes(v, new Uint8Array([0x01]), x, h));
  v = hmacSha256(k, v);

  let candidate = 0n;
  for (let i = 0; i <= attempt + 16; i += 1) {
    v = hmacSha256(k, v);
    candidate = BigInt(`0x${bytesToHex(v)}`);
    if (candidate > 0n && candidate < N && i >= attempt) return candidate;
    k = hmacSha256(k, concatBytes(v, new Uint8Array([0x00])));
    v = hmacSha256(k, v);
  }
  throw new Error('rfc6979_failed');
}

/**
 * Подпись 32-байтного дайджеста (в TRON это `txID`).
 *
 * Возвращает `signature` в формате, который ждёт сеть: 65 байт hex
 * `r || s || v`, где `v = 27 + recovery`. Подпись нормализуется (`s <= n/2`),
 * иначе часть узлов её отвергает.
 */
export function signDigest(digest: Uint8Array, privHex: string, attempt = 0): Signature {
  if (digest.length !== 32) throw new Error('bad_digest');
  const d = parsePrivateKey(privHex);
  const e = mod(BigInt(`0x${bytesToHex(digest)}`), N);

  for (let i = attempt; i < attempt + 16; i += 1) {
    const k = deterministicK(d, digest, i);
    const R = scalarMult(k);
    if (!R) continue;
    const r = mod(R.x, N);
    if (r === 0n) continue;
    let s = mod(invert(k, N) * (e + r * d), N);
    if (s === 0n) continue;

    let recovery = Number(R.y & 1n) + (R.x >= N ? 2 : 0);
    if (s > HALF_N) {
      s = N - s;
      recovery ^= 1;
    }
    const rHex = r.toString(16).padStart(64, '0');
    const sHex = s.toString(16).padStart(64, '0');
    const v = (27 + recovery).toString(16).padStart(2, '0');
    return { r, s, recovery, signature: `${rHex}${sHex}${v}` };
  }
  throw new Error('sign_failed');
}

/** Проверка подписи — для тестов и диагностики. */
export function verifyDigest(digest: Uint8Array, signatureHex: string, publicKey64: Uint8Array): boolean {
  const clean = signatureHex.startsWith('0x') ? signatureHex.slice(2) : signatureHex;
  if (clean.length !== 130) return false;
  const r = BigInt(`0x${clean.slice(0, 64)}`);
  const s = BigInt(`0x${clean.slice(64, 128)}`);
  if (r <= 0n || r >= N || s <= 0n || s >= N) return false;

  const e = mod(BigInt(`0x${bytesToHex(digest)}`), N);
  const w = invert(s, N);
  const u1 = mod(e * w, N);
  const u2 = mod(r * w, N);
  const pub: Point = {
    x: BigInt(`0x${bytesToHex(publicKey64.slice(0, 32))}`),
    y: BigInt(`0x${bytesToHex(publicKey64.slice(32))}`),
  };
  const point = pointAdd(scalarMult(u1), scalarMult(u2, pub));
  if (!point) return false;
  return mod(point.x, N) === r;
}

export function sha256BytesOf(data: Uint8Array): Uint8Array {
  return sha256Bytes(data);
}
