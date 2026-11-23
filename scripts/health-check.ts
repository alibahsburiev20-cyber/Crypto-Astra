// Проверка живости прода без секретов.
//
// Смотрит только публичные маршруты: /health (метка сборки) и /pay/status.json
// (флаги, схема, число таблиц). Ничего не меняет и не требует токена — поэтому
// годится и для cron, и для внешнего аптайм-монитора.
//
// Запуск:
//   npm run health -- --base https://crypto-astra.cryptoastra.workers.dev
//   npm run health -- --base … --expect-build 2026-11-17.2
//
// Код выхода: 0 — всё в норме, 1 — есть проблема (текст в stderr).
// Флаги payouts/sweep НЕ должны быть включены: если они включились сами,
// это повод остановить выплаты, а не радоваться.

interface Args {
  base: string;
  expectBuild: string | null;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
  };
  return {
    base: (get('base') ?? 'http://127.0.0.1:8787').replace(/\/$/, ''),
    expectBuild: get('expect-build'),
    timeoutMs: Number(get('timeout') ?? '8000'),
  };
}

async function getJson(url: string, timeoutMs: number): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

const problems: string[] = [];
const notes: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) problems.push(message);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const health = await getJson(`${args.base}/health`, args.timeoutMs);
  check(health.status === 200, `/health отвечает ${health.status}`);
  check(health.body?.ok === true, `/health вернул ok=${String(health.body?.ok)}`);
  const build = String(health.body?.build ?? '');
  check(build.length > 0, 'в /health нет метки сборки (APP_BUILD)');
  if (args.expectBuild) check(build === args.expectBuild, `сборка ${build}, ожидалась ${args.expectBuild}`);
  notes.push(`build=${build || '—'}`);

  const pay = await getJson(`${args.base}/pay/status.json`, args.timeoutMs);
  check(pay.status === 200, `/pay/status.json отвечает ${pay.status}`);
  if (pay.status === 200) {
    const b = pay.body ?? {};
    notes.push(`network=${b.network ?? '—'}`, `schema=${b.schema ?? '—'}`, `tables=${b.tables ?? '—'}`);
    check(b.schema === 'ready', `схема платежей: ${b.schema} (ожидалось ready)`);
    check(Number(b.tables) >= 10, `таблиц платежей: ${b.tables}`);
    const flags = b.flags ?? {};
    for (const name of ['payouts', 'sweep']) {
      check(flags[name] === false, `флаг ${name}=${String(flags[name])} — должен быть false`);
    }
    notes.push(`flags: ${Object.entries(flags).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }

  const pool = await getJson(`${args.base}/pool.json`, args.timeoutMs);
  check(pool.status === 200, `/pool.json отвечает ${pool.status}`);

  const started = Date.now();
  const home = await getJson(`${args.base}/`, args.timeoutMs);
  check(home.status === 200, `главная страница отвечает ${home.status}`);
  notes.push(`главная ${Date.now() - started} мс`);

  console.log(JSON.stringify({ base: args.base, at: new Date().toISOString(), notes, problems }, null, 2));
  if (problems.length) {
    for (const p of problems) console.error(`ОШИБКА: ${p}`);
    process.exit(1);
  }
  console.log('Здоровье в норме.');
}

main().catch((e) => {
  console.error(`Проверка не выполнилась: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

export {};
