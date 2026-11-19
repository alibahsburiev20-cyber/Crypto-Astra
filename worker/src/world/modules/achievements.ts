// Достижения (этап 4). Награды только косметические: ASTRA за бейджи не даём,
// иначе их нафармят за вечер и экономика поедет. Поэтому таблицы нет — список
// считается из фактов игры, а «когда получено» не так важно, как «получено ли».

export type AchievementIcon = 'expedition' | 'craft' | 'market' | 'fleet' | 'level' | 'social';

export interface AchievementView {
  id: string;
  title: string;
  hint: string;
  icon: AchievementIcon;
  value: number;
  target: number;
  unlocked: boolean;
}

interface Counter {
  expeditions: number;
  crafts: number;
  sales: number;
  ships: number;
  modules: number;
  repairs: number;
  passClaims: number;
  inGuild: number;
  level: number;
}

function counters(sql: SqlStorage, playerId: string): Counter {
  const n = (query: string, ...args: unknown[]) => {
    const rows = sql.exec(query, ...(args as never[])).toArray();
    return rows.length ? Number(rows[0].c) : 0;
  };
  return {
    expeditions: n(`SELECT COUNT(*) AS c FROM expeditions WHERE player_id = ? AND status = 'completed'`, playerId),
    crafts: n(`SELECT COUNT(*) AS c FROM craft_jobs WHERE player_id = ? AND status = 'done'`, playerId),
    sales: n(`SELECT COUNT(*) AS c FROM market_sales WHERE seller_id = ?`, playerId),
    ships: n(`SELECT COUNT(*) AS c FROM ships WHERE player_id = ?`, playerId),
    modules: n(`SELECT COUNT(*) AS c FROM ship_modules WHERE ship_id IN (SELECT id FROM ships WHERE player_id = ?)`, playerId),
    repairs: n(`SELECT COUNT(*) AS c FROM ledger WHERE player_id = ? AND reason = 'repair' AND asset = 'astra'`, playerId),
    passClaims: n(`SELECT COUNT(*) AS c FROM pass_claims WHERE player_id = ?`, playerId),
    inGuild: n(`SELECT COUNT(*) AS c FROM guild_members WHERE player_id = ?`, playerId),
    level: n(`SELECT level AS c FROM players WHERE id = ?`, playerId),
  };
}

export function achievementsView(sql: SqlStorage, playerId: string): { list: AchievementView[]; unlocked: number } {
  const c = counters(sql, playerId);
  const defs: Omit<AchievementView, 'value' | 'unlocked'>[] = [
    { id: 'first_expedition', title: 'Первый рейс', hint: 'Заверши экспедицию', icon: 'expedition', target: 1 },
    { id: 'ten_expeditions', title: 'Десять рейсов', hint: 'Заверши 10 экспедиций', icon: 'expedition', target: 10 },
    { id: 'first_craft', title: 'Мастерская', hint: 'Заверши крафт', icon: 'craft', target: 1 },
    { id: 'first_sale', title: 'Торговец', hint: 'Продай лот на рынке', icon: 'market', target: 1 },
    { id: 'first_module', title: 'Инженер', hint: 'Установи модуль', icon: 'fleet', target: 1 },
    { id: 'three_ships', title: 'Эскадра', hint: 'Собери три корабля', icon: 'fleet', target: 3 },
    { id: 'first_repair', title: 'Своими руками', hint: 'Отремонтируй корабль', icon: 'fleet', target: 1 },
    { id: 'level_5', title: 'Уровень 5', hint: 'Дорасти до пятого уровня', icon: 'level', target: 5 },
    { id: 'pass_5', title: 'Pass: уровень 5', hint: 'Забери пять наград Pass', icon: 'level', target: 5 },
    { id: 'in_guild', title: 'Не один', hint: 'Вступи в гильдию', icon: 'social', target: 1 },
  ];
  const value = (id: string): number => {
    switch (id) {
      case 'first_expedition':
      case 'ten_expeditions': return c.expeditions;
      case 'first_craft': return c.crafts;
      case 'first_sale': return c.sales;
      case 'first_module': return c.modules;
      case 'three_ships': return c.ships;
      case 'first_repair': return c.repairs;
      case 'level_5': return c.level;
      case 'pass_5': return c.passClaims;
      case 'in_guild': return c.inGuild;
      default: return 0;
    }
  };
  const list: AchievementView[] = defs.map((def) => {
    const current = value(def.id);
    return { ...def, value: Math.min(current, def.target), unlocked: current >= def.target };
  });
  return { list, unlocked: list.filter((a) => a.unlocked).length };
}
