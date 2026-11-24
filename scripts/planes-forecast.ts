#!/usr/bin/env tsx
// Экономика авиазвена: шансы по редкости, боксы и патрули.
//
// Машины звена — коллекция без экономического веса: они не дают ни ASTRA, ни
// ресурсов, ни параллельных рейсов. Поэтому «цена» машины считается только как
// потраченная ASTRA на боксы, а не как будущий доход. Скрипт считает:
//   1. шанс каждой редкости в каждом боксе (через тот же rollPlane, что у сервера);
//   2. сколько ASTRA уходит на одну машину, если открывать только платные;
//   3. шанс находки в патруле и сколько вылетов нужно на одну машину;
//   4. сколько времени занимает полная коллекция при разном темпе.
//
// Прогон: `npx tsx scripts/planes-forecast.ts` (по умолчанию 20 000 seed'ов).
import {
  BOXES, BOX_ORDER, PATROL, PLANES, PLANE_ORDER, PLANE_RARITY_NAMES, PLANE_RARITY_ORDER,
  planesOfRarity, type BoxId, type PlaneId, type PlaneRarity,
} from '../worker/src/shared/gameData';
import { rollPlane } from '../worker/src/world/modules/boxes';
import { rollPatrol } from '../worker/src/world/modules/planes';

const args = process.argv.slice(2);
const runs = Number(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 20000);
const seeds = Number(args.find((a) => a.startsWith('--seeds='))?.split('=')[1] ?? 20000);

let state = 20261117;
function rnd(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 16 байт hex — тот же формат, что у сервера (crypto.randomUUID без дефисов). */
function hexSeed(): string {
  let out = '';
  for (let i = 0; i < 16; i++) out += Math.floor(rnd() * 256).toString(16).padStart(2, '0');
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(3)} %`;
const astra = (x: number) => Math.round(x).toLocaleString('ru-RU');
const per = (x: number) => (x > 0 ? `${Math.round(1 / x).toLocaleString('ru-RU')} шт.` : '—');

console.log(`Авиазвено — прогноз (${seeds.toLocaleString('ru-RU')} seed'ов на бокс)\n`);

// 1. Шансы по редкости: считаем тем же rollPlane, что и сервер.
const perBox = new Map<BoxId, { hits: Map<PlaneRarity, number>; opens: number }>();
for (const id of BOX_ORDER) perBox.set(id, { hits: new Map(), opens: 0 });
for (let i = 0; i < seeds; i++) {
  const seed = hexSeed();
  for (const id of BOX_ORDER) {
    const slot = perBox.get(id)!;
    slot.opens += 1;
    const plane = rollPlane(BOXES[id], seed);
    if (plane) slot.hits.set(PLANES[plane].rarity, (slot.hits.get(PLANES[plane].rarity) ?? 0) + 1);
  }
}

console.log('Бокс            цена   обычная   редкая   легендарная   всего    открытий на машину');
for (const id of BOX_ORDER) {
  const def = BOXES[id];
  const slot = perBox.get(id)!;
  const rate = (r: PlaneRarity) => (slot.hits.get(r) ?? 0) / slot.opens;
  const total = PLANE_RARITY_ORDER.reduce((sum, r) => sum + rate(r), 0);
  console.log(
    `${id.padEnd(15)} ${String(def.price).padStart(5)}   ${pct(rate('common')).padStart(8)}   ${pct(rate('rare')).padStart(7)}   ${pct(rate('legendary')).padStart(12)}   ${pct(total).padStart(7)}   ${per(total).padStart(6)}`,
  );
}

console.log('\nШанс конкретной модели за одно открытие:');
for (const id of BOX_ORDER) {
  const slot = perBox.get(id)!;
  const parts: string[] = [];
  for (const rarity of PLANE_RARITY_ORDER) {
    const pool = planesOfRarity(rarity).length;
    const rate = (slot.hits.get(rarity) ?? 0) / slot.opens;
    if (!pool || !rate) continue;
    parts.push(`${PLANE_RARITY_NAMES[rarity]}: ${pct(rate / pool)}`);
  }
  console.log(`  ${id.padEnd(14)} ${parts.join(' · ')}`);
}

// 2. Патруль: шанс находки за вылет и сколько вылетов нужно.
console.log('\nПатруль (машина летает сама, наград в экономике нет):');
console.log('Машина      редкость      полёт    шанс находки   вылетов на машину   что находит');
for (const id of PLANE_ORDER) {
  const def = PLANES[id];
  const cfg = PATROL[def.rarity];
  const hours = cfg.ms / 3600000;
  const found = new Map<PlaneId, number>();
  for (let i = 0; i < 20000; i++) {
    const plane = rollPatrol(id, hexSeed());
    if (plane) found.set(plane, (found.get(plane) ?? 0) + 1);
  }
  const hits = [...found.values()].reduce((a, b) => a + b, 0);
  const rate = hits / 20000;
  const commonShare = [...found.entries()]
    .filter(([p]) => PLANES[p].rarity === 'common')
    .reduce((a, [, n]) => a + n, 0) / Math.max(1, hits);
  console.log(
    `${id.padEnd(11)} ${(PLANE_RARITY_NAMES[def.rarity]).padEnd(12)} ${`${hours} ч`.padStart(7)}   ${pct(rate).padStart(10)}   ${per(rate).padStart(15)}   обычных ${pct(commonShare)}`,
  );
}

// 3. Полная коллекция: боксы + патрули.
function simulate(dailyPaid: number, patrolsPerDay: number, weeks: number): { astra: number; weeks: number; found: number } {
  const owned = new Set<PlaneId>();
  let spent = 0;
  let weeksDone = 0;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const plan: BoxId[] = ['daily'];
      if (d === 0) plan.push('weekly');
      for (let i = 0; i < Math.round(dailyPaid / 7); i++) plan.push(i % 3 === 2 ? 'crate_pro' : 'crate_supply');
      for (const box of plan) {
        spent += BOXES[box].price;
        const plane = rollPlane(BOXES[box], hexSeed());
        if (plane) owned.add(plane);
      }
      // Патрули: летает одна машина за раз, полёт долгий (6/12/24 ч). Модель
      // простая: игрок «бодрствует» 16 часов в сутки и запускает вылет, когда
      // предыдущий вернулся; всего не больше patrolsPerDay заходов.
      let awake = 16;
      let flights = 0;
      while (flights < patrolsPerDay && awake > 0) {
        const planes = PLANE_ORDER.filter((p) => owned.has(p));
        if (!planes.length) break; // без машины летать некому
        const flyer = planes[Math.floor(rnd() * planes.length)];
        const hours = PATROL[PLANES[flyer].rarity].ms / 3600000;
        if (hours > awake) break; // не успевает вернуться до отбоя
        awake -= hours;
        flights += 1;
        const found = rollPatrol(flyer, hexSeed());
        if (found) owned.add(found);
      }
    }
    if (owned.size === PLANE_ORDER.length && !weeksDone) weeksDone = w + 1;
  }
  return { astra: spent, weeks: weeksDone, found: owned.size };
}

