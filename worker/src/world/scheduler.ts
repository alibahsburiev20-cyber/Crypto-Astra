const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000];

export interface JobRow {
  id: string;
  kind: string;
  payload: string;
  attempts: number;
  run_at?: number;
}

export function enqueue(sql: SqlStorage, kind: string, runAt: number, payload: unknown): string {
  const id = crypto.randomUUID();
  sql.exec(
    `INSERT INTO jobs (id, run_at, kind, payload, status, attempts) VALUES (?, ?, ?, ?, 'pending', 0)`,
    id, runAt, kind, JSON.stringify(payload),
  );
  return id;
}

export function nextAttempt(attempts: number, now: number): { status: 'pending' | 'failed'; runAt: number; attempts: number } {
  const n = attempts + 1;
  if (n >= 5) return { status: 'failed', runAt: now, attempts: n };
  return { status: 'pending', runAt: now + BACKOFF_MS[Math.min(n - 1, BACKOFF_MS.length - 1)], attempts: n };
}

export function playerPayload(playerId: string): string {
  return JSON.stringify({ playerId });
}

/** Снимает отложенные задачи этой экспедиции. Ledger не трогает. */
export function dropExpeditionJobs(sql: SqlStorage, expeditionId: string): void {
  const rows = sql.exec(
    `SELECT id, payload FROM jobs WHERE status = 'pending' AND kind IN ('expedition_finish', 'expedition_event', 'expedition_event_timeout')`,
  ).toArray();
  for (const r of rows) {
    let payload: { expeditionId?: string } = {};
    try { payload = JSON.parse(String(r.payload)); } catch { /* битый payload всё равно не исполнится полезно */ }
    if (payload.expeditionId === expeditionId) sql.exec(`UPDATE jobs SET status = 'done' WHERE id = ?`, String(r.id));
  }
}

export function parsePayload<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

/** Ближайший run_at среди pending-задач. null — задач нет, будильник можно снять. */
export function nextAlarmAt(sql: SqlStorage): number | null {
  return minRunAt(sql);
}

function minRunAt(sql: SqlStorage, kinds?: readonly string[]): number | null {
  const rows = kinds
    ? sql.exec(
      `SELECT MIN(run_at) AS t FROM jobs WHERE status = 'pending' AND kind IN (${kinds.map(() => '?').join(', ')})`,
      ...kinds,
    ).toArray()
    : sql.exec(`SELECT MIN(run_at) AS t FROM jobs WHERE status = 'pending'`).toArray();
  const raw = rows[0]?.t;
  if (raw === null || raw === undefined) return null;
  const t = Number(raw);
  return Number.isFinite(t) ? t : null;
}

/** Ближайшая задача, которая влияет на игру (см. `CRITICAL_KINDS`). */
export function nextCriticalAt(sql: SqlStorage): number | null {
  return minRunAt(sql, CRITICAL_KINDS);
}

/** Ближайшая служебная задача: сверка, уборка, регенерация топлива. */
export function nextMaintenanceAt(sql: SqlStorage): number | null {
  const marks = CRITICAL_KINDS.map(() => '?').join(', ');
  const rows = sql.exec(
    `SELECT MIN(run_at) AS t FROM jobs WHERE status = 'pending' AND kind NOT IN (${marks})`,
    ...CRITICAL_KINDS,
  ).toArray();
  const raw = rows[0]?.t;
  if (raw === null || raw === undefined) return null;
  const t = Number(raw);
  return Number.isFinite(t) ? t : null;
}

// --- Сон мира ---------------------------------------------------------------
//
// Мир просыпается по будильнику (alarm) и по часовому cron. Каждое пробуждение
// стоит времени Durable Object, а на бесплатном плане его 13 000 GB-секунд в
// сутки на всё. Поэтому, когда в мире давно никого не было, будим его только
// под задачи, которые влияют на игру (рейс, крафт, сезон), а служебные
// (сверка журнала, уборка идемпотентности, регенерация топлива) отдаём
// часовому cron — они и так догоняются «пачкой» при следующем пробуждении.

/** Сколько тишины считаем «в мире никого нет». */
export const IDLE_AFTER_MS = 10 * 60_000;

/** Задачи, которые нельзя отложить: от них зависит то, что видит игрок. */
export const CRITICAL_KINDS = [
  'expedition_finish',
  'expedition_event',
  'expedition_event_timeout',
  'craft_finish',
  'season_close',
] as const;

/**
 * Когда будить мир.
 *
 * `criticalAt` — ближайшая играющая задача, `maintenanceAt` — ближайшая
 * служебная. Возвращает `null`, если будить нечего.
 *
 * В тишине служебные задачи игнорируются: их догонит cron, а каждая лишняя
 * побудка — это потраченное время объекта.
 */
export function decideWakeAt(
  now: number,
  lastActivityAt: number,
  criticalAt: number | null,
  maintenanceAt: number | null,
): number | null {
  const idle = now - Math.max(0, lastActivityAt) >= IDLE_AFTER_MS;
  if (idle) return criticalAt;
  if (criticalAt === null) return maintenanceAt;
  if (maintenanceAt === null) return criticalAt;
  return Math.min(criticalAt, maintenanceAt);
}
