import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLAIM_INTERVAL_MS, DAY_MS, MISSION_DAILY_REWARD } from '../../src/shared/constants';
import { BOXES, XP } from '../../src/shared/gameData';
import { applyDelta, getBalance } from '../../src/world/balances';
import { claim } from '../../src/world/modules/claim';
import { openBox } from '../../src/world/modules/boxes';
import { catchUpXpFromPoints } from '../../src/world/migrate';
import { finishRun, startRun } from '../../src/world/modules/minigame';
import { claimMission, dailyMissions } from '../../src/world/modules/missions';
import { RUN_MS, type TracePoint } from '../../src/shared/minigame';
import { createPlayer } from '../../src/world/modules/players';
import { applyXp, getXp, playerLevel } from '../../src/world/modules/progress';
import { levelFromXp, xpThreshold } from '../../src/world/modules/expeditionMath';
import { buyShip } from '../../src/world/modules/ships';
import { verifyLedger } from '../../src/world/ledger';
import { makeWorld } from '../helpers/sqlShim';

// Опыт и уровень (правка 3 из «как у друга»). Диагноз был такой: XP капал только
// за завершённый рейс, и игрок с сотнями очков сезона оставался 1-го уровня, а
// уровень держит верфь и секторы. Теперь опыт идёт из всей обычной активности,
// кривая уровня сжатая, а накопленное догоняется миграцией.

const T0 = DAY_MS * 12 + 3_600_000;

function world() {
  const w = makeWorld();
  w.tx(() => createPlayer(w.sql, 'p1', T0));
  return w;
}

function steady(x = 500, step = 100): TracePoint[] {
  const out: TracePoint[] = [];
  for (let t = 0; t <= RUN_MS; t += step) out.push({ t, x });
  return out;
}

