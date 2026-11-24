// EVM RPC-клиент и разбор логов `Transfer`.
//
// Тесты идут через подменённый `fetch`: сеть в юнит-тестах недоступна, а ловить
// надо именно наше поведение на плохих ответах — 429, обрезанный JSON, `null`
// вместо квитанции, «нода вернула не массив». Именно на этом обычно и теряют
// деньги: код решает «нет данных = 0» и зачисляет ноль либо пропускает платёж.
import { describe, expect, it } from 'vitest';
import {
  EvmRpcError, MAX_BLOCKS_PER_LOG_QUERY, TRANSFER_TOPIC0, addressToTopic, bigIntToHex, createEvmRpc,
  hexToBigInt, hexToNumber, stripTopic, transferFromLog,
} from '../../src/pay/evm/rpc';
import { BSC_MAINNET } from '../../src/pay/evm/config';

const USDT = BSC_MAINNET.usdt;

/** Одна строка `eth_getLogs` ровно так, как её отдаёт geth-совместимая нода. */
function log(over: Record<string, unknown> = {}) {
  return {
    address: USDT,
    topics: [
      TRANSFER_TOPIC0,
      addressToTopic('0x1111111111111111111111111111111111111111'),
      addressToTopic('0x2222222222222222222222222222222222222222'),
    ],
    data: `0x${(10n ** 18n).toString(16).padStart(64, '0')}`,
    blockNumber: '0x3039',
    transactionHash: `0x${'ab'.repeat(32)}`,
    logIndex: '0x0',
    removed: false,
    ...over,
  };
}

function rpc(handler: (body: any) => unknown, status = 200) {
  const calls: { url: string; body: any }[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), body });
    const payload = handler(body);
    return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, rpc: createEvmRpc({ url: 'https://rpc.test', fetchImpl }) };
}

const ok = (result: unknown) => ({ jsonrpc: '2.0', id: 1, result });

describe('примитивы', () => {
  it('hex ↔ bigint ↔ number', () => {
    expect(hexToBigInt('0x1')).toBe(1n);
    expect(hexToBigInt('0x0')).toBe(0n);
    expect(bigIntToHex(255n)).toBe('0xff');
    expect(hexToNumber('0x3039')).toBe(12345);
    expect(() => hexToNumber('0x' + 'f'.repeat(32))).toThrow(/number_too_big/);
    expect(() => hexToBigInt('12')).toThrow(/bad_hex/);
  });

  it('адрес → 32-байтная тема и обратно', () => {
    const topic = addressToTopic('0x2222222222222222222222222222222222222222');
    expect(topic).toHaveLength(66);
    expect(stripTopic(topic)).toBe('0x2222222222222222222222222222222222222222');
    expect(() => addressToTopic('Txxxx')).toThrow(/bad_address/);
    expect(() => stripTopic('0x12')).toThrow(/bad_topic/);
  });
});

