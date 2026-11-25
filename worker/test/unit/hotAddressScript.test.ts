// Скрипт `pay:hot-address`: адрес кошелька для обеих сетей из одного ключа.
//
// Проверяется внешним вектором, а не «функция вернула строку»: жёлтая книга
// Ethereum даёт адрес для приватного ключа `1` = `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`
// (это keccak256 от точки G), а `TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC` — тот же ключ
// в TRON. Если пайплайн «ключ → открытый ключ → адрес» сломается в любой части
// (кривая, keccak, base58), тест упадёт на известных числах, а не на совпадении
// с самим собой.
import { describe, expect, it } from 'vitest';
import { chainOfAddress, hotAddresses } from '../../../scripts/hot-address';

const KEY_ONE = '0'.repeat(63) + '1';

describe('адрес горячего кошелька из ключа', () => {
  it('скрипт запускается и печатает обе формы (ключ из окружения)', async () => {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('npx', ['tsx', 'scripts/hot-address.ts'], {
      cwd: new URL('../../../', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, SIGNER_PRIVATE_KEY: KEY_ONE },
    });
    const parsed = JSON.parse(out) as Record<string, string>;
    expect(parsed.tron).toBe('TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC');
    expect(parsed.bsc).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
    // Ключ в вывод не попадает — это единственный смысл скрипта.
    expect(out).not.toContain('0'.repeat(63) + '1');
  });

  it('`--check` сверяет адрес и не даёт оставить в конфиге адрес прошлой сети', async () => {
    const { execFileSync } = await import('node:child_process');
    const run = (extra: string[]) => execFileSync('npx', ['tsx', 'scripts/hot-address.ts', ...extra], {
      cwd: new URL('../../../', import.meta.url),
      encoding: 'utf8',
      env: { ...process.env, SIGNER_PRIVATE_KEY: KEY_ONE },
    });
    // Свой адрес + нужная сеть → ок.
    expect(JSON.parse(run(['--check', '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf', '--chain', 'bsc'])).ok).toBe(true);
    // Тот же ключ, но в конфиге остался TRON-адрес, а сеть уже BSC → не ок.
    let code = 0;
    try {
      run(['--check', 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC', '--chain', 'bsc']);
    } catch (e) {
      code = (e as { status?: number }).status ?? 0;
    }
    expect(code).toBe(1);
  });

  it('один ключ — два адреса: TRON и EVM, и они разные', () => {
    const found = hotAddresses(KEY_ONE);
    expect(found.tron).toBe('TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC');
    expect(found.bsc.lower).toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
    expect(found.bsc.checksum).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
    expect(found.bsc.lower.slice(2)).not.toBe(found.tron);
  });

  it('ключ принимает `0x`, пробелы и ВЕРХНИЙ регистр: его копируют из разных мест', () => {
    const spaced = hotAddresses(`  0X${'0'.repeat(63)}1  `);
    expect(spaced.tron).toBe(hotAddresses(KEY_ONE).tron);
  });

  it('кривой ключ — явная ошибка, а не «ноль-адрес»', () => {
    expect(() => hotAddresses('00'.repeat(31))).toThrow('ключ должен быть 64 hex-символа');
    expect(() => hotAddresses('z'.repeat(64))).toThrow(/hex/);
    // N (порядок группы) как ключ — вне диапазона: адрес строить не из чего.
    expect(() => hotAddresses('ffffffff'.repeat(8))).toThrow();
  });

  it('форма адреса говорит, к какой сети она относится', () => {
    expect(chainOfAddress('0x' + 'ab'.repeat(20))).toBe('bsc');
    expect(chainOfAddress('0X' + 'AB'.repeat(20))).toBe('bsc');
    expect(chainOfAddress('TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC')).toBe('tron');
    expect(chainOfAddress('0x123')).toBe('unknown');
    expect(chainOfAddress('')).toBe('unknown');
  });
});
