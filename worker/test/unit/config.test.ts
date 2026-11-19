import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Конфиг воркера — тоже код, и ошибка здесь дороже ошибки в обработчике:
// ключ подписи, попавший в боевые `[vars]`, утекает в публичный репозиторий,
// а превью-база, совпавшая с боевой, ломает изоляцию тестовых аккаунтов.
// Тест держит три вещи: прод без секретов в vars, превью со своим ключом,
// разные D1 у окружений.

const root = new URL('../../../', import.meta.url);
const toml = readFileSync(new URL('wrangler.toml', root), 'utf8');
const generated = readFileSync(new URL('worker/wrangler.toml', root), 'utf8');

/** Строки одной секции: понимает и `[name]`, и `[[name]]`, и вложенные `[a.b]`. */
function section(text: string, name: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inside = trimmed === `[${name}]` || trimmed === `[[${name}]]`;
      continue;
    }
    if (inside) out.push(line);
  }
  return out;
}

/** Пары ключ-значение из строк секции; комментарии и пустые строки пропускаются. */
function values(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    map.set(key, raw.replace(/^"|"$/g, ''));
  }
  return map;
}

const prodVars = values(section(toml, 'vars'));
const previewVars = values(section(toml, 'previews.vars'));
const prodDb = values(section(toml, 'd1_databases'));
const previewDb = values(section(toml, 'previews.d1_databases'));

describe('конфиг воркера (этапы 2–3)', () => {
  it('в боевых vars нет ключей: только публичные значения', () => {
    expect(prodVars.has('JWT_SECRET')).toBe(false);
    expect(prodVars.has('TURNSTILE_SECRET')).toBe(false);
    expect(prodVars.get('TURNSTILE_SITE_KEY')).toMatch(/^0x/);
  });

  it('секретные имена не встречаются вне блока превью', () => {
    // Всё до `[previews]` — боевая часть конфига.
    const beforePreviews = toml.slice(0, toml.indexOf('[previews]'));
    expect(beforePreviews).not.toContain('JWT_SECRET =');
    expect(beforePreviews).not.toContain('TURNSTILE_SECRET =');
  });

  it('превью получает ключ подписи, чтобы сборка работала без терминала', () => {
    const key = previewVars.get('JWT_SECRET') ?? '';
    expect(key.length).toBeGreaterThanOrEqual(32); // столько требует guards.ts
    // Значение должно само кричать, что оно не боевое.
    expect(key).toContain('preview');
    expect(previewVars.get('TURNSTILE_SITE_KEY')).toBe('');
  });

  it('у превью своя D1, не боевая', () => {
    const prodId = prodDb.get('database_id');
    const previewId = previewDb.get('database_id');
    expect(prodId).toMatch(/^[0-9a-f-]{36}$/);
    expect(previewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(previewId).not.toBe(prodId);
    expect(previewDb.get('database_name')).toBe('astra-preview');
  });

  it('оба конфига описывают одно и то же превью', () => {
    expect(generated).toContain('[previews]');
    expect(generated).toContain('preview_database_id');
    expect(generated).toContain('main = "src/index.ts"');
    expect(generated).toContain('directory = "../client"');
  });
});
