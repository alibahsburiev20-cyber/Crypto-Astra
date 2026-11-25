// Мониторинг депозитов в EVM (BNB Chain) — `eth_getLogs` по событию `Transfer`.
//
// Чего здесь нет по сравнению с TRON-монитором и почему:
//
//   * TRON-монитор ходит «по одному адресу, по времени». В EVM так нельзя:
//     `eth_getLogs` фильтрует по блокам, а не по адресу получателя, поэтому
//     идём диапазоном блоков и складываем адреса получателей в OR-тему. Один
//     запрос на всю пачку адресов — это и быстрее, и вежливее к публичной ноде.
//   * Курсор — номер блока, а не время. Время в разных блоках идёт вспять на
//     реоргадах, и по нему можно пропустить перевод.
//   * Подтверждения (`confirmations`) обязательны: перевод в «последнем» блоке
//     может исчезнуть вместе с блоком. Берём `eth_getLogs` только до
//     `head - confirmations`, а курсор двигаем по факту обработки.
//   * Ошибка ноды курсор не двигает: следующий проход доберёт то же окно.
//
// Сеть сюда не импортируется: адрес контракта, шкалу знаков и набор адресов
// передаёт вызывающий (см. `pay/chain.ts`), поэтому у TRON и BSC один и тот же
// путь «событие → `pay_chain_events` → зачисление».

import { creditDeposit } from '../ledger';
import { TRANSFER_TOPIC0, type EvmLog, type LogFilter, transferFromLog, addressToTopic } from './rpc';
import type { PayChain } from '../units';

/** Строка курсора: одна на цепь и контракт. */
const CURSOR_KEY = 'bsc';

/** Сколько адресов в одной OR-теме. Больше — часть нод начинает отвечать ошибкой. */
export const RECIPIENTS_PER_QUERY = 24;

/** Сколько блоков за один проход. 1000 блоков BSC ≈ час: cron ходит раз в минуту. */
export const BLOCKS_PER_PASS = 1_000;

/** Потолок адресов на проход: защита от «обойти миллион адресов в одном cron». */
export const MAX_ADDRESSES_PER_PASS = 500;

/**
 * Ровно то, что нужно сканеру. Отдельный тип, а не весь клиент: так тесты
 * подменяют сеть двумя методами, а боевой код получает `createEvmRpc(...)`.
 */
export interface EvmChainReader {
  blockNumber(): Promise<number>;
  logs(filter: LogFilter): Promise<EvmLog[]>;
}

export interface EvmMonitorDeps {
  rpc: EvmChainReader;
  contract: string;
  chain: PayChain;
  confirmations: number;
  /** Только активные адреса этой цепи; пустой список — сканировать нечего. */
  addresses: string[];
  blocksPerPass?: number;
}

export interface EvmScanResult {
  fromBlock: number;
  toBlock: number;
  head: number;
  fetched: number;
  stored: number;
  duplicates: number;
  rejected: number;
  error: string | null;
}

export async function readCursor(db: D1Database, chain = CURSOR_KEY, contract = ''): Promise<number> {
  const row = await db.prepare('SELECT height FROM pay_chain_cursor WHERE chain = ? AND contract = ?')
    .bind(chain, contract).first<number>('height');
  return Number(row ?? 0);
}

