import { describe, expect, it } from 'vitest';
import { parseLimit } from '../../src/routes/game';
import { listLedger } from '../../src/world/modules/state';
import { makeWorld } from '../helpers/sqlShim';
import { createPlayer } from '../../src/world/modules/players';

const T0 = 86_400_000 * 10;

describe('limit в запросах', () => {
  it('битые значения не превращаются в NaN', () => {
    expect(parseLimit('abc')).toBe(30);
    expect(parseLimit(null)).toBe(30);
    expect(parseLimit('')).toBe(30);
    expect(parseLimit('-5')).toBe(1);
    expect(parseLimit('0')).toBe(1);
    expect(parseLimit('999')).toBe(50);
    expect(parseLimit('7.9')).toBe(7);
  });

  it('listLedger с NaN не падает и отдаёт журнал', () => {
    const { sql, tx } = makeWorld();
    tx(() => createPlayer(sql, 'p1', T0));
    const rows = listLedger(sql, 'p1', Number.NaN);
    // ASTRA, топливо и стартовая прочность корабля
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.asset)).toContain('fuel');
  });
});
