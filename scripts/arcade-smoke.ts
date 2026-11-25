// Смоук-проверка аркады против живого воркера (dev, preview или прод).
//
// Зачем: аркада считает очки на сервере, поэтому «экран работает» словами не
// доказывается. Здесь один тестовый игрок проходит полный круг: вход → каталог →
// забег → читерский ввод отвергнут → честный лабиринт засчитан → опыт пришёл →
// ASTRA не шелохнулась → журнал несёт reason 'arcade'.
//
// Запуск:
//   npm run smoke:arcade -- --base https://crypto-astra.cryptoastra.workers.dev --email … --password …
//   npm run smoke:arcade -- --base http://127.0.0.1:8787 --register   # локальная разработка
//
// Расход: 2 попытки из суточных 10 у тестового аккаунта и одна строка в журнале.
// Больше ничего не меняет: покупки, рейсы и рынок не трогает.
//
// Код выхода: 0 — всё сошлось, 1 — есть проблема (текст в stderr).
import { ARCADE_GAMES, makeMaze, solveMaze } from '../worker/src/shared/arcade';

interface Args {
  base: string;
  email: string | null;
  password: string | null;
  register: boolean;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
  };
  return {
    base: (get('base') ?? 'http://127.0.0.1:8787').replace(/\/$/, ''),
    email: get('email'),
    password: get('password'),
    register: argv.includes('--register'),
    timeoutMs: Number(get('timeout') ?? '15000'),
  };
}

const args = parseArgs(process.argv.slice(2));
const problems: string[] = [];
const notes: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) problems.push(message);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
}

let token = '';

