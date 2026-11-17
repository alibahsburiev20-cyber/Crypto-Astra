/**
 * Проверка хеш-цепочки и сверка Ledger с балансами по снимку мира.
 *
 * Запуск: npm run check-ledger -- --file snapshot.json
 * Формат: { "world_id": "w1", "ledger": [...], "balances": [...] }
 * Путь "-" читает JSON из stdin. Код выхода 1, если цепочка или суммы не сходятся.
 */
import { readFileSync } from 'node:fs';
import { verifySnapshot, type Snapshot } from './lib/verifySnapshot';

function parseArgs(argv: string[]): { file: string | null; json: boolean } {
  const i = argv.indexOf('--file');
  return { file: i >= 0 && argv[i + 1] ? argv[i + 1] : null, json: argv.includes('--json') };
}

function readInput(file: string | null): string {
  if (file === '-') return readFileSync(0, 'utf8');
  if (file) return readFileSync(file, 'utf8');
  throw new Error('нужен --file <snapshot.json> или --file -');
}

const { file, json } = parseArgs(process.argv.slice(2));
try {
  const snapshot = JSON.parse(readInput(file)) as Snapshot;
  const report = verifySnapshot(snapshot);
  if (json) {
    console.log(JSON.stringify({ world_id: snapshot.world_id ?? null, ...report }, null, 2));
  } else {
    console.log(`Мир: ${snapshot.world_id ?? '—'}`);
    console.log(`Записей в Ledger: ${report.rows}`);
    console.log(`Голова цепочки: ${report.head ? `#${report.head.seq} ${report.head.hash}` : 'пусто'}`);
    if (report.ok) console.log('OK: цепочка и балансы сходятся');
    else {
      console.log(`ОШИБКА: ${report.problems.length} расхождени(й)`);
      for (const p of report.problems.slice(0, 20)) console.log(`  - ${p}`);
      if (report.problems.length > 20) console.log(`  … ещё ${report.problems.length - 20}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
} catch (e) {
  console.error(`Не удалось проверить снимок: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
