import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Клиент показывает текст по коду ошибки. Если сервер добавил код, а клиент — нет,
// игрок увидит «Что-то пошло не так». Тест ловит такой рассинхрон.
const root = new URL('../../../', import.meta.url);
const src = readFileSync(new URL('client/app.js', root), 'utf8');
const client = readFileSync(new URL('client/app.js', root), 'utf8');
const worker = readFileSync(new URL('worker/src/http/router.ts', root), 'utf8')
  + readFileSync(new URL('worker/src/routes/auth.ts', root), 'utf8')
  + readFileSync(new URL('worker/src/routes/game.ts', root), 'utf8')
  + readFileSync(new URL('worker/src/auth/guards.ts', root), 'utf8')
  // Срез 6: рынок бросает свои коды из модуля, а не из маршрута.
  + readFileSync(new URL('worker/src/world/modules/market.ts', root), 'utf8')
  + readFileSync(new URL('worker/src/world/modules/ships.ts', root), 'utf8')
  + readFileSync(new URL('worker/src/world/modules/crafting.ts', root), 'utf8')
  + readFileSync(new URL('worker/src/world/modules/shipModules.ts', root), 'utf8');

describe('коды ошибок клиента и сервера', () => {
  it('у каждого кода ApiError есть перевод', () => {
    const block = client.slice(client.indexOf('const ERRORS = {'), client.indexOf('};', client.indexOf('const ERRORS = {')));
    const codes = new Set([...worker.matchAll(/ApiError\(\d{3},\s*'([a-z0-9_]+)'\)/g)].map((m) => m[1]));
    const missing = [...codes].filter((c) => !block.includes(`${c}:`));
    expect(missing).toEqual([]);
  });

  it('Claim и планировщик не отдают клиенту неизвестные коды', () => {
    expect(src).toContain("too_early: 'Claim ещё не готов'");
    expect(src).toContain("daily_limit: 'Суточный лимит Claim исчерпан'");
  });
});
