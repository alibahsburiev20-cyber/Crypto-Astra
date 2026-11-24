import { applyDelta } from '../balances';
import { ApiError } from '../errors';
import { verifyLedger } from '../ledger';
import { isFrozen, verifyStatus } from './maintenance';
import { playerExists } from './players';
import { publicIdentity } from './identity';

// Админка мира (этап 15). Три операции, без которых оператор беспомощен:
//   • увидеть состояние мира (игроки, баланс, сверка, заморозка);
//   • заморозить/разморозить мир, если журнал разошёлся;
//   • начислить ASTRA вручную — компенсация за баг, а не «подарок другу»:
//     каждая выдача пишется в журнал с reason=admin_grant и именем оператора.
//
// Доступ проверяется на маршруте (`requireAdmin`), сюда попадает только уже
// авторизованный вызов.

export interface AdminSummary {
  frozen: boolean;
  verify: { ok: boolean; rows: number; brokenAtSeq: number | null; mismatches: number };
  totals: { players: number; astra: number; points: number; ships: number; adventures: number };
  players: {
    id: string; label: string; level: number; xp: number; astra: number; points: number;
    ships: number; created_at: number;
  }[];
}
/** Таблицы, которые админский отчёт умеет считать. */
export type AdminTable = 'players' | 'ships' | 'expeditions';

const ADMIN_TABLES: readonly AdminTable[] = ['players', 'ships', 'expeditions'];

export function isCountableTable(name: string): name is AdminTable {
  return (ADMIN_TABLES as readonly string[]).includes(name);
}


export function adminSummary(sql: SqlStorage, limit = 50, now = Date.now()): AdminSummary {
  const players = sql.exec(
    `SELECT p.id AS id, p.level AS level, p.xp AS xp, p.created_at AS created_at,
            COALESCE((SELECT amount FROM balances WHERE player_id = p.id AND asset = 'astra'), 0) AS astra,
            COALESCE((SELECT amount FROM balances WHERE player_id = p.id AND asset = 'points'), 0) AS points,
            (SELECT COUNT(*) FROM ships WHERE player_id = p.id) AS ships
       FROM players p ORDER BY p.created_at DESC LIMIT ?`,
    limit,
  ).toArray().map((r) => ({
    id: String(r.id),
    label: publicIdentity(sql, String(r.id), now).label,
    level: Number(r.level),
    xp: Number(r.xp),
    astra: Number(r.astra),
    points: Number(r.points),
    ships: Number(r.ships),
    created_at: Number(r.created_at),
  }));

  const total = (asset: string): number => {
    const row = sql.exec('SELECT COALESCE(SUM(amount), 0) AS s FROM balances WHERE asset = ?', asset).toArray()[0];
    return row ? Number(row.s) : 0;
  };
  // Только перечислимые таблицы и только по имени из белого списка. Строка
  // запроса собирается подстановкой, поэтому любое имя «извне» здесь запрещено:
  // иначе админский отчёт стал бы точкой SQL-инъекции.
  const count = (table: AdminTable): number => {
    // До input здесь дойти не может, но проверка оставлена намеренно: функция
    // собирает SQL подстановкой, и следующая правка обязана споткнуться об
    // исключение, а не об молчаливую инъекцию.
    if (!isCountableTable(table)) throw new Error(`admin: table not countable: ${table}`);
    const row = sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0];
    return row ? Number(row.n) : 0;
  };
  const report = verifyLedger(sql);

  return {
    frozen: isFrozen(sql),
    verify: {
      ok: report.ok,
      rows: report.rows,
      brokenAtSeq: report.brokenAtSeq,
      mismatches: report.mismatches.length,
    },
    totals: {
      players: count('players'),
      astra: total('astra'),
      points: total('points'),
      ships: count('ships'),
      adventures: count('expeditions'),
    },
    players,
  };
}

export function setFrozen(sql: SqlStorage, frozen: boolean): { frozen: boolean } {
  sql.exec(
    `INSERT INTO meta (key, value) VALUES ('frozen', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    frozen ? '1' : '0',
  );
  return { frozen };
}

export interface GrantInput {
  playerId: string;
  astra: number;
  reason: string;
  adminRef: string;
}

export interface GrantResult {
  playerId: string;
  granted: number;
  astra: number;
  reason: string;
}

/**
 * Ручное начисление ASTRA. Ключ идемпотентности включает оператора, игрока,
 * сумму и причину: повтор того же запроса не начислит дважды, а исправленная
 * сумма — это уже новое действие.
 */
export function grantAstra(sql: SqlStorage, input: GrantInput, now: number): GrantResult {
  if (!playerExists(sql, input.playerId)) throw new ApiError(404, 'player_not_found');
  if (!Number.isInteger(input.astra) || input.astra === 0) throw new ApiError(400, 'bad_amount');
  if (Math.abs(input.astra) > 100_000) throw new ApiError(400, 'bad_amount');
  const reason = input.reason.trim().slice(0, 80) || 'manual';

  const astra = applyDelta(sql, {
    playerId: input.playerId,
    asset: 'astra',
    delta: input.astra,
    reason: 'admin_grant',
    sourceRef: reason,
    idemKey: `admin:${input.adminRef}:${input.playerId}:${input.astra}:${reason}:${now}`,
  }, now);

  sql.exec(
    `INSERT INTO admin_log (id, actor, action, target, payload, created_at)
     VALUES (?, ?, 'grant', ?, ?, ?)`,
    crypto.randomUUID(), input.adminRef, input.playerId, JSON.stringify({ astra: input.astra, reason }), now,
  );

  return { playerId: input.playerId, granted: input.astra, astra, reason };
}

/** Состояние сверки — отдельная короткая ручка для дежурного. */
export function verifyInfo(sql: SqlStorage, now: number) {
  return verifyStatus(sql, now);
}
