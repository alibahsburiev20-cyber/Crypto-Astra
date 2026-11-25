// BSC-монитор: от `eth_getLogs` до баланса игрока.
//
// Это главный тест переезда: он проверяет не «функция вернула объект», а что
// перевод на 18-значной сети превращается ровно в те же micro, что игрок и
// отправил, и что зачисление нельзя получить дважды.
import { describe, expect, it } from 'vitest';
import { makeD1 } from '../helpers/d1';
import { ensurePaySchema, resetPaySchemaForTests } from '../../src/pay/schema';
import { payBalanceMicro } from '../../src/pay/ledger';
import { addressToTopic, TRANSFER_TOPIC0 } from '../../src/pay/evm/rpc';
import { applyEvmDeposits, bscActiveAddresses, readCursor, scanEvmBlocks } from '../../src/pay/evm/deposits';

const USDT = '0x55d398326f99059ff775485246999027b3197955';
const PLAYER = '0x' + '11'.repeat(20);
const STRANGER = '0x' + '99'.repeat(20);
const TX = (n: string) => n.repeat(64).slice(0, 64);
const T0 = 1_700_000_000_000;

async function freshDb() {
  resetPaySchemaForTests();
  const { db } = makeD1();
  await ensurePaySchema(db);
  // `chain = 'bsc'`: с колонкой сети сканер выбирает адреса по метке, а не по
  // формату — адрес без метки этой цепи для него не существует.
  await db.prepare(
    `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, created_at)
     VALUES ('ad_1', 'u1', 'bsc', ?, ?, 1, ?)`,
  ).bind(PLAYER, PLAYER.slice(2), T0).run();
  return db;
}

/** Нода как её видит сканер: `blockNumber` + `logs`. Всё остальное не нужно. */
function fakeChain(opts: { head: number; logs?: Record<string, unknown>[]; failLogs?: boolean }) {
  const seen: { from: number; to: number }[] = [];
  return {
    seen,
    rpc: {
      blockNumber: async () => opts.head,
      logs: async (filter: { fromBlock: number; toBlock: number }) => {
        seen.push({ from: filter.fromBlock, to: filter.toBlock });
        if (opts.failLogs) throw new Error('нода легла');
        return (opts.logs ?? []) as never;
      },
    },
  };
}

function transferLog(over: Record<string, unknown> = {}) {
  return {
    address: USDT,
    topics: [TRANSFER_TOPIC0, addressToTopic(STRANGER), addressToTopic(PLAYER)],
    // 1 USDT в 18-значной шкале: ровно 1e18.
    data: `0x${(10n ** 18n).toString(16).padStart(64, '0')}`,
    blockNumber: '0x65',
    transactionHash: `0x${TX('a')}`,
    logIndex: '0x0',
    removed: false,
    ...over,
  };
}

