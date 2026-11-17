/**
 * Симуляция экономики этапа 1 на реальных формулах игры.
 *
 * Запуск: npm run simulate -- --players 200 --days 30 --claims 32 --max-expeditions 5
 *
 * Считает источники и стоки ASTRA по §I.10 концепции: Claim, награды экспедиций,
 * стартовый бонус, покупка топлива и ремонт. Цель — стоки возвращают 70–90% выпущенной
 * валюты. Число стартовое: до гейта 3 его подгоняют коэффициентами, а не «на глаз».
 */
import {
  CLAIM_DAILY_MAX, DAY_MS, EXPEDITION_FULL_REWARD, FUEL_DAILY_MAX, FUEL_REGEN_MS,
  FUEL_UNIT_PRICE, START_ASTRA, START_FUEL,
} from '../worker/src/shared/constants';
import { EXPEDITION_TYPES, PLANETS, SHIPS, type ExpeditionKind } from '../worker/src/shared/gameData';
import { computeReward, fuelCost, levelFromXp, repairCost } from '../worker/src/world/modules/expeditionMath';

interface Args {
  players: number;
  days: number;
  claims: number;
  maxExpeditions: number;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const arg = (name: string, fallback: number): number => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0 || i + 1 >= argv.length) return fallback;
    const n = Number(argv[i + 1]);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    players: Math.max(1, Math.floor(arg('players', 200))),
    days: Math.max(1, Math.floor(arg('days', 30))),
    claims: Math.min(CLAIM_DAILY_MAX, Math.max(0, Math.floor(arg('claims', 32)))),
    maxExpeditions: Math.max(0, Math.floor(arg('max-expeditions', 5))),
    seed: Math.floor(arg('seed', 1)),
  };
}

// Детерминированный PRNG: один и тот же seed даёт один и тот же отчёт.
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

function hexSeed(rnd: () => number): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += Math.floor(rnd() * 256).toString(16).padStart(2, '0');
  return out;
}

interface Totals {
  claims: number;
  expeditionAstra: number;
  startBonus: number;
  fuelSpend: number;
  repairSpend: number;
  flights: number;
  stuck: number;
  finalAstra: number;
  finalDurability: number;
}

function simulate(args: Args): Totals {
  const rnd = mulberry32(args.seed);
  const t: Totals = {
    claims: 0, expeditionAstra: 0, startBonus: 0, fuelSpend: 0, repairSpend: 0,
    flights: 0, stuck: 0, finalAstra: 0, finalDurability: 0,
  };
  const scout = SHIPS.scout;
  const cap = scout.tank;
  const regenPerDay = Math.floor(DAY_MS / FUEL_REGEN_MS);

  for (let p = 0; p < args.players; p++) {
    let astra = START_ASTRA;
    let fuel = START_FUEL;
    let durability = 100;
    let xp = 0;
    let level = 1;
    t.startBonus += START_ASTRA;

    for (let day = 0; day < args.days; day++) {
      // Топливо восстанавливается +1 каждые 2 часа, но бак не переполняется.
      fuel = Math.min(cap, fuel + regenPerDay);

      const claims = Math.min(args.claims, CLAIM_DAILY_MAX);
      astra += claims * 5;
      t.claims += claims * 5;

      let bought = 0;
      let expeditions = 0;
      while (expeditions < args.maxExpeditions) {
        if (durability <= 0) break;
        // Ниже 50% ремонт закрыт (нет alloy_plate): игрок встаёт до этапа 2.
        if (durability < 60 && durability >= 50) {
          const cost = repairCost(100 - durability, scout.repairCoef);
          if (astra >= cost) {
            astra -= cost;
            t.repairSpend += cost;
            durability = 100;
          }
        }
        // Ниже 50% ремонт закрыт до появления alloy_plate (этап 2).
        if (durability < 50) break;

        const kind: ExpeditionKind = fuel >= 2 && expeditions < Math.floor(args.maxExpeditions / 2) && rnd() < 0.25 ? 'medium' : 'short';
        const cost = fuelCost(scout.consumption, kind);
        while (fuel < cost && bought < FUEL_DAILY_MAX && astra >= FUEL_UNIT_PRICE) {
          astra -= FUEL_UNIT_PRICE;
          t.fuelSpend += FUEL_UNIT_PRICE;
          fuel += 1;
          bought += 1;
        }
        if (fuel < cost) break;

        const open = PLANETS.filter((pl) => pl.sector <= Math.min(scout.maxSector, 2) && pl.sector <= level);
        if (!open.length) break;
        // Игрок выбирает планету потруднее: там больше награда и износ.
        const planet = open.reduce((a, b) => (b.difficulty > a.difficulty ? b : a));
        const reward = computeReward({
          planet, shipType: 'scout', kind, seed: hexSeed(rnd), eventBonusBp: 1000,
          extraWear: 0, durability, expeditionsToday: expeditions, pointsToday: 0,
        });

        fuel -= cost;
        astra += reward.astra;
        durability = Math.max(0, durability - reward.wear);
        xp += reward.xp;
        level = levelFromXp(xp);
        t.expeditionAstra += reward.astra;
        t.flights += 1;
        expeditions += 1;
      }
    }

    t.finalAstra += astra;
    t.finalDurability += durability;
    if (durability < 50) t.stuck += 1;
  }
  return t;
}

const args = parseArgs(process.argv.slice(2));
const r = simulate(args);
const income = r.claims + r.expeditionAstra;
const sinks = r.fuelSpend + r.repairSpend;
const ratio = income > 0 ? (sinks / income) * 100 : 0;

const fmt = (n: number): string => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
console.log(`Crypto Astra — симуляция экономики (${args.days} дн., ${args.players} игроков, seed ${args.seed})`);
console.log('');
console.log('Источники ASTRA:');
console.log(`  Claim (${args.claims}/день): ${fmt(r.claims)}`);
console.log(`  награды экспедиций (${r.flights} рейсов): ${fmt(r.expeditionAstra)}`);
console.log(`  стартовый бонус (вне оборота): ${fmt(r.startBonus)}`);
console.log('Стоки ASTRA:');
console.log(`  покупка топлива: ${fmt(r.fuelSpend)}`);
console.log(`  ремонт: ${fmt(r.repairSpend)}`);
console.log('');
console.log(`Поглощение без стартового бонуса: ${ratio.toFixed(1)}% (цель 70–90%)`);
console.log(`Средний баланс на конец: ${fmt(r.finalAstra / args.players)} ASTRA`);
console.log(`Средняя прочность: ${(r.finalDurability / args.players).toFixed(0)}%`);
console.log(`Игроков застряло без ремонта (ниже 50%): ${r.stuck}`);

if (ratio < 70) {
  console.log('');
  console.log('Вывод: стоков мало. До гейта 3 нужно поднимать расходы (топливо, ремонт, крафт)');
  console.log('или снижать доход Claim/экспедиций, а не «крутить на глаз».');
} else if (ratio > 90) {
  console.log('');
  console.log('Вывод: стоки выше цели, экономика слишком жёсткая для новых игроков.');
}
