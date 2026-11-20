import { describe, expect, it } from 'vitest';
import { keccak256Hex } from '../../src/pay/crypto/keccak';
import {
  addressFromPrivateKey, compressedPublicKey, publicKeyFromPrivate, signDigest, verifyDigest,
} from '../../src/pay/crypto/secp256k1';
import { bytesToHex, hexToBytes } from '../../src/pay/crypto/hmac';
import { deriveKey } from '../../src/pay/crypto/hd';
import { TRANSFER_TOPIC } from '../../src/pay/tron/transfer';
import { isValidAddress } from '../../src/pay/tron/address';

// Криптография проверяется векторами из реальных сетей, а не «само с собой»:
// если keccak или secp256k1 ошибается, адрес уйдёт в никуда, а подпись сеть
// отвергнет — и узнаем мы об этом в самый неподходящий момент.

const KEY_ONE = '0'.repeat(63) + '1';
const GENERATOR = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
  + '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';
const SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

describe('keccak-256', () => {
  it('совпадает с эталонными значениями', () => {
    expect(keccak256Hex('')).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(keccak256Hex('abc')).toBe('4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  });

  it('тема события Transfer совпадает с константой проекта', () => {
    expect(keccak256Hex('Transfer(address,address,uint256)')).toBe(TRANSFER_TOPIC);
  });

  it('длинный вход обрабатывается блоками по 136 байт', () => {
    const short = keccak256Hex('a'.repeat(135));
    const long = keccak256Hex('a'.repeat(272));
    expect(short).toHaveLength(64);
    expect(long).toHaveLength(64);
    expect(short).not.toBe(long);
  });
});

describe('secp256k1', () => {
  it('приватный ключ 1 даёт точку G', () => {
    expect(bytesToHex(publicKeyFromPrivate(KEY_ONE))).toBe(GENERATOR);
    expect(bytesToHex(compressedPublicKey(KEY_ONE))).toBe(`02${GENERATOR.slice(0, 64)}`);
  });

  it('приватный ключ 1 даёт известный адрес TRON', () => {
    // Тот же ключ в Ethereum — 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf.
    expect(addressFromPrivateKey(KEY_ONE)).toBe('TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC');
    expect(isValidAddress(addressFromPrivateKey(KEY_ONE))).toBe(true);
  });

  it('подпись проверяется открытым ключом, а подмена дайджеста — нет', () => {
    const digest = hexToBytes('11'.repeat(32));
    const sig = signDigest(digest, KEY_ONE);
    const pub = publicKeyFromPrivate(KEY_ONE);

    expect(sig.signature).toHaveLength(130);
    expect(verifyDigest(digest, sig.signature, pub)).toBe(true);
    expect(verifyDigest(hexToBytes('12'.repeat(32)), sig.signature, pub)).toBe(false);
    expect(verifyDigest(digest, sig.signature, publicKeyFromPrivate('0'.repeat(62) + '02'))).toBe(false);
  });

  it('подпись детерминирована: два вызова дают одно и то же', () => {
    const digest = hexToBytes('ab'.repeat(32));
    expect(signDigest(digest, KEY_ONE).signature).toBe(signDigest(digest, KEY_ONE).signature);
  });

  it('s нормализована (не больше n/2) — иначе часть узлов отвергает подпись', () => {
    const halfN = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
    for (const seedByte of ['01', '02', '03', '04', '05']) {
      const sig = signDigest(hexToBytes(seedByte.repeat(32)), KEY_ONE);
      expect(sig.s).toBeLessThanOrEqual(halfN);
      expect(sig.recovery).toBeGreaterThanOrEqual(0);
      expect(sig.recovery).toBeLessThanOrEqual(3);
    }
  });

  it('битый приватный ключ отвергается', () => {
    expect(() => publicKeyFromPrivate('')).toThrow(/bad_private_key/);
    expect(() => publicKeyFromPrivate('1'.repeat(63))).toThrow(/bad_private_key/);
    expect(() => publicKeyFromPrivate('0'.repeat(64))).toThrow(/bad_private_key/);
  });
});

describe('вывод адресов из семени', () => {
  it('детерминирован и уникален по индексу', async () => {
    const first = await deriveKey(SEED, 0);
    const again = await deriveKey(SEED, 0);
    const second = await deriveKey(SEED, 1);

    expect(first.address).toBe(again.address);
    expect(first.privateKey).toBe(again.privateKey);
    expect(second.address).not.toBe(first.address);
    expect(first.path).toBe("m/44'/195'/0'/0/0");
    expect(isValidAddress(first.address)).toBe(true);
  });

  it('адрес совпадает с адресом из приватного ключа', async () => {
    const key = await deriveKey(SEED, 3);
    expect(addressFromPrivateKey(key.privateKey)).toBe(key.address);
  });

  it('другое семя — другие адреса', async () => {
    const a = await deriveKey(SEED, 0);
    const b = await deriveKey(SEED.replace('00', 'ff'), 0);
    expect(a.address).not.toBe(b.address);
  });

  it('слишком короткое семя и кривой индекс отвергаются', async () => {
    await expect(deriveKey('00', 0)).rejects.toThrow(/seed_too_short/);
    await expect(deriveKey(SEED, -1)).rejects.toThrow(/bad_index/);
    await expect(deriveKey(SEED, 0x80000000)).rejects.toThrow(/bad_index/);
  });
});
