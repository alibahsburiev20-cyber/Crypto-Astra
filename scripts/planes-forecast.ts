#!/usr/bin/env tsx
// Экономика авиазвена: сколько машин падает из боксов и сколько это стоит.
//
// Машины звена — коллекция без экономического веса: они не дают ни ASTRA, ни
// ресурсов, ни параллельных рейсов. Поэтому «цена» машины считается только как
// потраченная ASTRA на боксы, а не как будущий доход. Скрипт считает:
//   1. шанс каждой редкости в каждом боксе;
//   2. сколько ASTRA уходит на одну машину, если открывать только платные;
//   3. сколько времени занимает полная коллекция при разном темпе.
//
// Прогон: `npx tsx scripts/planes-forecast.ts` (по умолчанию 20 000 прогонов).
import { BOXES, BOX_ORDER, PLANES, PLANE_ORDER, type BoxId, type PlaneId } from '../worker/src/shared/gameData';
import { rollBox } from '../worker/src/world/modules/boxes';

const args = process.argv.slice(2);
const runs = Number(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 20000);
const seeds = Number(args.find((a) => a.startsWith('--seeds='))?.split('=')[1] ?? 20000);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 16 байт hex — тот же формат, что у сервера (crypto.randomUUID без дефисов). */
function hexSeed(rnd: () => number): string {
  let out = '';
  for (let i = 0; i < 16; i++) out += Math.floor(rnd() * 256).toString(16).padStart(2, '0');
  return out;
}

const rnd = mulberry32(20261117);

// 1. Частота по боксам — прямо через rollBox, чтобы числа были из кода, а не из прозы.
const perBox = new Map<BoxId, { hits: Map<PlaneId, number>; opens: number }>();
for (const id of BOX_ORDER) perBox.set(id, { hits: new Map(), opens: 0 });
for (let i = 0; i < seeds; i++) {
  const seed = hexSeed(rnd);
  for (const id of BOX_ORDER) {
    const slot = perBox.get(id)!;
    slot.opens += 1;
    const roll = rollBox(BOXES[id], seed);
    if (roll.plane) slot.hits.set(roll.plane, (slot.hits.get(roll.plane) ?? 0) + 1);
  }
}

const pct = (x: number) => `${(x * 100).toFixed(2)} %`;
const astra = (x: number) => Math.round(x).toLocaleString('ru-RU');

console.log(`Авиазвено — прогноз (${seeds.toLocaleString('ru-RU')} seed'ов на бокс)\n`);

console.log('Бокс            цена    шанс машины   ASTRA за машину   состав пула');
for (const id of BOX_ORDER) {
  const def = BOXES[id];
  const slot = perBox.get(id)!;
  const hits = [...slot.hits.values()].reduce((a, b) => a + b, 0);
  const rate = hits / slot.opens;
  const perPlane = def.price > 0 && rate > 0 ? def.price / rate : 0;
  const pool = def.plane!.pool;
  const rare = pool.filter((p) => PLANES[p].rarity !== 'common').length;
  console.log(
    `${id.padEnd(15)} ${String(def.price).padStart(4)}   ${pct(rate).padStart(11)}   ${(perPlane ? astra(perPlane) : '—').padStart(15)}   ${pool.length} модел., редких ${rare}`,
  );
}

console.log('\nШанс конкретной модели за одно открытие:');
for (const id of BOX_ORDER) {
  const def = BOXES[id];
  const pool = def.plane!.pool;
  const per = def.plane!.chance / pool.length;
  const feniks = pool.includes('feniks') ? `${pct(per)} на Феникса` : 'Феникса нет';
  console.log(`  ${id.padEnd(14)} ${pct(per).padStart(7)} на любую из пула · ${feniks}`);
}

// 2. Полная коллекция: сколько боксов и сколько ASTRA.
// Модель игрока: 1 дневной + 1 недельный бесплатно, плюс N платных в неделю.
function simulate(dailyPaid: number, weeks: number): { boxes: number; astra: number; weeks: number; full: number } {
  const open = (id: BoxId) => {
    const roll = rollBox(BOXES[id], hexSeed(rnd));
    return { plane: roll.plane, price: BOXES[id].price };
  };
  const boxes = new Map<BoxId, number>();
  let spent = 0;
  const owned = new Map<PlaneId, number>();
  let weeksDone = 0;
  for (let w = 0; w < weeks; w++) {
    const plan: BoxId[] = ['daily', 'daily', 'daily', 'daily', 'daily', 'daily', 'daily', 'weekly'];
    for (let i = 0; i < dailyPaid; i++) plan.push(i % 3 === 2 ? 'crate_pro' : 'crate_supply');
    for (const id of plan) {
      boxes.set(id, (boxes.get(id) ?? 0) + 1);
      const res = open(id);
      spent += res.price;
      if (res.plane) owned.set(res.plane, (owned.get(res.plane) ?? 0) + 1);
    }
    if (owned.size === PLANE_ORDER.length && !weeksDone) weeksDone = w + 1;
  }
  const total = [...boxes.values()].reduce((a, b) => a + b, 0);
  return { boxes: total, astra: spent, weeks: weeksDone, full: owned.size };
}

const TEMPOS: [string, number][] = [
  ['только бесплатные', 0],
  ['+3 платных в неделю', 3],
  ['+7 платных в неделю', 7],
  ['+21 платный в неделю', 21],
];
const HORIZON = 52;

console.log(`\nПолная коллекция за ${HORIZON} недель (${runs.toLocaleString('ru-RU')} прогонов):`);
console.log('Темп                      боксов за год   ASTRA за год   собрано   недель до полной');
for (const [label, paid] of TEMPOS) {
  let boxes = 0;
  let spend = 0;
  let full = 0;
  const doneWeeks: number[] = [];
  for (let i = 0; i < runs; i++) {
    const res = simulate(paid, HORIZON);
    boxes += res.boxes;
    spend += res.astra;
    if (res.full === PLANE_ORDER.length) full += 1;
    if (res.weeks) doneWeeks.push(res.weeks);
  }
  const avgWeeks = doneWeeks.length ? doneWeeks.reduce((a, b) => a + b, 0) / doneWeeks.length : 0;
  console.log(
    `${label.padEnd(24)} ${astra(boxes / runs).padStart(14)} ${astra(spend / runs).padStart(14)}   ${pct(full / runs).padStart(7)}   ${(avgWeeks ? avgWeeks.toFixed(0) : '—').padStart(16)}`,
  );
}

// Сколько даёт игра без платежей: 7 дневных и 1 недельный в неделю.
const freePerWeek = 7 * BOXES.daily.plane!.chance + BOXES.weekly.plane!.chance;
const feniksWeekly = BOXES.weekly.plane!.chance / BOXES.weekly.plane!.pool.length;
const feniksCrate = BOXES.crate_pro.plane!.chance / BOXES.crate_pro.plane!.pool.length;
console.log('\nБесплатный путь (7 дневных + 1 недельный в неделю):');
console.log(`  ≈ ${freePerWeek.toFixed(2)} машины в неделю, то есть полка из 8 моделей заполняется месяцами.`);
console.log(`  Феникс: ${pct(feniksWeekly)} за недельный бокс (≈ ${Math.round(1 / feniksWeekly)} недель) и ${pct(feniksCrate)} за контейнер.`);
console.log('  Это цель на сезон, а не на вечер — и всё равно только картинка в гараже.');
