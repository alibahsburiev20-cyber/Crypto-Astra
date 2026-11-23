// Сводка «пока вас не было»: только факты из /me, без догадок.
import { describe, expect, it } from 'vitest';
import { humanGap, offlineSummary, MIN_GAP_MS } from '../../../client/welcome.js';

const NOW = 1_800_000_000_000;

describe('welcome: длительность', () => {
  it('часы и минуты', () => {
    expect(humanGap(45 * 60_000)).toBe('45 мин');
    expect(humanGap(3 * 3600_000 + 20 * 60_000)).toBe('3 ч 20 мин');
    expect(humanGap(2 * 86400_000 + 4 * 3600_000)).toBe('2 дн 4 ч');
    expect(humanGap(5 * 86400_000)).toBe('5 дн');
  });
});

describe('welcome: сводка', () => {
  it('молчит, если отсутствие короче порога', () => {
    expect(offlineSummary({ lastSeen: NOW - MIN_GAP_MS + 1, now: NOW })).toBe('');
  });

  it('молчит на первом входе и при сбитых часах', () => {
    expect(offlineSummary({ lastSeen: 0, now: NOW })).toBe('');
    expect(offlineSummary({ lastSeen: NOW + 60_000, now: NOW })).toBe('');
  });

  it('сообщает о завершённом рейсе и восстановленном топливе', () => {
    const text = offlineSummary({
      lastSeen: NOW - 2 * 3600_000,
      now: NOW,
      expeditions: { active: { planet: 'Марс', endsAt: NOW - 1000 }, recent: [] },
      fuel: { nextAt: NOW - 60_000 },
      season: { daysLeft: 12 },
    });
    expect(text).toContain('Пока вас не было 2 ч');
    expect(text).toContain('рейс «Марс» завершён');
    expect(text).toContain('топливо восстановилось');
    expect(text).toContain('до конца сезона 12 дн');
  });

  it('не выдаёт чужую награду за свою: рейс ещё в полёте', () => {
    const text = offlineSummary({
      lastSeen: NOW - 3600_000,
      now: NOW,
      expeditions: { active: { planet: 'Луна', endsAt: NOW + 600_000 }, recent: [] },
    });
    expect(text).toContain('рейс ещё в полёте');
    expect(text).not.toContain('завершён');
  });

  it('без активного рейса считает завершённые за время отсутствия', () => {
    const text = offlineSummary({
      lastSeen: NOW - 3600_000,
      now: NOW,
      expeditions: { active: null, recent: [{ endedAt: NOW - 1000 }, { endedAt: NOW - 100_000 }, { endedAt: NOW - 10 * 3600_000 }] },
    });
    expect(text).toContain('рейсов завершено: 2');
  });
});
