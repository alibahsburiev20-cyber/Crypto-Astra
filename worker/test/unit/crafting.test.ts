import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { MODULE_ORDER, MODULES, PLANETS, RECIPES, RECIPE_ORDER, SECTORS } from '../../src/shared/gameData';
import { applyDelta, getBalance } from '../../src/world/balances';
import { verifyLedger } from '../../src/world/ledger';
import { finishCraft, listCraftJobs, startCraft } from '../../src/world/modules/crafting';
import { addResource, getResource } from '../../src/world/modules/maintenance';
import { createPlayer } from '../../src/world/modules/players';
import { applyDurability } from '../../src/world/modules/progress';
import { repairShip } from '../../src/world/modules/upkeep';
import { makeWorld } from '../helpers/sqlShim';

const T0 = DAY_MS * 10;

function world() {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  return w;
}

function givePlateMaterials(sql: SqlStorage, tx: <T>(fn: () => T) => T) {
  tx(() => addResource(sql, 'p1', 'iron_ore', 3, T0 + 1));
  tx(() => addResource(sql, 'p1', 'copper_ore', 2, T0 + 2));
}

describe('крафт (срез 3 этапа 2)', () => {
  it('запуск списывает ресурсы и плату, ставит задачу и пишет журнал', () => {
    const { sql, tx } = world();
    givePlateMaterials(sql, tx);
    const astraBefore = getBalance(sql, 'p1', 'astra');
    const res = tx(() => startCraft(sql, 'p1', 'k1', 'alloy_plate', T0 + 1000));

    expect(getResource(sql, 'p1', 'iron_ore')).toBe(0);
    expect(getResource(sql, 'p1', 'copper_ore')).toBe(0);
    expect(getBalance(sql, 'p1', 'astra')).toBe(astraBefore - RECIPES.alloy_plate.fee);
    expect(res.job.endsAt).toBe(T0 + 1000 + RECIPES.alloy_plate.ms);
    expect(listCraftJobs(sql, 'p1').length).toBe(1);

    const reasons = sql.exec('SELECT reason FROM ledger').toArray().map((r) => String(r.reason));
    expect(reasons).toContain('craft_fee');
    expect(reasons).toContain('craft_input');
    expect(verifyLedger(sql).ok).toBe(true);

    const job = sql.exec(`SELECT kind FROM jobs WHERE kind = 'craft_finish'`).toArray();
    expect(job.length).toBe(1);
  });

  it('без ресурсов крафт не начинается и ничего не списывает', () => {
    const { sql, tx } = world();
    const astraBefore = getBalance(sql, 'p1', 'astra');
    expect(() => tx(() => startCraft(sql, 'p1', 'k1', 'alloy_plate', T0 + 1000))).toThrow(/insufficient_resources/);
    expect(getBalance(sql, 'p1', 'astra')).toBe(astraBefore);
    expect(listCraftJobs(sql, 'p1').length).toBe(0);
  });

  it('без ASTRA на плату крафт не начинается, ресурсы остаются', () => {
    const { sql, tx } = world();
    givePlateMaterials(sql, tx);
    sql.exec(`UPDATE balances SET amount = 10 WHERE player_id = 'p1' AND asset = 'astra'`);
    expect(() => tx(() => startCraft(sql, 'p1', 'k1', 'alloy_plate', T0 + 1000))).toThrow(/insufficient_funds/);
    expect(getResource(sql, 'p1', 'iron_ore')).toBe(3);
  });

  it('очередь на один слот: второй крафт отклоняется', () => {
    const { sql, tx } = world();
    givePlateMaterials(sql, tx);
    tx(() => startCraft(sql, 'p1', 'k1', 'alloy_plate', T0 + 1000));
    tx(() => addResource(sql, 'p1', 'iron_ore', 3, T0 + 2));
    tx(() => addResource(sql, 'p1', 'copper_ore', 2, T0 + 3));
    expect(() => tx(() => startCraft(sql, 'p1', 'k2', 'alloy_plate', T0 + 2000))).toThrow(/craft_queue_full/);
  });

  it('готовый компонент начисляется один раз и попадает в журнал', () => {
    const { sql, tx } = world();
    givePlateMaterials(sql, tx);
    const res = tx(() => startCraft(sql, 'p1', 'k1', 'alloy_plate', T0 + 1000));
    tx(() => finishCraft(sql, res.job.id, T0 + 1000 + RECIPES.alloy_plate.ms));
    tx(() => finishCraft(sql, res.job.id, T0 + 1000 + RECIPES.alloy_plate.ms + 1));
    expect(getResource(sql, 'p1', 'alloy_plate')).toBe(1);
    expect(listCraftJobs(sql, 'p1').length).toBe(0);
    const out = sql.exec(`SELECT delta FROM ledger WHERE reason = 'craft_output'`).toArray();
    expect(out.length).toBe(1);
    expect(Number(out[0].delta)).toBe(1);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('повтор запроса с тем же ключом не запускает второй крафт', () => {
    const { sql, tx } = world();
    givePlateMaterials(sql, tx);
    const first = tx(() => startCraft(sql, 'p1', 'k1', 'alloy_plate', T0 + 1000));
    const second = tx(() => startCraft(sql, 'p1', 'k1', 'alloy_plate', T0 + 1500));
    expect(second.job.id).toBe(first.job.id);
    expect(sql.exec('SELECT COUNT(*) AS c FROM craft_jobs').toArray()[0].c).toBe(1);
  });

  it('ремонт ниже 50% требует пластину и съедает её', () => {
    const { sql, tx } = world();
    const shipId = String(sql.exec('SELECT id FROM ships LIMIT 1').toArray()[0].id);
    // Крупный ремонт дорогой: 60 % износа = 900 ASTRA, у стартового игрока столько не бывает.
    tx(() => applyDelta(sql, { playerId: 'p1', asset: 'astra', delta: 2000, reason: 'claim' }, T0));
    tx(() => applyDurability(sql, { playerId: 'p1', shipId, delta: -60, reason: 'test_wear' }, T0 + 1000));

    // Без пластины — отказ, баланс не меняется.
    const astraBefore = getBalance(sql, 'p1', 'astra');
    expect(() => tx(() => repairShip(sql, 'p1', 'r0', shipId, T0 + 2000))).toThrow(/repair_needs_alloy_plate/);
    expect(getBalance(sql, 'p1', 'astra')).toBe(astraBefore);

    // С пластиной — ремонт проходит, пластина списывается.
    tx(() => addResource(sql, 'p1', 'alloy_plate', 1, T0 + 3000));
    const repaired = tx(() => repairShip(sql, 'p1', 'r1', shipId, T0 + 4000));
    expect(repaired.durability).toBe(100);
    expect(getResource(sql, 'p1', 'alloy_plate')).toBe(0);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('замороженный мир не запускает крафт', () => {
    const { sql, tx } = world();
    givePlateMaterials(sql, tx);
    sql.exec(`INSERT INTO meta (key, value) VALUES ('frozen', '1') ON CONFLICT (key) DO UPDATE SET value = '1'`);
    expect(() => tx(() => startCraft(sql, 'p1', 'k1', 'alloy_plate', T0 + 1000))).toThrow(/world_frozen/);
  });
});

describe('доступность рецептов и модулей (срез 3, пересмотр после замечания)', () => {
  // Ресурсы, которые можно добыть на планетах первого сектора: туда пускают с
  // первого уровня. Титан, кристалл и гелий-3 лежат в секторе 2 и выше — их
  // нельзя класть в рецепт, который нужен для ремонта и модулей новичку.
  const firstSector = new Set<string>();
  for (const planet of PLANETS) {
    const sector = SECTORS.find((s) => s.id === planet.sector);
    if (sector && sector.level <= 1) for (const r of planet.resources) firstSector.add(r);
  }

  it('все рецепты собираются из ресурсов первого сектора', () => {
    const problems: string[] = [];
    for (const id of RECIPE_ORDER) {
      for (const input of RECIPES[id].inputs) {
        if (!firstSector.has(input.resource)) problems.push(`${id}: ${input.resource}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('компоненты модулей либо добываются в первом секторе, либо крафтятся', () => {
    const craftable = new Set<string>(RECIPE_ORDER);
    const problems: string[] = [];
    for (const id of MODULE_ORDER) {
      for (const part of MODULES[id].parts) {
        if (!firstSector.has(part.resource) && !craftable.has(part.resource)) {
          problems.push(`${id}: ${part.resource}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('пластина для крупного ремонта крафтится из того, что можно добыть сразу', () => {
    const plate = RECIPES.alloy_plate.inputs.map((i) => i.resource);
    expect(plate.every((r) => firstSector.has(r))).toBe(true);
  });
});
