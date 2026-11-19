# Резервное копирование и восстановление

Этапы 1–3. R2 ещё не подключён (нужен после появления дохода): до этого снимки
сезонов и недельные снимки мира складываются в D1 `world_snapshots`. Бакет
включается блоком `[[r2_buckets]]` в `wrangler.toml` без изменения кода.

## Что где лежит

| Данные | Место | Штатное восстановление |
|---|---|---|
| Аккаунты, сессии, места, лимиты | D1 `astra-global` | D1 Time Travel, `wrangler d1 export` |
| Мир: игроки, Ledger, рейсы, задачи | Durable Object SQLite | Time Travel Durable Objects / снимок мира |
| Клиент | Git + Assets | повторный деплой коммита |

## D1

```bash
# снимок в файл (SQL)
npx wrangler d1 export DB --remote --output backup-$(date +%F).sql

# точка восстановления (Time Travel)
npx wrangler d1 time-travel info DB
npx wrangler d1 time-travel restore DB --timestamp <ISO>
```

Перед восстановлением: остановить регистрацию (флаг в клиенте/правило Cloudflare),
сохранить текущий экспорт, предупредить игроков. После — проверить
`/health`, вход, Claim и сверку Ledger.

## Мир

Durable Object SQLite имеет собственные точки восстановления. Точные команды и
глубина хранения зависят от тарифа Cloudflare — сверять с документацией перед
инцидентом. Дополнительно:

1. Раз в сутки снимать снимок мира (игроки, балансы, Ledger, рейсы) и проверять
   его `npm run check-ledger`.
2. Хранить снимки вне репозитория (R2 после подключения, сейчас — защищённое
   хранилище).
3. Проверять восстановление на тестовом мире, а не на живом.

## Архив снимков (этап 3)

Снимок снимает задача `snapshot_export` (раз в неделю) и закрытие сезона.
Cron воркера забирает готовые снимки и кладёт их:

- в R2 — если подключён бакет `ARCHIVE`, ключ
  `worlds/<world_id>/snapshots/<kind>-<created_at>-<id>.json`;
- иначе в D1 `world_snapshots.payload` (там же `sha256`, голова цепочки, размер).

Итоги закрытых сезонов дополнительно пишутся в D1 `season_history`.

```bash
# последние снимки из D1
npx wrangler d1 execute astra-global --remote   --command "SELECT id, world_id, kind, created_at, sha256, storage FROM world_snapshots ORDER BY created_at DESC LIMIT 5"

# снимок в файл (если storage = d1)
npx wrangler d1 execute astra-global --remote --json   --command "SELECT payload FROM world_snapshots WHERE id = '<id>'" > snap.json

# если storage = r2
npx wrangler r2 object get "crypto-astra-backups/worlds/<world>/snapshots/<file>.json" --file snap.json

# проверка: формат, суммы, голова цепочки, призы
npm run verify-snapshot -- --file snap.json --sha256 <sha256 из D1>
```

Полное восстановление мира по-прежнему идёт через Time Travel Durable Objects:
снимок — это контрольная точка «что было», а не замена журналу. После
восстановления сверяем `head_seq`/`head_hash` из снимка с `/me` (`verify`) и
гоняем `check-ledger` по экспорту Ledger.

## Регламент проверки

- Ежедневно: `check-ledger` по снимку, статус `last_verify_ok = 1`.
- Еженедельно: пробное восстановление D1 в тестовую базу.
- Ежемесячно: пробное восстановление мира, замер времени и полноты.
- Перед каждым деплоем: экспорт D1 и тег коммита.