async function call(
  path: string,
  init: { method?: string; body?: unknown; key?: string; auth?: boolean } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  if (init.key) headers['Idempotency-Key'] = init.key;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(args.base + path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Идеальный путь по зерну: тем же кодом, что считает сервер. */
function perfectMoves(seed: number): number[] {
  const g = makeMaze(seed >>> 0);
  const { path, steps } = solveMaze(g);
  const moves: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const ax = path[i - 1] % g.cols;
    const ay = Math.floor(path[i - 1] / g.cols);
    const bx = path[i] % g.cols;
    const by = Math.floor(path[i] / g.cols);
    moves.push(bx > ax ? 1 : bx < ax ? 3 : by > ay ? 2 : 0);
  }
  if (moves.length !== steps) throw new Error('решатель лабиринта разошёлся с полем');
  return moves;
}

const idem = (tag: string) => `smoke-${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function signIn(): Promise<void> {
  if (args.email && args.password) {
    const r = await call('/auth/login', { method: 'POST', auth: false, body: { email: args.email, password: args.password } });
    check(r.status === 200, `вход тестового игрока (${r.status})`);
    token = String(r.body?.access_token ?? '');
    return;
  }
  // Регистрация требует настоящего домена почты (проверка MX), поэтому без
  // готовых данных просим их явно, а не выдумываем адрес.
  const email = args.email ?? `arcade-smoke-${Date.now()}@gmail.com`;
  if (!args.register) {
    problems.push('нужны --email и --password существующего игрока либо --register');
    return;
  }
  const password = args.password ?? `Smoke-${Date.now().toString(36)}`;
  const r = await call('/auth/register', { method: 'POST', auth: false, body: { email, password } });
  check(r.status === 200, `регистрация тестового игрока (${r.status} ${r.body?.error ?? ''})`);
  token = String(r.body?.access_token ?? '');
  notes.push(`тестовый аккаунт: ${email}`);
}

async function main(): Promise<void> {
  const health = await call('/health', { auth: false });
  check(health.status === 200, `/health ${health.status}, build ${health.body?.build ?? '?'}`);
  const serverNow = Number(health.body?.now) || Date.now();

  await signIn();
  if (!token) throw new Error('нет токена — дальше идти нечего');

  // 1. Каталог.
  const list = await call('/arcade');
  check(list.status === 200, `GET /arcade ${list.status}`);
  const games = Array.isArray(list.body?.games) ? list.body.games : [];
  check(games.length === ARCADE_GAMES.length, `игр в каталоге: ${games.length} (ожидалось ${ARCADE_GAMES.length})`);
  check(games.every((g: { sprite: string }) => /^\/sprites\/arcade\/[a-z0-9_]+\.png$/.test(g.sprite)),
    'у каждой игры есть спрайт /sprites/arcade/<id>.png');
  const sprites = await Promise.all(games.map((g: { sprite: string }) => call(g.sprite, { auth: false })));
  check(sprites.every((s) => s.status === 200), 'все 10 плиток каталога реально отдаются (200), а не 404');
  const attempts0 = list.body?.attempts ?? {};
  check(Number(attempts0.left) > 0, `попыток доступно: ${attempts0.left}/${attempts0.limit}`);

  const me0 = await call('/me');
  const astra0 = Number(me0.body?.balances?.astra);
  const xp0 = Number(me0.body?.xp) || 0;
  check(Number.isFinite(astra0), `баланс ASTRA до: ${astra0}`);

  // 2. Читерский ввод: попытка сгорает, очков нет.
  const cheat = await call('/arcade/start', { method: 'POST', body: { game: 'maze' }, key: idem('cheat') });
  check(cheat.status === 200, `POST /arcade/start ${cheat.status}`);
  const cheatRun = String(cheat.body?.runId);
  const bad = await call('/arcade/finish', {
    method: 'POST', body: { runId: cheatRun, moves: [1, 1, 1, 1, 1] }, key: idem('cheatf'),
  });
  check(bad.status === 409 && ['bad_trace', 'too_fast', 'short'].includes(String(bad.body?.error)),
    `ход сквозь стену отвергнут: ${bad.status} ${bad.body?.error}`);
  const again = await call('/arcade/finish', {
    method: 'POST', body: { runId: cheatRun, moves: perfectMoves(Number(cheat.body?.seed)) }, key: idem('cheatf2'),
  });
  check(again.status === 409 && again.body?.error === 'run_expired', `закрытый забег не пересдать: ${again.status} ${again.body?.error}`);

  // 3. Честный забег: поле из зерна, путь решает клиент, счёт считает сервер.
  const run = await call('/arcade/start', { method: 'POST', body: { game: 'maze' }, key: idem('run') });
  check(run.status === 200, `второй старт ${run.status}`);
  const key = idem('finish');
  const finish = await call('/arcade/finish', {
    method: 'POST',
    body: { runId: String(run.body?.runId), moves: perfectMoves(Number(run.body?.seed)) },
    key,
  });
  check(finish.status === 200, `честный лабиринт принят: ${finish.status} ${finish.body?.error ?? ''}`);
  const score = Number(finish.body?.result?.score);
  check(score > 0, `очки посчитал сервер: ${score}`);
  check(finish.body?.result?.win === true, `порог победы взят (${finish.body?.result?.win})`);
  const xp = Number(finish.body?.rewards?.xp);
  check(xp > 0, `опыт начислен: +${xp}${finish.body?.rewards?.capped ? ' (потолок)' : ''}`);
  const list1 = await call('/arcade');
  check(Number(list1.body?.attempts?.used) === Number(attempts0.used) + 2,
    `попытки списаны ровно по забегу: ${attempts0.used} → ${list1.body?.attempts?.used}`);

  // 4. Идемпотентность: та же сдача не удваивает награду.
  const replay = await call('/arcade/finish', {
    method: 'POST',
    body: { runId: String(run.body?.runId), moves: perfectMoves(Number(run.body?.seed)) },
    key,
  });
  check(replay.status === finish.status && JSON.stringify(replay.body) === JSON.stringify(finish.body),
    'повтор с тем же Idempotency-Key = тот же ответ, награда не удвоилась');

  // 5. Экономика не тронута, журнал на месте.
  const me1 = await call('/me');
  check(Number(me1.body?.balances?.astra) === astra0, `ASTRA не изменилась: ${astra0} → ${me1.body?.balances?.astra}`);
  if (!finish.body?.rewards?.capped) {
    check(Number(me1.body?.xp) >= xp0 + xp, `опыт вырос: ${xp0} → ${me1.body?.xp}`);
  }
  const led = await call('/ledger?limit=30');
  const rows = Array.isArray(led.body?.entries) ? led.body.entries : [];
  const arcadeRows = rows.filter((e: { reason: string }) => e.reason === 'arcade' || e.reason === 'arcade_award');
  check(arcadeRows.length > 0, `в журнале есть строки аркады: ${arcadeRows.length}`);
  check(arcadeRows.every((e: { asset: string }) => e.asset === 'xp'), 'строки аркады — только опыт, ни ASTRA, ни очков');

  // 6. Часы: забег живёт по серверному времени, а не по часам машины, с которой
  // запущен смоук. endsAt = старт + runMs + 120 с grace на сдачу (ARCADE_FINISH_GRACE_MS).
  const endsIn = Number(run.body?.endsAt) - serverNow;
  const runMs = Number(run.body?.runMs);
  check(endsIn >= runMs && endsIn <= runMs + 130_000,
    `раунд задан сервером: ${Math.round(endsIn / 1000)} с до конца при раунде ${Math.round(runMs / 1000)} с (grace на сдачу включён)`);

  console.log('');
  if (notes.length) console.log(notes.join('\n'));
  if (problems.length) {
    console.error(`\nпроблем: ${problems.length}`);
    process.exitCode = 1;
  } else {
    console.log('\nаркада жива: ввод принимает, читерство отсекает, опыт начисляет, ASTRA в покое.');
  }
}

main().catch((e) => {
  console.error(`смоук упал: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
