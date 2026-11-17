// Кладёт файлы client/ внутрь воркера. Так деплой не зависит от отдельной загрузки ассетов.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, а не pathname: pathname ломается на пробелах и Windows-путях.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const client = join(root, 'client');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

const files = {};
for (const path of walk(client).sort()) {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (!types[ext]) continue;
  const urlPath = '/' + relative(client, path).split('\\').join('/');
  // Бинарные файлы (png/webp/ico/woff2) в JSON-строку не положить без потерь.
  if (!['.html', '.css', '.js', '.json', '.webmanifest', '.txt', '.svg'].includes(ext)) continue;
  files[urlPath] = { type: types[ext], body: readFileSync(path, 'utf8') };
}

const out = `// Сгенерировано scripts/embed-client.mjs. Не править руками.
export const SITE_FILES: Record<string, { type: string; body: string }> = ${JSON.stringify(files, null, 2)};
`;
const outDir = join(root, 'worker/src/static');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'site.ts'), out);
console.log(`embedded ${Object.keys(files).length} files`);
