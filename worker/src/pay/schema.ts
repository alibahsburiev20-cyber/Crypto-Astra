// Схема Astra Pay Core: 15 таблиц `pay_*`.
//
// Канон — миграции `worker/migrations/d1/0007_astra_pay.sql` (создаёт) и
// `0008_pay_addresses_chain.sql` (перестраивает `pay_addresses` под сеть).
// Здесь тот же DDL,
// но идемпотентный (`IF NOT EXISTS`), потому что прод деплоится из браузера:
// `wrangler d1 migrations apply --remote` оттуда не запустить. На уже
// мигрированной базе эти запросы — no-op.
//
// Деньги считаются только целыми числами: `amount_micro` — микро-USDT
// (1 USDT = 1 000 000). Никаких `REAL` и плавающей точки.
//
// Основные инварианты, зашитые в схему:
//   * один адрес на пару «игрок + цепь» (UNIQUE `(user_id, chain)`) и один
//     `derivation_index` на весь мир; адрес не «на вечность», а «на цепь»:
//     при переезде сети игрок получает второй, а первый остаётся видимым
//     монитору старой цепи, пока на нём есть деньги;
//   * один открытый счёт на игрока (частичный UNIQUE-индекс по `status='open'`);
//   * один открытый цикл пула (частичный UNIQUE-индекс по `status='open'`);
//   * одно событие блокчейна — одна строка (`PRIMARY KEY (txid, event_index)`);
//   * `pay_ledger` и `pay_audit_log` нельзя изменить или удалить (триггеры);
//   * повтор операции не удваивает учёт: `idem_key` UNIQUE / `PRIMARY KEY (scope, idem_key)`.

// 1 — схема «один адрес на игрока вообще»; 2 — адрес привязан к сети
// (`pay_addresses.chain`): игроки могут иметь по одному адресу на цепь;
// 3 — сеть вторая (Polygon): `pay_addresses.chain` принимает `polygon` (миграция
// 0009), и у заявки на выплату есть СВОЯ сеть (`pay_withdrawals.chain`, 0010) —
// платить надо туда, куда просили, а не туда, что включено сейчас.
// Версию видно в `/pay/status.json`: по ней оператор определяет, что переезд
// схемы дошёл до базы, а не только в код.
export const PAY_SCHEMA_VERSION = 3;

/** Имена таблиц. Используются в тестах, сверке и админке. */
export const PAY_TABLES = [
  'pay_addresses',
  'pay_invoices',
  'pay_chain_blocks',
  'pay_chain_events',
  'pay_deposits',
  'pay_ledger',
  'pay_products',
  'pay_entitlements',
  'pay_pool_cycles',
  'pay_withdrawals',
  'pay_payouts',
  'pay_treasury',
  'pay_operations',
  'pay_audit_log',
  'pay_chain_cursor',
] as const;

/** Форма таблицы; имя параметром, потому что перестройка строит её как `_new`. */
function payAddressesDdl(table: string): string {
  return `CREATE TABLE IF NOT EXISTS ${table} (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     chain TEXT NOT NULL DEFAULT 'tron' CHECK (chain IN ('tron', 'bsc', 'polygon')),
     address TEXT NOT NULL UNIQUE,
     hex TEXT NOT NULL UNIQUE,
     derivation_index INTEGER NOT NULL UNIQUE,
     active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
     last_scanned_ts INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL)`;
}

export const PAY_ADDRESSES_DDL = payAddressesDdl('pay_addresses');


/**
 * Что делает код, если застал `pay_addresses` старой формы. Совпадает с
 * миграцией 0008; отдельно держим, чтобы тест мог сверить форму таблицы,
 * собранной из этих же строк, с таблицей после `d1 migrations apply`.
 */
