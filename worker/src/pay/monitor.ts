// Монитор блокчейна: смотрим входящие USDT на наши адреса.
//
// Правила, без которых деньги теряются:
//   1. Только подтверждённые транзакции (`only_confirmed=true`). Неподтверждённый
//      перевод может исчезнуть вместе с блоком.
//   2. Один перевод — одна строка. Ключ `(txid, event_index)` уникален в базе,
//      поэтому повторный опрос через минуту не создаёт дубль.
//   3. Курсор по времени хранится у адреса (`last_scanned_ts`). Если сеть ответила
//      ошибкой, курсор не двигается — следующий заход доберёт пропущенное.
//   4. Ошибка сети не валит cron: монитор возвращает отчёт, а не бросает исключение.
//
// Сеть сюда передаётся функцией `fetchJson`: в тестах это поддельный TronGrid,
// в бою — настоящий. Никаких ключей монитору не нужно: он только читает.

import { creditDeposit } from './ledger';
import { TransferError, parseAccountTransfer } from './tron/transfer';

export const DEFAULT_API = 'https://api.trongrid.io';

/**
 * Настоящий TronGrid. Ключ необязателен: без него лимит ниже, но работать
 * можно. Ключ живёт только в секретах Worker и в D1 не попадает.
 */
export function trongridFetcher(apiKey?: string, fetchImpl: typeof fetch = fetch) {
  return async (url: string): Promise<unknown> => {
    const res = await fetchImpl(url, {
      headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  };
}
export const PAGE_LIMIT = 200;

export interface MonitorDeps {
  fetchJson: (url: string) => Promise<unknown>;
  contracts: string[];
  apiBase?: string;
  limit?: number;
}

export interface ScanResult {
  address: string;
  cursor: number;
  nextCursor: number;
  fetched: number;
  stored: number;
  duplicates: number;
  rejected: number;
  error: string | null;
}

/**
 * Просмотреть один адрес. Возвращает отчёт даже при ошибке сети: cron должен
 * идти дальше, а не падать целиком из-за одного адреса.
 */
export async function scanAddress(
  db: D1Database,
  deps: MonitorDeps,
  address: string,
  now: number,
): Promise<ScanResult> {
  const row = await db.prepare('SELECT last_scanned_ts FROM pay_addresses WHERE address = ? AND active = 1')
    .bind(address).first<number>('last_scanned_ts');
  const cursor = Number(row ?? 0);

  const base = deps.apiBase ?? DEFAULT_API;
  const limit = deps.limit ?? PAGE_LIMIT;
  const url = `${base}/v1/accounts/${encodeURIComponent(address)}/transactions/trc20`
    + `?only_confirmed=true&limit=${limit}&min_timestamp=${cursor}`;

  let payload: unknown;
  try {
    payload = await deps.fetchJson(url);
  } catch (e) {
    return {
      address, cursor, nextCursor: cursor, fetched: 0, stored: 0, duplicates: 0, rejected: 0,
      error: `fetch:${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const rows = Array.isArray((payload as { data?: unknown[] })?.data)
    ? ((payload as { data: unknown[] }).data)
    : [];

  let stored = 0;
  let duplicates = 0;
  let rejected = 0;
  let nextCursor = cursor;

  for (const raw of rows) {
    let transfer;
    try {
      transfer = parseAccountTransfer(raw, { contracts: deps.contracts });
    } catch (e) {
      if (e instanceof TransferError) {
        rejected += 1;
        continue;
      }
      throw e;
    }
    if (transfer.to !== address) continue;
    if (transfer.blockTime > nextCursor) nextCursor = transfer.blockTime;

    const res = await db.prepare(
      `INSERT INTO pay_chain_events
        (txid, event_index, block_height, block_time, from_addr, to_addr, contract, amount_micro, status, raw, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)
       ON CONFLICT (txid, event_index) DO NOTHING`,
    ).bind(
      transfer.txid, transfer.eventIndex, transfer.blockHeight ?? 0, transfer.blockTime,
      transfer.from, transfer.to, transfer.contract, transfer.amountMicro, transfer.raw, now,
    ).run();

    const changes = Number((res as { meta?: { changes?: number } }).meta?.changes ?? 0);
    if (changes) stored += 1;
    else duplicates += 1;
  }

  if (rows.length) {
    await db.prepare('UPDATE pay_addresses SET last_scanned_ts = ? WHERE address = ? AND last_scanned_ts < ?')
      .bind(nextCursor, address, nextCursor).run();
  }

  return { address, cursor, nextCursor, fetched: rows.length, stored, duplicates, rejected, error: null };
}

export interface ScanAllResult {
  addresses: number;
  stored: number;
  duplicates: number;
  rejected: number;
  errors: { address: string; error: string }[];
}

/** Обойти активные адреса. Лимит — чтобы cron укладывался в бюджет CPU. */
export async function scanAll(
  db: D1Database,
  deps: MonitorDeps,
  now: number,
  maxAddresses = 50,
): Promise<ScanAllResult> {
  const { results } = await db.prepare(
    'SELECT address FROM pay_addresses WHERE active = 1 ORDER BY last_scanned_ts, created_at LIMIT ?',
  ).bind(Math.max(1, Math.min(500, maxAddresses))).all<{ address: string }>();

  const summary: ScanAllResult = { addresses: 0, stored: 0, duplicates: 0, rejected: 0, errors: [] };
  for (const row of results ?? []) {
    const result = await scanAddress(db, deps, String(row.address), now);
    summary.addresses += 1;
    summary.stored += result.stored;
    summary.duplicates += result.duplicates;
    summary.rejected += result.rejected;
    if (result.error) summary.errors.push({ address: result.address, error: result.error });
  }
  return summary;
}

export interface ApplyResult {
  credited: number;
  duplicated: number;
  unknownAddress: number;
  processed: number;
}

/**
 * Превратить найденные события в деньги на балансе игрока.
 *
 * Событие без владельца адреса (например, адрес из будущего или чужой перевод)
 * пропускается: зачислять некому. Всё остальное идёт через `creditDeposit`,
 * который держит идемпотентность и хеш-цепочку.
 */
export async function applyDeposits(db: D1Database, now: number, limit = 100): Promise<ApplyResult> {
  const { results } = await db.prepare(
    `SELECT e.txid, e.event_index, e.to_addr, e.amount_micro
       FROM pay_chain_events e
       LEFT JOIN pay_ledger l
         ON l.idem_key = 'dep:' || e.txid || ':' || e.event_index
      WHERE l.id IS NULL AND e.status = 'success'
      ORDER BY e.block_height, e.event_index
      LIMIT ?`,
  ).bind(Math.max(1, Math.min(500, limit))).all<{
    txid: string; event_index: number; to_addr: string; amount_micro: number;
  }>();

  const out: ApplyResult = { credited: 0, duplicated: 0, unknownAddress: 0, processed: 0 };
  for (const event of results ?? []) {
    out.processed += 1;
    const owner = await db.prepare('SELECT user_id FROM pay_addresses WHERE address = ? AND active = 1')
      .bind(String(event.to_addr)).first<string>('user_id');
    if (!owner) {
      // Адрес без владельца больше не проверяем: иначе cron будет ходить по
      // нему вечно. Если адрес когда-нибудь появится, событие можно вернуть
      // в статус `success` вручную — сумма и txid сохранены.
      await db.prepare("UPDATE pay_chain_events SET status = 'orphan' WHERE txid = ? AND event_index = ?")
        .bind(String(event.txid), Number(event.event_index)).run();
      out.unknownAddress += 1;
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
