import { describe, expect, it } from 'vitest';
import { DAY_MS, GUILD_CREATE_COST, GUILD_MAX_MEMBERS, PASS_THRESHOLDS, REFERRAL_LIMIT, REFERRAL_REWARD } from '../../src/shared/constants';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { createPlayer } from '../../src/world/modules/players';
import {
  createGuild, guildOf, guildRating, guildView, joinGuild, kickMember, leaveGuild, renameGuild, roleOf, setRole,
} from '../../src/world/modules/guilds';
import {
  applyReferral, completedExpeditions, ensureCode, qualifyReferral, referralView,
} from '../../src/world/modules/referrals';
import { levelForPoints } from '../../src/world/modules/pass';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

type World = ReturnType<typeof makeWorld>;

function world(players: string[] = ['p1', 'p2', 'p3']): World {
  const w = makeWorld();
  for (const id of players) w.tx(() => createPlayer(w.sql, id, T0));
  return w;
}

function points(w: World, playerId: string, amount: number) {
  w.tx(() => applyDelta(w.sql, { playerId, asset: 'points', delta: amount, reason: 'expedition_reward', sourceRef: 'exp' }, T0 + 500));
}

/** Завершённый рейс: миссии и рефералы считают именно такие строки. */
function finishExpeditions(w: World, playerId: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    w.sql.exec(
      `INSERT INTO expeditions (id, player_id, ship_id, planet, kind, status, seed, started_at, ends_at, fuel_spent, created_at)
       VALUES (?, ?, 'ship-1', 'ferrum', 'short', 'completed', 'seed', ?, ?, 1, ?)`,
      `exp-${playerId}-${crypto.randomUUID()}`, playerId, T0, T0 + 1000 + i, T0,
    );
  }
}

