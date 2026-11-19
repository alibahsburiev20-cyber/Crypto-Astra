import {
  GUILD_CREATE_COST, GUILD_MAX_MEMBERS, GUILD_NAME_MAX, GUILD_NAME_MIN, GUILD_TAG_MAX,
} from '../../shared/constants';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { assertPlayable } from './maintenance';
import { ratingLabel } from './season';

// Гильдии (этап 4). Гильдия — социальный круг, а не множитель дохода: её рейтинг
// это сумма очков участников. Никаких бонусов к добыче нет, иначе гильдейские
// «паровозы» ломают экономику и сезонный рейтинг.

export type GuildRole = 'leader' | 'officer' | 'member';

interface GuildRow {
  id: string;
  name: string;
  tag: string;
  leaderId: string;
  inviteCode: string;
  createdAt: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

function rowToGuild(row: Record<string, unknown>): GuildRow {
  return {
    id: String(row.id),
    name: String(row.name),
    tag: String(row.tag),
    leaderId: String(row.leader_id),
    inviteCode: String(row.invite_code),
    createdAt: Number(row.created_at),
  };
}

export function guildOf(sql: SqlStorage, playerId: string): GuildRow | null {
  const rows = sql.exec(
    `SELECT g.* FROM guilds g JOIN guild_members m ON m.guild_id = g.id WHERE m.player_id = ?`,
    playerId,
  ).toArray();
  return rows.length ? rowToGuild(rows[0]) : null;
}

export function roleOf(sql: SqlStorage, playerId: string): GuildRole | null {
  const rows = sql.exec('SELECT role FROM guild_members WHERE player_id = ?', playerId).toArray();
  return rows.length ? (String(rows[0].role) as GuildRole) : null;
}

function normalizedName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < GUILD_NAME_MIN || name.length > GUILD_NAME_MAX) throw new ApiError(400, 'bad_guild_name');
  return name;
}

function normalizedTag(raw: string): string {
  const tag = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,5}$/.test(tag) || tag.length > GUILD_TAG_MAX) throw new ApiError(400, 'bad_guild_tag');
  return tag;
}

export interface GuildMemberView {
  playerId: string;
  label: string;
  role: GuildRole;
  points: number;
  level: number;
  isMe: boolean;
}

function membersOf(sql: SqlStorage, guildId: string, me: string): GuildMemberView[] {
  return sql.exec(
    `SELECT m.player_id, m.role, p.level, COALESCE(b.amount, 0) AS points
       FROM guild_members m
       JOIN players p ON p.id = m.player_id
       LEFT JOIN balances b ON b.player_id = m.player_id AND b.asset = 'points'
      WHERE m.guild_id = ?
      ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
               points DESC, m.joined_at ASC`,
    guildId,
  ).toArray().map((r) => ({
    playerId: String(r.player_id),
    label: ratingLabel(String(r.player_id)),
    role: String(r.role) as GuildRole,
    points: Number(r.points),
    level: Number(r.level),
    isMe: String(r.player_id) === me,
  }));
}

function guildPoints(sql: SqlStorage, guildId: string): number {
  const rows = sql.exec(
    `SELECT COALESCE(SUM(b.amount), 0) AS s
       FROM guild_members m
       LEFT JOIN balances b ON b.player_id = m.player_id AND b.asset = 'points'
      WHERE m.guild_id = ?`,
    guildId,
  ).toArray();
  return rows.length ? Number(rows[0].s) : 0;
}

export interface GuildTopRow {
  rank: number;
  id: string;
  name: string;
  tag: string;
  points: number;
  members: number;
  isMine: boolean;
}

export function guildRating(sql: SqlStorage, me: string): GuildTopRow[] {
  const mine = guildOf(sql, me);
  return sql.exec(
    `SELECT g.id, g.name, g.tag,
            COALESCE(SUM(b.amount), 0) AS points,
            COUNT(m.player_id) AS members
       FROM guilds g
       LEFT JOIN guild_members m ON m.guild_id = g.id
       LEFT JOIN balances b ON b.player_id = m.player_id AND b.asset = 'points'
      GROUP BY g.id
      ORDER BY points DESC, members DESC, g.created_at ASC
      LIMIT 20`,
  ).toArray().map((r, i) => ({
    rank: i + 1,
    id: String(r.id),
    name: String(r.name),
    tag: String(r.tag),
    points: Number(r.points),
    members: Number(r.members),
    isMine: mine !== null && mine.id === String(r.id),
  }));
}

