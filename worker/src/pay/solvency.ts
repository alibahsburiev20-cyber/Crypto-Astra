// Баланс целиком: сколько мы должны игрокам и сколько у нас реально есть.
//
// Это ответ на вопрос «а можно всё суммировать?». Суммировать — да, и это уже
// так работает: деньги лежат на адресах игроков и в горячем кошельке, а не в
// отдельных «кошельках игроков». Но сводка нужна не для красоты: если сумма
// обязательств больше суммы на блокчейне, значит выплаты финансируются не тем,
// что пришло, а тем, что придёт — и это уже не игра, а схема.
//
// Поэтому здесь два числа и одно правило:
//
//   Обязательства = балансы игроков (журнал) + призовой фонд (обещанные призы)
//   Активы        = USDT на адресах игроков + USDT на горячем кошельке
//
//   Покрытие = Активы / Обязательства
//
// Покрытие ниже 100 % — не «подушка», а дефицит: часть обещанного нечем
// закрыть. Показываем честно, а не округляем до «всё хорошо».
//
// Важно: активы считаются по блокчейну, обязательства — по журналу. Складывать
// их между собой нельзя (это разные миры), сравнивать — нужно.

import { openCycle } from './pool';
import { formatMicroUsdt } from './tron/amount';

export interface SolvencyInput {
  /** USDT на адресах игроков (по блокчейну). `null` — не удалось прочитать. */
  addressesMicro: number | null;
  /** USDT на горячем кошельке. `null` — не удалось прочитать. */
  hotMicro: number | null;
  /** Сколько адресов проверено и были ли ошибки сети. */
  addresses: number;
  chainErrors: number;
}

export interface SolvencySheet {
  liabilities: {
    /** Сумма положительных балансов игроков. */
    playersMicro: number;
    players: string;
    /** Обещанные призы сезона — такие же обязательства, как баланс игрока. */
    prizeMicro: number;
    prize: string;
    totalMicro: number;
    total: string;
  };
  assets: {
    addressesMicro: number;
    addresses: string;
    hotMicro: number;
    hot: string;
    totalMicro: number;
    total: string;
    /** `true`, если хотя бы часть активов не прочиталась. */
    incomplete: boolean;
  };
  /** Активы / обязательства, в процентах (100 = покрыто ровно). */
  coveragePercent: number | null;
  status: 'ok' | 'short' | 'no_liabilities' | 'unknown';
  /** Дефицит в микро-USDT (0, если покрыто). */
  gapMicro: number;
  updatedAt: number;
}

/** Сумма положительных балансов всех игроков. Отрицательные не вычитаем. */
export async function playerLiabilitiesMicro(db: D1Database): Promise<{ micro: number; players: number }> {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(balance), 0) AS micro, COUNT(*) AS n FROM (
       SELECT user_id, SUM(delta) AS balance FROM pay_ledger GROUP BY user_id HAVING SUM(delta) > 0
     )`,
  ).first<{ micro: number; n: number }>();
  return { micro: Number(row?.micro ?? 0), players: Number(row?.n ?? 0) };
}

/** Призовой фонд как обязательство: призы уже обещаны игрокам. */
export async function prizeLiabilityMicro(db: D1Database): Promise<number> {
  const cycle = await openCycle(db);
  return cycle ? Math.max(0, Number(cycle.prize_budget)) : 0;
}

/**
 * Сводка. Чистая арифметика поверх двух чисел; сеть читается снаружи, чтобы
 * функция оставалась проверяемой без блокчейна.
 */
export async function solvencySheet(
  db: D1Database,
  input: SolvencyInput,
  now = Date.now(),
): Promise<SolvencySheet> {
  const [players, prize] = await Promise.all([
    playerLiabilitiesMicro(db),
    prizeLiabilityMicro(db),
  ]);

  const total = players.micro + prize;
  const incomplete = input.addressesMicro === null || input.hotMicro === null;
  const assetsMicro = (input.addressesMicro ?? 0) + (input.hotMicro ?? 0);

  let status: SolvencySheet['status'];
  if (total <= 0) status = 'no_liabilities';
  else if (incomplete) status = 'unknown';
  else status = assetsMicro >= total ? 'ok' : 'short';

  const coveragePercent = total <= 0 ? null : Math.round((assetsMicro / total) * 1000) / 10;

  return {
    liabilities: {
      playersMicro: players.micro,
      players: formatMicroUsdt(players.micro),
      prizeMicro: prize,
      prize: formatMicroUsdt(prize),
      totalMicro: total,
      total: formatMicroUsdt(total),
    },
    assets: {
      addressesMicro: input.addressesMicro ?? 0,
      addresses: formatMicroUsdt(input.addressesMicro ?? 0),
      hotMicro: input.hotMicro ?? 0,
      hot: formatMicroUsdt(input.hotMicro ?? 0),
      totalMicro: assetsMicro,
      total: formatMicroUsdt(assetsMicro),
      incomplete,
    },
    coveragePercent,
    status,
    gapMicro: Math.max(0, total - assetsMicro),
    updatedAt: now,
  };
}