async function writeCursor(db: D1Database, chain: string, contract: string, height: number, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO pay_chain_cursor (chain, contract, height, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (chain, contract) DO UPDATE SET height = excluded.height, updated_at = excluded.updated_at`,
  ).bind(chain, contract, height, now).run();
}

/**
 * Один проход по блокам. Возвращает отчёт и никогда не бросает: cron обязан
 * дойти до остальных задач, если нода ответила мусором.
 */
export async function scanEvmBlocks(
  db: D1Database,
  deps: EvmMonitorDeps,
  now: number,
): Promise<EvmScanResult> {
  const empty: EvmScanResult = {
    fromBlock: 0, toBlock: 0, head: 0, fetched: 0, stored: 0, duplicates: 0, rejected: 0, error: null,
  };
  const addresses = (deps.addresses ?? []).map((a) => String(a).toLowerCase()).filter(Boolean);
  if (!deps.contract || !addresses.length) return empty;

  let head: number;
  try {
    head = await deps.rpc.blockNumber();
  } catch (e) {
    return { ...empty, error: `head:${e instanceof Error ? e.message : String(e)}` };
  }

  const safeHead = head - Math.max(0, deps.confirmations);
  const start = await readCursor(db, CURSOR_KEY, deps.contract);
  if (safeHead <= start) return { ...empty, head, fromBlock: start, toBlock: start };

  const from = start + 1;
  const to = Math.min(safeHead, from + (deps.blocksPerPass ?? BLOCKS_PER_PASS) - 1);
  const report: EvmScanResult = { fromBlock: from, toBlock: to, head, fetched: 0, stored: 0, duplicates: 0, rejected: 0, error: null };
  // Тема получателей: `null` во второй позиции означал бы «все», то есть
  // сканировать всю сеть. Перечисляем адресов пачками.
  const topics = addresses.length <= RECIPIENTS_PER_QUERY
    ? [TRANSFER_TOPIC0, null, addresses.map(addressToTopic)]
    : null;

  try {
    let logs: unknown[];
    if (topics) {
      logs = await deps.rpc.logs({ fromBlock: from, toBlock: to, address: deps.contract, topics });
    } else {
      // Много адресов: режем на пачки. Да, дороже, но корректность не обсуждается.
      logs = [];
      for (let i = 0; i < addresses.length; i += RECIPIENTS_PER_QUERY) {
        const slice = addresses.slice(i, i + RECIPIENTS_PER_QUERY).map(addressToTopic);
        const part = await deps.rpc.logs({
          fromBlock: from, toBlock: to, address: deps.contract, topics: [TRANSFER_TOPIC0, null, slice],
        });
        logs.push(...part);
      }
    }
    report.fetched = logs.length;

    const wanted = new Set(addresses);
    for (const raw of logs) {
      let transfer;
      try {
        transfer = transferFromLog(raw, { contract: deps.contract, chain: deps.chain, recipients: addresses });
      } catch (e) {
        // Мусор от ноды и чужие переводы — это не поломка, а статистика.
        if (e instanceof Error && 'code' in e) report.rejected += 1;
        else throw e;
        continue;
      }
      // Нода обязана отдать логи только из запрошенного окна. Проверяем всё
      // равно сами: «подтверждение» — это про блок, а не про вежливость провайдера.
      if (!wanted.has(transfer.to) || transfer.blockHeight < from || transfer.blockHeight > to) {
        report.rejected += 1;
        continue;
      }
      const res = await db.prepare(
        `INSERT INTO pay_chain_events
          (txid, event_index, block_height, block_time, from_addr, to_addr, contract, amount_micro, status, raw, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)
         ON CONFLICT (txid, event_index) DO NOTHING`,
      ).bind(
        transfer.txid, transfer.eventIndex, transfer.blockHeight, transfer.blockTime,
        transfer.from, transfer.to, transfer.contract, transfer.amountMicro, transfer.raw, now,
      ).run();
      const changes = Number((res as { meta?: { changes?: number } }).meta?.changes ?? 0);
      if (changes) report.stored += 1;
      else report.duplicates += 1;
    }
  } catch (e) {
    // Окно не помечается пройденным: на следующем проходе доберём те же блоки.
    return { ...report, error: `logs:${e instanceof Error ? e.message : String(e)}` };
  }

  await writeCursor(db, CURSOR_KEY, deps.contract, to, now);
  return report;
}

/**
 * Активные адреса BSC.
 *
 * Фильтр — по колонке `chain`, а не по форме адреса: `T…`/`0x…` различают сети
 * не хуже, но `chain` — то, что мы сами записали в момент выдачи. После
 * переключения `PAY_CHAIN` в таблице живут и старые адреса: их сканирует
 * предыдущий рельс, а не этот, и притаскивать их сюда — значит искать
 * пополнения там, где их быть не может.
 *
 * Отдаём в нижнем регистре: `transferFromLog` возвращает адрес получателя именно
 * так, и сравнение должно быть посимвольным.
 */
export async function bscActiveAddresses(db: D1Database, limit = MAX_ADDRESSES_PER_PASS): Promise<string[]> {
  const { results } = await db.prepare(
    "SELECT address FROM pay_addresses WHERE active = 1 AND chain = 'bsc' ORDER BY last_scanned_ts, created_at LIMIT ?",
  ).bind(Math.max(1, Math.min(MAX_ADDRESSES_PER_PASS, limit))).all<{ address: string }>();
  return (results ?? [])
    .map((row) => String(row.address).toLowerCase())
    .filter((address) => /^0x[0-9a-f]{40}$/.test(address));
}

export interface EvmApplyResult {
  credited: number;
  duplicated: number;
  orphan: number;
  processed: number;
}

/**
 * Зачислить найденное. Тот же `creditDeposit`, что и в TRON: ключ
 * `dep:<txid>:<event_index>` делает повторные проходы безопасными.
 */
export async function applyEvmDeposits(db: D1Database, contract: string, now: number, limit = 100): Promise<EvmApplyResult> {
  const { results } = await db.prepare(
    `SELECT e.txid, e.event_index, e.to_addr, e.amount_micro
       FROM pay_chain_events e
       LEFT JOIN pay_ledger l
         ON l.idem_key = 'dep:' || e.txid || ':' || e.event_index
      WHERE l.id IS NULL AND e.status = 'success' AND e.contract = ?
      ORDER BY e.block_height, e.event_index
      LIMIT ?`,
  ).bind(contract.toLowerCase(), Math.max(1, Math.min(500, limit))).all<{
    txid: string; event_index: number; to_addr: string; amount_micro: number;
  }>();

  const out: EvmApplyResult = { credited: 0, duplicated: 0, orphan: 0, processed: 0 };
  for (const event of results ?? []) {
    out.processed += 1;
    const owner = await db.prepare('SELECT user_id FROM pay_addresses WHERE address = ? AND active = 1')
      .bind(String(event.to_addr)).first<string>('user_id');
    if (!owner) {
      await db.prepare("UPDATE pay_chain_events SET status = 'orphan' WHERE txid = ? AND event_index = ?")
        .bind(String(event.txid), Number(event.event_index)).run();
      out.orphan += 1;
      // Чужие деньги на снятом адресе — единственная ситуация, о которой надо
      // кричать в логи: игрок их отправил, а зачислить некому.
      console.error('pay orphan deposit', { txid: String(event.txid), to: String(event.to_addr) });
      continue;
    }
    const credit = await creditDeposit(db, {
      txid: String(event.txid),
      eventIndex: Number(event.event_index),
      userId: String(owner),
      address: String(event.to_addr),
      amountMicro: Number(event.amount_micro),
    }, now);
    if (credit.credited) out.credited += 1;
    else out.duplicated += 1;
  }
  return out;
}
