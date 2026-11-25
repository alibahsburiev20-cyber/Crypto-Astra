import { sha256Hex } from '../shared/sha256';
import { ApiError } from './errors';

export const GENESIS_HASH = '0'.repeat(64);
// Базовые активы живут в balances, ресурсы — в таблице resources.
// В журнале у ресурса свой вид: res:<имя>.
export type Asset = 'astra' | 'fuel' | 'points' | 'xp' | `res:${string}` | `dur:${string}`;

export function isResourceAsset(asset: string): asset is `res:${string}` {
  return asset.startsWith('res:') && asset.length > 4;
}

export function resourceName(asset: string): string {
  return asset.slice(4);
}

export interface LedgerInput {
  playerId: string;
  asset: Asset;
  delta: number;
  reason: string;
  sourceRef?: string | null;
  idemKey?: string | null;
}

// hash = SHA-256(prev_hash + каноническая запись). seq в хеш не входит: он назначается при вставке.
export function canonical(i: LedgerInput, createdAt: number, prevHash: string): string {
  return prevHash + JSON.stringify([i.playerId, i.asset, i.delta, i.reason, i.sourceRef ?? '', i.idemKey ?? '', createdAt]);
}

export function appendLedger(sql: SqlStorage, input: LedgerInput, now: number): string {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new ApiError(500, 'bad_delta');
  const head = sql.exec('SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1').toArray();
  const prev = head.length ? String(head[0].hash) : GENESIS_HASH;
  const hash = sha256Hex(canonical(input, now, prev));
  sql.exec(
    `INSERT INTO ledger (player_id, asset, delta, reason, source_ref, idem_key, created_at, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.playerId, input.asset, input.delta, input.reason, input.sourceRef ?? null, input.idemKey ?? null, now, prev, hash,
  );
  return hash;
}

export interface LedgerReport {
  ok: boolean;
  rows: number;
  brokenAtSeq: number | null;
  mismatches: { playerId: string; asset: string; ledger: number; balance: number }[];
  head: { seq: number; hash: string } | null;
}

/**
 * Сколько строк журнала и какая из них последняя.
 *
 * Дёшево и без переноса строк в JS: `COUNT`/`MAX` считаются по индексу. Пара
 * «число строк + последний seq» — это то, по чему видно удаление строки:
 * append-only журнал не имеет права терять строки, а номера `seq` назначаются
 * автоматически и назад не откатываются.
 */
export function ledgerStats(sql: SqlStorage): { rows: number; maxSeq: number } {
  const row = sql.exec('SELECT COUNT(*) AS rows, COALESCE(MAX(seq), 0) AS maxSeq FROM ledger').toArray()[0];
  return { rows: Number(row?.rows ?? 0), maxSeq: Number(row?.maxSeq ?? 0) };
}

/**
 * Суммы журнала против балансов — по одному запросу на каждую сторону.
 *
 * Раньше это был один большой `SELECT * FROM ledger`: JS получал ВСЕ строки
 * журнала и на каждую считал SHA-256, то есть проверка мира стоила дороже, чем
 * всё остальное в мире, и дорожала линейно с числом игроков. Смысл сверки при
 * этом агрегатный: «сумма записей равна остатку». Агрегат умеет SQLite, и делает
 * это в разы дешевле, поэтому группировка ушла в SQL, а здесь остаётся только
 * сравнение — по одной строке на пару «игрок + актив».
 */
export function ledgerMismatches(sql: SqlStorage): LedgerReport['mismatches'] {
  const sums = new Map<string, number>();
  for (const r of sql.exec(
    'SELECT player_id AS player, asset AS asset, SUM(delta) AS total FROM ledger GROUP BY player_id, asset',
  )) {
    sums.set(`${String(r.player)}\u0000${String(r.asset)}`, Number(r.total));
  }
  // Те же четыре источника остатков, что и раньше, но собранные одним запросом:
  // ресурсы, опыт и прочность живут в своих таблицах, а в журнале у них свой вид
  // актива (`res:<имя>`, `xp`, `dur:<корабль>`).
  const balances = new Map<string, number>();
  for (const r of sql.exec(
    `SELECT player_id AS player, asset AS asset, amount AS amount FROM balances
     UNION ALL
     SELECT player_id, 'res:' || resource, amount FROM resources
     UNION ALL
     SELECT id, 'xp', xp FROM players
     UNION ALL
     SELECT player_id, 'dur:' || id, durability FROM ships`,
  )) {
    const key = `${String(r.player)}\u0000${String(r.asset)}`;
    balances.set(key, (balances.get(key) ?? 0) + Number(r.amount));
  }
  const mismatches: LedgerReport['mismatches'] = [];
  for (const key of new Set([...sums.keys(), ...balances.keys()])) {
    const l = sums.get(key) ?? 0;
    const b = balances.get(key) ?? 0;
    if (l !== b) {
      const [playerId, asset] = key.split('\u0000');
      mismatches.push({ playerId, asset, ledger: l, balance: b });
    }
  }
  return mismatches;
}

/** Ход по цепочке хешей. `after` — начать со строки после этого seq (или с первой). */
export function verifyChain(
  sql: SqlStorage, after = 0, startHash = GENESIS_HASH,
): { brokenAtSeq: number | null; head: LedgerReport['head']; rows: number } {
  let prev = startHash;
  let brokenAtSeq: number | null = null;
  let head: LedgerReport['head'] = null;
  let rows = 0;
  const walk = after > 0
    ? sql.exec('SELECT * FROM ledger WHERE seq > ? ORDER BY seq', after)
    : sql.exec('SELECT * FROM ledger ORDER BY seq');
  for (const r of walk) {
    rows += 1;
    const seq = Number(r.seq);
    const input: LedgerInput = {
      playerId: String(r.player_id), asset: String(r.asset) as Asset, delta: Number(r.delta),
      reason: String(r.reason), sourceRef: r.source_ref as string | null, idemKey: r.idem_key as string | null,
    };
    const expected = sha256Hex(canonical(input, Number(r.created_at), prev));
    if (brokenAtSeq === null && (String(r.prev_hash) !== prev || String(r.hash) !== expected)) brokenAtSeq = seq;
    prev = String(r.hash);
    head = { seq, hash: prev };
  }
  return { brokenAtSeq, head, rows };
}

/** Полная сверка: весь журнал от генезиса. Дорогая — её делает cron раз в неделю. */
export function verifyLedger(sql: SqlStorage): LedgerReport {
  const chain = verifyChain(sql);
  const mismatches = ledgerMismatches(sql);
  const stats = ledgerStats(sql);
  return {
    ok: chain.brokenAtSeq === null && mismatches.length === 0,
    rows: stats.rows,
    brokenAtSeq: chain.brokenAtSeq,
    mismatches,
    head: chain.head,
  };
}

/** Ключ meta: до какой строки журнала цепочка уже проверена. */
export const VERIFY_SEQ_KEY = 'ledger_verify_seq';
export const VERIFY_HASH_KEY = 'ledger_verify_hash';
/** Сколько строк и какой `max seq` видели в прошлый раз (ловит удаление из середины). */
export const LEDGER_TAIL_KEY = 'ledger_tail';

function metaValue(sql: SqlStorage, key: string): string | null {
  const row = sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
  return row === undefined ? null : String(row.value);
}

/** Последняя подтверждённая точка цепочки: `null` — сверять нужно с генезиса. */
export function verifyWatermark(sql: SqlStorage): { seq: number; hash: string } | null {
  const seq = Number(metaValue(sql, VERIFY_SEQ_KEY));
  const hash = metaValue(sql, VERIFY_HASH_KEY);
  if (!Number.isInteger(seq) || seq <= 0 || !hash) return null;
  return { seq, hash };
}

/**
 * Быстрая сверка: суммы по всему журналу (в SQLite) + целостность хвоста (в JS).
 *
 * Хвост проверяется от последней подтверждённой точки, а не от генезиса: часовой
 * обход «всего когда-либо записанного» — это ровно то, что линейно убивает
 * Durable Object по мере роста сезона. Всё, что ДО точки, уже проверялось, а
 * удаление строки выдают не хеши, а расхождение сумм и счётчики строк — их
 * смотрим целиком на каждом прогоне.
 */
export function verifyLedgerFast(sql: SqlStorage, after = 0, startHash = GENESIS_HASH): LedgerReport {
  const chain = verifyChain(sql, after, startHash);
  const mismatches = ledgerMismatches(sql);
  const stats = ledgerStats(sql);
  const tail = metaValue(sql, LEDGER_TAIL_KEY);
  if (tail) {
    const seen = String(tail).split(':').map(Number);
    if (seen.length === 2 && (stats.rows < seen[0] || stats.maxSeq < seen[1])) {
      // Что-то из журнала исчезло. Чинить это сверкой нечем — только стоп-флаг.
      return { ok: false, rows: stats.rows, brokenAtSeq: seen[1], mismatches, head: chain.head };
    }
  }
  return {
    ok: chain.brokenAtSeq === null && mismatches.length === 0,
    rows: stats.rows,
    brokenAtSeq: chain.brokenAtSeq,
    mismatches,
    head: chain.head,
  };
}

/**
 * Что видят админка и снимок: полные суммы + цепочка только хвоста.
 *
 * Разница с `verifyLedger` — ровно объём работы: часовой cron, экран оператора и
 * недельный снимок не должны платить за переписывание всей истории мира. Без
 * отметки (новый мир) это та же полная проверка.
 */
export function verifyNow(sql: SqlStorage): LedgerReport {
  const mark = verifyWatermark(sql);
  return mark ? verifyLedgerFast(sql, mark.seq, mark.hash) : verifyLedger(sql);
}
