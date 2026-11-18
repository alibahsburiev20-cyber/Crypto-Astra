import { runFuelRegen, runIdemCleanup, runLedgerVerify, ensureMaintenance } from './modules/maintenance';
import { finishCraft } from './modules/crafting';
import { finishExpedition, openExpeditionEvent, timeoutExpeditionEvent } from './modules/expeditions';
import { nextAttempt, parsePayload, type JobRow } from './scheduler';

export function runJob(sql: SqlStorage, job: JobRow, now: number): void {
  const payload = job.payload ? parsePayload<Record<string, string | number>>(job.payload) : {};
  if (job.kind === 'expedition_finish') return finishExpedition(sql, String(payload.expeditionId), now);
  if (job.kind === 'expedition_event') return openExpeditionEvent(sql, String(payload.expeditionId), Number(payload.eventIdx), now);
  if (job.kind === 'expedition_event_timeout') return timeoutExpeditionEvent(sql, String(payload.expeditionId), Number(payload.eventIdx), now);
  if (job.kind === 'craft_finish') return finishCraft(sql, String(payload.jobId), now);
  if (job.kind === 'fuel_regen') return runFuelRegen(sql, String(payload.playerId), Number(job.run_at ?? now), now);
  if (job.kind === 'ledger_verify') return runLedgerVerify(sql, now);
  if (job.kind === 'idem_cleanup') return runIdemCleanup(sql, now);
  throw new Error('unknown_job');
}

export function runDueJobs(sql: SqlStorage, now: number, tx: <T>(fn: () => T) => T, limit = 40): number {
  tx(() => ensureMaintenance(sql, now));
  let ran = 0;
  for (let i = 0; i < limit; i++) {
    const due = sql.exec(
      `SELECT id, kind, payload, attempts, run_at FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT 1`,
      now,
    ).toArray();
    if (!due.length) break;
    const job: JobRow = {
      id: String(due[0].id), kind: String(due[0].kind), payload: String(due[0].payload),
      attempts: Number(due[0].attempts), run_at: Number(due[0].run_at),
    };
    try {
      tx(() => {
        const still = sql.exec(`SELECT id FROM jobs WHERE id = ? AND status = 'pending'`, job.id).toArray();
        if (!still.length) return;
        runJob(sql, job, now);
        sql.exec(`UPDATE jobs SET status = 'done' WHERE id = ?`, job.id);
      });
      ran++;
    } catch (e) {
      tx(() => {
        const cur = sql.exec(`SELECT attempts, status FROM jobs WHERE id = ?`, job.id).toArray()[0];
        if (!cur || cur.status !== 'pending') return;
        const next = nextAttempt(Number(cur.attempts), now);
        sql.exec(`UPDATE jobs SET status = ?, attempts = ?, run_at = ? WHERE id = ?`, next.status, next.attempts, next.runAt, job.id);
      });
      console.error('job failed', job.kind, e);
    }
  }
  return ran;
}
