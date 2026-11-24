import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MODULE_ORDER, RECIPES, RECIPE_ORDER, RESOURCE_BASE_PRICES, RESOURCE_NAMES, moduleParts,
} from '../../src/shared/gameData';

// Спрайты крафта: у каждого рецепта своя иконка по имени рецепта, у каждого
// ресурса и компонента — имя по-русски. Клиент строит путь
// `/icons/resources/<id>.png` из идентификатора и названия из RESOURCES,
// поэтому пропуск в этих таблицах виден игроку как битая картинка.

const root = new URL('../../../', import.meta.url);
const file = (path: string) => new URL(`client/${path}`, root);
const sizeOf = (path: string) => statSync(file(path)).size;

/** Ширина и высота из IHDR: клиент ждёт 128 px, тесту хватит заголовка. */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(file(path));
  const signature = buf.subarray(0, 8).toString('hex');
  expect(signature, `${path}: не PNG`).toBe('89504e470d0a1a0a');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('спрайты и названия крафта', () => {
  it('у каждого рецепта есть спрайт 128×128 и не тяжелее 40 КБ', () => {
    for (const id of RECIPE_ORDER) {
      const path = `icons/resources/${id}.png`;
      expect(pngSize(path), id).toEqual({ width: 128, height: 128 });
      expect(sizeOf(path), id).toBeLessThan(40 * 1024);
    }
  });

  it('каждый торгуемый ресурс и компонент имеет спрайт по длинной стороне 128 px', () => {
    for (const id of Object.keys(RESOURCE_BASE_PRICES)) {
      // Старые руды обрезаны по содержимому (например 59×128), поэтому проверяем
      // длинную сторону: в разметке всё равно 20–56 px и object-fit: contain.
      const { width, height } = pngSize(`icons/resources/${id}.png`);
      expect(Math.max(width, height), id).toBe(128);
    }
  });

  it('названия есть и в gameData, и в клиенте', () => {
    const app = readFileSync(new URL('client/app.js', root), 'utf8');
    for (const id of Object.keys(RESOURCE_BASE_PRICES)) {
      expect(RESOURCE_NAMES[id], id).toBeTruthy();
      // Клиентская копия нужна для журнала и подписей «сколько есть / сколько надо».
      expect(app, id).toContain(`${id}: '`);
    }
  });

  it('экран крафта делит рецепты на два круга, а не показывает одну простыню', () => {
    const app = readFileSync(new URL('client/app.js', root), 'utf8');
    expect(app).toContain('Первый круг');
    expect(app).toContain('Дальний круг');
    expect(app).toContain("class: 'craft-group'");
    // Иконка берётся из идентификатора рецепта — значит имя файла и id совпадают.
    expect(app).toContain('`/icons/resources/${r.id}.png`');
  });

  it('в рецепте не бывает компонента, которого нет в RESOURCE_NAMES', () => {
    for (const id of RECIPE_ORDER) {
      expect(RESOURCE_NAMES[id], id).toBeTruthy();
      for (const input of RECIPES[id].inputs) expect(RESOURCE_NAMES[input.resource], input.resource).toBeTruthy();
    }
    for (const id of MODULE_ORDER) {
      for (const part of moduleParts(id, 5)) expect(RESOURCE_NAMES[part.resource], part.resource).toBeTruthy();
    }
  });
});
