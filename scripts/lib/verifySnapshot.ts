import { GENESIS_HASH, canonical, type Asset, type LedgerInput } from '../../worker/src/world/ledger';
import { sha256Hex } from '../../worker/src/shared/sha256';

export interface LedgerRow {
  seq: number;
  player_id: string;
  asset: string;
  delta: number;
  reason: string;
  source_ref: string | null;
  idem_key: string | null;
  created_at: number;
  prev_hash: string;
  hash: string;
}

export interface BalanceRow { player_id: string; asset: string; amount: number }

export interface Snapshot {
  world_id?: string;
  ledger: LedgerRow[];
  balances?: BalanceRow[];
}

export interface SnapshotReport {
  ok: boolean;
  rows: number;
  head: { seq: number; hash: string } | null;
  problems: string[];
}

const KEY_SEP = '\u0000';

/** Пересчитывает хеш-цепочку и сверяет суммы Ledger с балансами. Чистая функция. */
export function verifySnapshot(snapshot: Snapshot): SnapshotReport {
  const rows = [...(snapshot.ledger ?? [])].sort((a, b) => Number(a.seq) - Number(b.seq));
  const problems: string[] = [];
  let prev = GENESIS_HASH;
  let head: { seq: number; hash: string } | null = null;
  const sums = new Map<string, number>();

  for (const r of rows) {
    const input: LedgerInput = {
      playerId: String(r.player_id), asset: String(r.asset) as Asset, delta: Number(r.delta),
      reason: String(r.reason), sourceRef: r.source_ref ?? null, idemKey: r.idem_key ?? null,
    };
    const expected = sha256Hex(canonical(input, Number(r.created_at), prev));
    if (String(r.prev_hash) !== prev) problems.push(`seq ${r.seq}: prev_hash не совпадает с предыдущей записью`);
    else if (String(r.hash) !== expected) problems.push(`seq ${r.seq}: hash не совпадает с пересчитанным`);
    prev = String(r.hash);
    head = { seq: Number(r.seq), hash: prev };
    const key = `${input.playerId}${KEY_SEP}${input.asset}`;
    sums.set(key, (sums.get(key) ?? 0) + input.delta);
  }

  const balances = new Map<string, number>();
  for (const b of snapshot.balances ?? []) {
    balances.set(`${String(b.player_id)}${KEY_SEP}${String(b.asset)}`, Number(b.amount));
  }
  for (const key of new Set([...sums.keys(), ...balances.keys()])) {
    const l = sums.get(key) ?? 0;
    const b = balances.get(key) ?? 0;
    if (l !== b) {
      const [player, asset] = key.split(KEY_SEP);
      problems.push(`${player}/${asset}: ledger ${l}, баланс ${b}`);
    }
  }

  return { ok: problems.length === 0, rows: rows.length, head, problems };
}