export const PAY_ADDRESSES_REBUILD: string[] = [
  // Мусорное имя `_new` снимаем: перестройка обязана идти против ЧИСТОЙ
  // заготовки, иначе leftover от чьей-то прерванной миграции стал бы «новой»
  // таблицей.
  'DROP TABLE IF EXISTS pay_addresses_new',
  payAddressesDdl('pay_addresses_new'),
  // Копия идёт ДО удаления: если что-то пойдёт не так, `batch` откатит всё.
  // `INSERT` без `OR IGNORE` — при любом конфликте падает вся транзакция, а не
  // «тихо потеряла строку».
  // Форму сети угадываем по префиксу адреса: `0x…` — EVM, `T…` — TRON. Какая
  // именно EVM-сеть была активна, из старых строк не восстановить, и это не
  // важно: `polygon` в CHECK появилась уже вместе с polygon-адресами, а строки
  // из старого CHECK не бывают polygon по определению.
  `INSERT INTO pay_addresses_new (
       id, user_id, chain, address, hex, derivation_index, active, last_scanned_ts, created_at)
     SELECT id, user_id,
            CASE WHEN address LIKE '0x%' THEN 'bsc' ELSE 'tron' END,
            address, hex, derivation_index, active, last_scanned_ts, created_at
       FROM pay_addresses`,
  'DROP TABLE pay_addresses',
  'ALTER TABLE pay_addresses_new RENAME TO pay_addresses',
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_addresses_user_chain ON pay_addresses (user_id, chain)',
  'CREATE INDEX IF NOT EXISTS idx_pay_addresses_active ON pay_addresses (active, created_at)',
];

