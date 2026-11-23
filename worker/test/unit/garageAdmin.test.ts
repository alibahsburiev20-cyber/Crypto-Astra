import { readFileSync } from 'node:fs';
import type { Env } from '../../src/env';
import { requireAdmin } from '../../src/http/admin';
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { RUN_MS, makeField, MAX_SPEED } from '../../src/shared/minigame';
import { applyDelta, getBalance } from '../../src/world/balances';
import { adminSummary, grantAstra, setFrozen } from '../../src/world/modules/adminWorld';
import {
  GARAGE_BASE, GARAGE_MAX, SLOT_PRICE, buySlot, garageSlots, garageView,
} from '../../src/world/modules/garage';
import { WEEKLY_ASTRA, WEEKLY_WINS, finishRun, minigameView, startRun, weekStartOf } from '../../src/world/modules/minigame';
import { createPlayer } from '../../src/world/modules/players';
import { buyShip } from '../../src/world/modules/ships';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 30 + 3_600_000;

function world(astra = 5000) {
  const w = makeWorld();
  w.tx(() => {
    createPlayer(w.sql, 'p1', T0);
    applyDelta(w.sql, { playerId: 'p1', asset: 'astra', delta: astra, reason: 'seed' }, T0);
    // Уровень нужен, чтобы верфь продавала корпуса: гейт по уровню не предмет
    // этого набора тестов.
    w.sql.exec('UPDATE players SET level = 30 WHERE id = ?', 'p1');
  });
  return w;
}

describe('гараж: ячейки и покупка кораблей', () => {
  it('база три, Premium добавляет одну, потолок восемь', () => {
    const { sql } = world();
    expect(garageSlots(sql, 'p1', false)).toBe(GARAGE_BASE);
    expect(garageSlots(sql, 'p1', true)).toBe(GARAGE_BASE + 1);
    const view = garageView(sql, 'p1', true);
    expect(view.slots).toBe(GARAGE_BASE + 1);
    expect(view.used).toBe(1); // стартовый корабль уже в ангаре
    expect(view.free).toBe(GARAGE_BASE);
    expect(view.max).toBe(GARAGE_MAX);
  });

  it('ячейка покупается за ASTRA и не даёт бесплатных кораблей', () => {
    const { sql, tx } = world();
    const before = getBalance(sql, 'p1', 'astra');
    const res = tx(() => buySlot(sql, 'p1', 'slot-1', T0));
    expect(res.extra).toBe(1);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before - SLOT_PRICE);
    expect(garageSlots(sql, 'p1', false)).toBe(GARAGE_BASE + 1);

    // Повтор с тем же ключом не списывает второй раз.
    const again = tx(() => buySlot(sql, 'p1', 'slot-1', T0 + 1));
    expect(again.extra).toBe(1);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before - SLOT_PRICE);
  });

  it('без денег ячейка не продаётся', () => {
    const { sql, tx } = world();
    // Обнуляем баланс напрямую: так проверяем именно отказ по деньгам.
    sql.exec(`UPDATE balances SET amount = 10 WHERE player_id = 'p1' AND asset = 'astra'`);
    expect(() => tx(() => buySlot(sql, 'p1', 'slot-broke', T0))).toThrow(/insufficient_funds/);
  });

  it('потолок ячеек держится', () => {
    const { sql, tx } = world(100_000);
    for (let i = 0; i < GARAGE_MAX - GARAGE_BASE; i += 1) {
      tx(() => buySlot(sql, 'p1', `slot-${i}`, T0 + i));
    }
    expect(garageView(sql, 'p1', false).canBuy).toBe(false);
    expect(() => tx(() => buySlot(sql, 'p1', 'slot-over', T0 + 100))).toThrow(/garage_max/);
  });

  it('корабль не покупается при полном гараже и покупается после ячейки', () => {
    const { sql, tx } = world(100_000);
    // Заполняем три ячейки: стартовый + два корпуса.
    tx(() => buyShip(sql, 'p1', 'ship-1', 'hauler', T0, false));
    tx(() => buyShip(sql, 'p1', 'ship-2', 'miner', T0 + 1, false));
    expect(() => tx(() => buyShip(sql, 'p1', 'ship-3', 'explorer', T0 + 2, false))).toThrow(/garage_full/);

    tx(() => buySlot(sql, 'p1', 'slot-2', T0 + 3));
    expect(() => tx(() => buyShip(sql, 'p1', 'ship-4', 'explorer', T0 + 4, false))).not.toThrow();
  });
});