describe('сканер BSC', () => {
  it('перевод в 1 USDT зачисляется как 1 000 000 micro', async () => {
    const db = await freshDb();
    const { rpc } = fakeChain({ head: 200, logs: [transferLog()] });
    const report = await scanEvmBlocks(db, {
      rpc, contract: USDT, chain: 'bsc', confirmations: 15, addresses: [PLAYER],
    }, T0);
    expect(report.stored).toBe(1);
    expect(report.error).toBeNull();

    const applied = await applyEvmDeposits(db, USDT, T0 + 1);
    expect(applied).toMatchObject({ credited: 1, duplicated: 0, orphan: 0 });
    expect(await payBalanceMicro(db, 'u1')).toBe(1_000_000);
  });

  it('повторный проход не двигает курсор назад и не удваивает баланс', async () => {
    const db = await freshDb();
    const chain = fakeChain({ head: 200, logs: [transferLog()] });
    await scanEvmBlocks(db, {
      rpc: chain.rpc, contract: USDT, chain: 'bsc', confirmations: 15, addresses: [PLAYER],
    }, T0);
    await applyEvmDeposits(db, USDT, T0 + 1);

    // Курсор откатили вручную (авария до записи курсора, повторная настройка
    // провайдера): то же окно ещё раз — событие уже в базе, зачисление
    // идемпотентно, деньги не удваиваются.
    await db.prepare("UPDATE pay_chain_cursor SET height = 0 WHERE chain = 'bsc'").bind().run();
    const second = await scanEvmBlocks(db, {
      rpc: chain.rpc, contract: USDT, chain: 'bsc', confirmations: 15, addresses: [PLAYER],
    }, T0 + 2);
    expect(second).toMatchObject({ stored: 0, duplicates: 1 });
    expect(await applyEvmDeposits(db, USDT, T0 + 3)).toMatchObject({ credited: 0 });
    expect(await payBalanceMicro(db, 'u1')).toBe(1_000_000);
  });

  it('неподтверждённые блоки не зачисляются: 15 подтверждений — закон', async () => {
    const db = await freshDb();
    const { rpc, seen } = fakeChain({ head: 100, logs: [transferLog()] });
    const report = await scanEvmBlocks(db, {
      rpc, contract: USDT, chain: 'bsc', confirmations: 15, addresses: [PLAYER],
    }, T0);
    // Голова 100, ждём 15 подтверждений ⇒ просим только до 85-го блока.
    expect(seen[0]).toEqual({ from: 1, to: 85 });
    // Лог в fakeChain лежит в 101-м блоке: нода о нём сообщила, хотя мы его не
    // просили. Такое бывает у провайдеров со своей политикой «finalized» — и
    // зачислять это нельзя, иначе откатанный блок станет балансом игрока.
    expect(report).toMatchObject({ fetched: 1, stored: 0, rejected: 1 });
    expect(await payBalanceMicro(db, 'u1')).toBe(0);
  });

  it('ошибка ноды курсор не двигает: следующий проход доберёт окно', async () => {
    const db = await freshDb();
    const { rpc } = fakeChain({ head: 500, failLogs: true });
    const report = await scanEvmBlocks(db, {
      rpc, contract: USDT, chain: 'bsc', confirmations: 3, addresses: [PLAYER],
    }, T0);
    expect(report.error).toMatch(/logs:/);
    expect(await readCursor(db, 'bsc', USDT)).toBe(0);

    const ok = fakeChain({ head: 500, logs: [transferLog({ blockNumber: '0x12c' })] });
    const second = await scanEvmBlocks(db, {
      rpc: ok.rpc, contract: USDT, chain: 'bsc', confirmations: 3, addresses: [PLAYER],
    }, T0 + 1);
    expect(second.fromBlock).toBe(1);
    expect(second.stored).toBe(1);
  });

  it('чужие переводы и мусор от ноды отбрасываются, а не падают', async () => {
    const db = await freshDb();
    const logs = [
      // Не наш контракт — деньги в другой монете.
      transferLog({ address: '0x' + '77'.repeat(20) }),
      // Наш контракт, но получатель не наш адрес.
      transferLog({
        topics: [TRANSFER_TOPIC0, addressToTopic(STRANGER), addressToTopic('0x' + '88'.repeat(20))],
        transactionHash: `0x${TX('b')}`,
      }),
      // Чужое событие вместо Transfer.
      transferLog({ topics: [`0x${'00'.repeat(32)}`, addressToTopic(STRANGER), addressToTopic(PLAYER)], transactionHash: `0x${TX('c')}` }),
      // Откатанный блок.
      transferLog({ removed: true, transactionHash: `0x${TX('d')}` }),
    ];
    const { rpc } = fakeChain({ head: 200, logs });
    const report = await scanEvmBlocks(db, {
      rpc, contract: USDT, chain: 'bsc', confirmations: 15, addresses: [PLAYER],
    }, T0);
    expect(report.fetched).toBe(logs.length);
    expect(report.rejected).toBe(logs.length);
    expect(report.stored).toBe(0);
  });

  it('хвост меньше micro не зачисляется: это пыль, а не депозит', async () => {
    const db = await freshDb();
    const { rpc } = fakeChain({
      head: 200,
      logs: [transferLog({ data: `0x${(999_999n).toString(16).padStart(64, '0')}` })],
    });
    const report = await scanEvmBlocks(db, {
      rpc, contract: USDT, chain: 'bsc', confirmations: 15, addresses: [PLAYER],
    }, T0);
    expect(report.rejected).toBe(1);
    expect(report.stored).toBe(0);
    expect(await payBalanceMicro(db, 'u1')).toBe(0);
  });

  it('перевод на адрес без владельца помечается сиротой и попадает в лог', async () => {
    const db = await freshDb();
    const orphanAddress = '0x' + '42'.repeat(20);
    const { rpc } = fakeChain({
      head: 200,
      logs: [transferLog({
        topics: [TRANSFER_TOPIC0, addressToTopic(STRANGER), addressToTopic(orphanAddress)],
      })],
    });
    await scanEvmBlocks(db, {
      // В адресе сканера этот адрес есть (нода его вернула), но владельца в базе нет.
      rpc, contract: USDT, chain: 'bsc', confirmations: 15, addresses: [PLAYER, orphanAddress],
    }, T0);
    // Владелец ищется по активным адресам: у «несуществующего» игрока его нет.
    await db.prepare('UPDATE pay_addresses SET active = 0').bind().run();
    const applied = await applyEvmDeposits(db, USDT, T0 + 1);
    expect(applied).toMatchObject({ orphan: 1, credited: 0 });
    const row = await db.prepare('SELECT status FROM pay_chain_events WHERE to_addr = ?')
      .bind(orphanAddress).first<string>('status');
    expect(row).toBe('orphan');
  });

  it('в список сканирования попадают только адреса этой цепи', async () => {
    const db = await freshDb();
    // Ряд прошлой цепи того же игрока: он активен (на нём деньги), но этот
    // сканер его не трогает — за него отвечает TRON-монитор.
    await db.prepare(
      `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, created_at)
       VALUES ('ad_2', 'u1', 'tron', ?, ?, 2, ?)`,
    ).bind('T' + 'x'.repeat(33), `41${'aa'.repeat(20)}`, T0).run();
    // Формат `0x`, а метка — чужая сеть. Разрешает спор именно метка: она
    // записана в момент выдачи, и по ней же этот адрес был бы и зачислен.
    await db.prepare(
      `INSERT INTO pay_addresses (id, user_id, chain, address, hex, derivation_index, created_at)
       VALUES ('ad_3', 'u3', 'tron', ?, ?, 3, ?)`,
    ).bind('0x' + '33'.repeat(20), '33'.repeat(20), T0).run();
    // Наш адрес, но снятый с обслуживания.
    await db.prepare("UPDATE pay_addresses SET active = 0 WHERE id = 'ad_3'").run();

    expect(await bscActiveAddresses(db)).toEqual([PLAYER.toLowerCase()]);
  });

  it('адресов нет — к ноде не идём вовсе', async () => {
    const db = await freshDb();
    const { rpc, seen } = fakeChain({ head: 200, logs: [transferLog()] });
    const report = await scanEvmBlocks(db, {
      rpc, contract: USDT, chain: 'bsc', confirmations: 15, addresses: [],
    }, T0);
    expect(seen).toHaveLength(0);
    expect(report.stored).toBe(0);
  });

  it('окно режется по BLOCKS_PER_PASS, а не «от начала мира»', async () => {
    const db = await freshDb();
    const { rpc, seen } = fakeChain({ head: 100_000 });
    await scanEvmBlocks(db, {
      rpc, contract: USDT, chain: 'bsc', confirmations: 15, addresses: [PLAYER], blocksPerPass: 500,
    }, T0);
    expect(seen).toEqual([{ from: 1, to: 500 }]);
    expect(await readCursor(db, 'bsc', USDT)).toBe(500);
  });
});
