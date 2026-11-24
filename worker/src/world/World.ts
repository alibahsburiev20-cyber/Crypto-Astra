import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { runDueJobs } from './jobs';
import { autoClaim, claim, type ClaimResult } from './modules/claim';
import { boxesHistory, boxesView, openBox } from './modules/boxes';
import { claimPatrol, planesView, startPatrol } from './modules/planes';
import { startCraft } from './modules/crafting';
import { cancelExpedition, chooseExpeditionEvent, startExpedition } from './modules/expeditions';
import { createPlayer } from './modules/players';
import { buildState, listLedger } from './modules/state';
import { seasonReport } from './modules/season';
import { ackSnapshots, pendingSnapshots } from './modules/snapshots';
import { achievementsView } from './modules/achievements';
import {
  createGuild, guildView, joinGuild, kickMember, leaveGuild, renameGuild, setRole,
} from './modules/guilds';
import { claimMission, missionsView } from './modules/missions';
import { claimPass, passView } from './modules/pass';
import { applyReferral, referralView } from './modules/referrals';
import { installModule } from './modules/shipModules';
import { buyShip } from './modules/ships';
import { buySlot, garageView } from './modules/garage';
import {
  clearIdentity, ownIdentity, setCallsign, setStyle, syncPremium, type StyleAllowance, type StyleValue,
} from './modules/identity';
import { adminSummary, grantAstra, setFrozen } from './modules/adminWorld';
import { buyLot, cancelLot, createLot, marketView, type CreateLotInput } from './modules/market';
import { buyFuel, repairShip } from './modules/upkeep';
import {
  finishRun, minigameBrief, minigameView, startRun, type FinishResult, type StartResult,
} from './modules/minigame';
import { verifyLedger, type LedgerReport } from './ledger';
import { backfillProgressLedger, backfillResourceLedger, migrateLegacyExpeditions, migratePassClaimsSeason } from './migrate';
import { decideWakeAt, nextCriticalAt, nextMaintenanceAt } from './scheduler';
import { WORLD_SCHEMA } from './schema';