export const PAY_STATEMENTS: string[] = [
  // 1. Депозитные адреса. Внутри одной цепи адрес выдаётся один раз и навсегда:
  // менять адрес — значит терять депозиты, отправленные на старый. `chain` —
  // сеть, к которой адрес относится: он же и ответ на вопрос «что делать при
  // переезде» (выдать адрес новой цепи, старый не трогать). DEFAULT 'tron' —
  // компромисс с прошлым: старые строки, скопированные миграцией 0008, — ровно
  // TRON-овские.
  PAY_ADDRESSES_DDL,
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_addresses_user_chain ON pay_addresses (user_id, chain)',
  'CREATE INDEX IF NOT EXISTS idx_pay_addresses_active ON pay_addresses (active, created_at)',

  // 2. Счета на оплату. Сумма фиксируется при выставлении: игрок платит ровно её.
  `CREATE TABLE IF NOT EXISTS pay_invoices (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     product_id TEXT,
     amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
     status TEXT NOT NULL DEFAULT 'open'
       CHECK (status IN ('open', 'paid', 'expired', 'cancelled', 'manual')),
     address TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     paid_at INTEGER,
     deposit_txid TEXT)`,

  // 3. Обработанные блоки: курсор монитора. Пропуск высоты — авария, а не норма.
  // 4а. Курсоры сканеров: с какого блока смотреть дальше. Отдельно от адресов,
  // потому что EVM-сканер идёт диапазоном блоков и сразу по всем адресам, а не
  // «по одному адресу по времени».
  `CREATE TABLE IF NOT EXISTS pay_chain_cursor (
     chain TEXT NOT NULL,
     contract TEXT NOT NULL,
     height INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (chain, contract))`,

  `CREATE TABLE IF NOT EXISTS pay_chain_blocks (
     height INTEGER PRIMARY KEY,
     block_id TEXT NOT NULL,
     parent_id TEXT NOT NULL DEFAULT '',
     solidified_at INTEGER,
     processed_at INTEGER NOT NULL)`,

  // 4. События контракта USDT. `raw` хранит исходный JSON: при споре видно, что
  // именно пришло от индексатора.
  `CREATE TABLE IF NOT EXISTS pay_chain_events (
     txid TEXT NOT NULL,
     event_index INTEGER NOT NULL,
     block_height INTEGER NOT NULL,
     block_time INTEGER,
     from_addr TEXT NOT NULL,
     to_addr TEXT NOT NULL,
     contract TEXT NOT NULL,
     amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
     status TEXT NOT NULL DEFAULT 'success',
     raw TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     PRIMARY KEY (txid, event_index))`,
  'CREATE INDEX IF NOT EXISTS idx_pay_chain_events_block ON pay_chain_events (block_height)',
  'CREATE INDEX IF NOT EXISTS idx_pay_chain_events_to ON pay_chain_events (to_addr, block_height)',

  // 5. Депозиты: связка события блокчейна с игроком. `credited` без записи в
  // `pay_ledger` невозможен — проверка идёт в одной транзакции.
  `CREATE TABLE IF NOT EXISTS pay_deposits (
     id TEXT PRIMARY KEY,
     txid TEXT NOT NULL,
     event_index INTEGER NOT NULL,
     user_id TEXT NOT NULL,
     address TEXT NOT NULL,
     amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
     confirmations INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'detected'
       CHECK (status IN ('detected', 'confirmed', 'credited', 'manual', 'ignored')),
     credited_at INTEGER,
     created_at INTEGER NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     UNIQUE (txid, event_index))`,
  'CREATE INDEX IF NOT EXISTS idx_pay_deposits_user ON pay_deposits (user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_pay_deposits_status ON pay_deposits (status, created_at)',

  // 6. Финансовый Ledger: append-only, отдельно от игрового Ledger мира.
  // ASTRA и USDT не смешиваются никогда. Баланс игрока = сумма `delta`.
  `CREATE TABLE IF NOT EXISTS pay_ledger (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     asset TEXT NOT NULL DEFAULT 'USDT' CHECK (asset = 'USDT'),
     delta INTEGER NOT NULL CHECK (delta <> 0),
     reason TEXT NOT NULL
       CHECK (reason IN ('deposit', 'purchase', 'payout', 'fee', 'adjust', 'pool', 'sweep')),
     source_ref TEXT NOT NULL DEFAULT '',
     idem_key TEXT NOT NULL UNIQUE,
     prev_hash TEXT NOT NULL DEFAULT '',
     hash TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_pay_ledger_user ON pay_ledger (user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_pay_ledger_reason ON pay_ledger (reason, created_at)',

  // 7. Товары. Цена — целое число микро-USDT, без скидок и плавающих значений.
  `CREATE TABLE IF NOT EXISTS pay_products (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('cosmetic', 'premium', 'service')),
     title TEXT NOT NULL,
     price_micro INTEGER NOT NULL CHECK (price_micro > 0),
     catalog_json TEXT NOT NULL DEFAULT '{}',
     enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
     season_id TEXT,
     created_at INTEGER NOT NULL)`,

  // 8. Выдачи купленного. Идемпотентны: одна покупка — одна выдача.
  `CREATE TABLE IF NOT EXISTS pay_entitlements (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     product_id TEXT NOT NULL,
     purchase_id TEXT NOT NULL,
     granted_at INTEGER NOT NULL,
     expires_at INTEGER,
     payload TEXT NOT NULL DEFAULT '{}',
     UNIQUE (user_id, purchase_id))`,

  // 9. Циклы пула в USDT. Available = confirmed_in − reserved − paid − locked.
  `CREATE TABLE IF NOT EXISTS pay_pool_cycles (
     id TEXT PRIMARY KEY,
     period_start INTEGER NOT NULL,
     period_end INTEGER NOT NULL,
     confirmed_in INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_in >= 0),
     ops_reserved INTEGER NOT NULL DEFAULT 0 CHECK (ops_reserved >= 0),
     prize_budget INTEGER NOT NULL DEFAULT 0 CHECK (prize_budget >= 0),
     reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
     paid INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
     locked INTEGER NOT NULL DEFAULT 0 CHECK (locked >= 0),
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
     created_at INTEGER NOT NULL,
     closed_at INTEGER)`,

  // 10. Заявки на выплату. Переходы состояний — только по разрешённой таблице.
  //
  // Колонка `chain` — сеть, в которой игрок просит заплатить, и она же сеть,
  // куда уходит транзакция. Выводить её из текущей конфигурации воркера нельзя:
  // адрес 0x… выглядит одинаково в BNB Chain и в Polygon (семя и индекс те же),
  // и «платим по PAY_CHAIN» означало бы «выплата уехала в другую сеть» — молча,
  // потому что txid настоящий, а баланс списан. DEFAULT 'tron' закрывает строки,
  // созданные до колонки (миграция 0010).
  `CREATE TABLE IF NOT EXISTS pay_withdrawals (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     address TEXT NOT NULL,
     chain TEXT NOT NULL DEFAULT 'tron' CHECK (chain IN ('tron', 'bsc', 'polygon')),
     amount_micro INTEGER NOT NULL CHECK (amount_micro > 0),
     fee_micro INTEGER NOT NULL DEFAULT 0 CHECK (fee_micro >= 0),
     status TEXT NOT NULL DEFAULT 'requested'
       CHECK (status IN ('requested', 'approved', 'reserved', 'broadcasting',
                         'sent', 'confirmed', 'failed', 'manual')),
     idem_key TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     decided_at INTEGER,
     txid TEXT UNIQUE)`,
  'CREATE INDEX IF NOT EXISTS idx_pay_withdrawals_user ON pay_withdrawals (user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_pay_withdrawals_status ON pay_withdrawals (status, created_at)',

  // 11. Попытки подписи и отправки. Новый attempt — только после явного failed/manual.
  `CREATE TABLE IF NOT EXISTS pay_payouts (
     id TEXT PRIMARY KEY,
     withdrawal_id TEXT NOT NULL,
     attempt INTEGER NOT NULL CHECK (attempt >= 1),
     txid TEXT,
     signed_at INTEGER,
     broadcast_at INTEGER,
     solidified_at INTEGER,
     result TEXT NOT NULL DEFAULT '',
     error TEXT NOT NULL DEFAULT '',
     UNIQUE (withdrawal_id, attempt))`,

  // 12. Казна: фактический баланс берётся только из блокчейна, не из наших расчётов.
  `CREATE TABLE IF NOT EXISTS pay_treasury (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('hot', 'cold', 'deposit')),
     address TEXT NOT NULL,
     balance_micro INTEGER NOT NULL DEFAULT 0 CHECK (balance_micro >= 0),
     energy INTEGER NOT NULL DEFAULT 0,
     bandwidth INTEGER NOT NULL DEFAULT 0,
     trx_micro INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     UNIQUE (kind, address))`,

  // 13. Журнал операций: повтор с тем же ключом возвращает прежний ответ.
  `CREATE TABLE IF NOT EXISTS pay_operations (
     scope TEXT NOT NULL,
     idem_key TEXT NOT NULL,
     user_id TEXT,
     request_hash TEXT NOT NULL DEFAULT '',
     response TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     PRIMARY KEY (scope, idem_key))`,

  // 14. Аудит действий: и админ, и автоматика. Append-only.
  `CREATE TABLE IF NOT EXISTS pay_audit_log (
     id TEXT PRIMARY KEY,
     actor TEXT NOT NULL,
     action TEXT NOT NULL,
     target TEXT NOT NULL DEFAULT '',
     payload TEXT NOT NULL DEFAULT '{}',
     created_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_pay_audit_log_created ON pay_audit_log (created_at)',
];

