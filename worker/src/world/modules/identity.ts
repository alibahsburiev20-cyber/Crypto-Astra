import { ApiError } from '../errors';
import { ratingLabel } from './season';

// Личность игрока: позывной и косметика, которую видят другие (этап 17).
//
// Раньше позывной жил в localStorage браузера, а рамка и след рисовались только
// на своём экране. Здесь появляется серверная запись: её читают лидерборд,
// список гильдии, рейтинг сезона и админка. Клиент больше ничего не «сочиняет» —
// он показывает то, что вернул сервер.
//
// Косметика не даёт преимуществ: это только подпись и цвет.

export const CALLSIGN_MIN = 3;
export const CALLSIGN_MAX = 16;
/** Позывной можно менять не чаще раза в сутки: иначе рейтинг «мигает». */
export const CALLSIGN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type StyleValue = 'nebula' | 'ember' | 'premium';
export const STYLE_VALUES: StyleValue[] = ['nebula', 'ember', 'premium'];
export type BadgeValue = 'pioneer';

export interface PublicIdentity {
  label: string;
  callsign: string | null;
  frame: StyleValue | null;
  trail: StyleValue | null;
  badge: BadgeValue | null;
  premium: boolean;
}

export interface OwnIdentity extends PublicIdentity {
  callsignAt: number | null;
  nextCallsignAt: number | null;
}

interface IdentityRow {
  callsign: string | null;
  frame: string | null;
  trail: string | null;
  badge: string | null;
  premium_until: number | null;
  callsign_at: number | null;
}

const EMPTY: IdentityRow = {
  callsign: null, frame: null, trail: null, badge: null, premium_until: null, callsign_at: null,
};

// \p{L} — буквы любого алфавита: кириллица разрешена, эмодзи и значки — нет.
const CALLSIGN_BODY = /^[\p{L}\p{N}](?:[\p{L}\p{N} _-]*[\p{L}\p{N}])$/u;

