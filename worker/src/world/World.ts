import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { type ExpeditionKind } from '../shared/constants';
import { claim, type ClaimResult } from './modules/claim';
import { collectExpedition, startExpedition, type CollectResult, type StartResult } from './modules/expeditions';
import { createPlayer, getPlayerState } from './modules/players';
import { verifyLedger, type LedgerReport } from './ledger';
import { WORLD_SCHEMA } from './schema';

// Один мир = один объект. Запросы обрабатываются по одному, а каждое действие
// выполняется в transactionSync: баланс, ресурсы и ledger меняются вместе или не меняются.
// Внешних вызовов (fetch, await) внутри транзакции быть не должно.
export class World extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      for (const stmt of WORLD_SCHEMA) this.sql.exec(stmt);
    });
  }

  createPlayer(playerId: string): { created: boolean } {
    return this.ctx.storage.transactionSync(() => createPlayer(this.sql, playerId, Date.now()));
  }

  claim(playerId: string, idemKey: string): ClaimResult {
    return this.ctx.storage.transactionSync(() => claim(this.sql, playerId, idemKey, Date.now()));
  }

  startExpedition(playerId: string, idemKey: string, req: { kind: ExpeditionKind; shipId?: string | null }): StartResult {
    return this.ctx.storage.transactionSync(() => startExpedition(this.sql, playerId, idemKey, req, Date.now()));
  }

  collectExpedition(playerId: string, idemKey: string, expeditionId: string): CollectResult {
    return this.ctx.storage.transactionSync(() => collectExpedition(this.sql, playerId, idemKey, expeditionId, Date.now()));
  }

  getState(playerId: string) {
    return getPlayerState(this.sql, playerId);
  }

  verifyLedger(): LedgerReport {
    return verifyLedger(this.sql);
  }
}
