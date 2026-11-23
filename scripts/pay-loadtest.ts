// Нагрузочная проверка публичных и админских чтений Astra Pay.
//
// Проверяет только чтение: /health, /pay/status.json, /pool.json,
// /pay/products.json. Ничего не покупает и не выплачивает — нагрузочный тест
// не должен двигать деньги.
//
// Запуск: npm run pay:loadtest -- --base https://example.workers.dev --requests 300 --concurrency 20
// С токеном игрока добавляется /pay/account.json — так в замер попадает D1:
//   npm run pay:loadtest -- --base … --token "$TOKEN" 
//
// Код выхода 1, если ошибок больше 1 % или p95 дольше 500 мс.

interface Args {
  base: string;
  requests: number;
  concurrency: number;
  /** Токен игрока: добавляет чтение /pay/account.json — это запрос в D1. */
  token: string | null;
}

const PATH = ['/health', '/pay/status.json', '/pool.json', '/pay/products.json'];

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: string): string => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    base: get('base', 'http://127.0.0.1:8787').replace(/\/$/, ''),
    requests: Number(get('requests', '200')),
    concurrency: Number(get('concurrency', '10')),
    token: get('token', '') || null,
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.requests) || args.requests <= 0) throw new Error('bad requests');
  if (!Number.isFinite(args.concurrency) || args.concurrency <= 0) throw new Error('bad concurrency');

  const paths = args.token ? [...PATH, '/pay/account.json'] : PATH;
  const headers: Record<string, string> = args.token ? { Authorization: `Bearer ${args.token}` } : {};
  const timings: number[] = [];
  const statuses = new Map<number, number>();
  let errors = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= args.requests) return;
      const path = paths[index % paths.length];
      const started = performance.now();
      try {
        const res = await fetch(`${args.base}${path}`, { headers });
        await res.arrayBuffer();
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        if (!res.ok) errors += 1;
      } catch {
        errors += 1;
        statuses.set(0, (statuses.get(0) ?? 0) + 1);
      }
      timings.push(performance.now() - started);
    }
  }

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  const total = performance.now() - startedAt;

  const sorted = [...timings].sort((a, b) => a - b);
  const errorRate = errors / args.requests;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const rps = (args.requests / total) * 1000;

  console.log(JSON.stringify({
    base: args.base,
    requests: args.requests,
    concurrency: args.concurrency,
    paths,
    errorRate: Number(errorRate.toFixed(4)),
    rps: Number(rps.toFixed(1)),
    ms: {
      p50: Number(p50.toFixed(1)),
      p95: Number(p95.toFixed(1)),
      p99: Number(percentile(sorted, 99).toFixed(1)),
      max: Number((sorted[sorted.length - 1] ?? 0).toFixed(1)),
    },
    statuses: Object.fromEntries([...statuses.entries()].sort((a, b) => a[0] - b[0])),
  }, null, 2));

  if (errorRate > 0.01 || p95 > 500) {
    console.error('нагрузочная проверка не пройдена: ошибки > 1 % или p95 > 500 мс');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});

export {};
