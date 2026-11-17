# Ledger

Ledger — журнал операций мира и источник истины по балансам. Таблица `balances`
в SQLite — рабочий кэш, который обязан сходиться с журналом.

## Инварианты

- Только добавление: триггеры `ledger_no_update` и `ledger_no_delete` отменяют
  `UPDATE` и `DELETE` на уровне SQLite.
- Хеш-цепочка: каждая запись хранит `prev_hash` и `hash`.
- Первая запись ссылается на `GENESIS_HASH` = 64 нуля.
- `seq` (AUTOINCREMENT) в хеш не входит: он назначается при вставке, поэтому
  цепочка не зависит от пропусков последовательности после откатов.

## Каноническая запись и хеш

```
hash = SHA256(prev_hash + JSON.stringify([
  player_id, asset, delta, reason, source_ref ?? '', idem_key ?? '', created_at
]))
```

Порядок полей и пустые строки вместо `null` зафиксированы в
`worker/src/world/ledger.ts` (`canonical`). Менять формат нельзя без миграции
всех записей: проверка пересчитывает хеши тем же кодом.

`sha256Hex` — синхронная реализация SHA-256 (`worker/src/shared/sha256.ts`), потому
что внутри `transactionSync` нельзя ждать `crypto.subtle`. Реализация сверяется с
`node:crypto` в `worker/test/unit/sha256.test.ts`.

## Что попадает в Ledger сейчас

`astra`, `fuel`, `points`: стартовый бонус, Claim, топливо на рейс, возврат при
отмене, награда рейсу, событие, восстановление топлива, покупка топлива, ремонт.

**Пока не попадают** ресурсы, опыт и прочность (§I.2 требует и их). Это известное
отклонение этапа 1: ресурсы лежат в `resources`, опыт — в `players.xp`, прочность —
в `ships.durability`. План: расширить домен активов, писать стартовые значения и
изменения, научить `verifyLedger` сверять их. Делать это лучше до появления живых
миров (см. `ROADMAP.md`).

## Проверка

1. `runLedgerVerify` раз в сутки (и через 5 минут после создания игрока) вызывает
   `verifyLedger`.
2. Проверка идёт по порядку `seq`, пересчитывает хеши, складывает `delta` по
   `(player_id, asset)` и сравнивает с `balances`.
3. Результат пишется в `meta`: `last_verify_at`, `last_verify_ok`, `frozen`.
4. При любом расхождении мир замораживается (`frozen=1`), и игровые действия
   отвечают `423 world_frozen`. Разморозка — только успешной сверкой.

## Проверка снимка вручную

```bash
npm run check-ledger -- --file snapshot.json
npm run check-ledger -- --file snapshot.json --json
cat snapshot.json | npm run check-ledger -- --file -
```

Формат снимка:

```json
{
  "world_id": "w1",
  "ledger": [{ "seq": 1, "player_id": "p1", "asset": "astra", "delta": 500,
               "reason": "start_bonus", "source_ref": "start", "idem_key": null,
               "created_at": 1790000000000, "prev_hash": "00…", "hash": "…" }],
  "balances": [{ "player_id": "p1", "asset": "astra", "amount": 500 }]
}
```

Код выхода: 0 — сходится, 1 — расхождение, 2 — файл не прочитан.

## Что делать при расхождении

1. Не править Ledger и не «доливать» баланс. Журнал неизменяем, а мир уже
   заморожен.
2. Снять снимок и прогнать `check-ledger`, найти первый `seq` с ошибкой.
3. Сверить с логами Worker и `jobs` (`ledger_verify`, `expedition_finish`).
4. Если ошибка в коде — исправить, выкатить, дождаться успешной сверки. Если
   повреждены данные — восстановление из резервной копии по `RUNBOOK_BACKUP.md`.
