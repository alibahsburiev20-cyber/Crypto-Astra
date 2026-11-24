// JSON-RPC для EVM-сетей (BNB Smart Chain и любые другие).
//
// Почему свой клиент, а не библиотека: нам нужно ровно шесть вызовов, и каждый
// из них обязан либо вернуть данные в проверяемой форме, либо назвать причину.
// Библиотека вернула бы `null`/`undefined` там, где мы обязаны отличить
// «транзакции ещё нет» от «нода соврала», а это различие решает, зачислять
// деньги или ждать.
//
// Что здесь главное:
//   * любой ответ разбирается строго (см. `asRecord`, `hexToNumber`); мусор —
//     это ошибка, а не `0`;
//   * `removed: true` в логе — сеть честно говорит, что блок откатился; такое
//     событие не считается;
//   * лимит на диапазон блоков в `eth_getLogs`: публичные ноды отдают ошибку
//     «range too large», поэтому режем окно и идём по частям;
//   * сеть не может увести нас в бесконечный цикл: число вызовов за раз
//     ограничено, а таймаут стоит на каждом запросе.

import { AmountError, chainValueRemainder, chainValueToMicro, type PayChain } from '../units';

/** Коды ошибок транспорта. В логи и в `/admin/pay` уходят именно они, не текст ноды. */
export class EvmRpcError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'EvmRpcError';
    this.code = code;
  }
}

export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  removed: boolean;
}

export interface EvmReceipt {
  transactionHash: string;
  blockNumber: number | null;
  status: boolean;
  gasUsed: number;
  logs: EvmLog[];
}

export interface LogFilter {
  fromBlock: number;
  toBlock: number;
  /** Контракт токена. Один адрес — массив в `address` ноды не экономит ничего. */
  address: string;
  /** `null` — «любой». Массив — «любое из» (OR), так и используем для адресов получателей. */
  topics: (string | string[] | null)[];
}

export interface EvmRpcOptions {
  url: string;
  fetchImpl?: typeof fetch;
  /** Миллисекунды на один HTTP-запрос. По умолчанию 8 с: cron ходит раз в минуту. */
  timeoutMs?: number;
  /** Заголовок провайдера (например ключ QuickNode в URL — тогда не нужен). */
  headers?: Record<string, string>;
}

/** Сколько логов за один `eth_getLogs`. Выше — большинство публичных нод режут. */
export const MAX_BLOCKS_PER_LOG_QUERY = 1_000;
/** Сколько вызовов в одной пачке. Больше — подозрение на DoS ourselves. */
export const MAX_BATCH_CALLS = 8;
/** Потолок `toBlock - fromBlock` после нарезки: защита от «сcan c начала мира». */
export const MAX_LOGS_PER_QUERY = 1_000;

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function hexToBigInt(input: unknown): bigint {
  const text = String(input ?? '').trim();
  if (!/^0x[0-9a-fA-F]{1,32}$/.test(text)) throw new EvmRpcError('bad_hex');
  return BigInt(text);
}

export function bigIntToHex(value: bigint): string {
  if (value < 0n) throw new EvmRpcError('negative_hex');
  const hex = value.toString(16);
  return `0x${hex.length % 2 ? '0' : ''}${hex}`;
}

export function hexToNumber(input: unknown): number {
  const value = hexToBigInt(input);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new EvmRpcError('number_too_big');
  return Number(value);
}

/** `0x000…0abc` → `0x…abc` без ведущих нулей, в нижнем регистре. */
export function stripTopic(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(text)) throw new EvmRpcError('bad_topic');
  const body = text.slice(2).replace(/^0+/, '');
  return `0x${body.length % 2 ? '0' + body : body}`;
}

/** Адрес в 32-байтовую тему (левые нули) — так его хранит нода. */
export function addressToTopic(address: string): string {
  if (!ADDRESS_RE.test(address)) throw new EvmRpcError('bad_address');
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

/**
 * Тема → адрес. Берём ровно последние 40 знаков и требуем, чтобы старшие 24
 * были нулями: «адрес» с мусором в старших байтах — это не адрес, а чужие данные.
 */
export function topicToAddress(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(text)) throw new EvmRpcError('bad_topic');
  if (text.slice(2, 26) !== '0'.repeat(24)) throw new EvmRpcError('topic_not_address');
  return `0x${text.slice(26)}`;
}

/** 32-байтное слово данных перевода → целое. */
export function wordToBigInt(value: unknown): bigint {
  const text = String(value ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) throw new EvmRpcError('bad_word');
  return BigInt(text);
}

