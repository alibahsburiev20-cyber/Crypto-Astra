import { describe, expect, it } from 'vitest';
import {
  LOGIN_EMAIL_BLOCK_MS, LOGIN_EMAIL_POLICY, LOGIN_BLOCK_MS, LOGIN_IP_POLICY,
  REGISTER_DOMAIN_MAX, REGISTER_DOMAIN_POLICY, REGISTER_IP_POLICY,
  blockedFor, bump, loginKeys, registerDomainKey, registerKeys,
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

  it('перебор по одному адресу запирает адрес ненадолго, а не навсегда', () => {
    // Распределённый перебор — десятки IP на один ящик: счётчик по IP бессилен, и
    // после того как капчу со входа сняли, это единственное, что его тормозит.
    // Блокировка короткая (10 минут против 15 у IP), чтобы владелец адреса не
    // сидел запертым весь день, если его адрес решили выдать за чужой.
    let s = null as ReturnType<typeof bump> | null;
    for (let i = 0; i < LOGIN_EMAIL_POLICY.max - 1; i++) s = bump(s, T0 + i, LOGIN_EMAIL_POLICY);
    expect(s?.blockedUntil).toBe(0);
    const at = T0 + LOGIN_EMAIL_POLICY.max - 1;
    s = bump(s, at, LOGIN_EMAIL_POLICY);
    expect(s?.attempts).toBe(LOGIN_EMAIL_POLICY.max);
    expect((s?.blockedUntil ?? 0) - at).toBe(LOGIN_EMAIL_POLICY.blockMs);
    expect(LOGIN_EMAIL_BLOCK_MS).toBeLessThan(LOGIN_BLOCK_MS);
    expect(blockedFor(s, T0)).toBeGreaterThanOrEqual(LOGIN_EMAIL_BLOCK_MS);
    // Окно короче блокировки быть не должно, иначе счётчик обнулился бы раньше,
    // чем снялся бы запрет, и «мягкость» превратилась бы в дыру.
    expect(LOGIN_EMAIL_POLICY.windowMs).toBeGreaterThanOrEqual(LOGIN_EMAIL_POLICY.blockMs);
  });

  it('потолок на домен регистрации считается тем же счётчиком', () => {
    let s = null as ReturnType<typeof bump> | null;
    for (let i = 1; i < REGISTER_DOMAIN_MAX; i++) s = bump(s, T0, REGISTER_DOMAIN_POLICY);
    expect(s?.blockedUntil).toBe(0);
    s = bump(s, T0, REGISTER_DOMAIN_POLICY);
    expect((s?.blockedUntil ?? 0) - T0).toBe(REGISTER_DOMAIN_POLICY.blockMs);
    expect(registerDomainKey('web.de')).toBe('register_domain:web.de');
    // Пустой домен не должен сливаться в один общий счётчик со всеми сразу.
    expect(registerDomainKey('')).toBe('register_domain:unknown');
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
