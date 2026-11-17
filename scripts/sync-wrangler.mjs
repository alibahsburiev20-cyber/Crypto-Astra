// Cloudflare Workers Builds может запускать `wrangler deploy` из корня (нужен
// корневой wrangler.toml) или с `--config worker/wrangler.toml` (так настроено в
// дашборде). Чтобы обе команды работали, генерируем второй конфиг из корневого.
// Единственный источник истины — /wrangler.toml; worker/wrangler.toml не правим.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'wrangler.toml');
const target = join(root, 'worker', 'wrangler.toml');

const HEADER = `## СГЕНЕРИРОВАНО из ../wrangler.toml скриптом scripts/sync-wrangler.mjs.
## Не редактируйте вручную: измените корневой конфиг и запустите npm run config:sync.
## Нужен для сборки Cloudflare, настроенной на --config worker/wrangler.toml.
`;

export function render(sourceText) {
  const body = sourceText
    .replace('main = "worker/src/index.ts"', 'main = "src/index.ts"')
    .replace('directory = "client"', 'directory = "../client"')
    .replace('migrations_dir = "worker/migrations/d1"', 'migrations_dir = "migrations/d1"')
    // Комментарий про запуск из корня во втором конфиге неверен: путь другой.
    .replace(/^## Единственный конфиг.*\n## `npx wrangler deploy`.*\n/m, '');
  return HEADER + body;
}

const generated = render(readFileSync(source, 'utf8'));

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch { /* файла нет — это ошибка */ }
  if (current !== generated) {
    console.error('worker/wrangler.toml отстал от корневого. Запустите: npm run config:sync');
    process.exit(1);
  }
  console.log('worker/wrangler.toml синхронизирован');
} else {
  writeFileSync(target, generated);
  console.log(`записан ${target}`);
}
