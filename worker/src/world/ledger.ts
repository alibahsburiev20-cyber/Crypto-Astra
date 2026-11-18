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

// Проверка цепочки и сверка: сумма delta по игроку и активу должна равняться balances.
export function verifyLedger(sql: SqlStorage): LedgerReport {
  let prev = GENESIS_HASH;
  let rows = 0;
  let brokenAtSeq: number | null = null;
  let head: LedgerReport['head'] = null;
  const sums = new Map<string, number>();

  for (const r of sql.exec('SELECT * FROM ledger ORDER BY seq')) {
    rows++;
    const seq = Number(r.seq);
    const input: LedgerInput = {
      playerId: String(r.player_id), asset: String(r.asset) as Asset, delta: Number(r.delta),
      reason: String(r.reason), sourceRef: r.source_ref as string | null, idemKey: r.idem_key as string | null,
    };
    const expected = sha256Hex(canonical(input, Number(r.created_at), prev));
    if (brokenAtSeq === null && (String(r.prev_hash) !== prev || String(r.hash) !== expected)) brokenAtSeq = seq;
    prev = String(r.hash);
    head = { seq, hash: prev };
    const k = `${input.playerId}\u0000${input.asset}`;
    sums.set(k, (sums.get(k) ?? 0) + input.delta);
  }

  const balances = new Map<string, number>();
  for (const b of sql.exec('SELECT player_id, asset, amount FROM balances')) {
    balances.set(`${b.player_id}\u0000${b.asset}`, Number(b.amount));
  }
  // Ресурсы лежат в отдельной таблице, но в журнале у них вид res:<имя>.
  for (const r of sql.exec('SELECT player_id, resource, amount FROM resources')) {
    balances.set(`${r.player_id}\u0000res:${r.resource}`, Number(r.amount));
  }
  // Опыт — колонка players.xp, прочность — ships.durability; в журнале это
  // активы xp и dur:<shipId>.
  for (const p of sql.exec('SELECT id, xp FROM players')) {
    balances.set(`${p.id}\u0000xp`, Number(p.xp));
  }
  for (const sh of sql.exec('SELECT id, player_id, durability FROM ships')) {
    balances.set(`${sh.player_id}\u0000dur:${sh.id}`, Number(sh.durability));
  }
  const mismatches: LedgerReport['mismatches'] = [];
  for (const k of new Set([...sums.keys(), ...balances.keys()])) {
    const l = sums.get(k) ?? 0;
    const b = balances.get(k) ?? 0;
    if (l !== b) {
      const [playerId, asset] = k.split('\u0000');
      mismatches.push({ playerId, asset, ledger: l, balance: b });
    }
  }
  return { ok: brokenAtSeq === null && mismatches.length === 0, rows, brokenAtSeq, mismatches, head };
}
