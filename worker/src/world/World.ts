import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { runDueJobs } from './jobs';
import { claim, type ClaimResult } from './modules/claim';
import { startCraft } from './modules/crafting';
import { cancelExpedition, chooseExpeditionEvent, startExpedition } from './modules/expeditions';
import { createPlayer } from './modules/players';
import { buildState, listLedger } from './modules/state';
import { installModule } from './modules/shipModules';
import { buyShip } from './modules/ships';
import { buyFuel, repairShip } from './modules/upkeep';
import { verifyLedger, type LedgerReport } from './ledger';
import { backfillProgressLedger, backfillResourceLedger, migrateLegacyExpeditions } from './migrate';
import { nextAlarmAt } from './scheduler';
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
      this.ctx.storage.transactionSync(() => {
        migrateLegacyExpeditions(this.sql, Date.now());
        for (const stmt of WORLD_SCHEMA) this.sql.exec(stmt);
        backfillResourceLedger(this.sql, Date.now());
        backfillProgressLedger(this.sql, Date.now());
      });
    });
  }

  async createPlayer(playerId: string): Promise<{ created: boolean }> {
    const now = Date.now();
    const created = this.ctx.storage.transactionSync(() => createPlayer(this.sql, playerId, now));
    await this.arm();
    return created;
  }

  claim(playerId: string, idemKey: string): ClaimResult {
    return this.ctx.storage.transactionSync(() => claim(this.sql, playerId, idemKey, Date.now()));
  }

  async getState(playerId: string) {
    const now = Date.now();
    const state = this.ctx.storage.transactionSync(() => buildState(this.sql, playerId, now));
    await this.arm();
    return state;
  }

  async startCraft(playerId: string, idemKey: string, recipeId: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => startCraft(this.sql, playerId, idemKey, recipeId, now));
    await this.arm();
    return result;
  }

  async installModule(playerId: string, idemKey: string, body: { shipId: string; module: string }) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => installModule(this.sql, playerId, idemKey, body, now));
    await this.arm();
    return result;
  }

  async buyShip(playerId: string, idemKey: string, type: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => buyShip(this.sql, playerId, idemKey, type, now));
    await this.arm();
    return result;
  }

  listLedger(playerId: string, limit: number) {
    return listLedger(this.sql, playerId, limit);
  }

  async startExpedition(playerId: string, idemKey: string, body: { shipId: string; planet: string; kind: string }) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => startExpedition(this.sql, playerId, idemKey, body, now));
    await this.arm();
    return result;
  }

  async cancelExpedition(playerId: string, idemKey: string, expeditionId: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => cancelExpedition(this.sql, playerId, idemKey, expeditionId, now));
    await this.arm();
    return result;
  }

  async chooseEvent(playerId: string, idemKey: string, expeditionId: string, choiceId: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => chooseExpeditionEvent(this.sql, playerId, idemKey, expeditionId, choiceId, now));
    await this.arm();
    return result;
  }

  async repair(playerId: string, idemKey: string, shipId: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => repairShip(this.sql, playerId, idemKey, shipId, now));
    await this.arm();
    return result;
  }

  async buyFuel(playerId: string, idemKey: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => buyFuel(this.sql, playerId, idemKey, now));
    await this.arm();
    return result;
  }

  verifyLedger(): LedgerReport {
    return verifyLedger(this.sql);
  }

  async poke(): Promise<{ ran: number }> {
    const ran = runDueJobs(this.sql, Date.now(), (fn) => this.ctx.storage.transactionSync(fn));
    await this.arm();
    return { ran };
  }

  async alarm(): Promise<void> {
    await this.poke();
  }

  private async arm(): Promise<void> {
    const target = nextAlarmAt(this.sql);
    if (target === null) {
      try { await this.ctx.storage.deleteAlarm(); } catch { /* будильника не было */ }
      return;
    }
    // Между чтением очереди и setAlarm могла прийти задача с более ранним run_at.
    // Не отодвигаем уже стоящий будильник: иначе задача ждала бы следующего poke.
    const current = await this.ctx.storage.getAlarm();
    if (current !== null && current <= target) return;
    await this.ctx.storage.setAlarm(target);
  }
}
