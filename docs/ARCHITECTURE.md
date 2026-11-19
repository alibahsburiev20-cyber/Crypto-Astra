# Архитектура

Версия: этап 1 («Ядро»), ноябрь 2026. Источник истины — концепция 2.1, части II и IV.

## Компоненты

```
браузер
  │  same-origin: HTML/JS/CSS из Assets, API — из Worker
  ▼
Cloudflare Worker  (worker/src/index.ts)
  ├─ Assets (client/)            статика без сборки
  ├─ router (http/router.ts)     /auth/*, /config, /health, /me, /claim, /ledger, /expeditions/*, /ships/*, /fuel/*
  ├─ D1 «astra-global»           users, sessions, world_seats, auth_limits
  ├─ WorldLobby (DO, имя main)   единственный источник истины по местам в мирах
  └─ World (DO, имя = world_id)  игроки, балансы, Ledger, рейсы, jobs
```

Один Worker обслуживает и сайт, и API. Это убирает CORS и делает refresh-cookie
same-origin. Цена — общий риск: ошибка в маршруте затрагивает все миры.

## Путь запроса

1. `fetch` в Worker. Если метод GET/HEAD и путь совпал с файлом в `SITE_FILES`
   (сгенерирован из `client/`), отдаётся статика с CSP. В продакшене тот же файл
   обычно отдаёт слой Assets, а `SITE_FILES` — запасной путь.
2. Иначе `route()`: публичные `/health`, `/config`, `/auth/*`; остальные маршруты
   требуют `Authorization: Bearer <JWT>`.
3. Worker проверяет JWT, достаёт `user_id` и `world_id`, вызывает метод
   Durable Object через RPC: `env.WORLD.get(idFromName(world_id))`.
4. Метод мира выполняется внутри `transactionSync`: баланс, ресурсы, Ledger и
   состояние рейса меняются вместе или не меняются вовсе. Внешних `fetch` и
   `await` внутри транзакции нет.
5. Ошибки мира приходят как сообщение-код (`insufficient_funds`, `ship_busy`…);
   Worker превращает код в HTTP-статус по таблице `http/response.ts`.

## Регистрация (II.2)

1. Проверка email/пароля, лимит частоты по IP, Turnstile (если задан секрет).
2. `users` в D1 со статусом `pending`.
3. `WorldLobby.reserve` выдаёт `world_id` и резерв на 5 минут.
4. `World.createPlayer`: игрок, стартовые балансы, Scout, первая задача топлива.
5. Активация в D1 (`active` + зеркало `world_seats`) и `lobby.confirm`.
6. Если шаг 4 не прошёл — резерв снимается, запись `users` удаляется. Если игрок
   уже создан, запись не удаляется: иначе останется «сирота», который навсегда
   занимает место. Ошибка активации повторяется и логируется.

## Мир

- Максимум 100 игроков; при заполнении лобби создаёт новый мир `wN`.
- Все запросы мира сериализуются платформой; гонок внутри мира нет.
- Один alarm на объект. Все отложенные действия — строки таблицы `jobs`
  (`expedition_finish`, `expedition_event`, `fuel_regen`, `ledger_verify`,
  `idem_cleanup`). Подробности — `SCHEDULER.md`.
- Состояние мира — SQLite Durable Object. Наружу отдаётся только через Worker;
  клиент не имеет доступа к базе.

## Каталоги

| Путь | Что там |
|---|---|
| `client/` | сайт: `index.html`, `app.js`, `styles.css`, спрайты |
| `worker/src/http` | маршрутизация, ответы, cookie |
| `worker/src/auth` | PBKDF2, JWT, сессии, Turnstile, лимиты частоты |
| `worker/src/lobby` | `WorldLobby` |
| `worker/src/world` | `World`, Ledger, балансы, jobs, модули (claim, expeditions, upkeep, state) |
| `worker/src/shared` | константы, каталог игры, SHA-256, кодирование |
| `worker/migrations/d1` | миграции глобальной D1 |
| `worker/schema/world` | справочная схема мира (рабочая — `world/schema.ts`) |
| `worker/test` | unit и e2e тесты |
| `scripts` | seed, симуляция экономики, проверка Ledger |

## Границы (после этапа 3)

Сделаны: Claim, рейсы, топливо, ремонт, крафт, модули, верфь, рынок, сезоны с
рейтингом и архивом снимков. Нет гильдий, пула, админки и платежей — это этапы
4–5. R2 подключается вместе с бакетом: до этого архив снимков лежит в D1, Email
Service требует платного плана. Подробности — `ROADMAP.md` и `STAGE3.md`.
