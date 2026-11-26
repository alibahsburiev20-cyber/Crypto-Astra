// Polygon как вторая EVM-рельса.
//
// Проверяем ровно то, из-за чего «вторая сеть» обычно и ломается: не «spec
// существует», а что шкала, контракт, курсор, очередь выплат и подпись
// смотрят в ОДНУ и ту же сеть. Всё перечисленное ниже — про расхождения,
// которые не дают ошибки, а дают тихо потерянные деньги.
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { chainSpec, enabledChains, evmChainSpecs } from '../../src/pay/chain';
import { payFlags } from '../../src/pay/flags';
import { payNetworks } from '../../src/routes/pay';
import {
  BSC_MAINNET, POLYGON_MAINNET, evmActiveKeys, evmActiveKeysError, evmKeyByChainId,
} from '../../src/pay/evm/config';
import { addressToTopic, TRANSFER_TOPIC0 } from '../../src/pay/evm/rpc';
import { applyEvmDeposits, bscActiveAddresses, readCursor, scanEvmBlocks } from '../../src/pay/evm/deposits';
import { PayoutError, minWithdrawMicro, requestWithdrawal } from '../../src/pay/payouts';
import { normalizeWithdrawAddress } from '../../src/pay/payouts';
import { payBalanceMicro } from '../../src/pay/ledger';
import { microToChainValue } from '../../src/pay/units';

const flagsFor = (env: Record<string, string>) => payFlags(env as never);
const POL_USDT = POLYGON_MAINNET.usdt.toLowerCase();
const PLAYER = '0x' + '11'.repeat(20);
const STRANGER = '0x' + '99'.repeat(20);
const TX = (n: string) => n.repeat(64).slice(0, 64);
const T0 = 1_700_000_000_000;

describe('спецификация Polygon', () => {
  const env = { PAY_CHAIN: 'polygon', PAY_NETWORK: 'mainnet', PAYMENTS_ENABLED: 'on' } as never;
  const spec = chainSpec(env, flagsFor({ PAY_CHAIN: 'polygon', PAY_NETWORK: 'mainnet' }));

  it('6 знаков, USDT0, 64 подтверждения — и всё это не от BNB', () => {
    expect(spec).toMatchObject({
      chain: 'polygon',
      decimals: 6,
      contract: POL_USDT,
      confirmations: 64,
      chainId: 137,
    });
    expect(spec.label).toBe('Polygon PoS (USDT0)');
    expect(spec.explorerName).toBe('PolygonScan');
    // Отличия от BNB перечислены явно: если кто-то «обобщит» спеку одной
    // константой, упадёт именно этот тест.
    expect(spec.decimals).not.toBe(18);
    expect(spec.contract).not.toBe(BSC_MAINNET.usdt.toLowerCase());
    expect(spec.apiBase).toBe('https://polygon-rpc.com');
    expect(spec.txUrl('ab'.repeat(32))).toBe(`https://polygonscan.com/tx/${'ab'.repeat(32)}`);
  });

  it('контракт USDT и RPC перебиваются ПО СЕТИ, а не одной общей переменной', () => {
    const custom = chainSpec(
      {
        PAY_CHAIN: 'polygon', PAY_NETWORK: 'mainnet',
        PAY_EVM_CONTRACT_POL: '0x' + 'ab'.repeat(20),
        PAY_EVM_RPC_POL: 'https://polygon.my/rpc',
        // Общая переменная относится к BNB: подменить ей Polygon нельзя.
        PAY_EVM_CONTRACT: BSC_MAINNET.usdt,
      } as never,
      flagsFor({ PAY_CHAIN: 'polygon', PAY_NETWORK: 'mainnet' }),
    );
    expect(custom.contract).toBe(`0x${'ab'.repeat(20)}`);
    expect(custom.apiBase).toBe('https://polygon.my/rpc');
  });

  it('тестнет Amoy: без своего контракта приём выключен', () => {
    const testnet = chainSpec({ PAY_CHAIN: 'polygon' } as never, flagsFor({ PAY_CHAIN: 'polygon' }));
    expect(testnet.contract).toBe('');
    expect(testnet.chainId).toBe(80002);
    expect(testnet.confirmations).toBe(12);
    expect(testnet.ready.reason).toBe('polygon_contract_missing');
  });
});

