// Адреса EVM (BEP-20): проверка на известных векторах.
//
// Смысл теста: адрес — это куда уходят деньги. Ошибка в keccak или в контрольной
// сумме означает «деньги ушли не туда», и обнаружится это уже после перевода.
// Поэтому проверяем не «функция что-то вернула», а совпадение с эталонными
// значениями из спецификаций.
import { describe, expect, it } from 'vitest';
import { keccak256Hex } from '../../src/pay/crypto/keccak';
import {
  evmAddressFromPrivateKey, evmAddressFromPublicKey, isEvmAddress, toChecksumAddress,
} from '../../src/pay/evm/address';
import { deriveEvmKey } from '../../src/pay/evm/derivation';
import { BSC_MAINNET, BSC_TESTNET, evmReady, evmUsdtContract } from '../../src/pay/evm/config';
import { publicKeyFromPrivate } from '../../src/pay/crypto/secp256k1';

describe('keccak256 — основа адреса', () => {
  it('хеш пустой строки совпадает с эталоном', () => {
    expect(keccak256Hex('')).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  });
});

describe('адрес из ключа', () => {
  it('приватный ключ 1 даёт известный адрес', () => {
    // Эталон: приватный ключ 0x…01 в Ethereum/BSC.
    expect(evmAddressFromPrivateKey('1'.padStart(64, '0')))
      .toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
  });

  it('приватный ключ 2 даёт известный адрес', () => {
    expect(evmAddressFromPrivateKey('2'.padStart(64, '0')))
      .toBe('0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF');
  });

  it('принимает ключ с префиксом 0x и в верхнем регистре', () => {
    const key = '1'.padStart(64, '0');
    expect(evmAddressFromPrivateKey(`0x${key.toUpperCase()}`))
      .toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
  });

  it('адрес из открытого ключа совпадает с адресом из ключа', () => {
    // Не 'f'.repeat(64): это больше порядка кривой (N), такой ключ невалиден.
    const priv = 'a'.repeat(64);
    expect(evmAddressFromPublicKey(publicKeyFromPrivate(priv))).toBe(evmAddressFromPrivateKey(priv));
  });

  it('мусор вместо ключа — ошибка, а не адрес', () => {
    expect(() => evmAddressFromPrivateKey('zz')).toThrow(/bad_private_key/);
    expect(() => evmAddressFromPrivateKey('1'.repeat(63))).toThrow(/bad_private_key/);
  });
});

describe('контрольная сумма EIP-55', () => {
  it('эталонные адреса из спецификации', () => {
    const vectors = [
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ];
    for (const address of vectors) {
      expect(toChecksumAddress(address.toLowerCase())).toBe(address);
      expect(isEvmAddress(address)).toBe(true);
    }
  });

  it('неверная сумма отвергается: это опечатка при копировании', () => {
    expect(isEvmAddress('0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(false);
  });

  it('нижний регистр допустим: так отдают RPC и кошельки', () => {
    expect(isEvmAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true);
  });

  it('TRON-адрес не проходит как EVM', () => {
    expect(isEvmAddress('TEpNofrztMUwq3HgRjQARLF4ScxSbWRgFp')).toBe(false);
    expect(isEvmAddress('0x123')).toBe(false);
  });
});

describe('вывод ключей игроков для BSC', () => {
  const seed = 'a'.repeat(64);

  it('тот же индекс — тот же адрес, другой индекс — другой', async () => {
    const a = await deriveEvmKey(seed, 7);
    const b = await deriveEvmKey(seed, 7);
    const c = await deriveEvmKey(seed, 8);
    expect(a.address).toBe(b.address);
    expect(a.address).not.toBe(c.address);
    expect(a.path).toBe("m/44'/60'/0'/0/7");
    expect(isEvmAddress(a.address)).toBe(true);
  });

  it('адрес совпадает с адресом из выведенного ключа', async () => {
    const key = await deriveEvmKey(seed, 3);
    expect(key.address).toBe(evmAddressFromPrivateKey(key.privateKey));
  });

  it('TRON и BSC адреса одного игрока не совпадают', async () => {
    // Один индекс — два пути (195 и 60): адреса обязаны различаться.
    const evm = await deriveEvmKey(seed, 1);
    expect(evm.address.startsWith('0x')).toBe(true);
    expect(evm.address).not.toBe('TEpNofrztMUwq3HgRjQARLF4ScxSbWRgFp');
  });
});

describe('конфигурация сети', () => {
  it('mainnet — настоящий BSC и контракт BSC-USD', () => {
    expect(BSC_MAINNET.chainId).toBe(56);
    expect(BSC_MAINNET.usdt).toBe('0x55d398326f99059fF775485246999027B3197955');
    expect(evmReady('mainnet')).toBe(true);
  });

  it('тестнет без явного контракта не принимает деньги', () => {
    expect(BSC_TESTNET.chainId).toBe(97);
    expect(evmReady('nile')).toBe(false);
    expect(evmReady('nile', '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd')).toBe(true);
  });

  it('контракт из конфигурации важнее стандартного', () => {
    const custom = '0x1111111111111111111111111111111111111111';
    expect(evmUsdtContract('mainnet', custom)).toBe(custom);
    expect(evmUsdtContract('mainnet', '')).toBe(BSC_MAINNET.usdt);
  });
});
