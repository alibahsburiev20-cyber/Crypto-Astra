// Репетиция восстановления: разворачивает дамп D1 в чистую SQLite и сверяет
// количество строк с источником. Ничего не пишет в рабочую базу.
//
// Запуск (внутри scripts/restore-drill.sh, но можно и вручную):
//   npx tsx scripts/restore-verify.ts --dump /tmp/astra.sql --source .wrangler/state/v3/d1/…/db.sqlite
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, statSync } from 'node:fs';

interface Args { dump: string; source: string | null }

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const dump = get('dump');
  if (!dump) throw new Error('нужен --dump путь к SQL-дампу');
  return { dump, source: get('source') };
}

// Только таблицы D1. Игровое состояние (ledger, корабли, гильдии) живёт
// в Durable Object и восстанавливается отдельно — оно в этот дамп не попадает.
const TABLES = ['users', 'world_seats', 'pay_operations', 'pool_entries', 'pay_withdrawals', 'pay_addresses', 'pay_ledger', 'sessions'];

function counts(db: DatabaseSync, tables: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined;
      out[table] = Number(row?.n ?? 0);
    } catch {
      out[table] = -1; // таблицы нет в этой схеме — не падаем, помечаем
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.dump)) throw new Error(`дампа нет: ${args.dump}`);
  const startedAt = Date.now();
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(args.dump, 'utf8'));
  const restoreMs = Date.now() - startedAt;

  const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  const restored = counts(db, TABLES);

  let source: Record<string, number> | null = null;
  if (args.source) {
    if (!existsSync(args.source)) throw new Error(`нет файла источника: ${args.source}`);
    // Открываем источник только на чтение: репетиция не должна его менять.
    const src = new DatabaseSync(args.source, { readOnly: true });
    source = counts(src, TABLES);
    src.close();
  }

  const mismatches = source
    ? Object.keys(source).filter((table) => restored[table] !== source[table]).map((table) => ({
      table, source: source![table], restored: restored[table],
    }))
    : [];

  const report = {
    dump: args.dump,
    dumpBytes: statSync(args.dump).size,
    restoreMs,
    integrity: integrity.integrity_check,
    restored,
    source,
    mismatches,
    ok: integrity.integrity_check === 'ok' && mismatches.length === 0,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main();

export {};
