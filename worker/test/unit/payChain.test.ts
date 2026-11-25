// Выбор сети собран в одном месте: `pay/chain.ts`.
//
// Проверяем не «функция вернула объект», а то, из-за чего на самом деле теряют
// деньги при переезде: разные decimals, чужой контракт, адрес не той формы и
// обещание игроку там, где код ещё ничего не умеет.
import { describe, expect, it } from 'vitest';
import { payAddress, payStatus } from '../../src/routes/pay';
import { handleAddress } from '../../../signer/src/index';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { activeChain, chainSpec } from '../../src/pay/chain';
import { depositTxidFromRef } from '../../src/pay/ledger';
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

  it('ссылки в эксплорер строятся сетью, а не догадкой клиента', () => {
    const mainnet = chainSpec({ PAY_NETWORK: 'mainnet' } as never, flagsFor({ PAY_NETWORK: 'mainnet' }));
    expect(mainnet.addressUrl(TRON_ADDR)).toBe(`https://tronscan.org/#/address/${TRON_ADDR}`);
    expect(mainnet.explorerName).toBe('Tronscan');
    const nile = chainSpec({ PAY_NETWORK: 'nile' } as never, flagsFor({ PAY_NETWORK: 'nile' }));
    expect(nile.addressUrl(TRON_ADDR)).toContain('nile.tronscan.org');
    expect(nile.explorerName).toContain('Nile');
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
  it('адрес игрока ведёт на страницу адреса, а не на транзакцию', () => {
    const spec = chainSpec({ PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet' } as never,
      flagsFor({ PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet' }));
    expect(spec.addressUrl(EVM_ADDR)).toBe(`https://bscscan.com/address/${EVM_ADDR}`);
    expect(spec.explorerName).toBe('BscScan');
  });
});

describe('ссылка на перевод в истории', () => {
  it('txid достаётся из ключа идемпотентности депозита', () => {
    const txid = 'ab'.repeat(32);
    expect(depositTxidFromRef(`dep:${txid}:3`)).toBe(txid);
  });

  it('всё остальное остаётся без ссылки: выдумывать адрес транзакции нельзя', () => {
    expect(depositTxidFromRef('purchase:uuid-1')).toBe('');
    expect(depositTxidFromRef('dep:не-шестнадцатеричное:0')).toBe('');
    expect(depositTxidFromRef('dep:' + 'ab'.repeat(31))).toBe('');
    expect(depositTxidFromRef('')).toBe('');
    expect(depositTxidFromRef(null)).toBe('');
  });
});

// Этап 1 переезда: адрес хранится вместе с сетью (`pay_addresses.chain`).
//
// До этой правки «один адрес на игрока» означало «один адрес вообще», и смена
// `PAY_CHAIN` превращалась в тупик: старый адрес в базе, новой цепи у игрока не
// будет, приём стоит. Здесь проверяется ровно то, что этот тупик разобран:
// вторая сеть = второй адрес, а первая строка остаётся на месте.
describe('выдача адреса после смены сети', () => {
  const SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  const SIGNER_TOKEN = 'signer-test-token-0123456789abcdef';
  const T0 = 1_700_000_000_000;

  /** Signer как service binding: тот же обработчик, та же семенная фраза. */
  function signerStub() {
    return {
      fetch: async (_url: string, init: { body?: BodyInit | null }) => handleAddress(
        new Request('https://signer/address', {
          method: 'POST',
          headers: { authorization: `Bearer ${SIGNER_TOKEN}`, 'content-type': 'application/json' },
          body: init.body,
        }),
        { SIGNER_TOKEN, SIGNER_SEED: SEED } as never,
      ),
    };
  }

  /** Игрок, который жил в TRON: одна строка `pay_addresses` с сетью `tron`. */
  async function dbWithTronAddress() {
    resetPaySchemaForTests();
    const { db } = makeD1();
    await ensurePaySchema(db);
    await db.prepare(
      `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, created_at)
       VALUES ('a0', 'u1', 'tron', ?, ?, 0, ?)`,
    ).bind(TRON_ADDR, `41${'11'.repeat(20)}`, T0).run();
    return db;
  }

  const bscEnv = (db: D1Database) => ({
    DB: db,
    PAYMENTS_ENABLED: 'on', DEPOSITS_ENABLED: 'on',
    PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet',
    SIGNER: signerStub(), SIGNER_TOKEN,
  }) as never;

  it('вторая сеть даёт игроку второй адрес — и это не 409', async () => {
    const db = await dbWithTronAddress();
    const res = await payAddress(bscEnv(db), { userId: 'u1' } as never);
    // 201, а не 200: маршрут отвечает «создан», когда строка появилась только
    // что. После переезда именно так и будет у каждого игрока — второй адрес.
    expect(res.status).toBe(201);
    const body = await res.json() as { address: string; chain: string; created: boolean };
    expect(body.chain).toBe('bsc');
    expect(body.created).toBe(true);
    // Наружу — EIP-55: кошелёк игрока сверяет контрольную сумму, а не угадывает.
    expect(/^0x[0-9a-fA-F]{40}$/.test(body.address)).toBe(true);

    // Эталон — ответ того же Signer-контура по следующему индексу. Индекс
    // глобальный: #0 занят TRON-адресом, значит BSC-адрес — #1, а не «тот же
    // номер в другой сети» (иначе два игрока получили бы одну цепочку).
    const reference = await handleAddress(
      new Request('https://signer/address', {
        method: 'POST',
        headers: { authorization: `Bearer ${SIGNER_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ index: 1, chain: 'bsc' }),
      }),
      { SIGNER_TOKEN, SIGNER_SEED: SEED } as never,
    );
    expect(body.address.toLowerCase()).toBe(((await reference.json()) as { address: string }).address.toLowerCase());
  });

  it('старый адрес остаётся в базе: деньги на нём не сироты', async () => {
    const db = await dbWithTronAddress();
    await payAddress(bscEnv(db), { userId: 'u1' } as never);
    const rows = await db.prepare(
      'SELECT chain, address FROM pay_addresses WHERE user_id = ? ORDER BY chain',
    ).bind('u1').all<{ chain: string; address: string }>();
    expect((rows.results ?? []).map((r) => r.chain)).toEqual(['bsc', 'tron']);
    expect(rows.results?.[1].address).toBe(TRON_ADDR);
  });

  it('повторный запрос в ту же сеть идемпотентен и не занимает новый индекс', async () => {
    const db = await dbWithTronAddress();
    const first = await payAddress(bscEnv(db), { userId: 'u1' } as never);
    const again = await payAddress(bscEnv(db), { userId: 'u1' } as never);
    const a = await first.json() as { address: string; created: boolean };
    const b = await again.json() as { address: string; created: boolean };
    // Тот же адрес, и `created` больше не «true»: второй запрос ничего не создал.
    expect(b.address).toBe(a.address);
    expect([a.created, b.created]).toEqual([true, false]);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM pay_addresses').first<number>('n');
    expect(Number(count)).toBe(2);
  });

  it('TRON остаётся рабочей сетью, пока `PAY_CHAIN` не переключён', async () => {
    // Тот же игрок, та же база, конфиг как в проде сегодня: второй адрес ему не
    // выдаётся — маршрут отдаёт существующий. Переезд делает ровно одно: меняет
    // сеть, и весь остальной код к нему готов.
    const db = await dbWithTronAddress();
    const res = await payAddress(
      { DB: db, PAYMENTS_ENABLED: 'on', DEPOSITS_ENABLED: 'on', SIGNER: signerStub(), SIGNER_TOKEN } as never,
      { userId: 'u1' } as never,
    );
    const body = await res.json() as { address: string; chain: string; created: boolean };
    expect(body).toMatchObject({ address: TRON_ADDR, chain: 'tron', created: false });
  });

  it('кривая метка в базе — отказ, а не «покажем что нашли»', async () => {
    // Строка заявлена как BSC, а по факту в ней TRON-адрес (ручная правка).
    // Начисления по такому адресу не будет, поэтому молча показать его нельзя.
    const db = await dbWithTronAddress();
    await db.prepare("UPDATE pay_addresses SET chain = 'bsc' WHERE user_id = 'u1'").run();
    await expect(payAddress(bscEnv(db), { userId: 'u1' } as never))
      .rejects.toMatchObject({ status: 409, code: 'address_chain_mismatch' });
  });
});
