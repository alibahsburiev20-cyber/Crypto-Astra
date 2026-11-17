import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { enqueue, nextAlarmAt } from '../../src/world/scheduler';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

describe('nextAlarmAt', () => {
  it('без задач возвращает null', () => {
    const { sql } = makeWorld();
    expect(nextAlarmAt(sql)).toBeNull();
  });

  it('берёт минимальный run_at только среди pending', () => {
    const { sql, tx } = makeWorld();
    tx(() => {
      enqueue(sql, 'expedition_finish', T0 + 5000, { expeditionId: 'e1' });
      enqueue(sql, 'expedition_event', T0 + 1000, { expeditionId: 'e1' });
      const done = enqueue(sql, 'idem_cleanup', T0, {});
      sql.exec(`UPDATE jobs SET status = 'done' WHERE id = ?`, done);
    });
    expect(nextAlarmAt(sql)).toBe(T0 + 1000);
  });
});
