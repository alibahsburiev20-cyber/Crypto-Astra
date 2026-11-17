/**
 * Наполняет локальный мир тестовыми игроками через API.
 *
 * Запуск: npm run seed -- --users 3 --base http://127.0.0.1:8787
 * Требует запущенный `npm run dev`. Каждый игрок получает свой CF-Connecting-IP,
 * чтобы не упираться в лимит регистраций на один адрес.
 */
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const base = arg('base', process.env.BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const users = Math.max(1, Math.min(50, Number(arg('users', '3')) || 3));

interface Session { email: string; token: string; shipId: string }

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, init);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data } as { status: number; data: any };
}

async function main(): Promise<void> {
  const health = await call('/health');
  if (health.status !== 200) throw new Error(`сервер не отвечает: ${base}/health → ${health.status}`);
  console.log(`База: ${base}`);

  const sessions: Session[] = [];
  for (let i = 0; i < users; i++) {
    const email = `seed-${Date.now()}-${i}@example.com`;
    const ip = `10.10.${Math.floor(i / 250)}.${(i % 250) + 1}`;
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
    const reg = await call('/auth/register', { method: 'POST', headers, body: JSON.stringify({ email, password: 'password123' }) });
    if (reg.status !== 200) {
      console.log(`  ${email}: регистрация ${reg.status} ${JSON.stringify(reg.data)}`);
      continue;
    }
    const token = String(reg.data.access_token);
    const auth = { Authorization: `Bearer ${token}` };
    const claim = await call('/claim', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': `seed-claim-${i}` }, body: '{}' });
    const me = await call('/me', { headers: auth });
    const shipId = String(me.data?.ships?.[0]?.id ?? '');
    console.log(`  ${email}: Claim ${claim.status}, мир ${me.data?.world_id ?? '—'}`);
    sessions.push({ email, token, shipId });
  }

  for (const s of sessions) {
    if (!s.shipId) continue;
    const auth = { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };
    const started = await call('/expeditions/start', {
      method: 'POST', headers: { ...auth, 'Idempotency-Key': `seed-start-${s.shipId}` },
      body: JSON.stringify({ shipId: s.shipId, planet: 'ferra', kind: 'short' }),
    });
    if (started.status !== 200) {
      console.log(`  ${s.email}: старт ${started.status} ${JSON.stringify(started.data)}`);
      continue;
    }
    const expeditionId = String(started.data.expedition.id);
    const cancelled = await call('/expeditions/cancel', {
      method: 'POST', headers: { ...auth, 'Idempotency-Key': `seed-cancel-${expeditionId}` },
      body: JSON.stringify({ expeditionId }),
    });
    const ledger = await call('/ledger?limit=5', { headers: auth });
    console.log(`  ${s.email}: рейс ${started.status}, отмена ${cancelled.status}, записей ${ledger.data?.entries?.length ?? 0}`);
  }

  console.log(`Готово: ${sessions.length} игрок(ов). Откройте ${base}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