export function guildView(sql: SqlStorage, playerId: string) {
  const guild = guildOf(sql, playerId);
  const rating = guildRating(sql, playerId);
  if (!guild) {
    return {
      mine: null,
      role: null,
      members: [],
      top: rating,
      cost: GUILD_CREATE_COST,
      maxMembers: GUILD_MAX_MEMBERS,
      balance: getBalance(sql, playerId, 'astra'),
    };
  }
  const mineRow = rating.find((r) => r.id === guild.id) ?? null;
  return {
    mine: { id: guild.id, name: guild.name, tag: guild.tag, inviteCode: guild.inviteCode, points: guildPoints(sql, guild.id) },
    role: roleOf(sql, playerId),
    members: membersOf(sql, guild.id, playerId),
    top: rating,
    rank: mineRow?.rank ?? null,
    cost: GUILD_CREATE_COST,
    maxMembers: GUILD_MAX_MEMBERS,
    balance: getBalance(sql, playerId, 'astra'),
  };
}

export interface CreateGuildResult {
  guild: { id: string; name: string; tag: string; inviteCode: string };
  balance: number;
}

export function createGuild(
  sql: SqlStorage, playerId: string, idemKey: string, body: { name: string; tag: string }, now: number,
): CreateGuildResult {
  return withIdempotency(sql, playerId, 'guild:create', idemKey, body, now, () => {
    assertPlayable(sql);
    if (guildOf(sql, playerId)) throw new ApiError(409, 'already_in_guild');
    const name = normalizedName(body.name ?? '');
    const tag = normalizedTag(body.tag ?? '');
    const clash = sql.exec('SELECT 1 FROM guilds WHERE lower(name) = lower(?)', name).toArray().length > 0;
    if (clash) throw new ApiError(409, 'guild_name_taken');
    if (getBalance(sql, playerId, 'astra') < GUILD_CREATE_COST) throw new ApiError(409, 'insufficient_funds');
    // Плата — сток: ASTRA уходят из экономики, а не переходят другому игроку.
    applyDelta(sql, { playerId, asset: 'astra', delta: -GUILD_CREATE_COST, reason: 'guild_create', sourceRef: 'guild' }, now);
    const id = crypto.randomUUID();
    let code = randomCode(6);
    while (sql.exec('SELECT 1 FROM guilds WHERE invite_code = ?', code).toArray().length > 0) code = randomCode(6);
    sql.exec(
      'INSERT INTO guilds (id, name, tag, leader_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, name, tag, playerId, code, now,
    );
    sql.exec(`INSERT INTO guild_members (player_id, guild_id, role, joined_at) VALUES (?, ?, 'leader', ?)`, playerId, id, now);
    sql.exec('UPDATE players SET guild_id = ? WHERE id = ?', id, playerId);
    return {
      value: { guild: { id, name, tag, inviteCode: code }, balance: getBalance(sql, playerId, 'astra') },
      store: true,
    };
  });
}

export function joinGuild(sql: SqlStorage, playerId: string, idemKey: string, code: string, now: number): { guild: { id: string; name: string; tag: string } } {
  return withIdempotency(sql, playerId, 'guild:join', idemKey, { code }, now, () => {
    assertPlayable(sql);
    if (guildOf(sql, playerId)) throw new ApiError(409, 'already_in_guild');
    const clean = String(code ?? '').trim().toUpperCase();
    const rows = sql.exec('SELECT * FROM guilds WHERE invite_code = ?', clean).toArray();
    if (!rows.length) throw new ApiError(404, 'guild_not_found');
    const guild = rowToGuild(rows[0]);
    const count = Number(sql.exec('SELECT COUNT(*) AS c FROM guild_members WHERE guild_id = ?', guild.id).toArray()[0].c);
    if (count >= GUILD_MAX_MEMBERS) throw new ApiError(409, 'guild_full');
    sql.exec(`INSERT INTO guild_members (player_id, guild_id, role, joined_at) VALUES (?, ?, 'member', ?)`, playerId, guild.id, now);
    sql.exec('UPDATE players SET guild_id = ? WHERE id = ?', guild.id, playerId);
    return { value: { guild: { id: guild.id, name: guild.name, tag: guild.tag } }, store: true };
  });
}