/**
 * Число из ответа ноды: она отдаёт hex-строки, наш `parseLog` — уже числа.
 * Разбор должен принимать и то, и другое, иначе один и тот же лог считался бы
 * по-разному в тестах и в бою.
 */
function numericField(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new EvmRpcError('bad_number_field');
    return value;
  }
  return hexToNumber(value);
}

/** Хеш транзакции: с `0x` от ноды или без него из нашего `parseLog`. */
function hashField(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase();
  const body = text.startsWith('0x') ? text.slice(2) : text;
  if (!/^[0-9a-f]{64}$/.test(body)) throw new EvmRpcError('bad_txid');
  return body;
}

function asRecord(value: unknown, code = 'bad_shape'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EvmRpcError(code);
  return value as Record<string, unknown>;
}

function parseLog(value: unknown): EvmLog {
  const row = asRecord(value, 'bad_log');
  const address = String(row.address ?? '').trim();
  if (!ADDRESS_RE.test(address)) throw new EvmRpcError('bad_log_address');
  const txid = String(row.transactionHash ?? '').trim();
  if (!HASH_RE.test(txid)) throw new EvmRpcError('bad_log_txid');
  const topics = Array.isArray(row.topics) ? row.topics.map((t) => String(t)) : [];
  const logIndex = row.logIndex;
  if (typeof logIndex !== 'string' && typeof logIndex !== 'number') throw new EvmRpcError('bad_log_index');
  return {
    address: `0x${address.slice(2)}`,
    topics,
    data: String(row.data ?? ''),
    blockNumber: hexToNumber(row.blockNumber),
    transactionHash: txid.toLowerCase(),
    logIndex: hexToNumber(logIndex),
    removed: row.removed === true || String(row.removed ?? '') === '0x1',
  };
}

/**
 * Кликент одного RPC-эндпоинта.
 *
 * `fetchImpl` передаётся извне, чтобы тесты подменяли сеть, а боевой код
 * использовал глобальный `fetch` воркера.
 */
