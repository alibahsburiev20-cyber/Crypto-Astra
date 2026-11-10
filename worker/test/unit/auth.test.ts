import { describe, expect, it } from 'vitest';
import { signJwt, verifyJwt } from '../../src/auth/jwt';
import { hashPassword, verifyPassword } from '../../src/auth/password';
import { fromB64Url, toB64Url } from '../../src/shared/encoding';

const SECRET = 'test-secret-test-secret-test-secret-123';
const NOW = 1_800_000_000;

describe('base64url', () => {
  it('туда и обратно без потерь', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(fromB64Url(toB64Url(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('password', () => {
  it('верный пароль проходит, неверный нет', async () => {
    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
  it('соль разная при каждом хешировании', async () => {
    expect((await hashPassword('same')) === (await hashPassword('same'))).toBe(false);
  });
  it('битый формат хеша — false, без исключений', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$abc$AAAA$AAAA')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$99999999$AAAA$AAAA')).toBe(false);
  });
});

describe('jwt', () => {
  it('подписанный токен проверяется', async () => {
    const t = await signJwt({ sub: 'u1', w: 'w1' }, SECRET, NOW);
    const c = await verifyJwt(t, SECRET, NOW + 10);
    expect(c?.sub).toBe('u1');
    expect(c?.w).toBe('w1');
  });
  it('чужой секрет — отказ', async () => {
    const t = await signJwt({ sub: 'u1', w: 'w1' }, SECRET, NOW);
    expect(await verifyJwt(t, SECRET + 'x', NOW)).toBeNull();
  });
  it('просроченный токен — отказ (15 минут)', async () => {
    const t = await signJwt({ sub: 'u1', w: 'w1' }, SECRET, NOW);
    expect(await verifyJwt(t, SECRET, NOW + 899)).not.toBeNull();
    expect(await verifyJwt(t, SECRET, NOW + 900)).toBeNull();
  });
  it('подмена полезной нагрузки — отказ', async () => {
    const t = await signJwt({ sub: 'u1', w: 'w1' }, SECRET, NOW);
    const [h, , s] = t.split('.');
    const evil = toB64Url(new TextEncoder().encode(JSON.stringify({ sub: 'admin', w: 'w1', iat: NOW, exp: NOW + 9999 })));
    expect(await verifyJwt(`${h}.${evil}.${s}`, SECRET, NOW)).toBeNull();
  });
  it('alg=none не принимается', async () => {
    const h = toB64Url(new TextEncoder().encode(JSON.stringify({ alg: 'none', typ: 'JWT' })));
    const p = toB64Url(new TextEncoder().encode(JSON.stringify({ sub: 'u1', w: 'w1', iat: NOW, exp: NOW + 900 })));
    expect(await verifyJwt(`${h}.${p}.`, SECRET, NOW)).toBeNull();
  });
  it('мусор — null', async () => {
    expect(await verifyJwt('abc', SECRET, NOW)).toBeNull();
  });
});