function leaveInternal(sql: SqlStorage, playerId: string, now: number): void {
  const guild = guildOf(sql, playerId);
  if (!guild) throw new ApiError(409, 'not_in_guild');
  const role = roleOf(sql, playerId);
  sql.exec('DELETE FROM guild_members WHERE player_id = ?', playerId);
  sql.exec('UPDATE players SET guild_id = NULL WHERE id = ?', playerId);
  const rest = sql.exec(
    `SELECT player_id FROM guild_members WHERE guild_id = ? ORDER BY joined_at ASC, player_id ASC`,
    guild.id,
  ).toArray().map((r) => String(r.player_id));
  if (!rest.length) {
    // Ушёл последний — гильдии больше нет, чтобы не висели пустые строки в рейтинге.
    sql.exec('DELETE FROM guilds WHERE id = ?', guild.id);
    return;
  }
  if (role === 'leader') {
    // Лидер ушёл — гильдия не остаётся без лидера: передаём старейшему участнику.
    const heir = rest[0];
    sql.exec(`UPDATE guild_members SET role = 'leader' WHERE player_id = ?`, heir);
    sql.exec('UPDATE guilds SET leader_id = ? WHERE id = ?', heir, guild.id);
  }
  void now;
}

export function leaveGuild(sql: SqlStorage, playerId: string, idemKey: string, now: number): { left: true } {
  return withIdempotency(sql, playerId, 'guild:leave', idemKey, {}, now, () => {
    assertPlayable(sql);
    leaveInternal(sql, playerId, now);
    return { value: { left: true as const }, store: true };
  });
}

export function kickMember(sql: SqlStorage, playerId: string, idemKey: string, target: string, now: number): { kicked: string } {
  return withIdempotency(sql, playerId, 'guild:kick', idemKey, { target }, now, () => {
    assertPlayable(sql);
    const guild = guildOf(sql, playerId);
    if (!guild) throw new ApiError(409, 'not_in_guild');
    const myRole = roleOf(sql, playerId);
    if (myRole !== 'leader' && myRole !== 'officer') throw new ApiError(403, 'not_allowed');
    if (target === playerId) throw new ApiError(400, 'bad_target');
    const targetRole = roleOf(sql, target);
    if (!targetRole || guildOf(sql, target)?.id !== guild.id) throw new ApiError(404, 'guild_member_not_found');
    if (targetRole === 'leader') throw new ApiError(403, 'not_allowed');
    if (myRole === 'officer' && targetRole === 'officer') throw new ApiError(403, 'not_allowed');
    leaveInternal(sql, target, now);
    return { value: { kicked: target }, store: true };
  });
}

const ROLES: GuildRole[] = ['leader', 'officer', 'member'];

export function setRole(
  sql: SqlStorage, playerId: string, idemKey: string, body: { target: string; role: string }, now: number,
): { target: string; role: GuildRole } {
  return withIdempotency(sql, playerId, 'guild:role', idemKey, body, now, () => {
    assertPlayable(sql);
    const guild = guildOf(sql, playerId);
    if (!guild) throw new ApiError(409, 'not_in_guild');
    if (roleOf(sql, playerId) !== 'leader') throw new ApiError(403, 'not_allowed');
    const role = String(body.role ?? '') as GuildRole;
    if (!ROLES.includes(role)) throw new ApiError(400, 'bad_role');
    if (role === 'leader') throw new ApiError(400, 'bad_role');
    if (body.target === playerId) throw new ApiError(400, 'bad_target');
    if (!roleOf(sql, body.target) || guildOf(sql, body.target)?.id !== guild.id) throw new ApiError(404, 'guild_member_not_found');
    sql.exec('UPDATE guild_members SET role = ? WHERE player_id = ?', role, body.target);
    return { value: { target: body.target, role }, store: true };
  });
}

export function renameGuild(sql: SqlStorage, playerId: string, idemKey: string, body: { name: string; tag: string }, now: number): { name: string; tag: string } {
  return withIdempotency(sql, playerId, 'guild:rename', idemKey, body, now, () => {
    assertPlayable(sql);
    const guild = guildOf(sql, playerId);
    if (!guild) throw new ApiError(409, 'not_in_guild');
    if (roleOf(sql, playerId) !== 'leader') throw new ApiError(403, 'not_allowed');
    const name = normalizedName(body.name ?? guild.name);
    const tag = normalizedTag(body.tag ?? guild.tag);
    const clash = sql.exec('SELECT 1 FROM guilds WHERE lower(name) = lower(?) AND id <> ?', name, guild.id).toArray().length > 0;
    if (clash) throw new ApiError(409, 'guild_name_taken');
    sql.exec('UPDATE guilds SET name = ?, tag = ? WHERE id = ?', name, tag, guild.id);
    return { value: { name, tag }, store: true };
  });
}
