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
}
