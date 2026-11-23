// Проверка «чем платить» перед отправкой выплаты.
//
// Смысл: не отправлять в сеть перевод, который заведомо провалится, и называть
// причину человеческим языком («на кошельке нет USDT», «нет TRX на комиссию»),
// а не «ошибка сети».
import { describe, expect, it } from 'vitest';
import { payoutBlocker, hotWalletState } from '../../src/pay/hotwallet';
import { SWEEP_FEE_SUN } from '../../src/pay/sweep';

const HOT = 'TEpNofrztMUwq3HgRjQARLF4ScxSbWRgFp';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function fakeChain(payload: unknown | 'error') {
  return {
    contract: USDT,
    apiBase: 'https://api.trongrid.io',
    fetchJson: async (_url: string) => {
      if (payload === 'error') throw new Error('http_503');
      return payload;
    },
  };
}

function chainWith(usdtMicro: number, trxSun: number) {
  return {
    data: [{
      balance: trxSun,
      trc20: usdtMicro > 0 ? [{ [USDT]: String(usdtMicro) }] : [],
    }],
  };
}

describe('вердикт по кошельку', () => {
  it('денег и комиссии хватает — платить можно', () => {
    expect(payoutBlocker({ usdtMicro: 10_000_000, trxSun: SWEEP_FEE_SUN }, 5_000_000)).toBeNull();
  });

  it('USDT меньше суммы перевода — виноват USDT, а не сеть', () => {
    expect(payoutBlocker({ usdtMicro: 1_000_000, trxSun: SWEEP_FEE_SUN }, 5_000_000))
      .toBe('hot_wallet_insufficient_usdt');
  });

  it('USDT хватает, но TRX нет — перевод всё равно невозможен', () => {
    expect(payoutBlocker({ usdtMicro: 10_000_000, trxSun: SWEEP_FEE_SUN - 1 }, 5_000_000))
      .toBe('hot_wallet_no_trx');
  });

  it('пустой кошелёк — сначала не хватает USDT', () => {
    expect(payoutBlocker({ usdtMicro: 0, trxSun: 0 }, 5_000_000)).toBe('hot_wallet_insufficient_usdt');
  });
});

describe('чтение кошелька', () => {
  it('называет нехватку в USDT', async () => {
    const state = await hotWalletState(fakeChain(chainWith(1_000_000, SWEEP_FEE_SUN)), HOT, 5_000_000);
    expect(state.blocker).toBe('hot_wallet_insufficient_usdt');
    expect(state.usdt).toBe('1.00');
    expect(state.shortfall).toBe('4.00');
    expect(state.error).toBeNull();
  });

  it('видит, что USDT есть, а TRX нет', async () => {
    const state = await hotWalletState(fakeChain(chainWith(9_000_000, 0)), HOT, 5_000_000);
    expect(state.blocker).toBe('hot_wallet_no_trx');
    expect(state.trxSun).toBe(0);
    expect(state.shortfallMicro).toBe(0);
  });

  it('сеть молчит — вердикта нет, отправку не блокируем', async () => {
    const state = await hotWalletState(fakeChain('error'), HOT, 5_000_000);
    expect(state.error).toBe('chain_error');
    expect(state.blocker).toBeNull();
  });

  it('без адреса кошелька честно говорит, чего нет', async () => {
    const state = await hotWalletState(fakeChain(chainWith(0, 0)), '', 5_000_000);
    expect(state.error).toBe('hot_wallet_missing');
    expect(state.address).toBe('');
  });
});
