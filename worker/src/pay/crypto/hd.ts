// Вывод ключей адресов из одного семени (BIP32, путь m/44'/195'/0'/0/{i}).
//
// Смысл: у игры один корень, а у каждого игрока — свой адрес. Индекс хранится в
// базе, поэтому адрес можно восстановить из одного семени и индекса.
//
// SHA-512 для HMAC берём из WebCrypto: он есть и в Workers, и в Node, а писать
// свою реализацию 80-раундового хеша ради одной функции — лишний риск.
//
// ВАЖНО: эта функция живёт в Signer-контуре. Основной Worker адреса только
// запрашивает, приватных ключей у него нет.

import { bytesToHex, concatBytes, hexToBytes } from './hmac';
import { N, compressedPublicKey, addressFromPrivateKey } from './secp256k1';

export const COIN_TRON = 195;
export const DEFAULT_PATH = [44, COIN_TRON, 0, 0] as const;

export interface DerivedKey {
  index: number;
  privateKey: string;
  address: string;
  path: string;
}

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
}

function indexBytes(index: number): Uint8Array {
  return new Uint8Array([
    (index >>> 24) & 0xff, (index >>> 16) & 0xff, (index >>> 8) & 0xff, index & 0xff,
  ]);
}

function toBigInt(bytes: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(bytes)}`);
}

function pad32(value: bigint): Uint8Array {
  return hexToBytes(value.toString(16).padStart(64, '0'));
}

export interface Node { key: bigint; chainCode: Uint8Array }

export async function masterFromSeed(seed: Uint8Array): Promise<Node> {
  if (seed.length < 16) throw new Error('seed_too_short');
  const I = await hmacSha512(new TextEncoder().encode('Bitcoin seed'), seed);
  const key = toBigInt(I.slice(0, 32));
  if (key === 0n || key >= N) throw new Error('bad_seed');
  return { key, chainCode: I.slice(32) };
}

export async function deriveChild(parent: Node, index: number, hardened: boolean): Promise<Node> {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new Error('bad_index');
  const child = hardened ? index + 0x80000000 : index;

  const data = hardened
    ? concatBytes(new Uint8Array([0x00]), pad32(parent.key), indexBytes(child))
    : concatBytes(compressedPublicKey(bytesToHex(pad32(parent.key))), indexBytes(child));

  const I = await hmacSha512(parent.chainCode, data);
  const tweak = toBigInt(I.slice(0, 32));
  const key = (tweak + parent.key) % N;
  if (key === 0n || tweak >= N) throw new Error('bad_child');
  return { key, chainCode: I.slice(32) };
}

/** Ключ для игрока: путь `m/44'/195'/0'/0/{index}`. */
export async function deriveKey(seedHex: string, index: number): Promise<DerivedKey> {
  const seed = hexToBytes(seedHex);
  let node = await masterFromSeed(seed);
  for (const step of DEFAULT_PATH) node = await deriveChild(node, step, true);
  node = await deriveChild(node, index, false);

  const privateKey = node.key.toString(16).padStart(64, '0');
  return {
    index,
    privateKey,
    address: addressFromPrivateKey(privateKey),
    path: `m/44'/195'/0'/0/${index}`,
  };
}

/** Корневой открытый ключ (xpub-подобный), которым можно проверять адреса. */
export async function rootPublicKey(seedHex: string): Promise<string> {
  const node = await masterFromSeed(hexToBytes(seedHex));
  const priv = node.key.toString(16).padStart(64, '0');
  return bytesToHex(compressedPublicKey(priv));
}