// Один мир = один объект. Запросы обрабатываются по одному, а каждое действие
// выполняется в transactionSync: баланс, ресурсы и ledger меняются вместе или не меняются.
// Внешних вызовов (fetch, await) внутри транзакции быть не должно.
export class World extends DurableObject<Env> {
  private sql: SqlStorage;
  /**
   * Когда сюда последний раз приходил игрок (в памяти объекта).
   *
   * Хранить это в D1 или в meta нельзя: лишняя запись на каждый запрос съест
   * суточный лимит записей. После вытеснения объекта значение обнуляется — и это
   * правильно: если объекта не было в памяти, будить его лишний раз незачем.
   */
  private lastSeen = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.transactionSync(() => {
        migrateLegacyExpeditions(this.sql, Date.now());
        for (const stmt of WORLD_SCHEMA) this.sql.exec(stmt);
        migratePassClaimsSeason(this.sql);
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

  async getState(playerId: string, premium = false) {
    const now = Date.now();
    this.lastSeen = now;
    const state = this.ctx.storage.transactionSync(() => {
      // Premium забирает готовый бонус сам: игрок не должен помнить про кнопку.
      const claimed = premium ? autoClaim(this.sql, playerId, now) : null;
      const built = buildState(this.sql, playerId, now, premium);
      return claimed?.ok
        ? { ...built, autoClaimed: { astra: claimed.reward, nextClaimAt: claimed.nextClaimAt } }
        : { ...built, autoClaimed: null };
    });
    await this.arm();
    return state;
  }

  async startCraft(playerId: string, idemKey: string, recipeId: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => startCraft(this.sql, playerId, idemKey, recipeId, now));
    await this.arm();
    return result;
  }

  // Боксы: чтение таймеров и открытие. Открытие — транзакция, поэтому ASTRA и
  // ресурсы не могут разъехаться даже при падении между шагами.
  getBoxes(playerId: string) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => ({
      ...boxesView(this.sql, playerId, now),
      history: boxesHistory(this.sql, playerId, 5),
    }));
  }

  async openBox(playerId: string, idemKey: string, boxId: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => openBox(this.sql, playerId, idemKey, boxId, now));
    await this.arm();
    return result;
  }

  // Авиазвено: полка и патруль. Патруль — транзакция без наград в экономике,
  // поэтому планировщик будить не нужно: результат забирает сам игрок.
  getPlanes(playerId: string) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => planesView(this.sql, playerId, now));
  }

  async startPatrol(playerId: string, idemKey: string, planeId: string) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => startPatrol(this.sql, playerId, idemKey, planeId, now));
  }

  async claimPatrol(playerId: string, idemKey: string) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => claimPatrol(this.sql, playerId, idemKey, now));
  }

  async installModule(playerId: string, idemKey: string, body: { shipId: string; module: string }) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => installModule(this.sql, playerId, idemKey, body, now));
    await this.arm();
    return result;
  }

  async buyShip(playerId: string, idemKey: string, type: string, premium = false) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => buyShip(this.sql, playerId, idemKey, type, now, premium));
    await this.arm();
    return result;
  }

  // ── Гараж (этап 14) ────────────────────────────────────────────────────────
  getGarage(playerId: string, premium: boolean) {
    return this.ctx.storage.transactionSync(() => garageView(this.sql, playerId, premium));
  }

  async buyGarageSlot(playerId: string, idemKey: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => buySlot(this.sql, playerId, idemKey, now));
    await this.arm();
    return result;
  }

  // ── Админка мира (этап 15) ─────────────────────────────────────────────────
  adminWorld() {
    return this.ctx.storage.transactionSync(() => adminSummary(this.sql));
  }

  setFrozen(frozen: boolean) {
    return this.ctx.storage.transactionSync(() => setFrozen(this.sql, frozen));
  }

  async grant(adminRef: string, playerId: string, astra: number, reason: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => grantAstra(this.sql, { playerId, astra, reason, adminRef }, now));
    await this.arm();
    return result;
  }

  getMarket(playerId: string) {
    return this.ctx.storage.transactionSync(() => marketView(this.sql, playerId, Date.now()));
  }

  async createLot(playerId: string, idemKey: string, body: CreateLotInput) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => createLot(this.sql, playerId, idemKey, body, now));
    await this.arm();
    return result;
  }

  async buyLot(playerId: string, idemKey: string, lotId: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => buyLot(this.sql, playerId, idemKey, lotId, now));
    await this.arm();
    return result;
  }

  async cancelLot(playerId: string, idemKey: string, lotId: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => cancelLot(this.sql, playerId, idemKey, lotId, now));
    await this.arm();
    return result;
  }

  // ── Мини-игра (этап 13) ────────────────────────────────────────────────────
  // Попытки и награды считает мир; Premium приходит флагом из маршрута, потому
  // что подписка живёт в D1 платёжной части, а не в мире.
  getMinigame(playerId: string, premium: boolean) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => minigameView(this.sql, playerId, now, premium));
  }

  async startMinigame(playerId: string, idemKey: string, premium: boolean): Promise<StartResult> {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => startRun(this.sql, playerId, idemKey, now, premium));
    await this.arm();
    return result;
  }

  async finishMinigame(
    playerId: string, idemKey: string, body: { runId: string; trace: { t: number; x: number }[] }, premium: boolean,
  ): Promise<FinishResult> {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => finishRun(this.sql, playerId, idemKey, body, now, premium));
    await this.arm();
    return result;
  }

  minigameSummary(playerId: string, now: number, premium: boolean) {
    return minigameBrief(this.sql, playerId, now, premium);
  }

  // ── Социальное (этап 4) ────────────────────────────────────────────────────
  // Чтение собирается в один ответ на экран, чтобы клиенту не нужно было
  // делать три запроса: «Задания» = миссии + достижения + Pass.
  getSocial(playerId: string) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => ({
      missions: missionsView(this.sql, playerId, now),
      achievements: achievementsView(this.sql, playerId),
      pass: passView(this.sql, playerId, now),
    }));
  }

  async claimMission(playerId: string, idemKey: string, missionId: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => claimMission(this.sql, playerId, idemKey, missionId, now));
    await this.arm();
    return result;
  }

  async claimPass(playerId: string, idemKey: string, level: number) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => claimPass(this.sql, playerId, idemKey, level, now));
    await this.arm();
    return result;
  }

  getGuild(playerId: string) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => ({
      guild: guildView(this.sql, playerId, now),
      referrals: referralView(this.sql, playerId, now),
    }));
  }

  /** Своя карточка: позывной и выбранная косметика. */
  getProfile(playerId: string) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => ownIdentity(this.sql, playerId, now));
  }

  setCallsign(playerId: string, raw: string) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const res = setCallsign(this.sql, playerId, raw, now);
      return { ...res, profile: ownIdentity(this.sql, playerId, now) };
    });
  }

  setStyle(playerId: string, patch: { frame?: string | null; trail?: string | null; badge?: string | null }, allowance: StyleAllowance) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => setStyle(this.sql, playerId, patch, allowance, now));
  }

  /** Косметика и срок Premium приезжают из D1 после покупки или проверки подписки. */
  syncPremium(playerId: string, until: number | null, style?: StyleAllowance & { frame?: StyleValue | null; trail?: StyleValue | null; badge?: string | null }) {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      syncPremium(this.sql, playerId, until);
      if (style) {
        setStyle(this.sql, playerId, {
          ...(style.frame !== undefined ? { frame: style.frame } : {}),
          ...(style.trail !== undefined ? { trail: style.trail } : {}),
          ...(style.badge !== undefined ? { badge: style.badge } : {}),
        }, { frames: [...(style.frames ?? [])], trails: [...(style.trails ?? [])], badges: [...(style.badges ?? [])] }, now);
      }
      return ownIdentity(this.sql, playerId, now);
    });
  }

  /** Удаление аккаунта: подпись и косметика стираются. Журнал остаётся (учёт). */
  clearIdentity(playerId: string) {
    return this.ctx.storage.transactionSync(() => {
      clearIdentity(this.sql, playerId);
      return { ok: true };
    });
  }

  async createGuild(playerId: string, idemKey: string, body: { name: string; tag: string }) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => createGuild(this.sql, playerId, idemKey, body, now));
    await this.arm();
    return result;
  }

  async joinGuild(playerId: string, idemKey: string, code: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => joinGuild(this.sql, playerId, idemKey, code, now));
    await this.arm();
    return result;
  }

  async leaveGuild(playerId: string, idemKey: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => leaveGuild(this.sql, playerId, idemKey, now));
    await this.arm();
    return result;
  }

  async kickGuildMember(playerId: string, idemKey: string, target: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => kickMember(this.sql, playerId, idemKey, target, now));
    await this.arm();
    return result;
  }

  async setGuildRole(playerId: string, idemKey: string, body: { target: string; role: string }) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => setRole(this.sql, playerId, idemKey, body, now));
    await this.arm();
    return result;
  }

  async renameGuild(playerId: string, idemKey: string, body: { name: string; tag: string }) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => renameGuild(this.sql, playerId, idemKey, body, now));
    await this.arm();
    return result;
  }

  async applyReferral(playerId: string, idemKey: string, code: string) {
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => applyReferral(this.sql, playerId, idemKey, code, now));
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

  async getSeason(playerId: string) {
    // seasonReport может создать сезон, если мир его ещё не видел, — тогда
    // будильник надо поставить, иначе закрытие не придёт вовремя.
    const result = this.ctx.storage.transactionSync(() => seasonReport(this.sql, playerId, Date.now()));
    await this.arm();
    return result;
  }

  // Cron воркера забирает готовые снимки и подтверждает запись. Отметка `exported`
  // ставится только после ответа D1: снимок не должен исчезнуть при сбое архива.
  async takeSnapshots() {
    return this.ctx.storage.transactionSync(() => pendingSnapshots(this.sql));
  }

  async ackSnapshots(ids: string[]) {
    return this.ctx.storage.transactionSync(() => ackSnapshots(this.sql, ids));
  }

  verifyLedger(): LedgerReport {
    return verifyLedger(this.sql);
  }

  async poke(): Promise<{ ran: number }> {
    const ran = runDueJobs(this.sql, Date.now(), (fn) => this.ctx.storage.transactionSync(fn));
    // Это cron, а не игрок: активность не отмечаем, иначе мир никогда не уснёт.
    await this.arm(false);
    return { ran };
  }

  async alarm(): Promise<void> {
    await this.poke();
  }

  private async arm(touched = true): Promise<void> {
    const now = Date.now();
    if (touched) this.lastSeen = now;
    // В тишине служебные задачи не будят мир: их догонит часовой cron.
    const target = decideWakeAt(now, this.lastSeen, nextCriticalAt(this.sql), nextMaintenanceAt(this.sql));
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
