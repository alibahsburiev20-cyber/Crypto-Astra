// Сон мира: когда объект будить, а когда дать ему спать.
//
// Смысл теста: бесплатный план даёт 13 000 GB-секунд Durable Objects в сутки на
// всё. Каждая лишняя побудка — потраченное время объекта, поэтому в тишине мир
// должен просыпаться только под задачи, которые видит игрок, а служебные
// (сверка журнала, уборка) отдавать часовому cron.
import { describe, expect, it } from 'vitest';
import { CRITICAL_KINDS, IDLE_AFTER_MS, decideWakeAt } from '../../src/world/scheduler';
import { VERIFY_INTERVAL_MS } from '../../src/world/modules/maintenance';

const NOW = 1_700_000_000_000;

describe('когда будить мир', () => {
  it('игрок был только что — будим под ближайшую задачу, любую', () => {
    const critical = NOW + 60_000;
    const maintenance = NOW + 120_000;
    expect(decideWakeAt(NOW, NOW - 1000, critical, maintenance)).toBe(critical);
    expect(decideWakeAt(NOW, NOW - 1000, null, maintenance)).toBe(maintenance);
  });

  it('тишина — служебные задачи не будят: их догонит cron', () => {
    const maintenance = NOW + 60_000;
    expect(decideWakeAt(NOW, NOW - IDLE_AFTER_MS - 1, null, maintenance)).toBeNull();
  });

  it('тишина, но есть рейс или крафт — будим', () => {
    const critical = NOW + 5 * 60_000;
    expect(decideWakeAt(NOW, NOW - IDLE_AFTER_MS - 1, critical, NOW + 60_000)).toBe(critical);
  });

  it('тишина, служебная задача раньше критичной — всё равно ждём критичную', () => {
    const critical = NOW + 30 * 60_000;
    const maintenance = NOW + 60_000;
    expect(decideWakeAt(NOW, NOW - IDLE_AFTER_MS - 1, critical, maintenance)).toBe(critical);
  });

  it('после вытеснения объекта активность неизвестна — считаем тишиной', () => {
    // lastSeen = 0: объекта не было в памяти, значит и будить его незачем.
    expect(decideWakeAt(NOW, 0, null, NOW + 60_000)).toBeNull();
    expect(decideWakeAt(NOW, 0, NOW + 1000, NOW + 60_000)).toBe(NOW + 1000);
  });

  it('задач нет вовсе — будильник снимается', () => {
    expect(decideWakeAt(NOW, NOW, null, null)).toBeNull();
  });

  it('граница тишины: ровно IDLE_AFTER_MS — уже тишина', () => {
    const maintenance = NOW + 60_000;
    expect(decideWakeAt(NOW, NOW - IDLE_AFTER_MS, null, maintenance)).toBeNull();
    expect(decideWakeAt(NOW, NOW - IDLE_AFTER_MS + 1, null, maintenance)).toBe(maintenance);
  });
});

describe('служебные интервалы', () => {
  it('сверка журнала — раз в час, а не каждые пять минут', () => {
    expect(VERIFY_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it('критичные задачи перечислены явно и не включают служебные', () => {
    expect([...CRITICAL_KINDS].sort()).toEqual([
      'craft_finish', 'expedition_event', 'expedition_event_timeout', 'expedition_finish', 'season_close',
    ]);
    expect(CRITICAL_KINDS).not.toContain('ledger_verify');
    expect(CRITICAL_KINDS).not.toContain('idem_cleanup');
    expect(CRITICAL_KINDS).not.toContain('fuel_regen');
  });
});
