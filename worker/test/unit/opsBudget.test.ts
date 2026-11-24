// Бюджет запросов и режимы бережливости.
//
// Смысл теста: сервер должен уходить в деградацию ПРЕЖДЕ, чем Cloudflare
// отдаст ошибку 1027. И деградация не должна задевать то, без чего сайт нельзя
// ни открыть, ни оплатить.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_REQUEST_BUDGET as LIMIT, MODE_THRESHOLDS, consumeRequest, dailyBudget,
  flushUsage, isBlocked, modeForUsed, peekBudget, resetCounterForTests, resetOpsSchemaForTests,
  routeClass, secondsUntilReset, utcDay,
} from '../../src/ops/budget';
import { makeD1 } from '../helpers/d1';

const DAY = Date.UTC(2026, 10, 17, 12, 0, 0);

beforeEach(() => {
  resetCounterForTests();
  resetOpsSchemaForTests();
});

describe('режимы по доле бюджета', () => {
  it('границы режимов считаются от лимита', () => {
    expect(modeForUsed(0, LIMIT)).toBe('full');
    expect(modeForUsed(LIMIT * MODE_THRESHOLDS.thrifty - 1, LIMIT)).toBe('full');
    expect(modeForUsed(LIMIT * MODE_THRESHOLDS.thrifty, LIMIT)).toBe('thrifty');
    expect(modeForUsed(LIMIT * MODE_THRESHOLDS.lite, LIMIT)).toBe('lite');
    expect(modeForUsed(LIMIT * MODE_THRESHOLDS.sleep, LIMIT)).toBe('sleep');
    expect(modeForUsed(LIMIT * 2, LIMIT)).toBe('sleep');
  });

  it('кривое значение лимита не ломает расчёт', () => {
    expect(modeForUsed(-5, LIMIT)).toBe('full');
    expect(modeForUsed(50, 0)).toBe('full'); // 50 из 100 000 по умолчанию
  });

  it('бюджет из конфигурации: пусто или мусор — 100 000', () => {
    expect(dailyBudget(undefined)).toBe(LIMIT);
    expect(dailyBudget('')).toBe(LIMIT);
    expect(dailyBudget('0')).toBe(LIMIT);
    expect(dailyBudget('-1')).toBe(LIMIT);
    expect(dailyBudget('abc')).toBe(LIMIT);
    expect(dailyBudget('250000')).toBe(250_000);
  });
});

describe('что можно отключить', () => {
  it('деньги, вход, админка и статус — никогда', () => {
    for (const path of ['/health', '/ops/status', '/admin/pay', '/auth/login', '/pay/purchase']) {
      expect(routeClass(path)).toBe('critical');
      expect(isBlocked('sleep', 'critical')).toBe(false);
    }
  });

  it('витрины — первыми', () => {
    for (const path of ['/market', '/guild', '/season', '/social', '/ledger', '/pool.json', '/minigame']) {
      expect(routeClass(path)).toBe('heavy');
    }
    expect(isBlocked('full', 'heavy')).toBe(false);
    expect(isBlocked('thrifty', 'heavy')).toBe(false);
    expect(isBlocked('lite', 'heavy')).toBe(true);
  });

  it('игровые действия живут до sleep', () => {
    expect(routeClass('/me')).toBe('normal');
    expect(routeClass('/claim')).toBe('normal');
    expect(routeClass('/expeditions/start')).toBe('normal');
    expect(isBlocked('lite', 'normal')).toBe(false);
    expect(isBlocked('sleep', 'normal')).toBe(true);
  });

  it('thrifty ничего не блокирует — только экономит', () => {
    for (const klass of ['critical', 'heavy', 'normal'] as const) {
      expect(isBlocked('thrifty', klass)).toBe(false);
    }
  });
});

describe('сброс лимита', () => {
  it('UTC-день и ожидание до полуночи', () => {
    const at2359 = Date.UTC(2026, 10, 17, 23, 59, 0);
    expect(utcDay(at2359)).toBe('2026-11-17');
    expect(secondsUntilReset(at2359)).toBe(60);
    expect(secondsUntilReset(Date.UTC(2026, 10, 17, 0, 0, 0))).toBe(86_400);
    // Никогда не ноль: Retry-After: 0 означал бы «пробуй сразу», а лимит не сброшен.
    expect(secondsUntilReset(Date.UTC(2026, 10, 17, 23, 59, 59, 999))).toBe(1);
  });
});

describe('учёт запросов', () => {
  it('копит в памяти и сбрасывает пачкой в D1', async () => {
    const { db } = makeD1();
    const first = await consumeRequest(db, DAY, LIMIT);
    expect(first.used).toBe(1);
    expect(first.mode).toBe('full');

    for (let i = 0; i < 24; i += 1) await consumeRequest(db, DAY + i, LIMIT);

    // До сброса в D1 могло не дойти, но счётчик в памяти уже видит всё.
    const state = await peekBudget(db, DAY, LIMIT);
    expect(state.used).toBeGreaterThanOrEqual(25);

    await flushUsage(db, DAY);
    const row = await db.prepare('SELECT requests FROM ops_usage WHERE day = ?')
      .bind(utcDay(DAY)).first<number>('requests');
    expect(Number(row)).toBe(25);
  });

  it('сброс не удваивает уже записанное', async () => {
    const { db } = makeD1();
    for (let i = 0; i < 20; i += 1) await consumeRequest(db, DAY + i, LIMIT);
    await flushUsage(db, DAY);
    await flushUsage(db, DAY); // второй сброс подряд: накопленного нет
    const row = await db.prepare('SELECT requests FROM ops_usage WHERE day = ?')
      .bind(utcDay(DAY)).first<number>('requests');
    expect(Number(row)).toBe(20);
  });

  it('новый день начинается с нуля', async () => {
    const { db } = makeD1();
    for (let i = 0; i < 20; i += 1) await consumeRequest(db, DAY + i, LIMIT);
    await flushUsage(db, DAY);

    const nextDay = DAY + 86_400_000;
    const state = await consumeRequest(db, nextDay, LIMIT);
    expect(state.used).toBe(1);
    expect(state.day).toBe(utcDay(nextDay));
  });

  it('доходит до sleep и сообщает, сколько осталось', async () => {
    const { db } = makeD1();
    const limit = 10;
    let state = await consumeRequest(db, DAY, limit);
    for (let i = 0; i < 9; i += 1) state = await consumeRequest(db, DAY + i, limit);

    expect(state.used).toBe(10);
    expect(state.mode).toBe('sleep');
    expect(state.remaining).toBe(0);
  });

  it('сломанная база не мешает считать и не бросает', async () => {
    const broken = {
      prepare: () => { throw new Error('d1_down'); },
    } as unknown as D1Database;
    const state = await consumeRequest(broken, DAY, LIMIT);
    expect(state.mode).toBe('full');
    expect(state.used).toBe(0);
  });
});