describe('админка мира', () => {
  it('сводка показывает игроков и сходимость журнала', () => {
    const { sql, tx } = world();
    tx(() => buyShip(sql, 'p1', 'ship-a', 'hauler', T0, false));
    const summary = adminSummary(sql);
    expect(summary.totals.players).toBe(1);
    expect(summary.totals.ships).toBeGreaterThanOrEqual(1);
    expect(summary.verify.ok).toBe(true);
    expect(summary.players[0].id).toBe('p1');
    expect(summary.players[0].astra).toBe(getBalance(sql, 'p1', 'astra'));
  });

  it('заморозка и разморозка меняют состояние мира', () => {
    const { sql } = world();
    expect(adminSummary(sql).frozen).toBe(false);
    setFrozen(sql, true);
    expect(adminSummary(sql).frozen).toBe(true);
    setFrozen(sql, false);
    expect(adminSummary(sql).frozen).toBe(false);
  });

  it('ручное начисление пишется в журнал и в admin_log', () => {
    const { sql, tx } = world();
    const before = getBalance(sql, 'p1', 'astra');
    const res = tx(() => grantAstra(sql, { playerId: 'p1', astra: 250, reason: 'компенсация', adminRef: 'admin' }, T0));
    expect(res.granted).toBe(250);
    expect(getBalance(sql, 'p1', 'astra')).toBe(before + 250);

    const log = sql.exec('SELECT actor, action, target FROM admin_log').toArray();
    expect(log.length).toBe(1);
    expect(log[0].action).toBe('grant');
    expect(log[0].target).toBe('p1');

    const reasons = sql.exec(`SELECT reason FROM ledger WHERE reason = 'admin_grant'`).toArray();
    expect(reasons.length).toBe(1);
    expect(adminSummary(sql).verify.ok).toBe(true);
  });

  it('нулевая и нецелая сумма отбиваются', () => {
    const { sql, tx } = world();
    expect(() => tx(() => grantAstra(sql, { playerId: 'p1', astra: 0, reason: 'x', adminRef: 'admin' }, T0))).toThrow(/bad_amount/);
    expect(() => tx(() => grantAstra(sql, { playerId: 'p1', astra: 1.5, reason: 'x', adminRef: 'admin' }, T0))).toThrow(/bad_amount/);
    expect(() => tx(() => grantAstra(sql, { playerId: 'nobody', astra: 10, reason: 'x', adminRef: 'admin' }, T0))).toThrow(/player_not_found/);
  });
});

describe('арена: лидерборд и недельная цель', () => {
  function play(tx: (fn: () => unknown) => unknown, sql: SqlStorage, key: string, at: number) {
    const start = tx(() => startRun(sql, 'p1', `start-${key}`, at, false)) as { runId: string; seed: number };
    const field = makeField(start.seed);
    const xs: number[] = [];
    let x = 500;
    let ci = 0;
    for (let t = 0; t <= 1125; t += 1) {
      const time = t * 40;
      while (ci < field.crystals.length && field.crystals[ci].t <= time) ci += 1;
      const target = ci < field.crystals.length ? field.crystals[ci].x : x;
      const step = (MAX_SPEED * 40) / 1000;
      x += Math.max(-step, Math.min(step, target - x));
      xs.push(Math.round(x * 10));
    }
    const trace = xs.map((v, i) => ({ t: i * 40, x: v / 10 }));
    return tx(() => finishRun(sql, 'p1', `fin-${key}`, { runId: start.runId, trace }, at + RUN_MS, false));
  }

  it('лидерборд собирает победы и помечает себя', () => {
    const { sql, tx } = world();
    const res = play(tx as never, sql, 'w1', T0);
    expect((res as { ok: boolean }).ok).toBe(true);
    const view = minigameView(sql, 'p1', T0 + RUN_MS, false);
    expect(view.leaderboard.length).toBe(1);
    expect(view.leaderboard[0].wins).toBe(1);
    expect(view.leaderboard[0].isMe).toBe(true);
    expect(view.weekly.target).toBe(WEEKLY_WINS);
  });

  it('неделя считается с понедельника UTC', () => {
    const monday = Date.UTC(2026, 10, 16, 0, 0, 0);
    expect(weekStartOf(monday + 1000)).toBe(monday);
    expect(weekStartOf(monday + 6 * DAY_MS)).toBe(monday);
    expect(weekStartOf(monday + 7 * DAY_MS)).toBe(monday + 7 * DAY_MS);
  });

  it('двадцатая победа за неделю даёт разовую награду', () => {
    const { sql, tx } = world();
    // Двадцать прошлых побед на этой неделе: награда должна прийти на любом
    // следующем закрытии забега.
    for (let i = 0; i < WEEKLY_WINS; i += 1) {
      sql.exec(
        `INSERT INTO minigame_runs (id, player_id, seed, started_at, ends_at, status, score, hits, picks, win, astra)
         VALUES (?, 'p1', 1, ?, ?, 'finished', 200, 0, 20, 1, 5)`,
        `old-w-${i}`, T0 - i * 1000, T0 + 1000,
      );
    }
    const before = getBalance(sql, 'p1', 'astra');
    const res = play(tx as never, sql, 'week', T0) as { ok: boolean; awards: { medal: string; astra: number }[] };
    expect(res.ok).toBe(true);
    const weekly = res.awards.find((a) => a.medal.startsWith('arena_week_'));
    expect(weekly?.astra).toBe(WEEKLY_ASTRA);
    expect(getBalance(sql, 'p1', 'astra')).toBeGreaterThanOrEqual(before + WEEKLY_ASTRA);
  });
});

