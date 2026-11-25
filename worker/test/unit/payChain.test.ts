// Выбор сети собран в одном месте: `pay/chain.ts`.
//
// Проверяем не «функция вернула объект», а то, из-за чего на самом деле теряют
// деньги при переезде: разные decimals, чужой контракт, адрес не той формы и
// обещание игроку там, где код ещё ничего не умеет.
import { describe, expect, it } from 'vitest';
import { payAddress, payStatus } from '../../src/routes/pay';
import { activeChain, chainSpec } from '../../src/pay/chain';
import { payFlags, walletState } from '../../src/pay/flags';
import { hexToBase58 } from '../../src/pay/tron/address';
import { USDT_MAINNET, USDT_NILE } from '../../src/pay/tron/contracts';
import { BSC_MAINNET } from '../../src/pay/evm/config';

const TRON_ADDR = hexToBase58('41' + '11'.repeat(20));
const EVM_ADDR = '0x2222222222222222222222222222222222222222';

const flagsFor = (env: Record<string, string>) => payFlags(env as never);

describe('PAY_CHAIN', () => {
  it('без переменной — TRON, как было до переезда', () => {
    const env = { PAYMENTS_ENABLED: 'on' } as never;
    expect(activeChain(env)).toEqual({ chain: 'tron', unknown: false });
    expect(chainSpec(env, flagsFor({})).chain).toBe('tron');
  });

  it('значение `bsc` переключает сеть, регистр и пробелы не важны', () => {
    const env = { PAY_CHAIN: '  BSC ' } as never;
    expect(activeChain(env).chain).toBe('bsc');
  });

  it('опечатка в имени сети: контур встаёт, а не «берём первую попавшуюся»', () => {
    const env = { PAYMENTS_ENABLED: 'on', DEPOSITS_ENABLED: 'on', PAY_CHAIN: 'bsccc' } as never;
    const flags = payFlags(env);
    expect(flags.chainConfigError).toBe(true);
    // Витрина обязана сказать причину словами, а не показать чужой адрес.
    expect(walletState(env as never, flags)).toBe('chain_misconfigured');
  });
});

describe('TRON-контур (ничего не поехало)', () => {
  it('контракты, шкала и адрес — как до появления BSC', () => {
    const mainnet = chainSpec({ PAY_NETWORK: 'mainnet' } as never, flagsFor({ PAY_NETWORK: 'mainnet' }));
    expect(mainnet).toMatchObject({ chain: 'tron', decimals: 6, contract: USDT_MAINNET, confirmations: 20 });
    expect(mainnet.apiBase).toBe('https://api.trongrid.io');
    expect(mainnet.label).toBe('TRON (TRC-20)');
    expect(mainnet.isAddress(TRON_ADDR)).toBe(true);
    expect(mainnet.isAddress(EVM_ADDR)).toBe(false);
    expect(mainnet.txUrl('a'.repeat(64))).toBe(`https://tronscan.org/#/transaction/${'a'.repeat(64)}`);

    const nile = chainSpec({ PAY_NETWORK: 'nile' } as never, flagsFor({ PAY_NETWORK: 'nile' }));
    expect(nile.contract).toBe(USDT_NILE);
    expect(nile.apiBase).toBe('https://nile.trongrid.io');
  });

  it('адрес приводится к канону сети, а hex — то, что лежит в базе', () => {
    const spec = chainSpec({} as never, flagsFor({}));
    expect(spec.normalizeAddress(TRON_ADDR)).toBe(TRON_ADDR);
    expect(spec.addressHex(TRON_ADDR)).toMatch(/^41[0-9a-f]{40}$/);
  });
});

