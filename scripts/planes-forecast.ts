#!/usr/bin/env tsx
// Экономика авиазвена: шансы по редкости, боксы, патрули и закладка добычи.
//
// Звено — коллекция, которая умеет летать за ресурсами. ASTRA при этом не
// печатается вовсе: доход машины — только ресурсы и опыт, и в деньги они
// превращаются вторым действием (крафт или рынок). Поэтому «цена» машины
// считается как потраченная ASTRA на боксы, а её «доход» — в ресурсных единицах и
// в ASTRA-эквиваленте по базовым ценам, чтобы было видно масштаб. Скрипт считает:
//   1. шанс каждой редкости в каждом боксе (через тот же rollPlane, что у сервера,
//      включая анти-дубль: повторных моделей бокс не выдаёт);
//   2. сколько ASTRA уходит на одну машину, если открывать только платные;
//   3. шанс находки в патруле, сколько вылетов нужно на одну машину и сколько
//      ресурсов звено приносит в сутки при полном слоте;
//   4. сколько времени занимает полная коллекция при разном темпе.
//
// Прогон: `npx tsx scripts/planes-forecast.ts` — это 20 000 seed'ов на бокс и
// 4 000 прогонов года (минута работы); `--runs` / `--seeds` режут точность.
import {
  BOXES, BOX_ORDER, PATROL, PATROL_MAX_CONCURRENT, PLANES, PLANE_ORDER, PLANE_RARITY_NAMES,
  PLANE_RARITY_ORDER, RESOURCE_BASE_PRICES, planesOfRarity, salvageLabel,
  type BoxId, type PlaneId, type PlaneRarity,
} from '../worker/src/shared/gameData';
import { rollPlane } from '../worker/src/world/modules/boxes';
import { rollPatrol } from '../worker/src/world/modules/planes';

const args = process.argv.slice(2);
const runs = Number(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 4000);
// Сколько вылетов на машину прокрутить во втором разделе. Число своё: оно делит
// себя само, поэтому `--seeds` на него влиять не должно.
const PATROL_ROLLS = 20000;
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
/** Сколько вылетов нужно на одну машину — в тех же вылетах, что и колонка выше. */
const flights = (x: number) => (x > 0 ? `≈ ${Math.round(1 / x).toLocaleString('ru-RU')} выл.` : '—');

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

// 2. Патруль: шанс находки за вылет, закладка и сколько вылетов нужно.
console.log('\nПатруль (машина летает сама и привозит ресурсы + опыт; ASTRA — никогда):');
console.log('Машина      редкость      полёт    шанс находки   вылетов на машину   закладка                 ≈ ASTRA за вылет');
for (const id of PLANE_ORDER) {
  const def = PLANES[id];
  const cfg = PATROL[def.rarity];
  const hours = cfg.ms / 3600000;
  const found = new Map<PlaneId, number>();
  for (let i = 0; i < PATROL_ROLLS; i++) {
    const plane = rollPatrol(id, hexSeed());
    if (plane) found.set(plane, (found.get(plane) ?? 0) + 1);
  }
  const hits = [...found.values()].reduce((a, b) => a + b, 0);
  const rate = hits / PATROL_ROLLS;
  const commonShare = [...found.entries()]
    .filter(([p]) => PLANES[p].rarity === 'common')
    .reduce((a, [, n]) => a + n, 0) / Math.max(1, hits);
  // Закладка в ASTRA-эквиваленте — только чтобы сравнить масштаб с рейсами:
  // продаёт ресурсы игрок решает сам, и цена рынка гуляет вокруг базовой.
  const value = Object.entries(cfg.salvage)
    .reduce((sum, [resource, amount]) => sum + amount * (RESOURCE_BASE_PRICES[resource] ?? 0), 0);
  console.log(
    `${id.padEnd(11)} ${(PLANE_RARITY_NAMES[def.rarity]).padEnd(12)} ${`${hours} ч`.padStart(7)}   ${pct(rate).padStart(10)}   ${flights(rate).padStart(15)}   ${salvageLabel(cfg.salvage).padEnd(30)} ${String(Math.round(value)).padStart(6)} + ${cfg.xp} XP  (обычных ${pct(commonShare)})`,
  );
}

