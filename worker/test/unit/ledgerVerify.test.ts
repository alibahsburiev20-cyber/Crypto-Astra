import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/shared/constants';
import { applyDelta } from '../../src/world/balances';
import {
  LEDGER_TAIL_KEY, VERIFY_SEQ_KEY, verifyLedger, verifyNow, verifyWatermark,
} from '../../src/world/ledger';
import { claim } from '../../src/world/modules/claim';
import { createPlayer } from '../../src/world/modules/players';
import { FULL_VERIFY_INTERVAL_MS, runLedgerVerify, setMeta } from '../../src/world/modules/maintenance';
import { makeWorld } from '../helpers/sqlShim';

// Сколько стоит сверка журнала.
//
// `ledger` — append-only таблица, которая растёт всё время, что живёт сезон.
// Раньше часовой прогон перечитывал и пересчитывал от генезиса ВЕСЬ журнал,
// то есть мир неизбежно доходил до «проверка дольше, чем игра», и further — до
// 500-х на каждом запросе. Проверяем, что быстрая форма остаётся быстрой и при
// этом всё ещё видит подделку.

const T0 = DAY_MS * 10;

function world() {
  return makeWorld();
}

function populate(tx: <T>(fn: () => T) => T, sql: SqlStorage, players = 3, actions = 4) {
  for (let i = 1; i <= players; i += 1) tx(() => createPlayer(sql, `p${i}`, T0));
  for (let i = 1; i <= players; i += 1) {
    for (let a = 0; a < actions; a += 1) tx(() => claim(sql, `p${i}`, `k${i}-${a}`, T0 + a * 15 * 60_000));
  }
}

