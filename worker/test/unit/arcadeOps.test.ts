import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Про то, как аркаду проверяют на живом воркере. Этот файл — страховка для
// исполнителя: `scripts/arcade-smoke.ts` и промт в `docs/ARCADE-AGENT-PROMPT.md`
// должны остаться тем, чем заявлены. Опасность ровно одна: смоук «упрощают»
// до curl /health, и тогда проверка «аркада работает» снова начинает ничего не
// доказывать — а именно на это жаловался владелец («не могу открыть аркаду»).

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const smoke = read('scripts/arcade-smoke.ts');
const prompt = read('docs/ARCADE-AGENT-PROMPT.md');

describe('смоук аркады', () => {
  it('команда есть и ведёт в скрипт, а не в заметку', () => {
    expect(pkg.scripts['smoke:arcade']).toBe('tsx scripts/arcade-smoke.ts');
  });

  it('проверяет ровно то, что обещано: античит, награда, ASTRA, журнал', () => {
    // Ключевые проверки не должны «выпасть» из смоука при рефакторинге.
    for (const needle of [
      'bad_trace', 'run_expired', 'Idempotency-Key', 'balances?.astra',
      "e.reason === 'arcade'", 'perfectMoves(', 'GET /arcade',
    ]) {
      expect(smoke, needle).toContain(needle);
    }
    // Каталог и очки: сверяются с общими константами, а не с цифрами «на глаз».
    expect(smoke).toContain('ARCADE_GAMES.length');
  });

  it('не отправляет очки и не «договаривается» с сервером', () => {
    // Смоук — клиент, как и браузер: только ввод, никаких score/win в теле.
    const bodies = [...smoke.matchAll(/body: \{[^}]*\}/g)].map((m) => m[0]);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b).not.toMatch(/\bscore\s*:/);
      expect(b).not.toMatch(/\bwin\s*:/);
    }
    // Лабиринт решается общим модулем — тем же кодом, что считает сервер.
    expect(smoke).toContain("from '../worker/src/shared/arcade'");
  });

  it('не пишет в базу и не начисляет награды руками', () => {
    expect(smoke).not.toMatch(/UPDATE |INSERT |DELETE FROM/);
    expect(smoke).not.toContain('admin/world/grant');
  });

  it('завершается ошибкой, если хотя бы одна строка не совпала', () => {
    expect(smoke).toContain('process.exitCode = 1');
    expect(smoke).toMatch(/function check\(ok: boolean, message: string\)/);
  });
});

describe('промт для исполнителя с доступом', () => {
  it('объясняет главное: миграций D1 для аркады нет', () => {
    expect(prompt).toContain('миграций D1 для аркады нет');
    expect(prompt).toContain('017_arcade.sql');
    expect(prompt).toContain('IF NOT EXISTS');
    // И не даёт «помочь» руками.
    expect(prompt).toContain('Не начислять XP, ASTRA и очки вручную');
  });

  it('ведёт от деплоя к живой проверке и требует отчёт', () => {
    for (const needle of ['npm run deploy', 'smoke:arcade', 'ШАГ 5', 'ОТЧЁТ', 'npx wrangler rollback']) {
      expect(prompt, needle).toContain(needle);
    }
    // Секреты: запрет printed в чат — обязателен, иначе промт опасен.
    expect(prompt).toContain('Секреты не печатать');
  });

  it('ссылается на документы раздела, а не пересказывает их', () => {
    expect(prompt).toContain('docs/ARCADE.md');
    expect(prompt).toContain('docs/API.md');
    expect(read('docs/MONITORING.md')).toContain('smoke:arcade');
    expect(read('README.md')).toContain('smoke:arcade');
    expect(read('docs/ARCADE.md')).toContain('docs/ARCADE-AGENT-PROMPT.md');
  });
});