describe('гильдии (этап 4)', () => {
  it('создание списывает 500 ASTRA и делает игрока лидером', () => {
    const w = world();
    const before = getBalance(w.sql, 'p1', 'astra');
    const res = w.tx(() => createGuild(w.sql, 'p1', 'g1', { name: 'Звёздный патруль', tag: 'ZP' }, T0 + 1000));

    expect(getBalance(w.sql, 'p1', 'astra')).toBe(before - GUILD_CREATE_COST);
    expect(res.guild.inviteCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(roleOf(w.sql, 'p1')).toBe('leader');
    expect(guildOf(w.sql, 'p1')?.name).toBe('Звёздный патруль');
    expect(String(w.sql.exec('SELECT guild_id FROM players WHERE id = ?', 'p1').toArray()[0].guild_id)).toBe(res.guild.id);
    // Плата — сток, а не перевод: журнал цел и сходится.
    expect(verifyLedger(w.sql).ok).toBe(true);
    const reasons = w.sql.exec('SELECT reason FROM ledger').toArray().map((r) => String(r.reason));
    expect(reasons).toContain('guild_create');
  });

  it('второй гильдии у игрока быть не может', () => {
    const w = world();
    w.tx(() => createGuild(w.sql, 'p1', 'g1', { name: 'Первая', tag: 'ONE' }, T0 + 1000));
    expect(() => w.tx(() => createGuild(w.sql, 'p1', 'g2', { name: 'Вторая', tag: 'TWO' }, T0 + 2000)))
      .toThrowError(/already_in_guild/);
  });

  it('проверяет имя и тег', () => {
    const w = world();
    expect(() => w.tx(() => createGuild(w.sql, 'p1', 'g1', { name: 'ok', tag: 'OK' }, T0)))
      .toThrowError(/bad_guild_name/);
    expect(() => w.tx(() => createGuild(w.sql, 'p1', 'g2', { name: 'Нормальное имя', tag: 'too-long' }, T0)))
      .toThrowError(/bad_guild_tag/);
  });

  it('вступление по коду, лимит участников и запрет повторного входа', () => {
    const w = world();
    const created = w.tx(() => createGuild(w.sql, 'p1', 'g1', { name: 'Патруль', tag: 'PT' }, T0 + 1000));
    w.tx(() => joinGuild(w.sql, 'p2', 'j1', created.guild.inviteCode.toLowerCase(), T0 + 2000));
    expect(roleOf(w.sql, 'p2')).toBe('member');
    expect(() => w.tx(() => joinGuild(w.sql, 'p2', 'j2', created.guild.inviteCode, T0 + 3000)))
      .toThrowError(/already_in_guild/);
    expect(() => w.tx(() => joinGuild(w.sql, 'p3', 'j3', 'НЕТТАК', T0 + 3000)))
      .toThrowError(/guild_not_found/);

    // Забиваем гильдию до предела и проверяем отказ.
    for (let i = 0; i < GUILD_MAX_MEMBERS - 2; i += 1) {
      const id = `x${i}`;
      w.tx(() => createPlayer(w.sql, id, T0));
      w.tx(() => joinGuild(w.sql, id, `jx${i}`, created.guild.inviteCode, T0 + 4000 + i));
    }
    w.tx(() => createPlayer(w.sql, 'late', T0));
    expect(() => w.tx(() => joinGuild(w.sql, 'late', 'jl', created.guild.inviteCode, T0 + 9000)))
      .toThrowError(/guild_full/);
  });

  it('лидер уходит — гильдия переходит старейшему, последний участник распускает её', () => {
    const w = world();
    const created = w.tx(() => createGuild(w.sql, 'p1', 'g1', { name: 'Патруль', tag: 'PT' }, T0 + 1000));
    w.tx(() => joinGuild(w.sql, 'p2', 'j1', created.guild.inviteCode, T0 + 2000));
    w.tx(() => leaveGuild(w.sql, 'p1', 'l1', T0 + 3000));

    expect(guildOf(w.sql, 'p1')).toBeNull();
    expect(roleOf(w.sql, 'p2')).toBe('leader');
    expect(String(w.sql.exec('SELECT leader_id FROM guilds').toArray()[0].leader_id)).toBe('p2');

    w.tx(() => leaveGuild(w.sql, 'p2', 'l2', T0 + 4000));
    expect(w.sql.exec('SELECT COUNT(*) AS c FROM guilds').toArray()[0].c).toBe(0);
  });

  it('офицер не может снять офицера, лидер может снять любого', () => {
    const w = world();
    const created = w.tx(() => createGuild(w.sql, 'p1', 'g1', { name: 'Патруль', tag: 'PT' }, T0 + 1000));
    w.tx(() => joinGuild(w.sql, 'p2', 'j1', created.guild.inviteCode, T0 + 2000));
    w.tx(() => joinGuild(w.sql, 'p3', 'j2', created.guild.inviteCode, T0 + 3000));
    w.tx(() => setRole(w.sql, 'p1', 'r1', { target: 'p2', role: 'officer' }, T0 + 4000));
    w.tx(() => setRole(w.sql, 'p1', 'r2', { target: 'p3', role: 'officer' }, T0 + 5000));

    expect(() => w.tx(() => kickMember(w.sql, 'p2', 'k1', 'p3', T0 + 6000))).toThrowError(/not_allowed/);
    w.tx(() => kickMember(w.sql, 'p1', 'k2', 'p3', T0 + 7000));
    expect(guildOf(w.sql, 'p3')).toBeNull();
  });

  it('рейтинг гильдий — сумма очков участников, а не среднее', () => {
    const w = world();
    const a = w.tx(() => createGuild(w.sql, 'p1', 'g1', { name: 'Альфа', tag: 'AL' }, T0 + 1000));
    const b = w.tx(() => createGuild(w.sql, 'p2', 'g2', { name: 'Бета', tag: 'BE' }, T0 + 2000));
    w.tx(() => joinGuild(w.sql, 'p3', 'j1', b.guild.inviteCode, T0 + 3000));
    points(w, 'p1', 100);
    points(w, 'p2', 80);
    points(w, 'p3', 90);

    const rating = guildRating(w.sql, 'p1');
    expect(rating[0]).toMatchObject({ name: 'Бета', points: 170, members: 2, isMine: false });
    expect(rating[1]).toMatchObject({ name: 'Альфа', points: 100, members: 1, isMine: true });
    expect(guildView(w.sql, 'p1').rank).toBe(2);
    expect(a.guild.id).not.toBe(b.guild.id);
  });

  it('переименование доступно только лидеру', () => {
    const w = world();
    const created = w.tx(() => createGuild(w.sql, 'p1', 'g1', { name: 'Патруль', tag: 'PT' }, T0 + 1000));
    w.tx(() => joinGuild(w.sql, 'p2', 'j1', created.guild.inviteCode, T0 + 2000));
    expect(() => w.tx(() => renameGuild(w.sql, 'p2', 'rn1', { name: 'Чужая', tag: 'CH' }, T0 + 3000)))
      .toThrowError(/not_allowed/);
    w.tx(() => renameGuild(w.sql, 'p1', 'rn2', { name: 'Новый патруль', tag: 'NP' }, T0 + 4000));
    expect(guildOf(w.sql, 'p1')?.tag).toBe('NP');
  });
});

describe('рефералы (этап 4)', () => {
  it('код выдаётся при создании игрока и уникален', () => {
    const w = world(['p1', 'p2']);
    const c1 = ensureCode(w.sql, 'p1', T0);
    const c2 = ensureCode(w.sql, 'p2', T0);
    expect(c1).toMatch(/^[A-Z0-9]{7}$/);
    expect(c1).not.toBe(c2);
    // Повторный вызов возвращает тот же код, а не создаёт новый.
    expect(ensureCode(w.sql, 'p1', T0 + 1000)).toBe(c1);
  });

  it('свой код применить нельзя, второй раз — тоже', () => {
    const w = world(['p1', 'p2']);
    const c1 = ensureCode(w.sql, 'p1', T0);
    expect(() => w.tx(() => applyReferral(w.sql, 'p1', 'a1', c1, T0 + 1000))).toThrowError(/self_referral/);

    w.tx(() => createPlayer(w.sql, 'p3', T0));
    const c3 = ensureCode(w.sql, 'p3', T0);
    // p2 приглашён p3 — это допустимо; повторное применение уже нет.
    w.tx(() => applyReferral(w.sql, 'p2', 'a2', c3, T0 + 2000));
    const c1Again = ensureCode(w.sql, 'p1', T0);
    expect(() => w.tx(() => applyReferral(w.sql, 'p2', 'a3', c1Again, T0 + 3000)))
      .toThrowError(/referral_already_applied/);
  });

  it('награда обоим — только после пяти завершённых рейсов', () => {
    const w = world(['p1', 'p2']);
    const c1 = ensureCode(w.sql, 'p1', T0);
    w.tx(() => applyReferral(w.sql, 'p2', 'a1', c1, T0 + 1000));
    const before1 = getBalance(w.sql, 'p1', 'astra');
    const before2 = getBalance(w.sql, 'p2', 'astra');

    finishExpeditions(w, 'p2', 4);
    expect(w.tx(() => qualifyReferral(w.sql, 'p2', T0 + 2000))).toBe(false);
    expect(getBalance(w.sql, 'p1', 'astra')).toBe(before1);

    finishExpeditions(w, 'p2', 1);
    expect(completedExpeditions(w.sql, 'p2')).toBe(5);
    expect(w.tx(() => qualifyReferral(w.sql, 'p2', T0 + 3000))).toBe(true);
    expect(getBalance(w.sql, 'p2', 'astra')).toBe(before2 + REFERRAL_REWARD);
    expect(getBalance(w.sql, 'p1', 'astra')).toBe(before1 + REFERRAL_REWARD);
    // Повтор уже выданную награду не платит.
    expect(w.tx(() => qualifyReferral(w.sql, 'p2', T0 + 4000))).toBe(false);
    expect(verifyLedger(w.sql).ok).toBe(true);
  });

  it('у приглашающего не больше 20 рефералов', () => {
    const w = world(['p1']);
    const code = ensureCode(w.sql, 'p1', T0);
    for (let i = 0; i < REFERRAL_LIMIT; i += 1) {
      const id = `r${i}`;
      w.tx(() => createPlayer(w.sql, id, T0));
      w.tx(() => applyReferral(w.sql, id, `k${i}`, code, T0 + 1000 + i));
    }
    w.tx(() => createPlayer(w.sql, 'extra', T0));
    expect(() => w.tx(() => applyReferral(w.sql, 'extra', 'ke', code, T0 + 5000))).toThrowError(/referral_limit/);
    expect(referralView(w.sql, 'p1', T0 + 6000).invited).toHaveLength(REFERRAL_LIMIT);
  });
});

describe('Astra Pass и пороги (этап 4)', () => {
  it('уровни считаются по очкам сезона и не превышают десяти', () => {
    expect(levelForPoints(0)).toBe(0);
    expect(levelForPoints(PASS_THRESHOLDS[0] - 1)).toBe(0);
    expect(levelForPoints(PASS_THRESHOLDS[0])).toBe(1);
    expect(levelForPoints(10 ** 9)).toBe(10);
  });
});
