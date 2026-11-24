import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { autoClaim, claim } from '../../src/world/modules/claim';
import { buySlot } from '../../src/world/modules/garage';
import { guildView } from '../../src/world/modules/guilds';
import {
  CALLSIGN_COOLDOWN_MS, callsignProblem, clearIdentity, labelFor, normalizeCallsign,
  ownIdentity, publicIdentity, setCallsign, setStyle, syncPremium,
} from '../../src/world/modules/identity';
import { createGuild, joinGuild } from '../../src/world/modules/guilds';
import { arenaLeaderboard } from '../../src/world/modules/minigame';
import { createPlayer } from '../../src/world/modules/players';
import { applyDelta, getBalance } from '../../src/world/balances';
import { RUN_MS } from '../../src/shared/minigame';
import { buildState } from '../../src/world/modules/state';
import { setLevel } from '../helpers/level';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 30 + 3_600_000;

function world(astra = 5000) {
  const w = makeWorld();
  w.tx(() => {
    createPlayer(w.sql, 'p1', T0);
    createPlayer(w.sql, 'p2', T0);
    applyDelta(w.sql, { playerId: 'p1', asset: 'astra', delta: astra, reason: 'seed' }, T0);
    applyDelta(w.sql, { playerId: 'p2', asset: 'astra', delta: astra, reason: 'seed' }, T0);
    // Раньше здесь был голый UPDATE level = 30 на всех: уровень теперь считается
    // из опыта, поэтому обоим ставим опыт (и журнал остаётся честным).
    setLevel(w.sql, 'p1', 30);
    setLevel(w.sql, 'p2', 30);
  });
  return w;
}

describe('позывной: проверка и уникальность', () => {
  it('нормализует пробелы и режет мусор', () => {
    expect(normalizeCallsign('  Астра   Ноль  ')).toBe('Астра Ноль');
    expect(callsignProblem('Астра Ноль')).toBe(null);
    expect(callsignProblem('аб')).toBe('bad_callsign');
    expect(callsignProblem('x'.repeat(17))).toBe('bad_callsign');
    expect(callsignProblem('звёздочка🌟')).toBe('bad_callsign');
    expect(callsignProblem('Астра-Ноль')).toBe(null);
    // Дефис первым символом — уже не имя, а пунктуация.
    expect(callsignProblem(' -Астра- ')).toBe('bad_callsign');
    expect(callsignProblem('Астра!')).toBe('bad_callsign');
  });

  it('чужой позывной занять нельзя, свой — можно переписать после паузы', () => {
    const { sql, tx } = world();
    tx(() => setCallsign(sql, 'p1', 'Астра', T0));
    expect(() => tx(() => setCallsign(sql, 'p2', 'астра', T0))).toThrow(/callsign_taken/);
    expect(() => tx(() => setCallsign(sql, 'p1', 'Астра', T0 + 1000))).toThrow(/callsign_cooldown/);
    const next = tx(() => setCallsign(sql, 'p1', 'Астра Ноль', T0 + CALLSIGN_COOLDOWN_MS));
    expect(next.callsign).toBe('Астра Ноль');
    expect(labelFor(sql, 'p1')).toBe('Астра Ноль');
  });

  it('без позывного остаётся автоматическая подпись', () => {
    const { sql } = world();
    expect(labelFor(sql, 'p1')).toMatch(/^Пилот/);
    expect(publicIdentity(sql, 'p1', T0).callsign).toBe(null);
  });
});

describe('косметика: сервер и видимость', () => {
  it('надеть некупленное нельзя, своё — можно', () => {
    const { sql, tx } = world();
    expect(() => tx(() => setStyle(sql, 'p1', { frame: 'nebula' }, { frames: [] }, T0))).toThrow(/style_not_owned/);
    tx(() => setStyle(sql, 'p1', { frame: 'nebula', trail: 'nebula' }, { frames: ['nebula'], trails: ['nebula'] }, T0));
    const own = ownIdentity(sql, 'p1', T0);
    expect(own.frame).toBe('nebula');
    expect(own.trail).toBe('nebula');

    tx(() => setStyle(sql, 'p1', { frame: null, trail: null }, { frames: ['nebula'] }, T0));
    expect(ownIdentity(sql, 'p1', T0).frame).toBe(null);
  });

  it('значок выдаётся только владельцу', () => {
    const { sql, tx } = world();
    expect(() => tx(() => setStyle(sql, 'p1', { badge: 'pioneer' }, { badges: [] }, T0))).toThrow(/style_not_owned/);
    tx(() => setStyle(sql, 'p1', { badge: 'pioneer' }, { badges: ['pioneer'] }, T0));
    expect(publicIdentity(sql, 'p1', T0).badge).toBe('pioneer');
  });

  it('Premium виден по сроку и истекает сам', () => {
    const { sql, tx } = world();
    tx(() => syncPremium(sql, 'p1', T0 + 5 * DAY_MS));
    expect(publicIdentity(sql, 'p1', T0).premium).toBe(true);
    expect(publicIdentity(sql, 'p1', T0 + 6 * DAY_MS).premium).toBe(false);
  });

  it('карточка профиля приходит в состоянии мира', () => {
    const { sql, tx } = world();
    tx(() => setCallsign(sql, 'p1', 'Комета', T0));
    tx(() => setStyle(sql, 'p1', { frame: 'ember' }, { frames: ['ember'] }, T0));
    const state = buildState(sql, 'p1', T0, false);
    expect(state.profile.callsign).toBe('Комета');
    expect(state.profile.label).toBe('Комета');
    expect(state.profile.frame).toBe('ember');
  });

  it('удаление аккаунта стирает личность', () => {
    const { sql, tx } = world();
    tx(() => setCallsign(sql, 'p1', 'Комета', T0));
    tx(() => clearIdentity(sql, 'p1'));
    expect(publicIdentity(sql, 'p1', T0).callsign).toBe(null);
  });
});

