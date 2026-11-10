export interface Env {
  DB: D1Database;
  WORLD: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  JWT_SECRET: string;
  TURNSTILE_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_ACCESS_AUD: string;
}