export function normalizeCallsign(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/** Ключ уникальности: SQLite не умеет lower() для кириллицы, считаем в JS. */
export function callsignKey(raw: string): string {
  return normalizeCallsign(raw).toLowerCase();
}

export function callsignProblem(raw: string): string | null {
  const value = normalizeCallsign(raw);
  if (value.length < CALLSIGN_MIN) return 'bad_callsign';
  if (value.length > CALLSIGN_MAX) return 'bad_callsign';
  if (!CALLSIGN_BODY.test(value)) return 'bad_callsign';
  return null;
}

function rowOf(sql: SqlStorage, playerId: string): IdentityRow {
  const rows = sql.exec(
    'SELECT callsign, frame, trail, badge, premium_until, callsign_at FROM player_identity WHERE player_id = ?',
    playerId,
  ).toArray();
  if (!rows.length) return EMPTY;
  const r = rows[0];
  return {
    callsign: r.callsign == null ? null : String(r.callsign),
    frame: r.frame == null ? null : String(r.frame),
    trail: r.trail == null ? null : String(r.trail),
    badge: r.badge == null ? null : String(r.badge),
    premium_until: r.premium_until == null ? null : Number(r.premium_until),
    callsign_at: r.callsign_at == null ? null : Number(r.callsign_at),
  };
}

function ensureRow(sql: SqlStorage, playerId: string): void {
  sql.exec('INSERT OR IGNORE INTO player_identity (player_id) VALUES (?)', playerId);
}

function styleOrNull(value: string | null): StyleValue | null {
  return value && (STYLE_VALUES as string[]).includes(value) ? (value as StyleValue) : null;
}

function badgeOrNull(value: string | null): BadgeValue | null {
  return value === 'pioneer' ? 'pioneer' : null;
}

/** Что видно другим: подпись, рамка, след, значок. */
export function publicIdentity(sql: SqlStorage, playerId: string, now: number): PublicIdentity {
  const row = rowOf(sql, playerId);
  return {
    label: row.callsign ?? ratingLabel(playerId),
    callsign: row.callsign,
    frame: styleOrNull(row.frame),
    trail: styleOrNull(row.trail),
    badge: badgeOrNull(row.badge),
    premium: row.premium_until != null && row.premium_until > now,
  };
}

export function labelFor(sql: SqlStorage, playerId: string): string {
  return rowOf(sql, playerId).callsign ?? ratingLabel(playerId);
}

/** Своя карточка: публичная часть плюс подсказки про сроки. */
export function ownIdentity(sql: SqlStorage, playerId: string, now: number): OwnIdentity {
  const row = rowOf(sql, playerId);
  return {
    ...publicIdentity(sql, playerId, now),
    callsignAt: row.callsign_at,
    nextCallsignAt: row.callsign_at == null ? null : row.callsign_at + CALLSIGN_COOLDOWN_MS,
  };
}

/** Смена позывного. Уникальность — без учёта регистра, иначе «Астра» и «астра» дубли. */
export function setCallsign(
  sql: SqlStorage, playerId: string, raw: string, now: number,
): { callsign: string; nextChangeAt: number } {
  const problem = callsignProblem(raw);
  if (problem) throw new ApiError(400, problem);
  const value = normalizeCallsign(raw);

  const before = rowOf(sql, playerId);
  if (before.callsign_at != null && now - before.callsign_at < CALLSIGN_COOLDOWN_MS) {
    throw new ApiError(409, 'callsign_cooldown');
  }

  const key = callsignKey(value);
  const taken = sql.exec(
    'SELECT player_id FROM player_identity WHERE callsign_key = ? AND player_id <> ?',
    key, playerId,
  ).toArray();
  if (taken.length) throw new ApiError(409, 'callsign_taken');

  ensureRow(sql, playerId);
  sql.exec(
    'UPDATE player_identity SET callsign = ?, callsign_key = ?, callsign_at = ? WHERE player_id = ?',
    value, key, now, playerId,
  );
  return { callsign: value, nextChangeAt: now + CALLSIGN_COOLDOWN_MS };
}

export interface StyleAllowance {
  frames?: StyleValue[];
  trails?: StyleValue[];
  badges?: BadgeValue[];
}

/**
 * Выбор косметики. Разрешены только купленные варианты: список приходит из D1
 * (там лежат покупки), мир его не выдумывает.
 */
export function setStyle(
  sql: SqlStorage, playerId: string, patch: { frame?: string | null; trail?: string | null; badge?: string | null },
  allowance: StyleAllowance, now: number,
): PublicIdentity {
  const next: { frame?: string | null; trail?: string | null; badge?: string | null } = {};
  if ('frame' in patch) {
    const value = patch.frame == null || patch.frame === '' ? null : String(patch.frame);
    if (value !== null && !(allowance.frames ?? []).includes(value as StyleValue)) throw new ApiError(403, 'style_not_owned');
    next.frame = value;
  }
  if ('trail' in patch) {
    const value = patch.trail == null || patch.trail === '' ? null : String(patch.trail);
    if (value !== null && !(allowance.trails ?? []).includes(value as StyleValue)) throw new ApiError(403, 'style_not_owned');
    next.trail = value;
  }
  if ('badge' in patch) {
    const value = patch.badge == null || patch.badge === '' ? null : String(patch.badge);
    if (value !== null && !(allowance.badges ?? []).includes(value as BadgeValue)) throw new ApiError(403, 'style_not_owned');
    next.badge = value;
  }

  ensureRow(sql, playerId);
  if ('frame' in next) sql.exec('UPDATE player_identity SET frame = ? WHERE player_id = ?', next.frame, playerId);
  if ('trail' in next) sql.exec('UPDATE player_identity SET trail = ? WHERE player_id = ?', next.trail, playerId);
  if ('badge' in next) sql.exec('UPDATE player_identity SET badge = ? WHERE player_id = ?', next.badge, playerId);
  return publicIdentity(sql, playerId, now);
}

/** Срок Premium дублируется в мир: по нему сортируется гильдия и рисуется значок. */
export function syncPremium(sql: SqlStorage, playerId: string, until: number | null): void {
  ensureRow(sql, playerId);
  sql.exec('UPDATE player_identity SET premium_until = ? WHERE player_id = ?', until, playerId);
}

/** Удаление аккаунта: подпись и косметика стираются, история журнала остаётся. */
export function clearIdentity(sql: SqlStorage, playerId: string): void {
  sql.exec('DELETE FROM player_identity WHERE player_id = ?', playerId);
}
