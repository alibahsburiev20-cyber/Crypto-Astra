// Адреса EVM (BNB Chain / BEP-20): `0x…` с контрольной суммой EIP-55.
//
// Зачем это здесь: TRC-20 жжёт ~15 TRX за перевод, а BEP-20 — доли цента. Чтобы
// принять USDT в сети Binance Smart Chain, нужны свои адреса на каждого игрока,
// и выводить их надо из того же семени, что и TRON-адреса, но по другому пути
// (`m/44'/60'/0'/0/{i}` вместо `m/44'/195'/0'/0/{i}`).
//
// Опасность, которую надо помнить: адрес EVM одинаков во всех EVM-сетях. Если
// игрок отправит USDT по сети Ethereum или Polygon на этот `0x`-адрес, деньги
// уедут не туда — но ключ у нас тот же, поэтому они не потеряны навсегда, а
// застрянут, пока не будет газа в той сети. На TRON такой путаницы нет: формат
// `T…` в EVM не проходит проверку.
//
// Модуль ничего не подписывает: только адреса и проверки.

import { keccak256 } from '../crypto/keccak';
import { bytesToHex } from '../crypto/hmac';
import { publicKeyFromPrivate } from '../crypto/secp256k1';

/** EIP-55: заглавные буквы там, где соответствующий полубайт хеша ≥ 8. */
export function toChecksumAddress(address: string): string {
  const raw = String(address ?? '').trim();
  const hex = (raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new Error('bad_evm_address');
  const hash = bytesToHex(keccak256(new TextEncoder().encode(hex)));
  let out = '0x';
  for (let i = 0; i < hex.length; i += 1) {
    out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}

/**
 * Проверка адреса. Принимаем и `0xABC…` в контрольной сумме, и полностью
 * нижний регистр (так отдают RPC и большинство кошельков), но не «смешанный
 * регистр с неверной суммой»: это самая частая опечатка при копировании.
 */
export function isEvmAddress(input: string): boolean {
  const raw = String(input ?? '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return false;
  const hex = raw.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  try {
    return toChecksumAddress(raw) === raw;
  } catch {
    return false;
  }
}

/**
 * Адрес из открытого ключа.
 *
 * `publicKeyFromPrivate` у нас отдаёт 64 байта (x||y без префикса), но ключ
 * может прийти и в «сетевом» виде — 65 байт с ведущим `04`. Принимаем оба и
 * префикс отбрасываем: иначе адрес молча считался бы от чужих байт.
 */
export function evmAddressFromPublicKey(publicKey: Uint8Array): string {
  const raw = publicKey.length === 65 && publicKey[0] === 0x04 ? publicKey.slice(1) : publicKey;
  if (raw.length !== 64) throw new Error('bad_public_key');
  const hash = keccak256(raw);
  return toChecksumAddress(bytesToHex(hash.slice(12)));
}

/** Адрес из приватного ключа (64 hex). */
export function evmAddressFromPrivateKey(privHex: string): string {
  const clean = String(privHex ?? '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error('bad_private_key');
  return evmAddressFromPublicKey(publicKeyFromPrivate(clean.toLowerCase()));
}