export const PAY_TRIGGERS: string[] = [
  `CREATE TRIGGER IF NOT EXISTS pay_ledger_no_update BEFORE UPDATE ON pay_ledger
     BEGIN SELECT RAISE(ABORT, 'pay ledger is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS pay_ledger_no_delete BEFORE DELETE ON pay_ledger
     BEGIN SELECT RAISE(ABORT, 'pay ledger is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS pay_audit_log_no_update BEFORE UPDATE ON pay_audit_log
     BEGIN SELECT RAISE(ABORT, 'pay audit log is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS pay_audit_log_no_delete BEFORE DELETE ON pay_audit_log
     BEGIN SELECT RAISE(ABORT, 'pay audit log is append-only'); END`,
];

// Частичные UNIQUE-индексы: «один открытый счёт» и «один открытый цикл пула».
// В миграции они тоже есть — здесь повторяются, чтобы схема была самодостаточной.
export const PAY_PARTIAL_INDEXES: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_invoices_open
     ON pay_invoices (user_id) WHERE status = 'open'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_pool_cycles_open
     ON pay_pool_cycles (status) WHERE status = 'open'`,
];

/**
 * Индекс против ветвления журнала. Вынесен отдельно и создаётся с try/catch
 * специально: если в уже существующей базе форк случился до появления индекса,
 * правильная реакция — «деньги работают, а повреждённый хвост видно в сверке», а
 * не 503 на весь платёжный контур из-за DDL.
 */
export const PAY_CHAIN_INDEXES: string[] = [
  // За данным хешем может следовать ровно одна запись: гонка двух начислений
  // ловится базой, а не «увидеть потом в сверке».
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_ledger_prev ON pay_ledger (prev_hash)`,
];

/**
 * Перестройка `pay_addresses` под колонку `chain`.
 *
 * Старая таблица имела `user_id UNIQUE` на уровне таблицы — это «один адрес на
 * игрока вообще», и вторую цепь в такой схеме не разместить (миграция 0007).
 * Инлайн-UNIQUE из SQLite не выбрасывается, поэтому только перестройка. Правила:
 *   * колонки `chain` уже нет нужды ждать — есть: ничего не делаем (обычный путь);
 *   * колонки нет, таблица пуста — пересоздаём как надо, терять нечего;
 *   * колонки нет, строки есть — переносим их, а метку сети берём из формата
 *     адреса (`0x…` существует только в EVM, `T…` — только в TRON). Строки при
 *     этом не «угадываются»: `address`, `hex`, `derivation_index`, курсор и
 *     `active` уходят в новую таблицу как есть, поэтому перенос не может ни
 *     потерять чужой депозит, ни перенумеровать семя.
 *   * но если хоть один адрес нельзя отнести ни к одной из известных сетей —
 *     отказ: это мусор в денежной таблице (ручная правка), и перестраивать базу
 *     вокруг мусора код не имеет права.
 *
 * Почему перестройка вообще разрешена в коде, а не только в миграции: прод
 * деплоится из браузера и `d1 migrations apply` в тот момент может быть недоступен,
 * а отказ здесь означал бы «приём стоит, пока кто-то доберётся до терминала».
 * Пачка идёт через `batch` — в D1 это одна транзакция, так что «таблицу сняли, а
 * новую не создали» невозможно: либо всё, либо прежнее состояние.
 */
