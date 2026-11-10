import { ApiError } from './errors';
import { appendLedger, type Asset, type LedgerInput } from './ledger';

export function getBalance(sql: SqlStorage, playerId: string, asset: Asset): number {
  const r = sql.exec('SELECT amount FROM balances WHERE player_id = ? AND asset = ?', playerId, asset).toArray();
  return r.length ? Number(r[0].amount) : 0;
}

// Изменение баланса и запись в ledger — одна операция. Вызывать только внутри транзакции.
export function applyDelta(sql: SqlStorage, input: LedgerInput, now: number): number {
  const next = getBalance(sql, input.playerId, input.asset) + input.delta;
  if (next < 0) throw new ApiError(409, 'insufficient_funds');
  sql.exec(
    `INSERT INTO balances (player_id, asset, amount, version) VALUES (?, ?, ?, 1)
     ON CONFLICT (player_id, asset) DO UPDATE SET amount = excluded.amount, version = version + 1`,
    input.playerId, input.asset, next,
  );
  appendLedger(sql, input, now);
  return next;
}
