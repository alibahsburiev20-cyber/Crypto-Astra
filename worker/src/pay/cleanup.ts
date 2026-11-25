// Гигиена платёжных таблиц: что можно удалять, не потеряв проверяемость.
//
// Почему это вообще нужно: `pay_chain_events` — сырой поток сети. Каждая строка
// хранит ещё и `raw` — полное тело события. На бесплатном D1 (лимит 5 ГБ) такой
// журнал без ротации упирается в потолок за месяцы, и «база кончилась»
// обнаруживается в момент, когда приходят настоящие деньги.
//
// Почему безопасно: начисление смотрит на событие ровно один раз (перевод в
// журнал), после этого истина — `pay_ledger` и `pay_deposits`, а не этот поток.
// Удаляем только завершённые строки: `orphan` (блок ушёл в переорганизацию) и
// `success`, для которых запись в журнале уже стоит. Незачисленные `success` не
// трогаем никогда — их ещё должен увидеть `applyDeposits`. Если сканер однажды
// заново найдёт удалённое событие, повторного начисления не будет: строчка
// журнала с ref `dep:<txid>:<индекс>` уже существует.
//
// `limit` — про размер одного оператора, а не про объём: проверка «начислено ли»
// — индексный поиск по `pay_ledger.idem_key` (колонка UNIQUE), но D1 исполняет
// удаление одним утверждением, и лимит держит любой тик в границах. Если
// удалённых строк много, они уйдут за несколько тиков — это нормально.
//
// Таблица `pay_chain_blocks` (курсоры сканера) не чистится намеренно: там одна
// строка на цепь+контракт, места она не занимает, а потерять курсор дороже, чем
// хранить его.

/** Как глубоко хранить сырые события сети. 30 дней перекрывают самые
 *  консервативные сценарии разбора «почему деньги не зачислились» — игрок
 *  приходит с txid в поддержку неделями позже. */
export const CHAIN_EVENTS_RETENTION_DAYS = 30;
/** За один тик — потолок, см. комментарий про цену джойнера. */
export const CHAIN_EVENTS_PRUNE_LIMIT = 500;

export interface PruneResult {
  deleted: number;
  cutoff: number;
}

/**
 * Удаляет завершённые события сети старше `retentionDays`. Возвращает число
 * удалённых строк — cron пишет его в лог, и по нему видно, разгоняется ли
 * отставание: если `deleted` ходит по лимиту тик за тиком, событий приходит
 * больше, чем успевает уходить, — лимит или частоту надо поднимать.
 */
export async function pruneChainEvents(
  db: D1Database,
  now: number,
  options: { retentionDays?: number; limit?: number } = {},
): Promise<PruneResult> {
  const retentionDays = options.retentionDays ?? CHAIN_EVENTS_RETENTION_DAYS;
  const limit = options.limit ?? CHAIN_EVENTS_PRUNE_LIMIT;
  const cutoff = now - retentionDays * 86_400_000;
  const res = await db.prepare(
    `DELETE FROM pay_chain_events WHERE rowid IN (
       SELECT e.rowid FROM pay_chain_events e
       LEFT JOIN pay_ledger l ON l.idem_key = 'dep:' || e.txid || ':' || e.event_index
       WHERE e.created_at < ?
         AND (e.status = 'orphan' OR (e.status = 'success' AND l.id IS NOT NULL))
       ORDER BY e.rowid
       LIMIT ?)`,
  ).bind(cutoff, limit).run();
  const meta = (res as { meta?: { changes?: number } }).meta;
  return { deleted: Number(meta?.changes ?? 0), cutoff };
}