describe('имена и порядок видны другим', () => {
  it('лидерборд арены показывает позывной и рамку', () => {
    const { sql, tx } = world();
    tx(() => setCallsign(sql, 'p1', 'Комета', T0));
    tx(() => setStyle(sql, 'p1', { frame: 'nebula', trail: 'nebula' }, { frames: ['nebula'], trails: ['nebula'] }, T0));

    // Синтетический забег зависит от зерна трассы: записываем победу напрямую.
    sql.exec(
      `INSERT INTO minigame_runs (id, player_id, seed, started_at, ends_at, status, score, hits, picks, win, astra)
       VALUES ('board-win', 'p1', 1, ?, ?, 'finished', 180, 1, 19, 1, 150)`,
      T0, T0 + RUN_MS,
    );

    const board = arenaLeaderboard(sql, 'p1', T0 + RUN_MS);
    expect(board[0].label).toBe('Комета');
    expect(board[0].frame).toBe('nebula');
    expect(board[0].isMe).toBe(true);
  });

  it('в гильдии Premium поднимается выше по очкам, но лидер остаётся первым', () => {
    const { sql, tx } = world();
    tx(() => createGuild(sql, 'p1', 'guild-1', { name: 'Астра', tag: 'AST' }, T0));
    tx(() => joinGuild(sql, 'p2', 'join-1', guildCode(sql, 'p1'), T0 + 1));

    // p2 обгоняет по очкам, p1 остаётся лидером по роли.
    sql.exec(`UPDATE balances SET amount = 500 WHERE player_id = 'p2' AND asset = 'points'`);
    let view = guildView(sql, 'p2', T0 + 2);
    expect(view.members[0].playerId).toBe('p1');
    expect(view.members[1].playerId).toBe('p2');

    // Premium у p2 поднимает его выше обычного участника, но не выше лидера.
    tx(() => createPlayer(sql, 'p3', T0 + 3));
    tx(() => syncPremium(sql, 'p2', T0 + 30 * DAY_MS));
    view = guildView(sql, 'p1', T0 + 4);
    expect(view.members[0].playerId).toBe('p1');
    expect(view.members[1].premium).toBe(true);
  });
});

function guildCode(sql: SqlStorage, playerId: string): string {
  const row = sql.exec('SELECT invite_code FROM guilds WHERE leader_id = ?', playerId).toArray()[0];
  return String(row.invite_code);
}

describe('Premium: авто-клейм бонуса', () => {
  it('забирает готовый бонус и не начисляет дважды', () => {
    const { sql, tx } = world();
    // Первый claim руками, затем ждём интервал.
    tx(() => claim(sql, 'p1', 'claim-1', T0));
    const before = getBalance(sql, 'p1', 'astra');
    const early = tx(() => autoClaim(sql, 'p1', T0 + 60_000));
    expect(early).toBe(null);

    const later = tx(() => autoClaim(sql, 'p1', T0 + 3 * DAY_MS));
    expect(later?.ok).toBe(true);
    const after = getBalance(sql, 'p1', 'astra');
    expect(after).toBeGreaterThan(before);
    expect(tx(() => autoClaim(sql, 'p1', T0 + 3 * DAY_MS))?.ok ?? false).toBe(false);
  });
});

describe('аккаунт: экспорт и удаление описаны в клиенте', () => {
  const root = new URL('../../../', import.meta.url);
  const app = readFileSync(new URL('client/app.js', root), 'utf8');

  it('в интерфейсе есть экспорт, удаление и туториал', () => {
    expect(app).toContain('/account/export');
    expect(app).toContain("method: 'DELETE'");
    expect(app).toContain('astra:tutorial');
    expect(app).toContain('/profile/callsign');
    expect(app).toContain('/profile/style');
  });

  it('в клиенте нет хардкода админских секретов', () => {
    expect(app.includes('ADMIN_TOKEN=')).toBe(false);
    expect(app.includes('Sasha123sasha')).toBe(false);
  });
});