describe('две EVM-сети в одном воркере', () => {
  it('по умолчанию включена только BNB: Polygon обязана быть названа явно', () => {
    expect(evmActiveKeys({})).toEqual(['bnb']);
    const specs = evmChainSpecs({ PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet' } as never, flagsFor({ PAY_NETWORK: 'mainnet' }));
    expect(specs.map((s) => s.chain)).toEqual(['bsc']);
  });

  it('`PAY_EVM_CHAINS=bnb,polygon` даёт два разных скана', () => {
    const env = { PAY_CHAIN: 'bsc', PAY_NETWORK: 'mainnet', PAY_EVM_CHAINS: ' bnb , polygon ' } as never;
    const specs = evmChainSpecs(env, flagsFor({ PAY_NETWORK: 'mainnet', PAY_EVM_CHAINS: 'bnb,polygon' }));
    expect(specs.map((s) => s.chain)).toEqual(['bsc', 'polygon']);
    expect(specs.map((s) => s.chainId)).toEqual([56, 137]);
    expect(specs.map((s) => s.decimals)).toEqual([18, 6]);
    expect(specs.map((s) => s.contract)).toEqual([BSC_MAINNET.usdt.toLowerCase(), POL_USDT]);
  });

  it('опечатка в имени сети останавливает деньги, а не «сканируем что умеем»', () => {
    const env = { PAY_EVM_CHAINS: 'bnb,polygn' };
    expect(evmActiveKeysError(env)).toBe('unknown_network:polygn');
    // Ни одной спеки: половина списков — это ровно тот случай, когда polygon-
    // депозиты игрока никто не смотрит, а ошибки нет.
    expect(evmChainSpecs({ PAY_EVM_CHAINS: 'bnb,polygn', PAYMENTS_ENABLED: 'on' } as never)).toEqual([]);
    const flags = payFlags({ PAYMENTS_ENABLED: 'on', DEPOSITS_ENABLED: 'on', PAY_EVM_CHAINS: 'bnb,polygn' } as never);
    expect(flags.chainConfigError).toBe(true);
    expect(flags.chainConfigDetail).toMatch(/polygn/);
    // Витрина в таком состоянии не предлагает сети вообще.
    expect(payNetworks({ PAY_EVM_CHAINS: 'bnb,polygn', PAYMENTS_ENABLED: 'on' } as never)).toEqual([]);
  });

  it('`enabledChains` перечисляет активную цепь первой и только настроенные', () => {
    const ok = enabledChains({ PAY_CHAIN: 'polygon', PAY_EVM_CHAINS: 'polygon,bsc' } as never);
    expect(ok.error).toBe('');
    expect(ok.chains).toEqual(['polygon', 'bsc']);
    // `tron` вне EVM-списка: он активен, только если назван в `PAY_CHAIN`.
    expect(enabledChains({ PAY_CHAIN: 'bsc', PAY_EVM_CHAINS: 'bsc' } as never).chains).toEqual(['bsc']);
  });

  it('число сети узнаётся только из списка известных', () => {
    expect(evmKeyByChainId(137)).toBe('polygon');
    expect(evmKeyByChainId(80002)).toBe('polygon');
    expect(evmKeyByChainId(56)).toBe('bnb');
    expect(evmKeyByChainId(1)).toBeNull();
  });
});

describe('сканер Polygon: чужие адреса и чужой курсор', () => {
  /** База с polygon-адресом игрока: `bsc`-адресов в ней нет намеренно. */
  async function dbWithPolygon() {
    resetPaySchemaForTests();
    const { db } = makeD1();
    await ensurePaySchema(db);
    await db.prepare(
      `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, created_at)
       VALUES ('ad_pol', 'u1', 'polygon', ?, ?, 1, ?)`,
    ).bind(PLAYER, PLAYER.slice(2), T0).run();
    return db;
  }

  function fakeChain(head: number, logs: Record<string, unknown>[]) {
    return {
      blockNumber: async () => head,
      logs: async () => logs as never,
    };
  }

  function transferLog(contract: string, amountRaw: bigint) {
    return {
      address: contract,
      topics: [TRANSFER_TOPIC0, addressToTopic(STRANGER), addressToTopic(PLAYER)],
      data: `0x${amountRaw.toString(16).padStart(64, '0')}`,
      blockNumber: '0x65',
      transactionHash: `0x${TX('a')}`,
      logIndex: '0x0',
      removed: false,
    };
  }

  it('выборка адресов идёт по колонке `chain`', async () => {
    const db = await dbWithPolygon();
    expect(await bscActiveAddresses(db, undefined, 'polygon')).toEqual([PLAYER]);
    // Тот же запрос для BNB не должен «подобрать» адрес соседней сети.
    expect(await bscActiveAddresses(db, undefined, 'bsc')).toEqual([]);
  });

  it('зачисление ищет владельца ТОЙ цепи, чей контракт сканировали', async () => {
    const db = await dbWithPolygon();
    // 1 USDT в 6-значной шкале Polygon.
    const log = transferLog(POL_USDT, microToChainValue(1_000_000, 'polygon'));
    const report = await scanEvmBlocks(db, {
      rpc: fakeChain(200, [log]), contract: POL_USDT, chain: 'polygon', confirmations: 64, addresses: [PLAYER],
    }, T0);
    expect(report.stored).toBe(1);

    // Рельс BNB с тем же контрактом: адрес формально совпадает, но он не BNB —
    // зачислить его нельзя, и мы обязаны сказать «сирота», а не «игрок u1 богат».
    // Отдельная база: «сиротство» — состояние строки, его не «перепроверяют»
    // вторым проходом, иначе админ терял бы след того, кто и когда искал деньги.
    const wrong = await applyEvmDeposits(db, POL_USDT, T0 + 1, 100, 'bsc');
    expect(wrong).toMatchObject({ credited: 0, orphan: 1 });
    expect(await payBalanceMicro(db, 'u1')).toBe(0);

    const db2 = await dbWithPolygon();
    await scanEvmBlocks(db2, {
      rpc: fakeChain(200, [transferLog(POL_USDT, microToChainValue(1_000_000, 'polygon'))]),
      contract: POL_USDT, chain: 'polygon', confirmations: 64, addresses: [PLAYER],
    }, T0);
    const right = await applyEvmDeposits(db2, POL_USDT, T0 + 2, 100, 'polygon');
    expect(right).toMatchObject({ credited: 1, orphan: 0 });
    expect(await payBalanceMicro(db2, 'u1')).toBe(1_000_000);
  });

  it('курсоры сети непересекающи: высоты BNB и Polygon живут раздельно', async () => {
    const db = await dbWithPolygon();
    await scanEvmBlocks(db, {
      rpc: fakeChain(200, []), contract: POL_USDT, chain: 'polygon', confirmations: 64, addresses: [PLAYER],
    }, T0);
    await scanEvmBlocks(db, {
      rpc: fakeChain(900, []), contract: BSC_MAINNET.usdt.toLowerCase(), chain: 'bsc', confirmations: 15,
      addresses: [PLAYER],
    }, T0);
    expect(await readCursor(db, 'polygon', POL_USDT)).toBeGreaterThan(0);
    expect(await readCursor(db, 'bsc', BSC_MAINNET.usdt.toLowerCase())).toBeGreaterThan(0);
    // Разные сети — разные строки; «один курсор на воркер» означал бы, что
    // вторая сеть никогда не догонит свою голову.
    const rows = await db.prepare('SELECT chain, height FROM pay_chain_cursor').all<{ chain: string; height: number }>();
    const chains = (rows.results ?? []).map((r) => r.chain).sort();
    expect(chains).toEqual(['bsc', 'polygon']);
  });
});

describe('выплата в Polygon', () => {
  it('адрес проверяется как EVM, а не как TRON', () => {
    expect(normalizeWithdrawAddress('polygon', PLAYER)).toBe(PLAYER);
    expect(() => normalizeWithdrawAddress('polygon', 'T' + '1'.repeat(33))).toThrow(PayoutError);
    // Верхний регистр и чексум — те же правила, что в BNB: в базу ложится нижний.
    expect(normalizeWithdrawAddress('polygon', PLAYER.toUpperCase())).toBe(PLAYER);
  });

  it('минимум — 1 USDT, а не 5 как в TRON', () => {
    expect(minWithdrawMicro('polygon')).toBe(1_000_000);
    expect(minWithdrawMicro('bsc')).toBe(1_000_000);
    expect(minWithdrawMicro('tron')).toBe(5_000_000);
  });

  it('сеть пишется в строку заявки: платить потом надо по ней', async () => {
    resetPaySchemaForTests();
    const { db } = makeD1();
    await ensurePaySchema(db);
    await db.prepare(
      `INSERT INTO pay_ledger (id, user_id, asset, delta, reason, source_ref, idem_key, prev_hash, hash, created_at)
       VALUES ('l1', 'u1', 'USDT', 10000000, 'deposit', 's1', 'k1', '', 'h1', ?)`,
    ).bind(T0).run();

    const { withdrawal } = await requestWithdrawal(db, {
      userId: 'u1', chain: 'polygon', address: PLAYER, amountMicro: 2_000_000, idemKey: 'order-pol-1',
    }, T0);
    expect(withdrawal.status).toBe('requested');
    const row = await db.prepare('SELECT chain, address FROM pay_withdrawals WHERE id = ?')
      .bind(String(withdrawal.id)).first<{ chain: string; address: string }>();
    expect(row).toEqual({ chain: 'polygon', address: PLAYER });
  });
});

describe('витрина с выбором сети', () => {
  it('список сетей описывает и готовность каждой', () => {
    const env = {
      PAYMENTS_ENABLED: 'on', DEPOSITS_ENABLED: 'on', PAY_NETWORK: 'mainnet',
      PAY_CHAIN: 'bsc', PAY_EVM_CHAINS: 'bnb,polygon', PAY_EVM_CONTRACT_POL: '0x' + 'cd'.repeat(20),
    } as never;
    const list = payNetworks(env, flagsFor({
      PAYMENTS_ENABLED: 'on', DEPOSITS_ENABLED: 'on', PAY_NETWORK: 'mainnet', PAY_CHAIN: 'bsc',
    }));
    expect(list.map((n) => n.chain)).toEqual(['bsc', 'polygon']);
    expect(list[0]).toMatchObject({ label: 'BNB Smart Chain (BEP-20)', ready: true });
    expect(list[1]).toMatchObject({ decimals: 6, confirmations: 64, ready: true });
    expect(list[1].explorer).toMatchObject({ name: 'PolygonScan' });
  });

  it('сеть без контракта показана, но неактивна: адрес мы по ней не даём', () => {
    // Тестнет: там общего USDT нет, и контракт назван только для BNB. Именно так
    // выглядит раскатка Polygon до того, как поднят свой токен, — витрина обязана
    // показать сеть «не готова», а не выдавать адрес, по которому никто не смотрит.
    const env = {
      PAYMENTS_ENABLED: 'on', DEPOSITS_ENABLED: 'on', PAY_CHAIN: 'bsc', PAY_EVM_CHAINS: 'bnb,polygon',
      PAY_EVM_CONTRACT: '0x' + 'ee'.repeat(20),
    } as never;
    const list = payNetworks(env, flagsFor({ PAYMENTS_ENABLED: 'on', DEPOSITS_ENABLED: 'on', PAY_CHAIN: 'bsc' }));
    expect(list[0]).toMatchObject({ chain: 'bsc', ready: true });
    expect(list[1]).toMatchObject({ chain: 'polygon', ready: false, contract: '' });
    expect((list[1].rail as { deposits: boolean }).deposits).toBe(false);
  });
});

describe('адрес Polygon: формат и показ', () => {
  it('`0x…` проходит как EVM-адрес и для BNB, и для Polygon', async () => {
    const { addressChain, addressMatchesChain, displayAddress } = await import('../../src/pay/addresses');
    // Формат не различает эти две цепи — и не может: адрес выводится из одного
    // ключа. Поэтому `addressChain` отвечает «это EVM», а «какая именно сеть»
    // знает только колонка `pay_addresses.chain`.
    expect(addressChain(PLAYER)).toBe('bsc');
    expect(addressMatchesChain(PLAYER, 'bsc')).toBe(true);
    expect(addressMatchesChain(PLAYER, 'polygon')).toBe(true);
    expect(addressMatchesChain('T' + '1'.repeat(33), 'polygon')).toBe(false);
    expect(addressMatchesChain('мусор', 'polygon')).toBe(false);
  });

  it('игроку адрес показывается с контрольной суммой и в Polygon тоже', async () => {
    const { displayAddress } = await import('../../src/pay/addresses');
    // Адрес, у которого контрольная сумма меняет регистр букв: «11…1» остался бы
    // таким же и без чексума, и тест ничего не проверял бы.
    const lower = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
    const checksummed = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
    expect(displayAddress('polygon', lower)).toBe(checksummed);
    // Тот же адрес в BNB показан так же: чексум — свойство EVM, а не сети.
    expect(displayAddress('bsc', lower)).toBe(checksummed);
    // TRON — без изменений: Tampering с регистром там ломает адрес.
    const tron = 'T' + '1'.repeat(33);
    expect(displayAddress('tron', tron)).toBe(tron);
  });
});
