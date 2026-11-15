// Кладёт файлы client/ внутрь воркера. Так деплой не зависит от отдельной загрузки ассетов.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const client = join(root, 'client');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
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
for (const path of walk(client)) {
  const ext = path.slice(path.lastIndexOf('.'));
  if (!types[ext]) continue;
  const urlPath = '/' + relative(client, path).split('\\').join('/');
  files[urlPath] = { type: types[ext], body: readFileSync(path, 'utf8') };
}

const out = `// Сгенерировано scripts/embed-client.mjs. Не править руками.
export const SITE_FILES: Record<string, { type: string; body: string }> = ${JSON.stringify(files, null, 2)};
`;
const outDir = join(root, 'worker/src/static');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'site.ts'), out);
console.log(`embedded ${Object.keys(files).length} files`);
