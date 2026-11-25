import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/env';
import { payFlags, payNetwork, publicFlags } from '../../src/pay/flags';
import { payStatus } from '../../src/routes/pay';

// Деньги включаются только словом `on`. Эти тесты — страховка от случайного
// включения: опечатка, `true`, `1`, `yes` и пустая строка оставляют флаги
// выключенными.

const env = (patch: Partial<Env>): Env => ({ ...patch } as unknown as Env);

describe('флаги Astra Pay', () => {
  it('по умолчанию всё выключено', () => {
    const flags = payFlags(env({}));
    expect(flags).toMatchObject({
      payments: false, deposits: false, purchases: false, pool: false,
      payouts: false, sweep: false, schemaCheck: false, network: 'nile',
    });
  });

  it('включается только значением on', () => {
    for (const value of ['true', '1', 'yes', 'ON', ' on ']) {
      // 'ON' и ' on ' — это тоже `on`: регистр и пробелы не считаются опечаткой.
      const expected = value.trim().toLowerCase() === 'on';
      expect(payFlags(env({ PAYMENTS_ENABLED: value })).payments).toBe(expected);
    }
  });

  it('дочерние флаги не работают при выключенном общем', () => {
    const flags = payFlags(env({
      PAYMENTS_ENABLED: 'off',
      DEPOSITS_ENABLED: 'on',
      PURCHASES_ENABLED: 'on',
      PAYOUTS_ENABLED: 'on',
      SWEEP_ENABLED: 'on',
      POOL_ENABLED: 'on',
    }));
    expect(flags.payments).toBe(false);
    expect(flags.deposits).toBe(false);
    expect(flags.purchases).toBe(false);
    expect(flags.payouts).toBe(false);
    expect(flags.sweep).toBe(false);
    expect(flags.pool).toBe(false);
  });

  it('при включённом общем флаге дочерние включаются по отдельности', () => {
    const flags = payFlags(env({
      PAYMENTS_ENABLED: 'on',
      DEPOSITS_ENABLED: 'on',
      PAYMENTS_ENABLED_TYPO: 'on',
    } as Partial<Env>));
    expect(flags.payments).toBe(true);
    expect(flags.deposits).toBe(true);
    expect(flags.purchases).toBe(false);
    expect(flags.payouts).toBe(false);
  });

  it('сеть по умолчанию — тестнет nile', () => {
    expect(payNetwork(env({}))).toBe('nile');
    expect(payNetwork(env({ PAY_NETWORK: 'Nile ' }))).toBe('nile');
    expect(payNetwork(env({ PAY_NETWORK: 'mainnet' }))).toBe('mainnet');
    expect(payNetwork(env({ PAY_NETWORK: 'trash' }))).toBe('nile');
  });

  it('публичные флаги не содержат лишнего', () => {
    const flags = payFlags(env({ PAYMENTS_ENABLED: 'on' }));
    expect(Object.keys(publicFlags(flags)).sort()).toEqual(
      ['deposits', 'payments', 'pool', 'payouts', 'purchases', 'sweep'].sort(),
    );
    expect(publicFlags(flags).payments).toBe(true);
  });
});

/** D1, который падает при любом обращении: статус при выключенных деньгах не должен трогать базу. */
const untouchableDb = {
  prepare() {
    throw new Error('D1 не должна вызываться при выключенных платежах');
  },
} as unknown as D1Database;

describe('GET /pay/status.json', () => {
  it('при выключенных деньгах не трогает D1 и отдаёт schema: off', async () => {
    const res = await payStatus(env({ DB: untouchableDb }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.network).toBe('nile');
    expect(body.asset).toBe('USDT');
    expect(body.decimals).toBe(6);
    expect(body.schema).toBe('off');
    expect(body.tables).toBe(15);
    expect(body.contract).toBe('TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj');
    expect((body.flags as Record<string, boolean>).payments).toBe(false);
    // Никаких адресов, ключей и сумм в публичном ответе.
    expect(JSON.stringify(body)).not.toMatch(/private|secret|key|balance/i);
  });

  it('контракт mainnet подставляется по сети', async () => {
    const res = await payStatus(env({ PAY_NETWORK: 'mainnet' }));
    const body = await res.json() as Record<string, unknown>;
    expect(body.contract).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  });

  it('свой контракт переопределяет стандартный', async () => {
    const res = await payStatus(env({ PAY_USDT_CONTRACT: 'TXYZ' }));
    const body = await res.json() as Record<string, unknown>;
    expect(body.contract).toBe('TXYZ');
  });
});
