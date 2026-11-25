// Шкала денег в разных сетях. Главный тест на «переезд на BEP-20».
//
// Почему это отдельный файл с эталонными числами: 1 USDT в TRON приходит как
// `1000000`, а в BNB Chain — как `1000000000000000000`. Ошибка в этом
// пересчёте не «падает», а молча зачисляет в триллион раз меньше (или больше).
import { describe, expect, it } from 'vitest';
import {
  AmountError, MICRO, USDT_ONCHAIN_DECIMALS, chainValueRemainder, chainValueToMicro,
  formatChainValue, isExactMicro, isPayChain, microToChainValue, scalePerMicro, usdtDecimals,
} from '../../src/pay/units';

describe('шкала сети', () => {
  it('TRON — 6 знаков, BSC — 18', () => {
    expect(USDT_ONCHAIN_DECIMALS).toEqual({ tron: 6, bsc: 18 });
    expect(usdtDecimals('bsc')).toBe(18);
    expect(scalePerMicro('tron')).toBe(1n);
    expect(scalePerMicro('bsc')).toBe(1_000_000_000_000n);
  });

  it('список сетей закрыт: четвёртой сети здесь быть не может', () => {
    expect(isPayChain('bsc')).toBe(true);
    expect(isPayChain('solana')).toBe(false);
    expect(() => usdtDecimals('solana' as never)).toThrow();
  });
});

describe('chainValueToMicro', () => {
  it('1 USDT в каждой сети = 1 000 000 micro', () => {
    expect(chainValueToMicro('1000000', 'tron')).toBe(MICRO);
    expect(chainValueToMicro('1000000000000000000', 'bsc')).toBe(MICRO);
    expect(chainValueToMicro(1000000n, 'tron')).toBe(MICRO);
  });

  it('15 USDT — ровно столько же, сколько обещано игроку', () => {
    expect(chainValueToMicro('15000000000000000000', 'bsc')).toBe(15 * MICRO);
  });

  it('мельче micro не зачисляем: это пыль, а не депозит', () => {
    expect(() => chainValueToMicro('999999999999', 'bsc')).toThrow(/amount_below_precision/);
    expect(() => chainValueToMicro('1', 'bsc')).toThrow(/amount_below_precision/);
    expect(() => chainValueToMicro('0', 'tron')).toThrow(/amount_below_precision/);
  });

  it('хвост отбрасывается вниз, а не вверх', () => {
    // 1 USDT + 5e11 (половина micro) → зачисляется ровно 1 USDT.
    const raw = (10n ** 18n + 500_000_000_000n).toString();
    expect(chainValueToMicro(raw, 'bsc')).toBe(MICRO);
    expect(chainValueRemainder(raw, 'bsc')).toBe(500_000_000_000n);
    expect(isExactMicro(raw, 'bsc')).toBe(false);
    expect(isExactMicro('1000000000000000000', 'bsc')).toBe(true);
  });

  it('переполнение отсекается, а не превращается в float', () => {
    const huge = (BigInt(Number.MAX_SAFE_INTEGER) + 1n) * 1_000_000_000_000n;
    expect(() => chainValueToMicro(huge.toString(), 'bsc')).toThrow(/amount_too_big/);
    expect(() => chainValueToMicro('1'.repeat(41), 'bsc')).toThrow(/chain_value_too_long/);
  });

  it('мусор и отрицательные числа отвергаются', () => {
    for (const bad of ['', ' ', '-1', '1.5', '1e18', '0x10', 'abc', null, undefined, {}, 1.5]) {
      expect(() => chainValueToMicro(bad, 'bsc')).toThrow(AmountError);
    }
  });

  it('ведущие нули и пробелы по краям — не повод терять платёж', () => {
    expect(chainValueToMicro('0000001000000', 'tron')).toBe(MICRO);
    expect(chainValueToMicro('  1000000000000000000  ', 'bsc')).toBe(MICRO);
  });
});

describe('microToChainValue', () => {
  it('обратный пересчёт совпадает с прямым', () => {
    for (const micro of [1, 999_999, 1_000_000, 15 * MICRO, 12_345_678]) {
      for (const chain of ['tron', 'bsc'] as const) {
        const raw = microToChainValue(micro, chain);
        expect(chainValueToMicro(raw, chain)).toBe(micro);
      }
    }
  });

  it('1 USDT на BSC = 1e18 — именно это число кладём в calldata', () => {
    expect(microToChainValue(MICRO, 'bsc')).toBe(1_000_000_000_000_000_000n);
  });

  it('ноль и дробь — ошибка, а не «молча отправим 0»', () => {
    expect(() => microToChainValue(0, 'bsc')).toThrow(AmountError);
    expect(() => microToChainValue(1.5, 'bsc')).toThrow(AmountError);
    expect(() => microToChainValue(-1_000_000, 'bsc')).toThrow(AmountError);
  });
});

describe('formatChainValue', () => {
  it('печатает сумму так, как её видит эксплорер', () => {
    expect(formatChainValue('1000000000000000000', 'bsc')).toBe('1');
    expect(formatChainValue('1500000000000000000', 'bsc')).toBe('1.5');
    expect(formatChainValue('1500000', 'tron')).toBe('1.5');
    expect(formatChainValue('1', 'bsc')).toBe('0.000000000000000001');
  });
});