describe('BSC-контур', () => {
  const env = { PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet', PAYMENTS_ENABLED: 'on' } as never;
  const spec = chainSpec(env, flagsFor({ PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet' }));

  it('18 знаков и адрес контракта Binance-Peg', () => {
    expect(spec).toMatchObject({
      chain: 'bsc',
      decimals: 18,
      contract: BSC_MAINNET.usdt.toLowerCase(),
      apiBase: BSC_MAINNET.rpc,
      confirmations: 15,
    });
    expect(spec.label).toBe('BNB Smart Chain (BEP-20)');
  });

  it('адреса принимаются в любом регистре, а в базу ложатся в нижнем', () => {
    expect(spec.isAddress(EVM_ADDR)).toBe(true);
    // Настоящий чексум-адрес BSC-USD: именно его игрок видит в кошельке.
    expect(spec.isAddress(BSC_MAINNET.usdt)).toBe(true);
    // Смешанный регистр без правильного чексума — самая частая опечатка при
    // копировании, и она обязана отваливаться, а не «просто не совпало».
    expect(spec.isAddress('0x' + '2a'.repeat(19) + '2B')).toBe(false);
    expect(spec.isAddress('0x123')).toBe(false);
    expect(spec.isAddress('Txxxx')).toBe(false);
    expect(spec.normalizeAddress('0x2222222222222222222222222222222222222222')).toBe(EVM_ADDR);
    expect(spec.addressHex('0x' + '2A'.repeat(20))).toBe('2a'.repeat(20));
  });

  it('ссылка ведёт в bscscan, а не в tronscan', () => {
    expect(spec.txUrl('ab'.repeat(32))).toBe(`${BSC_MAINNET.explorer}/tx/${'ab'.repeat(32)}`);
  });

  it('тестнет без контракта — приём выключен, а не «угадали чужой токен»', () => {
    const testnet = chainSpec({ PAY_CHAIN: 'bsc' } as never, flagsFor({ PAY_CHAIN: 'bsc' }));
    expect(testnet.contract).toBe('');
    expect(testnet.ready.reason).toBe('bsc_contract_missing');
  });

  it('рельс дописан: адреса, приём и выплаты включены вместе', () => {
    // Смысл этого флага в том, что `true` появляется только вместе с кодом. Если
    // кто-то отключит модуль — тест должен упасть, а не «тихо выключить деньги».
    expect(spec.ready).toMatchObject({ addresses: true, deposits: true, payouts: true });
    expect(spec.ready.reason).toBe('');
  });

  it('без контракта приём и выплаты стоят, даже если адреса выдавать можно', () => {
    const testnet = chainSpec({ PAY_CHAIN: 'bsc' } as never, flagsFor({ PAY_CHAIN: 'bsc' }));
    expect(testnet.ready).toMatchObject({ addresses: true, deposits: false, payouts: false });
    expect(testnet.ready.reason).toBe('bsc_contract_missing');
  });

  it('адрес игроку не выдаётся, если контракт не задан: 503 вместо «0x… посмотрите позже»', async () => {
    const env = { PAYMENTS_ENABLED: 'on', DEPOSITS_ENABLED: 'on', PAY_CHAIN: 'bsc', PAY_NETWORK: 'testnet' } as never;
    // База тут не нужна: маршрут обязан отказать до первого запроса к D1.
    await expect(payAddress(env, { userId: 'u1' } as never)).rejects.toMatchObject({
      status: 503, code: 'usdt_contract_missing',
    });
  });

  it('статус честно показывает и сеть, и готовность рельса', async () => {
    const res = await payStatus({ PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet' } as never);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ chain: 'bsc', decimals: 18, networkLabel: 'BNB Smart Chain (BEP-20)' });
    expect(body.rail).toMatchObject({ addresses: true, deposits: true, payouts: true });
    expect(body.contract).toBe(BSC_MAINNET.usdt.toLowerCase());
  });

  it('RPC можно перебить своим эндпоинтом: публичный узел не надежен', () => {
    const custom = chainSpec(
      { PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet', PAY_EVM_RPC: 'https://my.node/rpc' } as never,
      flagsFor({ PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet' }),
    );
    expect(custom.apiBase).toBe('https://my.node/rpc');
  });
});
