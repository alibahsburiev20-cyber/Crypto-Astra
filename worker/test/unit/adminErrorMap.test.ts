// Карта ошибок админки — по образцу `errorMap.test.ts`, но для админ-контура.
//
// Игрок и оператор видят разное: у игрока текст берётся из `client/app.js`, у
// админа — из `client/admin.js`. Новый код отказа, не записанный в словарь,
// показывается оператору как «Отказ: grant_limit» — то есть как ничего. Этот
// тест превращает такую правку в красный CI, а не в «разберёмся на проде».
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATUS_BY_CODE } from '../../src/http/response';

const root = new URL('../../../', import.meta.url);
const ADMIN_SOURCES = [
  'worker/src/http/admin.ts',
  'worker/src/routes/admin.ts',
  'worker/src/routes/pay.ts',
  'worker/src/admin/accounts.ts',
  'worker/src/admin/players.ts',
  'worker/src/admin/schema.ts',
];

function codes(): Set<string> {
  const out = new Set<string>();
  const re = /ApiError\(\d+,\s*'([a-z_]+)'/g;
  for (const file of ADMIN_SOURCES) {
    for (const match of readFileSync(new URL(file, root), 'utf8').matchAll(re)) out.add(match[1]);
  }
  return out;
}

const all = codes();
const adminJs = readFileSync(new URL('client/admin.js', root), 'utf8');

describe('карта ошибок админки', () => {
  it('коды собраны из исходников админки', () => {
    // Не «сколько-то», а «не пусто»: пустой набор означал бы, что сломался сам
    // сканер (файл переименован), и проверка молча перестала бы что-либо значит.
    expect(all.size).toBeGreaterThan(15);
    expect(all.has('owner_only')).toBe(true);
    expect(all.has('grant_limit')).toBe(true);
    expect(all.has('player_has_funds')).toBe(true);
  });

  it('у каждого кода есть HTTP-статус', () => {
    const missing = [...all].filter((code) => !(code in STATUS_BY_CODE)).sort();
    expect(missing).toEqual([]);
  });

  it('у каждого кода есть текст для оператора', () => {
    const missing = [...all].filter((code) => !adminJs.includes(`${code}:`)).sort();
    expect(missing).toEqual([]);
  });

  it('тексты админки не ссылаются на несуществующие коды', () => {
    // Словарь в клиенте — источник правды для показа. Ключ, которому нет места
    // ни в админ-кодах, ни в общей таблице статусов, — это устаревшая строка:
    // она ничего не ломает, но ровно поэтому и не чистится сама.
    const known = new Set<string>([...all, ...Object.keys(STATUS_BY_CODE)]);
    const declared = [...adminJs.matchAll(/^ {2}([a-z_]+): '/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(15);
    expect(declared.filter((code) => !known.has(code))).toEqual([]);
  });

  it('деньги админки сканируются: `routes/pay.ts` в списке источников', () => {
    // Отказы сбора и корректировки живут в `routes/pay.ts`. Без этого файла в
    // списке тест «зелёный», а оператор видит `Отказ: sweep_disabled`.
    expect(ADMIN_SOURCES).toContain('worker/src/routes/pay.ts');
    expect(all.has('sweep_disabled')).toBe(true);
    expect(all.has('hot_wallet_missing')).toBe(true);
  });

  it('сканер не «слепой»: админские файлы действительно перечислены', () => {
    const dir = new URL('worker/src/admin/', root);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
    expect(files).toEqual(['accounts.ts', 'players.ts', 'schema.ts']);
  });
});
