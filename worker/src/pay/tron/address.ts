// Base58 и адреса TRON.
//
// В TRON адрес — это 21 байт: префикс `0x41` и 20 байт хеша открытого ключа.
// В текст он превращается через base58check: base58(байты + первые 4 байта
// двойного SHA-256). Поэтому адрес всегда начинается с `T`.
//
// Здесь только чистые функции без сети и без ключей: они нужны монитору
// (проверить, что перевод пришёл на наш адрес) и админке (показать адрес
// игроку). Приватных ключей в этом файле нет и не будет.

import { sha256Bytes } from '../../shared/sha256';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

/** Ошибка разбора адреса. `code` — машинный код, чтобы не зависеть от класса в RPC. */
export class TronAddressError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'TronAddressError';
    this.code = code;
  }
}

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let n = 0n;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return '1'.repeat(zeros) + out;
}

export function base58Decode(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === '1') zeros += 1;
  let n = 0n;
  for (const char of text) {
    const value = ALPHABET_MAP.get(char);
    if (value === undefined) throw new TronAddressError('base58_charset');
    n = n * 58n + BigInt(value);
  }
  const tail: number[] = [];
  while (n > 0n) {
    tail.unshift(Number(n % 256n));
    n /= 256n;
  }
  return new Uint8Array([...new Array(zeros).fill(0), ...tail]);
}

/** Первые 4 байта двойного SHA-256 — контрольная сумма base58check. */
export function checksum4(payload: Uint8Array): Uint8Array {
  return sha256Bytes(sha256Bytes(payload)).slice(0, 4);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new TronAddressError('hex_charset');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** 20 байт (или 21 с префиксом `41`) → адрес вида `T...`. */
export function hexToBase58(hex: string): string {
  const clean = hex.toLowerCase().replace(/^0x/, '');
  let payload = hexToBytes(clean);
  if (payload.length === 20) payload = new Uint8Array([0x41, ...payload]);
  if (payload.length !== 21 || payload[0] !== 0x41) throw new TronAddressError('bad_prefix');
  return base58Encode(new Uint8Array([...payload, ...checksum4(payload)]));
}

/** Адрес вида `T...` → `41` + 40 hex. Неверная сумма или префикс — исключение. */
export function addressToHex(address: string): string {
  const raw = String(address ?? '').trim();
  if (raw.length !== 34 || !raw.startsWith('T')) throw new TronAddressError('bad_address');
  const decoded = base58Decode(raw);
  if (decoded.length !== 25) throw new TronAddressError('bad_length');
  const payload = decoded.slice(0, 21);
  const sum = decoded.slice(21);
  if (payload[0] !== 0x41) throw new TronAddressError('bad_prefix');
  if (!bytesEqual(sum, checksum4(payload))) throw new TronAddressError('bad_checksum');
  return bytesToHex(payload);
}

export function isValidAddress(address: string): boolean {
  try {
    addressToHex(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Канонический вид адреса: `T...`. Всё, что не проходит контрольную сумму,
 * отвергается — иначе опечатка в адресе выплаты отправит деньги в никуда.
 */
export function normalizeAddress(address: string): string {
  const raw = String(address ?? '').trim();
  // Уже hex (41… или 20 байт) — переводим в base58, иначе проверяем base58.
  if (/^(0x)?[0-9a-fA-F]{40,42}$/.test(raw)) return hexToBase58(raw);
  return hexToBase58(addressToHex(raw));
}

/** Адрес из 20 байт открытого ключа (хеш keccak считает Signer — здесь только сборка). */
export function addressFromPublicKeyHash(hash20: Uint8Array | string): string {
  const hex = typeof hash20 === 'string' ? hash20 : bytesToHex(hash20);
  if (hex.replace(/^0x/, '').length !== 40) throw new TronAddressError('bad_length');
  return hexToBase58(hex);
}
