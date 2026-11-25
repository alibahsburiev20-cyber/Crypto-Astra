// Обслуживание платёжного контура: суточная сверка без привязки к тексту
// расписания, ротация сырых событий сети и честный отказ витрины, когда платежи
// выключены. Всё это — «тихие» механизмы: они не видны игроку до того момента,
// когда становятся видны очень сильно (несходится журнал / кончается квота D1 /
// в поиске висит «пустой магазин»). Поэтому здесь проверяются именно условия
// запуска и отказа, а не красивость отчёта.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { staticResponse } from '../../src/http/static';
import { payProducts } from '../../src/routes/pay';
import { CHAIN_EVENTS_PRUNE_LIMIT, CHAIN_EVENTS_RETENTION_DAYS, pruneChainEvents } from '../../src/pay/cleanup';
import { RECONCILE_MIN_INTERVAL_MS, reconcileDaily } from '../../src/pay/reconcile';

const T0 = 1_770_000_000_000;

interface FakeDb {
  db: unknown;
  ops: Map<string, string>;
  log: { sql: string; bind: unknown[] }[];
}

/**
 * D1-заглушка: `pay_operations` работает хранилищем (в нём живёт отметка
 * сверки), остальные чтения отдают «пусто» — пустая, но согласованная база для
 * сверки означает «всё сходится».
 */
function makeDb(opts: { failOpsInsert?: boolean } = {}): FakeDb {
  const ops = new Map<string, string>();
  const log: { sql: string; bind: unknown[] }[] = [];
  let failed = false;
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const self = {
        bind(...values: unknown[]) {
          args = values;
          log.push({ sql, bind: values });
          return self;
        },
        async first() {
          if (sql.startsWith('SELECT response FROM pay_operations')) return ops.get(String(args[1])) ?? null;
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (sql.startsWith('INSERT INTO pay_operations')) {
            if (opts.failOpsInsert && !failed) {
              failed = true;
              throw new Error('db is down');
            }
            ops.set(String(args[0]), String(args[1]));
          }
          return { meta: { changes: 1 } };
        },
      };
      return self;
    },
  };
  return { db, ops, log };
}

describe('суточная сверка (reconcileDaily)', () => {
  it('первый тик сверяет и ставит отметку; частота расписания больше не важна', async () => {
    const { db, ops } = makeDb();
    const first = await reconcileDaily(db as never, T0);
    expect(first).not.toBeNull();
    expect(first?.ok).toBe(true);
    expect(JSON.parse(ops.get('reconcile_last')!)).toEqual({ ts: T0 });

    // Тот же час — та же отметка: повторять тяжёлую сверку каждый тик нельзя.
    expect(await reconcileDaily(db as never, T0 + 60_000)).toBeNull();

    // Порог прошёл — сверка снова состоялась (и отметка сдвинулась).
    const later = await reconcileDaily(db as never, T0 + RECONCILE_MIN_INTERVAL_MS + 1);
    expect(later).not.toBeNull();
    expect(JSON.parse(ops.get('reconcile_last')!)).toEqual({ ts: T0 + RECONCILE_MIN_INTERVAL_MS + 1 });
  });

  it('не привязана к строке cron: проверка вызывается из обычного тика', async () => {
    // У функции нет параметра «какой cron сработал» — структурная страховка от
    // возврата прежней схемы `controller.cron === '0 3 * * *'`.
    expect(reconcileDaily.length).toBe(2);
    const { db } = makeDb();
    await expect(reconcileDaily(db as never, T0)).resolves.toBeTruthy();
  });

  it('база упала при записи отметки — сверка не считается сделанной', async () => {
    const { db, ops } = makeDb({ failOpsInsert: true });
    await expect(reconcileDaily(db as never, T0)).rejects.toThrow(/db is down/);
    expect(ops.has('reconcile_last')).toBe(false);
    // Следующий тик (пусть и через минуту) попробует снова: без отметки «сверено»
    // нет, а молчать сутки после сбоя — значит потерять и автостоп.
    await expect(reconcileDaily(db as never, T0 + 60_000)).resolves.not.toBeNull();
  });
});

