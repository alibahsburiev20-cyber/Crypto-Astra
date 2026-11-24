import { RECIPES, RECIPE_ORDER, XP, isRecipeId, type RecipeId } from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { enqueue } from '../scheduler';
import { assertPlayable, applyResourceDelta, getResource, isFrozen } from './maintenance';
import { craftSlotsFor } from './pass';
import { applyXp } from './progress';
import { levelFromXp } from './expeditionMath';

// Крафт (этап 2, срез 3). Запуск списывает ресурсы и плату в ASTRA одной
// транзакцией и ставит задачу craft_finish; готовый компонент начисляет сервер,
// клиент только показывает результат.

/** Базовый слот один; второй открывает забранная награда 3 уровня Astra Pass. */
export const CRAFT_SLOTS = 1;

export interface CraftView {
  id: string;
  recipe: RecipeId;
  name: string;
  startedAt: number;
  endsAt: number;
  fee: number;
}

function viewOf(row: Record<string, unknown>): CraftView {
  const recipe = String(row.recipe) as RecipeId;
  return {
    id: String(row.id),
    recipe,
    name: RECIPES[recipe]?.name ?? recipe,
    startedAt: Number(row.started_at),
    endsAt: Number(row.ends_at),
    fee: Number(row.fee),
  };
}

export function listCraftJobs(sql: SqlStorage, playerId: string): CraftView[] {
  return sql.exec(
    `SELECT id, recipe, started_at, ends_at, fee FROM craft_jobs
     WHERE player_id = ? AND status = 'running' ORDER BY ends_at`,
    playerId,
  ).toArray().map(viewOf);
}

export function craftCatalog() {
  return RECIPE_ORDER.map((id) => {
    const r = RECIPES[id];
    return { id, name: r.name, inputs: r.inputs, ms: r.ms, fee: r.fee, tier: r.tier };
  });
}

export function startCraft(sql: SqlStorage, playerId: string, idemKey: string, recipeId: string, now: number) {
  return withIdempotency(sql, playerId, 'craft_start', idemKey, { recipe: recipeId }, now, () => {
    assertPlayable(sql);
    if (!isRecipeId(recipeId)) throw new ApiError(400, 'bad_recipe');
    const recipe = RECIPES[recipeId];

    const running = sql.exec(
      `SELECT COUNT(*) AS c FROM craft_jobs WHERE player_id = ? AND status = 'running'`,
      playerId,
    ).toArray();
    const slots = craftSlotsFor(sql, playerId);
    if (Number(running[0].c) >= slots) throw new ApiError(409, 'craft_queue_full');

    for (const input of recipe.inputs) {
      if (getResource(sql, playerId, input.resource) < input.amount) throw new ApiError(409, 'insufficient_resources');
    }
    if (getBalance(sql, playerId, 'astra') < recipe.fee) throw new ApiError(409, 'insufficient_funds');

    const jobId = crypto.randomUUID();
    const endsAt = now + recipe.ms;
    // Плата уходит в систему: это и есть поглотитель, ради которого вводится крафт.
    applyDelta(sql, { playerId, asset: 'astra', delta: -recipe.fee, reason: 'craft_fee', sourceRef: jobId, idemKey }, now);
    for (const input of recipe.inputs) {
      applyResourceDelta(sql, {
        playerId, resource: input.resource, delta: -input.amount,
        reason: 'craft_input', sourceRef: jobId, idemKey,
      }, now);
    }
    sql.exec(
      `INSERT INTO craft_jobs (id, player_id, recipe, status, started_at, ends_at, fee)
       VALUES (?, ?, ?, 'running', ?, ?, ?)`,
      jobId, playerId, recipe.id, now, endsAt, recipe.fee,
    );
    enqueue(sql, 'craft_finish', endsAt, { jobId });

    return {
      value: {
        job: { id: jobId, recipe: recipe.id, name: recipe.name, startedAt: now, endsAt, fee: recipe.fee },
        astra: getBalance(sql, playerId, 'astra'),
        slots,
      },
      store: true,
    };
  });
}

/** Завершение крафта. Вызывается планировщиком, клиент не участвует. */
export function finishCraft(sql: SqlStorage, jobId: string, now: number): void {
  const rows = sql.exec('SELECT id, player_id, recipe, status FROM craft_jobs WHERE id = ?', jobId).toArray();
  if (!rows.length) return;
  const row = rows[0];
  if (String(row.status) !== 'running') return;
  if (isFrozen(sql)) {
    enqueue(sql, 'craft_finish', now + 60 * 60 * 1000, { jobId });
    return;
  }
  const playerId = String(row.player_id);
  const recipe = String(row.recipe);
  applyResourceDelta(sql, {
    playerId, resource: recipe, delta: 1, reason: 'craft_output', sourceRef: jobId,
  }, now);
  sql.exec(`UPDATE craft_jobs SET status = 'done' WHERE id = ?`, jobId);
  // Готовая вещь даёт опыт: мастерская — тоже прогресс, а не только трата льда.
  applyXp(sql, { playerId, delta: XP.craft, reason: 'craft_output', sourceRef: jobId }, now, levelFromXp);
}
