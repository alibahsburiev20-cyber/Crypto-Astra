/**
 * Проверка снимка мира из архива (этап 3).
 *
 * Запуск: npm run verify-snapshot -- --file snapshot.json [--sha256 <hash>] [--json]
 *
 * Снимки снимает задача `snapshot_export` внутри мира, а cron складывает их в R2
 * (если бакет подключён) или в D1 `world_snapshots.payload`. Этот скрипт отвечает
 * на вопрос «архив целый и сходится?»: суммы неотрицательны, голова хеш-цепочки
 * соответствует числу строк, призы закрытого сезона совпадают с таблицей наград.
 * Путь `-` читает JSON из stdin. Код выхода 1, если снимок не сошёлся.
 */
import { readFileSync } from 'node:fs';
import { sha256Hex } from '../worker/src/shared/sha256';
import { verifyWorldSnapshot } from './lib/verifyWorldSnapshot';

function parseArgs(argv: string[]): { file: string | null; sha: string | null; json: boolean } {
  const i = argv.indexOf('--file');
  const s = argv.indexOf('--sha256');
  return {
    file: i >= 0 && argv[i + 1] ? argv[i + 1] : null,
    sha: s >= 0 && argv[s + 1] ? argv[s + 1].trim().toLowerCase() : null,
    json: argv.includes('--json'),
  };
}

function readInput(file: string | null): string {
  if (file === '-') return readFileSync(0, 'utf8');
  if (file) return readFileSync(file, 'utf8');
  throw new Error('нужен --file <snapshot.json> или --file -');
}

const { file, sha, json } = parseArgs(process.argv.slice(2));
try {
  const raw = readInput(file);
  const check = verifyWorldSnapshot(JSON.parse(raw));
  const problems = [...check.problems];
  const actualSha = sha256Hex(raw);
  if (sha && sha !== actualSha) problems.push(`sha256 файла ${actualSha} не совпадает с ожидаемым ${sha}`);
  const report = { ...check, ok: problems.length === 0, problems, sha256: actualSha };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Снимок: ${report.kind} от ${new Date(Number(JSON.parse(raw).created_at ?? 0)).toISOString()}`);
    console.log(`Сезон: ${report.season}`);
    console.log(`Игроков: ${report.players} · Ledger ${report.ledgerRows} строк, голова ${report.head}`);
    console.log(`ASTRA в мире: ${report.astra} · очков: ${report.points}`);
    if (report.kind === 'season_close') console.log(`Итогов сезона: ${report.standings}`);
    console.log(`SHA-256: ${actualSha}`);
    if (report.ok) console.log('OK: снимок целый, суммы и призы сходятся');
    else {
      console.log(`ОШИБКА: ${problems.length} проблем(ы)`);
      for (const p of problems) console.log(`  - ${p}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
} catch (e) {
  console.error(`Не удалось проверить снимок: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