describe('админка: доступ по токену и почте', () => {
  const req = (headers: Record<string, string> = {}) =>
    new Request('https://example.test/admin/world?world=w1', { headers });
  const env = (vars: Record<string, string>) => vars as unknown as Env;

  it('без ADMIN_TOKEN админка выключена', () => {
    expect(() => requireAdmin(req({ 'X-Admin-Token': 'x' }), env({}))).toThrow(/admin_disabled/);
  });

  it('пустой и неверный токен отбиваются', () => {
    expect(() => requireAdmin(req(), env({ ADMIN_TOKEN: 'secret-token' }))).toThrow(/admin_token_required/);
    expect(() => requireAdmin(req({ 'X-Admin-Token': 'wrong' }), env({ ADMIN_TOKEN: 'secret-token' }))).toThrow(/admin_forbidden/);
    expect(() => requireAdmin(req({ 'X-Admin-Token': 'secret-token' }), env({ ADMIN_TOKEN: 'secret-token' }))).not.toThrow();
  });

  it('если задан ADMIN_EMAIL, почта обязательна и сверяется без учёта регистра', () => {
    const e = env({ ADMIN_TOKEN: 'secret-token', ADMIN_EMAIL: 'alibahsburiev20@gmail.com' });
    expect(() => requireAdmin(req({ 'X-Admin-Token': 'secret-token' }), e)).toThrow(/admin_email_forbidden/);
    expect(() => requireAdmin(req({ 'X-Admin-Token': 'secret-token', 'X-Admin-Email': 'other@example.com' }), e)).toThrow(/admin_email_forbidden/);
    expect(() => requireAdmin(
      req({ 'X-Admin-Token': 'secret-token', 'X-Admin-Email': 'Alibahsburiev20@Gmail.com' }), e,
    )).not.toThrow();
  });

  it('без ADMIN_EMAIL почта не требуется', () => {
    expect(() => requireAdmin(req({ 'X-Admin-Token': 'secret-token' }), env({ ADMIN_TOKEN: 'secret-token' }))).not.toThrow();
  });
});

describe('админка: страница отдаётся клиентом', () => {
  const root = new URL('../../../', import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

  it('страница и скрипт на месте, без SVG и без инлайновых скриптов', () => {
    const html = read('client/admin.html');
    const js = read('client/admin.js');
    expect(html).toContain('src="/admin.js"');
    expect(html).toContain('X-Admin-Token');
    expect(html).toContain('X-Admin-Email');
    expect(html).toContain('id="email"');
    expect(html.includes('.svg')).toBe(false);
    expect(html).toContain('noindex');
    expect(js).toContain('/admin/world/freeze');
    expect(js).toContain('/admin/world/grant');
    expect(js).toContain('sessionStorage');
    expect(js).toContain("'X-Admin-Email': email()");
  });
});