// 2b. Что даёт полный слот звена. Перебираем все составы из PLANE_ORDER по
// PATROL_MAX_CONCURRENT бортов (одна модель — один вылет) и показываем три
// крайности: максимум единиц добычи, максимум ASTRA-эквивалента и состав новичка
// из четырёх обычных машин. Честный потолок важнее красивой строчки: подпись
// «четыре борта» под суммой всех восьми машин была именно такой красивостью.
function perDay(rarity: PlaneRarity): number {
  return Math.floor((24 * 3600_000) / PATROL[rarity].ms);
}
function patrolValue(rarity: PlaneRarity): number {
  return Object.entries(PATROL[rarity].salvage)
    .reduce((sum, [resource, amount]) => sum + amount * (RESOURCE_BASE_PRICES[resource] ?? 0), 0);
}
interface DayYield {
  units: Map<string, number>;
  count: number;
  xp: number;
  value: number;
}
function dayOf(roster: PlaneId[]): DayYield {
  const units = new Map<string, number>();
  let count = 0;
  let xp = 0;
  let value = 0;
  for (const id of roster) {
    const cfg = PATROL[PLANES[id].rarity];
    const times = perDay(PLANES[id].rarity);
    for (const [resource, amount] of Object.entries(cfg.salvage)) {
      units.set(resource, (units.get(resource) ?? 0) + amount * times);
      count += amount * times;
    }
    xp += cfg.xp * times;
    value += patrolValue(PLANES[id].rarity) * times;
  }
  return { units, count, xp, value };
}
function describe(roster: PlaneId[]): string {
  const y = dayOf(roster);
  return `[${roster.join(', ')}]`.padEnd(46)
    + ` ${String(y.count).padStart(2)} ед. (${[...y.units.entries()].map(([r, n]) => `${n} ${r}`).join(', ')})`
    + ` · ${String(y.xp).padStart(3)} XP · ≈ ${astra(y.value)} ASTRA-экв.`;
}
const rosters: PlaneId[][] = [];
(function pick(from: number, acc: PlaneId[]): void {
  if (acc.length === PATROL_MAX_CONCURRENT) rosters.push([...acc]);
  for (let i = from; i < PLANE_ORDER.length; i++) pick(i + 1, [...acc, PLANE_ORDER[i]]);
})(0, []);
const byUnits = rosters.reduce((a, b) => (dayOf(b).count > dayOf(a).count ? b : a));
const byValue = rosters.reduce((a, b) => (dayOf(b).value > dayOf(a).value ? b : a));
const fourCommon = PLANE_ORDER.filter((id) => PLANES[id].rarity === 'common').slice(0, PATROL_MAX_CONCURRENT);
console.log(`\nСутки на полном слоте (${PATROL_MAX_CONCURRENT} борта, все восемь машин собраны, каждый борт сдаёшь вовремя):`);
console.log('  больше единиц  —', describe(byUnits));
console.log('  дороже по рынку —', describe(byValue));
console.log('  четыре обычные —', describe(fourCommon));
console.log('Модель суток ниже этого потолка: заходы раз в 6 часов дают 4 вылета борта в день,');
console.log('а 8 вылетов — это уже каждые 3 часа, что никто не держит.');
console.log('Для сравнения: короткий рейс скаута — 6 ASTRA и 1–2 ресурса за 15 минут, зато');
console.log('с топливом, износом и слотом ангара. Закладка патруля бесплатна, но её надо забрать.');

