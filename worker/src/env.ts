import type { World } from './world/World';
import type { WorldLobby } from './lobby/WorldLobby';

export interface Env {
  DB: D1Database;
  WORLD: DurableObjectNamespace<World>;
  LOBBY: DurableObjectNamespace<WorldLobby>;
  JWT_SECRET: string;
  TURNSTILE_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_ACCESS_AUD: string;
}