describe('транспорт', () => {
  it('eth_blockNumber разбирается в число', async () => {
    const { rpc: client } = rpc(() => ok('0x12d687'));
    expect(await client.blockNumber()).toBe(1_234_567);
  });

  it('429 и 500 различаются: лимит — это не «сеть упала»', async () => {
    const limited = rpc(() => ok(null), 429);
    await expect(limited.rpc.blockNumber()).rejects.toThrow(/rpc_rate_limited/);
    const down = rpc(() => ok(null), 500);
    await expect(down.rpc.blockNumber()).rejects.toThrow(/http_500/);
  });

  it('ошибка ноды превращается в код, «range too large» — в rpc_limited', async () => {
    const a = rpc(() => ({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'limit exceeded' } }));
    await expect(a.rpc.blockNumber()).rejects.toThrow(/rpc_limited/);
    const b = rpc(() => ({ jsonrpc: '2.0', id: 1, error: { code: 3 } }));
    await expect(b.rpc.blockNumber()).rejects.toThrow(/rpc_3/);
    const c = rpc(() => ({ jsonrpc: '2.0', id: 1 }));
    await expect(c.rpc.blockNumber()).rejects.toThrow(/no_result/);
  });

  it('не-JSON и таймаут не превращаются в «ноль блоков»', async () => {
    const junk = rpc(() => '<html>502 bad gateway</html>');
    await expect(junk.rpc.blockNumber()).rejects.toThrow(/bad_json/);

    const timing = createEvmRpc({
      url: 'https://rpc.test',
      fetchImpl: (async () => {
        const err = new Error('aborted');
        err.name = 'TimeoutError';
        throw err;
      }) as unknown as typeof fetch,
    });
    await expect(timing.blockNumber()).rejects.toThrow(/rpc_timeout/);

    const unreachable = createEvmRpc({
      url: 'https://rpc.test',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(unreachable.blockNumber()).rejects.toThrow(/rpc_unreachable/);
  });

  it('http-RPC и пустой URL не проходят', () => {
    expect(() => createEvmRpc({ url: 'http://rpc.test' })).toThrow(EvmRpcError);
    expect(() => createEvmRpc({ url: '' })).toThrow(/bad_rpc_url/);
  });

  it('время блока возвращается в миллисекундах', async () => {
    const seconds = rpc(() => ok({ timestamp: '0x6714' }));
    expect(await seconds.rpc.blockTimestamp(12345)).toBe(26388000);
    const missing = rpc(() => ok(null));
    expect(await missing.rpc.blockTimestamp(1)).toBeNull();
  });
});

describe('eth_getLogs', () => {
  it('дальний диапазон режется по блокам, а не улетает в «range too large»', async () => {
    const span = MAX_BLOCKS_PER_LOG_QUERY * 2 + 5;
    const { calls, rpc: client } = rpc((body) => {
      const [filter] = body.params;
      return ok([{ ...log(), blockNumber: filter.fromBlock }]);
    });
    const rows = await client.logs({
      fromBlock: 0, toBlock: span, address: USDT, topics: [TRANSFER_TOPIC0],
    });
    expect(calls).toHaveLength(3);
    expect(rows).toHaveLength(3);
    expect(rows[2].blockNumber).toBe(MAX_BLOCKS_PER_LOG_QUERY * 2);
  });

  it('обратный диапазон — пусто, без запроса к ноде', async () => {
    const { calls, rpc: client } = rpc(() => ok([]));
    expect(await client.logs({ fromBlock: 10, toBlock: 5, address: USDT, topics: [] })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('массив в теме = OR по получателям: один запрос на пачку адресов', async () => {
    const { calls, rpc: client } = rpc(() => ok([]));
    await client.logs({
      fromBlock: 1, toBlock: 2, address: USDT,
      topics: [TRANSFER_TOPIC0, null, ['0x0000000000000000000000000000000000000001']],
    });
    expect(calls[0].body.params[0].topics[2]).toHaveLength(1);
  });

  it('лог без txid или с мусорным адресом — ошибка, а не пропущенная строка', async () => {
    const { rpc: client } = rpc(() => ok([{ ...log(), transactionHash: '0x00' }]));
    await expect(client.logs({ fromBlock: 1, toBlock: 1, address: USDT, topics: [] }))
      .rejects.toThrow(/bad_log_txid/);
  });

  it('ответ не-массивом — bad_logs_shape', async () => {
    const { rpc: client } = rpc(() => ok({ nope: true }));
    await expect(client.logs({ fromBlock: 1, toBlock: 1, address: USDT, topics: [] }))
      .rejects.toThrow(/bad_logs_shape/);
  });
});

describe('batch', () => {
  it('порядок ответов берётся по id, а не по позиции в массиве', async () => {
    const { rpc: client } = rpc((body) => [
      { jsonrpc: '2.0', id: 2, result: '0x2' },
      { jsonrpc: '2.0', id: 1, result: '0x1' },
    ]);
    expect(await client.batch([{ method: 'a' }, { method: 'b' }])).toEqual(['0x1', '0x2']);
  });

  it('нода без batch — явная ошибка, а не тихий фолбэк', async () => {
    const { rpc: client } = rpc(() => ok(null));
    await expect(client.batch([{ method: 'a' }])).rejects.toThrow(/batch_unsupported/);
  });

  it('размер пачки ограничен', async () => {
    const { rpc: client } = rpc(() => []);
    await expect(client.batch(new Array(9).fill({ method: 'a' }))).rejects.toThrow(/batch_too_big/);
    expect(await client.batch([])).toEqual([]);
  });
});

describe('исходящие вызовы', () => {
  it('nonce и баланс требуют адрес, иначе ошибка конфигурации', async () => {
    const { rpc: client } = rpc(() => ok('0x1'));
    expect(await client.transactionCount('0x1111111111111111111111111111111111111111')).toBe(1);
    await expect(client.transactionCount('Txxxx')).rejects.toThrow(/bad_address/);
    await expect(client.call('0xnope', '0x')).rejects.toThrow(/bad_address/);
    await expect(client.call('0x' + '11'.repeat(20), 'not hex')).rejects.toThrow(/bad_calldata/);
  });

  it('gasPrice — BigInt: на wei `number` не помещается', async () => {
    const { rpc: client } = rpc(() => ok('0x3b9aca00'));
    expect(await client.gasPrice()).toBe(1_000_000_000n);
  });

  it('feeHistory считает maxFee как 2×base + приоритет', async () => {
    const { rpc: client } = rpc(() => ok({ baseFeePerGas: ['0x1', '0x2'], reward: [['0x1'], ['0x3']] }));
    const fees = await client.feeHistory();
    expect(fees).toEqual({ maxPriorityFeePerGas: 3n, maxFeePerGas: 7n });
  });

  it('feeHistory без данных — null: вызывающий сам решает, брать ли gasPrice', async () => {
    const { rpc: client } = rpc(() => ok(null));
    expect(await client.feeHistory()).toBeNull();
  });

  it('сырая транзакция проверяется до отправки, хеш возвращается без 0x', async () => {
    const { rpc: client } = rpc(() => ok('0x' + 'ab'.repeat(32)));
    await expect(client.sendRawTransaction('0xzz')).rejects.toThrow(/bad_raw_tx/);
    await expect(client.sendRawTransaction('')).rejects.toThrow(/bad_raw_tx/);
    expect(await client.sendRawTransaction('0x02')).toBe('ab'.repeat(32));
  });

  it('квитанции нет = null, реверт = status:false', async () => {
    const pending = rpc(() => ok(null));
    expect(await pending.rpc.transactionReceipt('ab'.repeat(32))).toBeNull();

    const reverted = rpc(() => ok({ status: '0x0', gasUsed: '0x5208', logs: [], blockNumber: '0x1' }));
    const rec = await reverted.rpc.transactionReceipt('ab'.repeat(32));
    expect(rec?.status).toBe(false);
    expect(rec?.gasUsed).toBe(21000);
    expect(rec?.transactionHash).toBe('ab'.repeat(32));

    const badHash = rpc(() => ok(null));
    await expect(badHash.rpc.transactionReceipt('нет-такого')).rejects.toThrow(/bad_tx_hash/);
  });
});

describe('перевод USDT из лога', () => {
  const opts = { contract: USDT, chain: 'bsc' as const };

  it('1 USDT на BSC = 1 000 000 micro — тот самый пересчёт 18 → 6', () => {
    const t = transferFromLog(log(), opts);
    expect(t.amountMicro).toBe(1_000_000);
    expect(t.exact).toBe(true);
    expect(t.dustRaw).toBe(0n);
    expect(t.to).toBe('0x2222222222222222222222222222222222222222');
    expect(t.contract).toBe(USDT.toLowerCase());
    expect(t.blockTime).toBeNull();
    expect(t.blockHeight).toBe(12345);
    expect(t.eventIndex).toBe(0);
    expect(t.txid).toBe('ab'.repeat(32));
  });

  it('15 USDT — ровно 15 000 000 micro, как в каталоге', () => {
    const t = transferFromLog(log({ data: `0x${(15n * 10n ** 18n).toString(16).padStart(64, '0')}` }), opts);
    expect(t.amountMicro).toBe(15_000_000);
  });

  it('хвост меньше micro не зачисляется и помечается', () => {
    const t = transferFromLog(log({ data: `0x${(10n ** 18n + 5n * 10n ** 11n).toString(16).padStart(64, '0')}` }), opts);
    expect(t.amountMicro).toBe(1_000_000);
    expect(t.exact).toBe(false);
    expect(t.dustRaw).toBe(500_000_000_000n);
  });

  it('чужой контракт — не деньги', () => {
    expect(() => transferFromLog(log({ address: '0x' + '99'.repeat(20) }), opts))
      .toThrow(/wrong_contract/);
  });

  it('не-Transfer и усечённый data отвергаются', () => {
    const wrongTopic0 = { ...log(), topics: [`0x${'00'.repeat(32)}`, ...log().topics.slice(1)] };
    expect(() => transferFromLog(wrongTopic0, opts)).toThrow(/not_transfer/);
    expect(() => transferFromLog(log({ data: '0x1234' }), opts)).toThrow(/bad_word/);
    expect(() => transferFromLog(log({ data: `0x${'00'.repeat(32)}` }), opts)).toThrow(/zero_amount/);
    expect(() => transferFromLog(log({ topics: [] }), opts)).toThrow(/bad_topics/);
  });

  it('откатанный лог не считается: блок мог исчезнуть', () => {
    expect(() => transferFromLog(log({ removed: true }), opts)).toThrow(/log_removed/);
    expect(() => transferFromLog(log({ removed: '0x1' }), opts)).toThrow(/log_removed/);
  });

  it('фильтр получателей ловит «не наш адрес»', () => {
    const withFilter = { ...opts, recipients: ['0x' + '33'.repeat(20)] };
    expect(() => transferFromLog(log(), withFilter)).toThrow(/not_our_address/);
    const mine = log({ topics: [TRANSFER_TOPIC0, addressToTopic('0x' + '11'.repeat(20)), addressToTopic('0x' + '33'.repeat(20))] });
    expect(transferFromLog(mine, withFilter).to).toBe('0x' + '33'.repeat(20));
  });

  it('меньше одного micro — это пыль, а не депозит', () => {
    expect(() => transferFromLog(log({ data: `0x${(10n ** 12n - 1n).toString(16).padStart(64, '0')}` }), opts))
      .toThrow(/dust_only/);
  });

  it('TRON-число на BSC-шкале не принимается за 1 USDT', () => {
    // 6-значное `1000000` на 18-значной сети = одна миллионная доля USDT.
    const tronShape = `0x${(1_000_000n).toString(16).padStart(64, '0')}`;
    expect(() => transferFromLog(log({ data: tronShape }), opts)).toThrow(/dust_only/);
    // А на TRON-шкале то же число — это и есть 1 USDT: шкалы не путаем.
    expect(transferFromLog(log({ data: tronShape }), { ...opts, chain: 'tron' }).amountMicro).toBe(1_000_000);
  });
});
