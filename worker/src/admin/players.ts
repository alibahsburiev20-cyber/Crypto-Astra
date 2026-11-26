// Что админ может сделать с конкретным игроком: посмотреть, закрыть вход,
// удалить аккаунт.
//
// Три решения, заложенные в этот файл, стоят того, чтобы быть названными:
//
//   1. «Удаление» — то же мягкое закрытие, что выбирает сам игрок
//      (`routes/account.ts`): почта и пароль стираются, сессии отзываются,
//      позывной убирается. Записи журналов остаются: это бухгалтерия, и в ней
//      нет почты. Значит «удалить игрока» ≠ «стереть след денег» — и это не
//      недоработка, а требование проверяемости.
//   2. Деньги — преграда, а не деталь. Пока на балансе лежит хоть одна микро-
//      доля USDT или висит незакрытая заявка, аккаунт не закрываем: игрок
//      потеряет право на свои деньги, а мы получим «сгоревший» остаток, который
//      никто не сможет выплатить. Отдельной кнопки «удалить вместе с деньгами»
//      нет намеренно: сначала урегулирование (выплата вручную или возврат),
//      потом закрытие.
//   3. Блокировка обратима, закрытие — нет. Восстановить доступ после блокировки
//      можно одной строкой; после стирания почты и пароля — уже нет, игрок
//      регистрируется заново, и старый `user_id` не возвращается.

import { payBalanceMicro } from '../pay/ledger';
import { ApiError } from '../world/errors';

/** Статусы заявок, при которых деньги ещё «в движении». */
export const OPEN_WITHDRAWAL_STATES = ['requested', 'approved', 'reserved', 'broadcasting', 'sent'];

export interface PlayerSummary {
  id: string;
  email: string | null;
  status: string;
  worldId: string | null;
  createdAt: number;
  telegram: boolean;
  /** Активные refresh-сессии: «с каким числом устройств мы его пускаем». */
  sessions: number;
  /** Баланс USDT в micro. `null` — таблица денег недоступна, а не «нулей». */
  payBalanceMicro: number | null;
  openWithdrawals: number;
  addresses: { chain: string; address: string; active: number }[];
  /** Из DO мира; `null`, если мир не ответил (другой мир, DO не прогрет). */
  game: { astra: number | null; level: number | null; points: number | null } | null;
}

/**
 * Карточка игрока. Всё, что видно админу, собрано в одном месте ровно затем,
 * чтобы решение «закрывать аккаунт» принималось по цифрам, а не по ощущениям.
 */
export async function playerSummary(
  db: D1Database,
  userId: string,
  game?: { astra?: number; level?: number; points?: number } | null,
): Promise<PlayerSummary> {
  const user = await db.prepare(
    'SELECT id, email, world_id, status, created_at, telegram_id, password_hash FROM users WHERE id = ? LIMIT 1',
  ).bind(userId).first<Record<string, unknown>>();
  if (!user) throw new ApiError(404, 'player_not_found');

  const sessions = await db.prepare(
    'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?',
  ).bind(userId, Date.now()).first<number>('n');

  // Незакрытые заявки: их статусы перечислены явно, потому что `confirmed` —
  // это история, а `manual` — «разбирается человек», и то и другое не препятствие.
  const pending = await db.prepare(
    `SELECT COUNT(*) AS n FROM pay_withdrawals WHERE user_id = ? AND status IN (${OPEN_WITHDRAWAL_STATES.map(() => '?').join(',')})`,
  ).bind(userId, ...OPEN_WITHDRAWAL_STATES).first<number>('n');

  let balance: number | null = null;
  try {
    balance = await payBalanceMicro(db, userId);
  } catch (e) {
    // Деньги не прочитаны — значит «можно ли закрывать» неизвестно. `null`
    // доезжает до UI, и кнопка закрытия сама по себе отказывает.
    console.error('player pay balance unavailable', e);
  }

  const addresses = await db.prepare(
    'SELECT chain, address, active FROM pay_addresses WHERE user_id = ? ORDER BY created_at LIMIT 10',
  ).bind(userId).all<{ chain: string; address: string; active: number }>();

  return {
    id: String(user.id),
    email: user.email === null || user.email === undefined ? null : String(user.email),
    status: String(user.status ?? ''),
    worldId: user.world_id ? String(user.world_id) : null,
    createdAt: Number(user.created_at ?? 0),
    // Личные данные в карточку не просим: достаточно факта «привязан телеграм»
    // и «есть пароль» — по ним видно, чем игрок входит, без самих значений.
    telegram: Boolean(user.telegram_id),
    sessions: Number(sessions ?? 0),
    payBalanceMicro: balance,
    openWithdrawals: Number(pending ?? 0),
    addresses: (addresses.results ?? []).map((row) => ({ chain: row.chain, address: row.address, active: Number(row.active) })),
    game: game ? { astra: numOrNull(game.astra), level: numOrNull(game.level), points: numOrNull(game.points) } : null,
  };
}