export async function upgradePayAddressChains(db: D1Database): Promise<void> {
  type D1Like = {
    prepare(sql: string): {
      run(): Promise<unknown>;
      first<T>(column?: string): Promise<T | null>;
    };
    batch(statements: unknown[]): Promise<unknown>;
  };
  const d = db as unknown as D1Like;
  try {
    await d.prepare('SELECT chain FROM pay_addresses LIMIT 1').first('chain');
    // Колонка есть. Осталось проверить её список значений: `CHECK` в SQLite
    // нельзя ослабить на месте, а без `'polygon'` в нём первая же polygon-строка
    // упала бы `CHECK constraint failed` — то есть игрок получил бы 502 ровно
    // там, где всё «настроено». Читаем определение таблицы; база, где такого
    // запроса нет (мок), отвечает пусто — тогда считаем форму актуальной.
    const ddl = await d.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pay_addresses'")
      .first<string>('sql')
      .catch(() => null);
    if (typeof ddl !== 'string' || !ddl || /'polygon'/.test(ddl)) return;
    console.error('pay_addresses: CHECK устарел (в списке нет polygon) — перестраиваем таблицу');
  } catch {
    /* нет таблицы или нет колонки — разбираемся ниже */
  }
  // `null` — таблицы нет (её создаст PAY_STATEMENTS этим же прогоном); `0` —
  // она есть и пуста. Различать надо именно так: проверка «на ложность»
  // спутала бы пустую таблицу с отсутствующей и оставила бы базу старой формы
  // навсегда — ровно тот случай, которого переезд боится больше всего.
  const count = await d.prepare('SELECT COUNT(*) AS n FROM pay_addresses').first<number>('n').catch(() => null);
  if (count === null || count === undefined) return;
  if (Number(count) > 0) {
    // «Формат неизвестен» — это не «повесим tron»: непонятную строку нельзя
    // ни перенести, ни удалить без человека.
    const odd = await d
      .prepare("SELECT COUNT(*) AS n FROM pay_addresses WHERE address NOT LIKE '0x%' AND address NOT LIKE 'T%'")
      .first<number>('n')
      .catch(() => null);
    if (Number(odd ?? 0) > 0) {
      throw new Error(`pay_addresses: ${odd} строк(и) с адресом ни в одной известной сети — примените миграцию 0008 вручную`);
    }
  }
  await d.batch(PAY_ADDRESSES_REBUILD.map((sql) => d.prepare(sql)));
}

let payReady: Promise<boolean> | null = null;

/** true — таблицы `pay_*` на месте. После ошибки следующий вызов пробует снова. */
export function ensurePaySchema(db: D1Database): Promise<boolean> {
  if (!payReady) {
    payReady = (async () => {
      // Порядок — часть гарантии, а не косметика: `pay_addresses` поднимается и
      // перестраивается ПЕРВОЙ, потому что индексы этой таблицы в общем списке
      // ссылаются на колонку `chain`. На базе старой формы (прод до миграции 0008)
      // любой другой порядок означает «DDL упал на no such column: chain, и весь
      // контур вернулся к 503» — ровно то, что мы чиним этим же прогоном.
      await db.prepare(PAY_ADDRESSES_DDL).run();
      await upgradePayAddressChains(db);
      for (const statement of PAY_STATEMENTS) await db.prepare(statement).run();
      for (const index of PAY_PARTIAL_INDEXES) await db.prepare(index).run();
      for (const index of PAY_CHAIN_INDEXES) {
        try {
          await db.prepare(index).run();
        } catch (e) {
          console.error('pay ledger chain index failed', e);
        }
      }
      for (const trigger of PAY_TRIGGERS) {
        try {
          await db.prepare(trigger).run();
        } catch (e) {
          // Без триггеров учёт работает, но append-only держится только кодом.
          console.error('pay trigger failed', e);
        }
      }
      return true;
    })().catch((e) => {
      console.error('pay schema bootstrap failed', e);
      payReady = null;
      return false;
    });
  }
  return payReady;
}

/** Только для тестов: сбрасывает память промиса между сценариями. */
export function resetPaySchemaForTests(): void {
  payReady = null;
}