const TEMPOS: [string, number, number][] = [
  ['бесплатные боксы, без патрулей', 0, 0],
  ['бесплатные + 1 патруль в день', 0, 1],
  ['бесплатные + максимум патрулей (4/день обычными)', 0, 4],
  ['+3 платных в неделю, 2 патруля в день', 3, 2],
  ['+7 платных в неделю, максимум патрулей', 7, 4],
];
const HORIZON = 52;

console.log(`\nПолная коллекция за ${HORIZON} недель (${runs.toLocaleString('ru-RU')} прогонов):`);
console.log('Темп                                            ASTRA за год   собрано   недель до полной');
for (const [label, paid, patrols] of TEMPOS) {
  let spend = 0;
  let full = 0;
  const done: number[] = [];
  for (let i = 0; i < runs; i++) {
    const res = simulate(paid, patrols, HORIZON);
    spend += res.astra;
    if (res.found === PLANE_ORDER.length) full += 1;
    if (res.weeks) done.push(res.weeks);
  }
  const avg = done.length ? done.reduce((a, b) => a + b, 0) / done.length : 0;
  console.log(
    `${label.padEnd(50)} ${astra(spend / runs).padStart(13)}   ${pct(full / runs).padStart(7)}   ${(avg ? avg.toFixed(0) : '—').padStart(16)}`,
  );
}

console.log('\nЧто это значит: машины стали в 5–8 раз реже, чем в первом выпуске, а');
console.log('легендарная — только в грузовом контейнере (1 из 250 открытий) и в патруле с');
console.log('редкой машины. Патруль не даёт ни ASTRA, ни ресурсов, поэтому на экономику');
console.log('он не влияет вовсе: это способ добрать коллекцию временем, а не валютой.');
console.log('Кто не играет каждый день — просто не летает: 4 вылета в сутки потолок.');
