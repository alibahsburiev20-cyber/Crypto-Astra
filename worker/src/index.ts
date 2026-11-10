import type { Env } from './env';
import { route } from './http/router';
import { WorldLobby } from './lobby/WorldLobby';
import { World } from './world/World';

export { World, WorldLobby };
export type { Env };

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },
  // Расписание (cron) задано в wrangler.toml; планировщик мира и сверка Ledger подключатся следующим шагом.
  async scheduled(): Promise<void> {},
};
