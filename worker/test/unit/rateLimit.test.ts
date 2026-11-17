import { describe, expect, it } from 'vitest';
import {
  LOGIN_EMAIL_POLICY, LOGIN_IP_POLICY, REGISTER_IP_POLICY,
  blockedFor, bump, loginKeys, registerKeys,
} from '../../src/auth/rateLimit';
import { sha256Hex } from '../../src/shared/sha256';

const T0 = 1_800_000_000_000;

describe('bump', () => {
  it('первая попытка открывает окно', () => {
    expect(bump(null, T0, LOGIN_IP_POLICY)).toEqual({ attempts: 1, windowStart: T0, blockedUntil: 0 });
  });

  it('попытки внутри окна складываются', () => {
    const a = bump(null, T0, LOGIN_IP_POLICY);
    const b = bump(a, T0 + 1000, LOGIN_IP_POLICY);
    expect(b.attempts).toBe(2);
    expect(b.windowStart).toBe(T0);
  });

  it('после окна счётчик начинается заново', () => {
    let s = bump(null, T0, LOGIN_IP_POLICY);
    for (let i = 1; i < 5; i++) s = bump(s, T0 + i * 1000, LOGIN_IP_POLICY);
    const next = bump(s, T0 + LOGIN_IP_POLICY.windowMs, LOGIN_IP_POLICY);
    expect(next.attempts).toBe(1);
    expect(next.windowStart).toBe(T0 + LOGIN_IP_POLICY.windowMs);
  });

  it('на пределе ставит блокировку, после неё окно сбрасывается', () => {
    let s = null as ReturnType<typeof bump> | null;
    for (let i = 1; i <= LOGIN_IP_POLICY.max; i++) s = bump(s, T0 + i, LOGIN_IP_POLICY);
    expect(s?.attempts).toBe(LOGIN_IP_POLICY.max);
    const blockedUntil = s?.blockedUntil ?? 0;
    expect(blockedUntil).toBeGreaterThan(T0);
    expect(blockedFor(s, T0 + 1)).toBeGreaterThan(0);

    const after = bump(s, blockedUntil + 1, LOGIN_IP_POLICY);
    expect(after.attempts).toBe(1);
    expect(after.blockedUntil).toBe(0);
  });

  it('политика без блокировки (email) не запирает владельца адреса', () => {
    let s = null as ReturnType<typeof bump> | null;
    for (let i = 0; i < 50; i++) s = bump(s, T0 + i, LOGIN_EMAIL_POLICY);
    expect(s?.attempts).toBe(50);
    expect(s?.blockedUntil).toBe(0);
    expect(blockedFor(s, T0)).toBe(0);
  });

  it('регистрация блокируется на час', () => {
    let s = null as ReturnType<typeof bump> | null;
    for (let i = 1; i <= REGISTER_IP_POLICY.max; i++) s = bump(s, T0, REGISTER_IP_POLICY);
    expect((s?.blockedUntil ?? 0) - T0).toBe(REGISTER_IP_POLICY.blockMs);
  });
});

describe('ключи лимитов', () => {
  it('email не попадает в D1 открытым текстом', () => {
    const keys = loginKeys('203.0.113.7', 'Player@Example.com');
    expect(keys[0]).toBe('login_ip:203.0.113.7');
    expect(keys[1]).toBe(`login_email:${sha256Hex('Player@Example.com')}`);
    expect(keys[1].includes('Player@Example.com')).toBe(false);
  });

  it('без CF-Connecting-IP используется общий ключ', () => {
    expect(loginKeys(null, 'a@b.c')[0]).toBe('login_ip:unknown');
    expect(registerKeys('')[0]).toBe('register_ip:unknown');
  });
});