export function createEvmRpc(opts: EvmRpcOptions) {
  const url = String(opts.url ?? '').trim();
  if (!/^https:\/\//.test(url)) throw new EvmRpcError('bad_rpc_url');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;
  let seq = 0;

  async function post(body: unknown): Promise<unknown> {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((e: unknown) => {
      const name = e instanceof Error ? e.name : '';
      throw new EvmRpcError(name === 'TimeoutError' ? 'rpc_timeout' : 'rpc_unreachable');
    });
    if (res.status === 429) throw new EvmRpcError('rpc_rate_limited');
    if (!res.ok) throw new EvmRpcError(`http_${res.status}`);
    return await res.json().catch(() => {
      throw new EvmRpcError('bad_json');
    });
  }

  /** Один вызов. Ошибку ноды превращаем в код, текст ноды не отдаём наружу. */
  async function request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const payload = asRecord(await post({ jsonrpc: '2.0', id: (seq += 1), method, params }));
    if (payload.error) {
      const err = asRecord(payload.error);
      const code = Number(err.code ?? 0);
      // -32005 «limit exceeded»/«range too large» у разных нод; это не поломка, а
      // сигнал уменьшить окно — возвращаем отдельным кодом.
      throw new EvmRpcError(code === -32005 ? 'rpc_limited' : `rpc_${code}`);
    }
    if (!('result' in payload)) throw new EvmRpcError('no_result');
    return payload.result as T;
  }

  /**
   * Пачка вызовов одним HTTP-запросом. Нужна, чтобы `eth_blockNumber` +
   * `eth_getLogs` + `eth_gasPrice` не съедали три таймаута на одном скане.
   */
  async function batch(calls: { method: string; params?: unknown[] }[]): Promise<unknown[]> {
    if (!calls.length) return [];
    if (calls.length > MAX_BATCH_CALLS) throw new EvmRpcError('batch_too_big');
    const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params ?? [] }));
    const payload = await post(body);
    if (!Array.isArray(payload)) {
      // Нода не поддержала batch: считаем это ошибкой конфигурации, а не падаем
      // в тихий фолбэк — иначе тестнет «работает», а на проде окажется иначе.
      throw new EvmRpcError('batch_unsupported');
    }
    const byId = new Map<number, Record<string, unknown>>();
    for (const item of payload) byId.set(Number(asRecord(item).id ?? 0), asRecord(item));
    return calls.map((_, i) => {
      const item = byId.get(i + 1);
      if (!item) throw new EvmRpcError('batch_missing');
      if (item.error) {
        const err = asRecord(item.error);
        throw new EvmRpcError(`rpc_${Number(err.code ?? 0)}`);
      }
      return item.result;
    });
  }

  return {
    request,
    batch,

    async blockNumber(): Promise<number> {
      return hexToNumber(await request<string>('eth_blockNumber'));
    },

    /** Логи за диапазон, нарезанный по блокам: нода не должна видеть огромный window. */
    async logs(filter: LogFilter): Promise<EvmLog[]> {
      const { fromBlock, toBlock } = filter;
      if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock)) throw new EvmRpcError('bad_block_range');
      if (fromBlock > toBlock) return [];
      const out: EvmLog[] = [];
      for (let from = fromBlock; from <= toBlock;) {
        const to = Math.min(toBlock, from + MAX_BLOCKS_PER_LOG_QUERY - 1);
        const rows = await request<unknown[]>('eth_getLogs', [{
          fromBlock: bigIntToHex(BigInt(from)),
          toBlock: bigIntToHex(BigInt(to)),
          address: filter.address,
          topics: filter.topics,
        }]);
        if (!Array.isArray(rows)) throw new EvmRpcError('bad_logs_shape');
        for (const row of rows) out.push(parseLog(row));
        if (out.length > MAX_LOGS_PER_QUERY) throw new EvmRpcError('too_many_logs');
        from = to + 1;
      }
      return out;
    },

    /** Время блока в миллисекундах — нужно курсору сканера и сверке «когда пришло». */
    async blockTimestamp(blockNumber: number): Promise<number | null> {
      const row = await request<unknown>('eth_getBlockByNumber', [bigIntToHex(BigInt(blockNumber)), false]);
      if (row === null) return null;
      const time = hexToNumber(asRecord(row).timestamp);
      // Нода отдаёт секунды; у нас везде миллисекунды — приводим здесь, а не в caller.
      return time < 1e12 ? time * 1000 : time;
    },

    async gasPrice(): Promise<bigint> {
      return hexToBigInt(await request<string>('eth_gasPrice'));
    },

    /** EIP-1559: без этого выплата на 1 gwei зависнет в мемпуле на часы. */
    async feeHistory(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | null> {
      const rows = await request<{ reward?: unknown[]; baseFeePerGas?: unknown[] } | null>(
        'eth_feeHistory', ['0x5', 'latest', [0x64]],
      );
      if (!rows) return null;
      const base = Array.isArray(rows.baseFeePerGas) ? rows.baseFeePerGas : [];
      const rewards = Array.isArray(rows.reward) ? rows.reward : [];
      const lastBase = base[base.length - 1];
      if (lastBase === undefined) return null;
      const priorityRaw = rewards.length
        ? (Array.isArray(rewards[rewards.length - 1]) ? (rewards[rewards.length - 1] as unknown[])[0] : null)
        : null;
      const priority = priorityRaw === undefined || priorityRaw === null
        ? 1_000_000_000n /* 1 gwei — разумный пол на BSC */
        : hexToBigInt(priorityRaw);
      const baseFee = hexToBigInt(lastBase);
      return { maxPriorityFeePerGas: priority, maxFeePerGas: baseFee * 2n + priority };
    },

    async transactionCount(address: string, blockTag = 'latest'): Promise<number> {
      if (!ADDRESS_RE.test(address)) throw new EvmRpcError('bad_address');
      return hexToNumber(await request<string>('eth_getTransactionCount', [address, blockTag]));
    },

    async balance(address: string): Promise<bigint> {
      if (!ADDRESS_RE.test(address)) throw new EvmRpcError('bad_address');
      return hexToBigInt(await request<string>('eth_getBalance', [address, 'latest']));
    },

    /** Вызов к контракту без транзакции: `decimals()`, `balanceOf()`. */
    async call(to: string, data: string): Promise<string> {
      if (!ADDRESS_RE.test(to)) throw new EvmRpcError('bad_address');
      if (!/^0x[0-9a-fA-F]*$/.test(data)) throw new EvmRpcError('bad_calldata');
      const result = await request<string>('eth_call', [{ to, data }, 'latest']);
      return String(result ?? '');
    },

    async sendRawTransaction(rawHex: string): Promise<string> {
      if (!/^0x[0-9a-fA-F]+$/.test(rawHex)) throw new EvmRpcError('bad_raw_tx');
      const hash = await request<string>('eth_sendRawTransaction', [rawHex]);
      const text = String(hash ?? '').trim().toLowerCase();
      if (!HASH_RE.test(text)) throw new EvmRpcError('bad_tx_hash');
      return text.slice(2);
    },

    async transactionReceipt(hash: string): Promise<EvmReceipt | null> {
      const clean = String(hash ?? '').trim().toLowerCase();
      const value = /^0x[0-9a-f]{64}$/.test(clean) ? clean : `0x${clean}`;
      if (!HASH_RE.test(value)) throw new EvmRpcError('bad_tx_hash');
      const row = await request<unknown>('eth_getTransactionReceipt', [value]);
      if (row === null) return null;
      const rec = asRecord(row);
      const logsRaw = Array.isArray(rec.logs) ? rec.logs : [];
      return {
        transactionHash: value.slice(2),
        blockNumber: rec.blockNumber === undefined ? null : hexToNumber(rec.blockNumber),
        // `0x1` успех, `0x0` реверт; отсутствия поля быть не должно — это не «успех».
        status: String(rec.status ?? '') === '0x1',
        gasUsed: hexToNumber(rec.gasUsed ?? '0x0'),
        logs: logsRaw.map(parseLog),
      };
    },
  };
}

