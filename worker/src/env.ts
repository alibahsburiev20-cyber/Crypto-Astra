import type { World } from './world/World';
import type { WorldLobby } from './lobby/WorldLobby';

export interface Env {
  DB: D1Database;
  WORLD: DurableObjectNamespace<World>;
  LOBBY: DurableObjectNamespace<WorldLobby>;
  JWT_SECRET: string;
  TURNSTILE_SECRET: string;
  /** Публичный site key Turnstile. Пусто — виджет не показывается. */
  TURNSTILE_SITE_KEY?: string;
  TELEGRAM_BOT_TOKEN: string;
  /** Реклама. По умолчанию выключена: без договора и сниппета слот не показывается. */
  ADS_ENABLED?: string;
  ADS_PROVIDER?: string;
  ADS_UNIT_ID?: string;
  ADS_SCRIPT_URL?: string;
  ADMIN_ACCESS_AUD: string;
  /**
   * Временный токен админки пула (срез 5.1). Пока админка не закрыта Cloudflare
   * Access, записи пула добавляет только тот, кто знает этот секрет. Пусто —
   * запись выключена (публичный отчёт при этом работает).
   */
  ADMIN_TOKEN?: string;
  /** Метка сборки для /health: по ней видно, что именно задеплоено. */
  APP_BUILD?: string;
  /**
   * Суточный бюджет запросов, который сервер позволяет себе сам (по умолчанию
   * 100 000 — лимит бесплатного плана Cloudflare). Дойдя до 60/80/95 %, сайт
   * уходит в thrifty / lite / sleep вместо ошибки 1027.
   */
  REQUEST_BUDGET?: string;
  /** Необязательный email оператора: если задан, он обязателен в заголовке. */
  ADMIN_EMAIL?: string;
  /**
   * Строгий контур регистрации: наличие MX у домена (через DNS-over-HTTPS) и
   * потолок регистраций на незнакомый домен. По умолчанию включён; `off` — только
   * для локального запуска и e2e, где DNS недоступен. Боевое окружение ничего не
   * настраивает: значит контур включён.
   */
  SIGNUP_GUARD?: string;
  /**
   * Бакет для архива снимков. Необязателен: без него снимки складываются в D1
   * (payload в world_snapshots). Включается блоком [[r2_buckets]] в wrangler.toml,
   * когда появится доход и смысл платить за хранение.
   */
  ARCHIVE?: R2Bucket;
  /**
   * Astra Pay (этап 1). Все флаги по умолчанию выключены: включённым считается
   * только значение `"on"`. Дочерние флаги не работают без `PAYMENTS_ENABLED`.
   */
  PAYMENTS_ENABLED?: string;
  DEPOSITS_ENABLED?: string;
  PURCHASES_ENABLED?: string;
  POOL_ENABLED?: string;
  PAYOUTS_ENABLED?: string;
  SWEEP_ENABLED?: string;
  /** Создавать таблицы `pay_*` при выключенных деньгах — для проверки схемы. */
  PAY_SCHEMA_CHECK?: string;
  /** `nile` (по умолчанию) или `mainnet`. Mainnet — только этап 12. */
  PAY_NETWORK?: string;
  /** Адрес контракта USDT. Пусто — берётся стандартный для сети. */
  PAY_USDT_CONTRACT?: string;
  /**
   * Цепь, в которой ходят деньги: `tron` (по умолчанию) или `bsc`.
   *
   * Незнакомое значение деньги не включает и не переключает «на первое попавшееся»:
   * оно выключает контур с причиной в `/pay/status.json`.
   */
  PAY_CHAIN?: string;
  /** JSON-RPC для BSC. Пусто — публичный эндпоинт из `pay/evm/config.ts`. */
  PAY_EVM_RPC?: string;
  /**
   * USDT-контракт в EVM. Пусто — стандартный Binance-Peg BSC-USD для mainnet;
   * в тестнете без него приём выключен (там каждый крутит свой токен).
   */
  PAY_EVM_CONTRACT?: string;
  /**
   * Потолок ставки газа в wei на выплату. Пусто = 20 gwei. Нужен, чтобы совет
   * ноды (`eth_feeHistory`) не превратился в «сожгли BNB на дорогом транзите».
   */
  PAY_MAX_GAS_PRICE_WEI?: string;
  /** Доля выручки магазина в призовой фонд сезона, % (по умолчанию 40). */
  POOL_PRIZE_SHARE?: string;
  /** Ключ TronGrid. Необязателен: без него лимит опроса ниже. */
  TRONGRID_API_KEY?: string;
  /**
   * Service binding на отдельный Worker-подписант. Пока биндинга нет, адреса
   * игрокам не выдаются: лучше ошибка, чем адрес от неизвестного источника.
   */
  SIGNER?: Fetcher;
  /** Токен к Signer-контуру. Живёт только в секретах Worker. */
  SIGNER_TOKEN?: string;
  /** Адрес горячего кошелька, с которого уходят выплаты. Публичный, не секрет. */
  PAY_HOT_ADDRESS?: string;
}
