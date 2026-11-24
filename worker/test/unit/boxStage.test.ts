// Анимация открытия бокса — проверяется по-настоящему, в jsdom.
//
// Почему не строками: сцена состоит из 5 фаз и таймеров, и «есть класс
// is-opened» ничего не доказывает. Здесь мы прогоняем таймлайн до конца и
// смотрим, что на экране: сколько чипов, какие иконки, что написано, чем
// заканчивается и что остаётся после закрытия.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoxStage, stageItems, stageLayout } from '../../../client/box-stage.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://play.example/' });
const doc = dom.window.document;

function stage(reduced = false) {
  const win = {
    document: doc,
    innerWidth: 390,
    innerHeight: 780,
    matchMedia: (q: string) => ({ matches: reduced && q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }),
  };
  const s = createBoxStage({ doc, win });
  const closed = vi.fn();
  return { s, closed, win };
}

const payload = {
  box: 'crate_supply',
  name: 'Ящик снабжения',
  sprite: '/sprites/boxes/crate_supply.png',
  drops: [
    { resource: 'iron_ore', name: 'Железная руда', amount: 12 },
    { resource: 'silicon', name: 'Кремний', amount: 5 },
    { resource: 'circuit', name: 'Схема', amount: 1 },
    { resource: 'astralite', name: 'Астралит', amount: 1 },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  doc.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('данные сцены', () => {
  it('одинаковые ресурсы складываются, нули и мусор отбрасываются', () => {
    expect(stageItems([
      { resource: 'iron_ore', amount: 3 },
      { resource: 'iron_ore', amount: 2 },
      { resource: 'ice', amount: 0 },
      { resource: '', amount: 4 },
      null,
    ])).toEqual([
      { resource: 'iron_ore', name: 'iron_ore', amount: 5 },
    ]);
  });

  it('чипы расходятся веером вверх и не выходят за экран телефона', () => {
    const layout = stageLayout(4, 390);
    expect(layout).toHaveLength(4);
    // Первый и последний — по краям веера, значит одинаково далеко от центра.
    expect(Math.abs(layout[0].tx)).toBe(Math.abs(layout[3].tx));
    // Вверх: координата y отрицательная у всех.
    for (const p of layout) expect(p.ty).toBeLessThan(0);
    // Чип шириной 68 px: на экране 390 px дальше 133 px от центра он бы обрезался.
    for (const p of layout) expect(Math.abs(p.tx)).toBeLessThanOrEqual(133);
    for (const p of layout) expect(p.ty).toBeGreaterThanOrEqual(-133);
  });
});

describe('сцена открытия', () => {
  it('фазы идут по порядку: бокс, тряска, вспышка, ресурсы, итог', () => {
    const { s } = stage();
    s.play(payload);
    const root = doc.querySelector('.box-stage') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute('role')).toBe('dialog');
    expect((doc.querySelector('.box-stage-result') as HTMLElement).hidden).toBe(true);
    expect(doc.querySelectorAll('.box-spark').length).toBeGreaterThan(10);

    vi.advanceTimersByTime(400);
    expect(root.classList.contains('is-shaking')).toBe(true);
    expect(root.classList.contains('is-opened')).toBe(false);

    vi.advanceTimersByTime(500);
    expect(root.classList.contains('is-opened')).toBe(true);

    // Чипы: по одному на каждый ресурс, с иконкой и количеством.
    const chips = [...doc.querySelectorAll('.box-chip')] as HTMLElement[];
    expect(chips).toHaveLength(4);
    expect(chips.map((c) => c.dataset.resource)).toEqual(['iron_ore', 'silicon', 'circuit', 'astralite']);
    expect(chips[0].querySelector('img')?.getAttribute('src')).toBe('/icons/resources/iron_ore.png');
    expect(chips[0].querySelector('.box-chip-count')?.textContent).toBe('×12');
    expect(chips[2].classList.contains('is-part')).toBe(true);
    expect(chips[3].classList.contains('is-rare')).toBe(true);
    // Каждый чип знает, куда лететь.
    expect(chips[0].style.getPropertyValue('--tx')).not.toBe('');
    expect(chips[1].style.getPropertyValue('--delay')).toBe('70ms');

    // Итог появляется после последнего чипа.
    vi.advanceTimersByTime(2000);
    const result = doc.querySelector('.box-stage-result') as HTMLElement;
    expect(result.hidden).toBe(false);
    expect(result.textContent).toContain('Ящик снабжения');
    expect(result.textContent).toContain('Схема');
    expect(result.textContent).toContain('Редкая находка!');
    expect(result.textContent).toContain('Компонентов: 1');
  });

  it('клик по сцене проматывает анимацию, «Забрать» закрывает и убирает узел', () => {
    const { s, closed } = stage();
    s.play(payload, closed);
    vi.advanceTimersByTime(100);

    const root = doc.querySelector('.box-stage') as HTMLElement;
    root.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(root.classList.contains('is-settled')).toBe(true);
    expect((doc.querySelector('.box-stage-result') as HTMLElement).hidden).toBe(false);

    (doc.querySelector('[data-box-close]') as HTMLElement).click();
    expect(doc.querySelector('.box-stage')).toBeNull();
    expect(doc.body.classList.contains('is-box-stage')).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('Escape и Enter тоже проматывают, а не закрывают молча', () => {
    const { s } = stage();
    s.play(payload);
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect((doc.querySelector('.box-stage-result') as HTMLElement).hidden).toBe(false);
    expect(doc.querySelector('.box-stage')).toBeTruthy();
  });

  it('при reduced-motion анимации нет: сразу результат', () => {
    const { s } = stage(true);
    s.play(payload);
    const root = doc.querySelector('.box-stage') as HTMLElement;
    expect(root.classList.contains('is-settled')).toBe(true);
    expect((doc.querySelector('.box-stage-result') as HTMLElement).hidden).toBe(false);
    expect(root.classList.contains('is-shaking')).toBe(false);
  });

  it('новая сцена не оставляет на экране старую', () => {
    const { s } = stage();
    s.play(payload);
    s.play({ ...payload, box: 'daily', name: 'Дневной бокс' });
    expect(doc.querySelectorAll('.box-stage')).toHaveLength(1);
    expect((doc.querySelector('.box-stage') as HTMLElement).dataset.boxId).toBe('daily');
  });

  it(' стили и разметка страницы знают про сцену', () => {
    const css = readFileSync(new URL('../../../client/styles.css', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../../client/app.js', import.meta.url), 'utf8');
    for (const rule of ['.box-stage', '.box-chip', '@keyframes box-fly', '@keyframes box-shake', '@keyframes box-spark', 'prefers-reduced-motion']) {
      expect(css).toContain(rule);
    }
    expect(app).toContain("from './box-stage.js'");
    // Сцена запускается только после успешного ответа сервера.
    expect(app).toContain('boxStage.play(');
    expect(app).toContain('res.status < 400');
  });
});
