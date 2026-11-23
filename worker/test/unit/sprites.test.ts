import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Правило проекта: в интерфейсе нет SVG. Игрок видит PNG-спрайты — иконки,
// кнопки, фон, астероиды, корабль. Тест следит за двумя вещами: что SVG не
// просочился обратно и что каждая картинка, на которую ссылается клиент,
// действительно лежит в client/ (иначе на проде будет битая иконка).

const root = new URL('../../../', import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const html = read('client/index.html');
const app = read('client/app.js');
const css = read('client/styles.css');
const payHtml = read('client/pay.html');
const payJs = read('client/pay.js');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const clientFiles = walk('client');

describe('спрайты: только PNG', () => {
  it('в client/ не осталось ни одного SVG', () => {
    expect(clientFiles.filter((f) => f.endsWith('.svg'))).toEqual([]);
  });

  it('ни HTML, ни JS, ни CSS не ссылаются на .svg', () => {
    for (const text of [html, app, css, payHtml, payJs]) {
      expect(text.includes('.svg')).toBe(false);
    }
  });

  it('каждая картинка из разметки и кода существует', () => {
    const sources = [html, app, css, payHtml, payJs].join('\n');
    const refs = new Set<string>();
    for (const match of sources.matchAll(/\/(?:icons|sprites|avatars)\/[a-zA-Z0-9_./-]+\.png/g)) {
      refs.add(match[0]);
    }
    // Шаблонные пути (/sprites/ships/${type}.png) проверяются отдельно: у нас
    // есть по файлу на каждый класс корабля.
    expect(refs.size).toBeGreaterThan(15);
    const missing = [...refs].filter((ref) => !existsSync(join(root, 'client', ref)));
    expect(missing).toEqual([]);
  });

  it('это настоящие PNG, а не переименованные файлы', () => {
    const pngs = clientFiles.filter((f) => f.endsWith('.png'));
    expect(pngs.length).toBeGreaterThan(25);
    for (const file of pngs) {
      const bytes = readFileSync(join(root, file)).subarray(0, 8);
      expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      // Спрайт не должен весить как фотография: иначе мобильный интернет умрёт.
      expect(statSync(join(root, file)).size).toBeLessThan(400 * 1024);
    }
  });
});

describe('спрайты арены и фоны', () => {
  it('у игры есть PNG-спрайты: корабль, кристалл, три астероида, взрыв', () => {
    for (const name of ['ship', 'crystal', 'boom', 'asteroid_1', 'asteroid_2', 'asteroid_3']) {
      expect(existsSync(join(root, `client/sprites/arena/${name}.png`))).toBe(true);
    }
    expect(app).toContain("'/sprites/arena/ship.png'");
    expect(app).toContain("'/sprites/arena/crystal.png'");
    expect(app).toContain('drawImage');
  });

  it('фон — тоже файл, и он подключён', () => {
    // hero.png был байт-в-байт копией space.png — держим один файл.
    for (const name of ['space', 'arena']) {
      expect(existsSync(join(root, `client/sprites/bg/${name}.png`))).toBe(true);
    }
    expect(existsSync(join(root, 'client/sprites/bg/hero.png'))).toBe(false);
    expect(css).not.toContain("url('/sprites/bg/hero.png')");
    expect(css).toContain("url('/sprites/bg/space.png')");
    expect(app).toContain("'/sprites/bg/arena.png'");
  });

  it('ни одна ссылка на спрайт не ведёт в пустоту', () => {
    // Ловит удалённый файл, о котором забыли в разметке: раньше так жил hero.png.
    const files = new Set<string>();
    const walk = (rel: string) => {
      for (const name of readdirSync(join(root, 'client', rel))) {
        const relPath = `${rel}/${name}`;
        if (statSync(join(root, 'client', relPath)).isDirectory()) walk(relPath);
        else files.add(`/${relPath}`);
      }
    };
    for (const dir of ['sprites', 'icons', 'avatars']) walk(dir);

    const texts = ['app.js', 'pay.js', 'pool.js', 'admin.js', 'i18n.js',
      'index.html', 'pay.html', 'pool.html', 'admin.html', 'styles.css', 'pay.css']
      .map((name) => read(`client/${name}`)).join('\n');
    const refs = new Set(Array.from(texts.matchAll(/['"(](\/(?:sprites|icons|avatars)\/[A-Za-z0-9_./-]+)/g), (m) => m[1]));
    expect(refs.size).toBeGreaterThan(20);
    expect([...refs].filter((ref) => !files.has(ref))).toEqual([]);
  });

  it('скрипт сборки спрайтов лежит в репозитории', () => {
    expect(existsSync(join(root, 'scripts/build-sprites.sh'))).toBe(true);
    expect(read('scripts/build-sprites.sh')).toContain('convert -size');
  });

  it('иконки кнопок — PNG и подключены к доку', () => {
    for (const icon of ['arena', 'login', 'register', 'logout', 'play', 'claim', 'refresh', 'buy']) {
      expect(existsSync(join(root, `client/icons/ui/${icon}.png`))).toBe(true);
    }
    expect(html).toContain('/icons/ui/arena.png');
    expect(html).toContain('/icons/ui/login.png');
    expect(html).toContain('/icons/nav/pay.png');
    expect(html).toContain('/icons/nav/bonus.png');
  });
});