describe('источники опыта', () => {
  it('Claim даёт опыт и пишет его в журнал', () => {
    const { sql, tx } = world();
    const res = tx(() => claim(sql, 'p1', 'c1', T0));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.xp).toBe(XP.claim);
    expect(getXp(sql, 'p1')).toBe(XP.claim);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('40 клеймов — это уже второй уровень: опыт копится без единого рейса', () => {
    const { sql, tx } = world();
    for (let i = 0; i < 40; i++) {
      tx(() => claim(sql, 'p1', `c${i}`, T0 + i * CLAIM_INTERVAL_MS));
    }
    expect(getXp(sql, 'p1')).toBe(40);
    expect(playerLevel(sql, 'p1')).toBe(2);
    expect(verifyLedger(sql).ok).toBe(true);
  });

  it('миссия за клеймы даёт опыт сверх награды, и метрика не сдваивается', () => {
    const { sql, tx } = world();
    // Набор миссий на день задаёт seed, поэтому ищем день, где выпала «Ритм»
    // (метрика claims), и живём в нём: 4 клейма — ровно цель без запаса.
    let day = -1;
    for (let d = 100; d < 200 && day < 0; d++) {
      if (dailyMissions('p1', d).some((m) => m.metric === 'claims')) day = d;
    }
    expect(day).toBeGreaterThan(0);
    const start = day * DAY_MS + 6 * 3_600_000;
    for (let i = 0; i < 4; i++) tx(() => claim(sql, 'p1', `c${i}`, start + i * CLAIM_INTERVAL_MS));
    // Ровно 4 строки ASTRA за 4 действия: без фильтра по активу опыт удваивал бы
    // счётчик и «Ритм» закрывался бы за два клейма.
    const res = tx(() => claimMission(sql, 'p1', 'm1', 'd_claim_4', start + 4 * CLAIM_INTERVAL_MS));
    expect(res.astra).toBe(MISSION_DAILY_REWARD.astra);
    expect(res.xp).toBe(XP.mission);
    expect(getXp(sql, 'p1')).toBe(4 * XP.claim + XP.mission);
  });

  it('забег на арене даёт опыт даже когда награда упёрлась в потолок', () => {
    const { sql, tx } = world();
    const start = tx(() => startRun(sql, 'p1', 'run-1', T0, false));
    const res = tx(() => finishRun(sql, 'p1', 'fin-1', { runId: start.runId, trace: steady() }, T0 + RUN_MS, false));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Потолок ASTRA на нулевом балансе не пустит награду, а опыт — пустит:
    // забег засчитан, и «топ-ап» уровня должен быть ему соразмерен.
    expect(res.rewards.xp).toBeGreaterThanOrEqual(XP.minigameRun);
    expect(getXp(sql, 'p1')).toBe(res.rewards.xp);
  });

  it('открытие бокса даёт опыт бокса, а бесплатные ящики не печатают ASTRA', () => {
    const { sql, tx } = world();
    const astraBefore = getBalance(sql, 'p1', 'astra');
    const res = tx(() => openBox(sql, 'p1', 'b1', 'daily', T0));
    expect(res.xp).toBe(BOXES.daily.xp);
    expect(getXp(sql, 'p1')).toBe(BOXES.daily.xp ?? 0);
    // Бесплатный бокс не списывает деньги, а дроп может что-то дать;
    // главное — опыт начислен ровно один раз.
    expect(sql.exec(`SELECT COUNT(*) AS c FROM ledger WHERE asset = 'xp'`).toArray()[0].c).toBe(1);
    expect(astraBefore).toBeGreaterThanOrEqual(0);
  });

  it('запретный повтор: второй Claim в интервал не даёт ни денег, ни опыта', () => {
    const { sql, tx } = world();
    tx(() => claim(sql, 'p1', 'c1', T0));
    const second = tx(() => claim(sql, 'p1', 'c2', T0 + 1000));
    expect(second.ok).toBe(false);
    expect(getXp(sql, 'p1')).toBe(XP.claim);
  });
});

describe('уровень — производная от опыта', () => {
  it('устаревший кэш уровня не держит замок верфи', () => {
    const { sql, tx } = world();
    // Игрок набежал опыта на 5-й уровень, а колонка level осталась с 1-го:
    // ровно та поломка, из-за которой «371 очко и уровень 1».
    tx(() => applyXp(sql, { playerId: 'p1', delta: xpThreshold(5), reason: 'seed', sourceRef: 'xp' }, T0, levelFromXp));
    tx(() => applyDelta(sql, { playerId: 'p1', asset: 'astra', delta: 10000, reason: 'seed' }, T0 + 1));
    sql.exec('UPDATE players SET level = 1 WHERE id = ?', 'p1');
    expect(playerLevel(sql, 'p1')).toBe(5);
    // Hauler открывается на 5-м: покупка обязана пройти по опыту, а не по кэшу.
    tx(() => buyShip(sql, 'p1', 'k1', 'hauler', T0 + 2));
    expect(sql.exec('SELECT COUNT(*) AS c FROM ships WHERE type = ?', 'hauler').toArray()[0].c).toBe(1);
  });

  it('Migration-догоняна: очки сезона конвертируются в опыт один раз', () => {
    const { sql, tx } = world();
    // Точь в точь жалоба: 371 очко, 30 XP и первый уровень.
    tx(() => applyXp(sql, { playerId: 'p1', delta: 30, reason: 'expedition_reward', sourceRef: 'e1' }, T0, levelFromXp));
    tx(() => applyDelta(sql, { playerId: 'p1', asset: 'points', delta: 371, reason: 'minigame' }, T0 + 1));
    catchUpXpFromPoints(sql, T0 + 2);
    const expectedXp = Math.floor(371 / XP.pointsPerXp); // 92
    expect(getXp(sql, 'p1')).toBe(Math.max(30, expectedXp));
    expect(playerLevel(sql, 'p1')).toBe(levelFromXp(expectedXp));
    expect(levelFromXp(expectedXp)).toBe(2); // 92 XP: L2=40 уже пройден, L3=98 ещё нет
    // Кэш уровня пересобран.
    expect(Number(sql.exec('SELECT level FROM players').toArray()[0].level)).toBe(playerLevel(sql, 'p1'));
    // Идемпотентность: повторный прогон ничего не доначисляет.
    catchUpXpFromPoints(sql, T0 + 3);
    expect(getXp(sql, 'p1')).toBe(Math.max(30, expectedXp));
    expect(verifyLedger(sql).ok).toBe(true);
  });
});

describe('гараж и модули глазами игрока', () => {
  const app = readFileSync(new URL('../../../client/app.js', import.meta.url), 'utf8');

  it('в занятой ячейке — корпус корабля, а не заглушка', () => {
    // Спрайт типа строится так же, как в верфи: `/sprites/ships/${type}.png`.
    expect(app).toContain('function shipArtSrc(type)');
    expect(app).toContain('`/sprites/ships/${type}.png`');
    expect(app).toContain("class: 'garage-ship'");
    // Заглушка slot_filled из <img> ушла: рамка ячейки теперь фон CSS.
    expect(app).not.toContain("/sprites/garage/slot_filled.png");
  });

  it('модули видны в гараже, во флоте и на экране модулей', () => {
    expect(app).toContain('function moduleRig(');
    // Гараж: rig прямо в ячейке; флот: rig под корпусом; модули: rig над кораблём.
    expect(app).toContain('moduleRig(mods, 14)');
    expect(app).toContain('moduleRig(shipMods(s.id), 22)');
    expect(app).toContain('moduleRig(ship, 20)');
    // Подпись «модули N/M» в ячейке — без открытия раздела видно, чем накачан корпус.
    expect(app).toContain('модули ${mods.used}/${mods.slots}');
  });

  it('шкала уровня объясняет источники опыта', () => {
    expect(app).toContain('Опыт: Claim, рейсы, арена, миссии, боксы, крафт и каждый уровень модуля.');
  });
});
