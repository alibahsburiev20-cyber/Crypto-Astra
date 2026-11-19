import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATUS_BY_CODE } from '../../src/http/response';

// Каждый код ApiError, который может бросить мир, обязан иметь HTTP-статус и
// перевод в клиенте. Иначе игрок увидит 500 `internal` с пустым текстом.
// Тест сканирует исходники, а не сверяется с ручным списком, поэтому новый код
// без строки в таблице падает здесь, а не в проде.

const root = new URL('../../../', import.meta.url);
const dirs = ['worker/src/world/modules', 'worker/src/world'];

function codes(): Set<string> {
  const out = new Set<string>();
  const re = /ApiError\(\d+,\s*'([a-z_]+)'/g;
  for (const dir of dirs) {
    for (const name of readdirSync(new URL(`${dir}/`, root))) {
      if (!name.endsWith('.ts')) continue;
      const text = readFileSync(new URL(`${dir}/${name}`, root), 'utf8');
      for (const match of text.matchAll(re)) out.add(match[1]);
    }
  }
  return out;
}

const all = codes();
const app = readFileSync(new URL('client/app.js', root), 'utf8');

describe('карта ошибок', () => {
  it('в исходниках есть коды ошибок', () => {
    expect(all.size).toBeGreaterThan(40);
  });

  it('у каждого кода есть HTTP-статус', () => {
    const missing = [...all].filter((code) => !(code in STATUS_BY_CODE)).sort();
    expect(missing).toEqual([]);
  });

  it('статусы в таблице — валидные HTTP-коды', () => {
    for (const [code, status] of Object.entries(STATUS_BY_CODE)) {
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(500);
    }
  });

  it('у каждого кода есть текст для игрока', () => {
    // Служебные коды, которые игрок не видит: их обрабатывает сам клиент.
    const internal = new Set(['player_id_required', 'bad_delta']);
    const missing = [...all].filter((code) => !internal.has(code) && !app.includes(`${code}:`)).sort();
    expect(missing).toEqual([]);
  });
});