describe('ротация pay_chain_events', () => {
  it('удаляет только завершённое и только старое', async () => {
    const captured: { sql: string; bind: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            captured.push({ sql, bind: values });
            return this;
          },
          async run() {
            return { meta: { changes: 42 } };
          },
        };
      },
    };
    const res = await pruneChainEvents(db as never, T0);
    expect(res.deleted).toBe(42);
    expect(res.cutoff).toBe(T0 - CHAIN_EVENTS_RETENTION_DAYS * 86_400_000);
    const { sql, bind } = captured[0]!;
    expect(sql).toContain('DELETE FROM pay_chain_events');
    // Только `orphan` и «success, по которому журнал уже стоит»; свежие и
    // незакрытые события остаются.
    expect(sql).toContain("e.status = 'orphan'");
    expect(sql).toContain("e.status = 'success' AND l.id IS NOT NULL");
    expect(sql).toContain('LEFT JOIN pay_ledger l ON l.idem_key');
    expect(bind[0]).toBe(T0 - CHAIN_EVENTS_RETENTION_DAYS * 86_400_000);
    expect(bind[1]).toBe(CHAIN_EVENTS_PRUNE_LIMIT);
  });

  it('пустой ответ базы — 0 удалённых, без падения', async () => {
    const db = { prepare: () => ({ bind() { return this; }, async run() { return {}; } }) };
    expect(await pruneChainEvents(db as never, T0)).toEqual({ deleted: 0, cutoff: T0 - 30 * 86_400_000 });
  });
});

describe('витрина при выключенных платежах', () => {
  it('контур выключен — 503 payments_disabled, а не 200 с пустым каталогом', async () => {
    await expect(payProducts({} as never)).rejects.toMatchObject({
      status: 503,
      code: 'payments_disabled',
    });
    await expect(payProducts({ PAYMENTS_ENABLED: 'true' } as never)).rejects.toMatchObject({
      status: 503,
      code: 'payments_disabled',
    });
  });

  it('контур включён — каталог отдаётся, даже если покупок ещё нет', async () => {
    const res = await payProducts({
      PAYMENTS_ENABLED: 'on',
      PURCHASES_ENABLED: 'on',
    } as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; products: unknown[]; purchasesEnabled: boolean };
    expect(body.ok).toBe(true);
    expect(body.purchasesEnabled).toBe(true);
    expect(Array.isArray(body.products)).toBe(true);
  });
});

describe('платёжные страницы и индексирование', () => {
  it('витрина и админка закрыты от поиска заголовком', () => {
    expect(staticResponse('/pay.html', 'GET')?.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(staticResponse('/admin.html', 'GET')?.headers.get('X-Robots-Tag')).toBe('noindex');
    // Метатег в разметке — второй контур (для тех, кто читает HTML, а не заголовки).
    const body = staticResponse('/pay.html', 'GET')!;
    return body.text().then((text) => expect(text).toContain('name="robots"'));
  });

  it('лендинг и публичный отчёт пула — не закрыты: их индексирование и нужно', () => {
    expect(staticResponse('/', 'GET')?.headers.get('X-Robots-Tag')).toBeNull();
    expect(staticResponse('/pool.html', 'GET')?.headers.get('X-Robots-Tag')).toBeNull();
  });

  it('набором заголовков правит не index.ts в одиночку: client/_headers обязан знать ту же политику', () => {
    const headersFile = readFileSync(new URL('../../../client/_headers', import.meta.url), 'utf8');
    expect(headersFile).toContain('X-Robots-Tag: noindex');
    for (const page of ['/pay.html', '/admin.html']) {
      expect(headersFile).toContain(page);
    }
  });
});