describe('водораздел сверки', () => {
  it('успешный прогон оставляет отметку, провал — нет', () => {
    const { sql, tx } = world();
    populate(tx, sql);
    expect(verifyWatermark(sql)).toBe(null);
    tx(() => runLedgerVerify(sql, T0));
    const mark = verifyWatermark(sql);
    expect(mark).not.toBe(null);
    expect(mark!.seq).toBeGreaterThan(0);

    // Подделка — отметка не двигается: следующий прогон обязан проверить хвост
    // заново от последней честной точки, а не «проскочить» испорченное.
    tx(() => {
      sql.exec('DROP TRIGGER IF EXISTS ledger_no_update');
      sql.exec('UPDATE ledger SET delta = delta + 1 WHERE seq = 1');
    });
    const before = verifyWatermark(sql)!.seq;
    tx(() => runLedgerVerify(sql, T0 + DAY_MS));
    expect(sql.exec(`SELECT value FROM meta WHERE key = 'frozen'`).toArray()[0].value).toBe('1');
    expect(verifyWatermark(sql)!.seq).toBe(before);
  });

  it('быстрая форма видит подделку СТАРОЙ строки — по суммам', () => {
    const { sql, tx } = world();
    populate(tx, sql);
    tx(() => runLedgerVerify(sql, T0));
    expect(verifyNow(sql).ok).toBe(true);
    // Отметка уже за первой строкой: хеш-цепочку быстрая форма с этого места не
    // пересчитывает. Значит подделку в старом ловит другой слой — суммы.
    const mark = verifyWatermark(sql)!;
    expect(mark.seq).toBeGreaterThan(1);
    tx(() => {
      sql.exec('DROP TRIGGER IF EXISTS ledger_no_update');
      sql.exec('UPDATE ledger SET delta = delta + 5 WHERE seq = 1');
    });
    const fast = verifyNow(sql);
    expect(fast.ok).toBe(false);
    expect(fast.mismatches.length).toBeGreaterThan(0);
    // Полная форма находит ту же порчу по цепочке.
    expect(verifyLedger(sql).brokenAtSeq).toBe(1);
  });

  it('удаление строки из середины видно по счётчикам', () => {
    const { sql, tx } = world();
    populate(tx, sql);
    tx(() => runLedgerVerify(sql, T0));
    expect(verifyNow(sql).ok).toBe(true);
    tx(() => {
      sql.exec('DROP TRIGGER IF EXISTS ledger_no_delete');
      // Последняя строка — чтобы суммы остались целыми и «по сумме» промах не
      // считался единственным способом это заметить.
      sql.exec('DELETE FROM ledger WHERE seq = (SELECT MAX(seq) FROM ledger)');
    });
    const fast = verifyNow(sql);
    expect(fast.ok).toBe(false);
    expect(fast.brokenAtSeq).not.toBe(null);
  });

  it('полная перепроверка делается раз в неделю, а не каждый час', () => {
    const { sql, tx } = world();
    populate(tx, sql);
    tx(() => runLedgerVerify(sql, T0));
    expect(Number(sql.exec(`SELECT value FROM meta WHERE key = 'ledger_verify_full_at'`).toArray()[0].value)).toBe(T0);
    tx(() => runLedgerVerify(sql, T0 + 3_600_000));
    expect(Number(sql.exec(`SELECT value FROM meta WHERE key = 'ledger_verify_full_at'`).toArray()[0].value)).toBe(T0);
    tx(() => runLedgerVerify(sql, T0 + FULL_VERIFY_INTERVAL_MS + 1));
    expect(Number(sql.exec(`SELECT value FROM meta WHERE key = 'ledger_verify_full_at'`).toArray()[0].value))
      .toBe(T0 + FULL_VERIFY_INTERVAL_MS + 1);
  });

  it('суммы считаются одним запросом, а не построчно', () => {
    // Иначе «проверка мира» остаётся самой дорогой операцией в мире: журнал
    // растёт быстрее, чем кто-либо успевает его перечитать.
    const { sql, tx } = world();
    populate(tx, sql, 5, 40);
    const reads: string[] = [];
    const proxy = {
      exec(query: string, ...binds: unknown[]) {
        reads.push(query.replace(/\s+/g, ' ').trim());
        return sql.exec(query, ...binds);
      },
    } as unknown as SqlStorage;
    // Первый прогон — полный (отметки ещё нет), второй идёт по быстрому пути:
    // именно его и смотрим.
    tx(() => runLedgerVerify(sql, T0));
    reads.length = 0;
    tx(() => runLedgerVerify(proxy, T0 + DAY_MS));
    const walk = reads.filter((q) => /FROM ledger/.test(q) && /seq > \?/.test(q));
    // Хвост читается с условием по seq, а не «весь журнал в память».
    expect(walk.length).toBeGreaterThan(0);
    expect(reads.some((q) => /GROUP BY player_id, asset/.test(q))).toBe(true);
    expect(reads.some((q) => /^SELECT \* FROM ledger ORDER BY seq$/.test(q))).toBe(false);
  });

  it('миру без отметки показывается полная проверка', () => {
    const { sql, tx } = world();
    populate(tx, sql, 2, 2);
    expect(verifyWatermark(sql)).toBe(null);
    expect(verifyNow(sql).ok).toBe(true);
    expect(verifyNow(sql).rows).toBe(verifyLedger(sql).rows);
  });

  it('пустая отметка в meta не ломает быстрый путь', () => {
    const { sql, tx } = world();
    populate(tx, sql);
    tx(() => {
      setMeta(sql, VERIFY_SEQ_KEY, '0');
      setMeta(sql, LEDGER_TAIL_KEY, '999999:999999');
    });
    expect(verifyWatermark(sql)).toBe(null);
    // Просроченный «хвост» без отметки — это повод проверить всё, а не заморозить мир.
    expect(verifyNow(sql).ok).toBe(true);
  });

  it('начисление задним числом не остаётся незамеченным', () => {
    const { sql, tx } = world();
    populate(tx, sql);
    tx(() => runLedgerVerify(sql, T0));
    tx(() => applyDelta(sql, { playerId: 'p1', asset: 'astra', delta: 1_000_000, reason: 'claim' }, T0 + DAY_MS));
    expect(verifyNow(sql).ok).toBe(true); // новый хвост ещё не проверен, но и не испорчен
    tx(() => runLedgerVerify(sql, T0 + DAY_MS + 1));
    const mark = verifyWatermark(sql)!;
    expect(mark.seq).toBeGreaterThan(0);
    expect(verifyNow(sql).ok).toBe(true);
  });
});