export type EvmRpc = ReturnType<typeof createEvmRpc>;

/** keccak-тема `Transfer(address,address,uint256)` — одна и та же в TRON и EVM. */
export const TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface EvmTransfer {
  txid: string;
  eventIndex: number;
  blockHeight: number;
  blockTime: number | null;
  from: string;
  to: string;
  contract: string;
  amountMicro: number;
  /** Хвост, который сгорел из-за разницы шкал (0 на 6-значной сети). */
  dustRaw: bigint;
  /** Перевод ровно целое число micro — витрина обязана это требовать от игрока. */
  exact: boolean;
  raw: string;
}

export interface DecodeOptions {
  /** Allowlist контракта: всё остальное — чужой токен, а не деньги. */
  contract: string;
  chain: PayChain;
  /** Если задан — принимаем переводы только на эти адреса (нижний регистр). */
  recipients?: string[];
}

/**
 * Лог `eth_getLogs` → перевод USDT.
 *
 * Разбор сознательно придирчивый: у нас на кону зачисление денег, а «похожий на
 * true» ответ ноды — это то, из-за чего потом ищут пропавший USDT по эксплореру.
 */
export function transferFromLog(value: unknown, opts: DecodeOptions): EvmTransfer {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : (() => {
        throw new EvmRpcError('bad_log');
      })();
  if (row.removed === true || String(row.removed ?? '') === '0x1') throw new EvmRpcError('log_removed');

  const contract = String(row.address ?? '').trim().toLowerCase();
  if (contract !== opts.contract.toLowerCase()) throw new EvmRpcError('wrong_contract');

  const topics = Array.isArray(row.topics) ? row.topics.map((t) => String(t).toLowerCase()) : [];
  if (topics.length !== 3) throw new EvmRpcError('bad_topics');
  if (topics[0] !== TRANSFER_TOPIC0) throw new EvmRpcError('not_transfer');

  const from = topicToAddress(topics[1]);
  const to = topicToAddress(topics[2]);
  if (opts.recipients && !opts.recipients.includes(to)) throw new EvmRpcError('not_our_address');

  // `data` — это 32-байтное слово BigUInt в hex. В `units` передаём число, а не
  // строку hex: иначе `1000000` (TRON) и `0x...0f4240` (BSC) сошлись бы в одну шкалу.
  const raw = wordToBigInt(row.data);
  if (raw === 0n) throw new EvmRpcError('zero_amount');

  let amountMicro: number;
  let dustRaw: bigint;
  try {
    amountMicro = chainValueToMicro(raw, opts.chain);
    dustRaw = chainValueRemainder(raw, opts.chain);
  } catch (e) {
    if (e instanceof AmountError) {
      // `amount_below_precision` — это перевод меньше одного micro: пыль от чужих
      // минт-дропов. Не зачисляем и не считаем депозитом.
      throw new EvmRpcError(e.code === 'amount_below_precision' ? 'dust_only' : e.code);
    }
    throw e;
  }

  return {
    txid: hashField(row.transactionHash),
    eventIndex: numericField(row.logIndex),
    blockHeight: numericField(row.blockNumber),
    blockTime: null,
    from,
    to,
    contract,
    amountMicro,
    dustRaw,
    exact: dustRaw === 0n,
    raw: JSON.stringify(row),
  };
}
