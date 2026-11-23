// Контракт клиента и сервера: адреса, которые зовёт браузер, должны существовать
// в роутере, а селекторы — в разметке. Это дешёвая страховка от «кнопка есть,
// маршрута нет» и наоборот.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const clientFiles = ['client/app.js', 'client/pay.js', 'client/pool.js', 'client/admin.js'];
const router = read('worker/src/http/router.ts');
const app = read('client/app.js');

const ASSET = /\.(png|jpe?g|webp|svg|ico|css|html|json|webmanifest|txt|mp3|ogg)$/i;

function apiCallsIn(path: string): string[] {
  const text = read(path);
  const found = new Set<string>();
  // api('…'), fetch('…'), call('…'): все запросы клиента идут через них.
  for (const m of text.matchAll(/(?:\bapi|\bfetch|\bcall)\(\s*[`'"]([^`'"]+)[`'"]/g)) found.add(m[1]);
  return [...found];
}

const serverRoutes = new Set<string>();
for (const m of router.matchAll(/p === '([^']+)'/g)) serverRoutes.add(m[1]);

describe('контракт клиента и роутера', () => {
  it('каждый путь из клиента объявлен в роутере', () => {
    const missing: string[] = [];
    for (const file of clientFiles) {
      for (const path of apiCallsIn(file)) {
        if (ASSET.test(path)) continue;
        if (!path.startsWith('/')) continue;
        // Строки с ${} — динамические, их проверяет e2e.
        if (path.includes('${')) continue;
        const clean = path.split('?')[0];
        if (!serverRoutes.has(clean)) missing.push(`${file}: ${clean}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('селекторы pay.js есть в pay.html', () => {
    const html = read('client/pay.html');
    const js = read('client/pay.js');
    const keys = new Set<string>();
    for (const m of js.matchAll(/data-pay="([a-z-]+)"/g)) keys.add(m[1]);
    const missing = [...keys].filter((key) => !html.includes(`data-pay="${key}"`));
    expect(missing).toEqual([]);
  });

  it('селекторы admin.js есть в admin.html', () => {
    const html = read('client/admin.html');
    const js = read('client/admin.js');
    const ids = new Set<string>();
    for (const m of js.matchAll(/\$\('#([a-z-]+)'\)/g)) ids.add(m[1]);
    const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
    expect(missing).toEqual([]);
  });

  it('идентификаторы из app.js, которые ищутся через $, есть в index.html', () => {
    const html = read('client/index.html');
    const ids = new Set<string>();
    for (const m of app.matchAll(/\$\('#([a-z-]+)'\)/g)) ids.add(m[1]);
    const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
    expect(missing).toEqual([]);
  });

  it('все маршруты из роутера упомянуты в docs/API.md', () => {
    const api = read('docs/API.md');
    const missing = [...serverRoutes].filter((route) => !api.includes(`\`${route}`));
    expect(missing).toEqual([]);
  });
});