function numOrNull(value: unknown): number | null {
  return value === undefined || value === null || !Number.isFinite(Number(value)) ? null : Number(value);
}

/** Временный запрет входа: отзыва сессий + `status='blocked'`. Обратимо. */
export async function blockPlayer(db: D1Database, userId: string, now: number): Promise<{ sessions: number; alreadyBlocked: boolean }> {
  const user = await db.prepare('SELECT status FROM users WHERE id = ? LIMIT 1').bind(userId).first<{ status: string }>();
  if (!user) throw new ApiError(404, 'player_not_found');
  if (user.status === 'deleted') throw new ApiError(409, 'player_already_closed');
  // `status <> 'blocked'`, а не «= active»: игрока могли заблокировать и на
  // pending (заявка с обходным признаком) — повторный нажатый «заблокировать»
  // не должен выглядеть как «уже блокировка».
  const res = await db.prepare(`UPDATE users SET status = 'blocked' WHERE id = ? AND status <> 'blocked'`).bind(userId).run();
  const sessions = await revokeAllSessions(db, userId, now);
  // Повторная блокировка — не ошибка: админ жмёт кнопку второй раз (или с двух
  // вкладок), а состояние уже такое, как он хотел. Сессии при этом всё равно
  // отозваны выше — на случай, между «заблокировал» и «опять нажал» игрок успел
  // войти. Отказывать в этом значило бы учить оператора не нажимать «повтори».
  return { sessions, alreadyBlocked: changesOf(res) === 0 };
}

/** Снять блокировку. Работает только с `blocked`: из «удалённого» нас вернуть нечем. */
export async function unblockPlayer(db: D1Database, userId: string): Promise<void> {
  const res = await db.prepare(`UPDATE users SET status = 'active' WHERE id = ? AND status = 'blocked'`).bind(userId).run();
  if (changesOf(res) === 0) throw new ApiError(409, 'not_blocked');
}

export interface CloseResult {
  closedAt: number;
  sessions: number;
  /** Остаток на момент закрытия — всегда 0: иначе сюда не дойти. */
  balanceMicro: number;
  /** Что мы реально стерли — это же уходит игроку в ответ, чтобы не было сюрпризов. */
  wiped: { email: boolean; password: boolean };
}

/**
 * Закрыть аккаунт по решению админа. Тот же набор действий, что у
 * `POST /account/delete`, плюс препятствия деньгами.
 */
export async function closePlayer(db: D1Database, userId: string, now: number): Promise<CloseResult> {
  const summary = await playerSummary(db, userId);
  if (summary.status === 'deleted') throw new ApiError(409, 'player_already_closed');
  if (summary.payBalanceMicro === null) throw new ApiError(503, 'pay_unavailable');
  if (summary.payBalanceMicro > 0 || summary.openWithdrawals > 0) {
    throw new ApiError(409, 'player_has_funds');
  }

  // Порядок тот же, что у самоудаления: сначала отозвать вход, потом стирать
  // личность. Иначе между «почты нет» и «сессий нет» остаётся окно, в котором
  // игрок ещё может что-то сделать со своим аккаунтом.
  const sessions = await revokeAllSessions(db, userId, now);
  await db.prepare(`UPDATE users SET email = NULL, password_hash = NULL, status = 'deleted' WHERE id = ?`)
    .bind(userId).run();
  return { closedAt: now, sessions, balanceMicro: summary.payBalanceMicro, wiped: { email: true, password: true } };
}

/**
 * Отозвать все refresh-сессии.
 *
 * Важно, чего этот шаг НЕ делает: access-токен живёт 15 минут и проверяется без
 * базы (иначе каждое действие игрока стало бы запросом в D1). Значит после
 * блокировки игрок доигрывает эти минуты. Это честно и это же причина, по которой
 * «заморозить мир» и «заблокировать игрока» — разные по скорости инструменты.
 */
export async function revokeAllSessions(db: D1Database, userId: string, now: number): Promise<number> {
  const res = await db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .bind(now, userId).run();
  return changesOf(res);
}

function changesOf(res: unknown): number {
  return Number((res as { meta?: { changes?: number } })?.meta?.changes ?? 0);
}
