import { describe, expect, it } from 'vitest';
import { CLAIM_DAILY_MAX, CLAIM_INTERVAL_MS, DAY_MS } from '../../src/shared/constants';
import { decideClaim } from '../../src/world/modules/claimMath';

describe('decideClaim', () => {
  const t0 = DAY_MS * 10;
  it('первый Claim разрешён', () => {
    const d = decideClaim(null, t0);
    expect(d.ok).toBe(true);
  });
  it('раньше интервала 15 минут — отказ с временем следующего Claim', () => {
    const d = decideClaim({ lastClaimAt: t0, day: 10, count: 1 }, t0 + CLAIM_INTERVAL_MS - 1);
    expect(d).toEqual({ ok: false, code: 'too_early', nextClaimAt: t0 + CLAIM_INTERVAL_MS });
  });
  it('ровно через 15 минут разрешён', () => {
    expect(decideClaim({ lastClaimAt: t0, day: 10, count: 1 }, t0 + CLAIM_INTERVAL_MS).ok).toBe(true);
  });
  it('суточный лимит 96', () => {
    const d = decideClaim({ lastClaimAt: t0, day: 10, count: CLAIM_DAILY_MAX }, t0 + DAY_MS / 2);
    expect(d).toEqual({ ok: false, code: 'daily_limit', nextClaimAt: DAY_MS * 11 });
  });
  it('новый день обнуляет счётчик', () => {
    const d = decideClaim({ lastClaimAt: t0, day: 10, count: CLAIM_DAILY_MAX }, DAY_MS * 11 + 1);
    expect(d.ok).toBe(true);
  });
  it('время назад (сбой часов) не даёт лишнего Claim', () => {
    expect(decideClaim({ lastClaimAt: t0, day: 10, count: 1 }, t0 - 1000).ok).toBe(false);
  });
});