// 3. Полная коллекция: боксы + патрули.
function simulate(
  dailyPaid: number, patrolsPerDay: number, weeks: number,
): { astra: number; weeks: number; found: number; salvage: number } {
  const owned = new Set<PlaneId>();
  let spent = 0;
  let weeksDone = 0;
  // Сколько звено принесло ресурсов за всё время — в ASTRA-эквиваленте по
  // базовым ценам: так видно, не стал ли патруль заменой флоту.
  let salvage = 0;
  // Состояние звена живёт между сутками: борт, вылетевший вечером, возвращается
  // ночью и будет сдан только утром, поэтому «когда вернулся» и «когда свободен»
  // считаются в абсолютных часах от начала прогона.
  const backAt = new Map<PlaneId, number>();  // когда борт вернулся
  const readyAt = new Map<PlaneId, number>(); // когда борт снова можно запустить
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const plan: BoxId[] = ['daily'];
      if (d === 0) plan.push('weekly');
      for (let i = 0; i < Math.round(dailyPaid / 7); i++) plan.push(i % 3 === 2 ? 'crate_pro' : 'crate_supply');
      for (const box of plan) {
        spent += BOXES[box].price;
        // Анти-дубль: бокс выбирает только из тех моделей, что ещё не собраны.
        const plane = rollPlane(BOXES[box], hexSeed(), new Set(owned));
        if (plane) owned.add(plane);
      }
      // Патрули. Модель суток честная, «по-игроковому»: игрок делает
      // patrolsPerDay заходов, на каждом заходе забирает всё вернувшееся и
      // запускает свободные борта, сколько позволяют слоты
      // (PATROL_MAX_CONCURRENT в воздухе, одна модель — один вылет). Время —
      // абсолютные часы от начала прогона, потому что борт, вылетевший вечером,
      // возвращается ночью и будет сдан утром: один заход в день — это один
      // «залп» из четырёх бортов, четыре захода — до шестнадцати вылетов.
      {
        const owned0 = PLANE_ORDER.filter((id) => owned.has(id));
        if (owned0.length && patrolsPerDay > 0) {
          const day0 = (w * 7 + d) * 24;
          for (let v = 0; v < patrolsPerDay; v++) {
            const at = day0 + 6 + (v * 24) / patrolsPerDay;
            // 1. Сдаём всё, что вернулось к этому заходу.
            for (const id of owned0) {
              const t = backAt.get(id);
              if (t === undefined || t > at) continue;
              backAt.delete(id);
              readyAt.set(id, at);
              const cfg = PATROL[PLANES[id].rarity];
              salvage += Object.entries(cfg.salvage)
                .reduce((sum, [resource, amount]) => sum + amount * (RESOURCE_BASE_PRICES[resource] ?? 0), 0);
              // Анти-дубль внутри rollPatrol: звено ищет только то, чего у игрока нет.
              const found = rollPatrol(id, hexSeed(), owned);
              if (found) owned.add(found);
            }
            // 2. Запускаем свободные борта, пока есть свободные слоты.
            let airborne = backAt.size;
            const free = owned0.filter((id) => (readyAt.get(id) ?? at) <= at && !backAt.has(id));
            for (let i = free.length - 1; i > 0; i--) {
              const j = Math.floor(rnd() * (i + 1));
              [free[i], free[j]] = [free[j], free[i]];
            }
            for (const id of free) {
              if (airborne >= PATROL_MAX_CONCURRENT) break;
              backAt.set(id, at + PATROL[PLANES[id].rarity].ms / 3600000);
              airborne += 1;
            }
          }
        }
      }
    }
    if (owned.size === PLANE_ORDER.length && !weeksDone) weeksDone = w + 1;
  }
  return { astra: spent, weeks: weeksDone, found: owned.size, salvage };
}

const TEMPOS: [string, number, number][] = [
  ['бесплатные боксы, без патрулей', 0, 0],
  ['бесплатные + 1 заход в день', 0, 1],
  ['бесплатные + 4 захода в день (максимум)', 0, 4],
  ['+3 платных в неделю, 2 патруля в день', 3, 2],
  ['+7 платных в неделю, максимум патрулей', 7, 4],
];
const HORIZON = 52;

console.log(`\nПолная коллекция за ${HORIZON} недель (${runs.toLocaleString('ru-RU')} прогонов):`);
console.log('Темп                                            ASTRA за год   собрано   недель до полной   добыча звена');
for (const [label, paid, patrols] of TEMPOS) {
  let spend = 0;
  let full = 0;
  let earned = 0;
  const done: number[] = [];
  for (let i = 0; i < runs; i++) {
    const res = simulate(paid, patrols, HORIZON);
    spend += res.astra;
    earned += res.salvage;
    if (res.found === PLANE_ORDER.length) full += 1;
    if (res.weeks) done.push(res.weeks);
  }
  const avg = done.length ? done.reduce((a, b) => a + b, 0) / done.length : 0;
  console.log(
    `${label.padEnd(50)} ${astra(spend / runs).padStart(13)}   ${pct(full / runs).padStart(7)}   ${(avg ? avg.toFixed(0) : '—').padStart(16)}   ${astra(earned / runs).padStart(12)}`,
  );
}

console.log('\nЧто это значит: боксы не выдают повторных машин, поэтому коллекция собирается');
console.log('быстрее — и это ровно то, что просили: «повторные те же корабли» из бокса');
console.log('исчезли. Патруль теперь добывает ресурсы и опыт, но не ASTRA: звено полезно');
console.log('тем, кто заходит каждый день, и бесполезно как валютопечатный станок.');
console.log('Кто не заходит в игру — не летает: борт возвращается, но добыча ждёт кнопки.');
