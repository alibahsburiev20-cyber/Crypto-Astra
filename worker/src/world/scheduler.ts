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
  const row = sql.exec(`SELECT MIN(run_at) AS t FROM jobs WHERE status = 'pending'`).toArray()[0];
  const raw = row?.t;
  if (raw === null || raw === undefined) return null;
  const t = Number(raw);
  return Number.isFinite(t) ? t : null;
}
