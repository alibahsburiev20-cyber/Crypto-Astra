import {
  MODULES, MODULE_ORDER, MODULE_MAX_LEVEL, SHIPS, isModuleId, moduleEffectText, moduleFx, moduleParts, modulePrice,
  type ModuleFx, type ModuleId, type ShipType,
} from '../../shared/gameData';
import { applyDelta, getBalance } from '../balances';
import { ApiError } from '../errors';
import { withIdempotency } from '../idempotency';
import { applyResourceDelta, assertPlayable, getResource } from './maintenance';

// Модули (этап 2, срез 4). Модуль ставится на корабль, занимает слот и живёт до
// конца сезона: снять его нельзя, только улучшить. Поэтому вложение не
// возвращается, а ASTRA реально уходит из экономики.

export interface InstalledModule { module: ModuleId; level: number }

export function installedOn(sql: SqlStorage, shipId: string): InstalledModule[] {
  return sql.exec('SELECT module, level FROM ship_modules WHERE ship_id = ? ORDER BY installed_at', shipId)
    .toArray()
    .filter((r) => isModuleId(String(r.module)))
    .map((r) => ({ module: String(r.module) as ModuleId, level: Number(r.level) }));
}

/** Множители конкретного корабля. Пустой список модулей даёт ровно единицы. */
export function fxOfShip(sql: SqlStorage, shipId: string): ModuleFx {
  return moduleFx(installedOn(sql, shipId));
}

interface ShipRow { id: string; type: ShipType; status: string }

function shipOf(sql: SqlStorage, playerId: string, shipId: string): ShipRow {
  const rows = sql.exec('SELECT id, type, status FROM ships WHERE id = ? AND player_id = ?', shipId, playerId).toArray();
  if (!rows.length) throw new ApiError(404, 'ship_not_found');
  return { id: String(rows[0].id), type: String(rows[0].type) as ShipType, status: String(rows[0].status) };
}

export function slotsOf(type: ShipType): number {
  return SHIPS[type]?.slots ?? 0;
}

/** Каталог для клиента: все уровни с ценой и компонентами, чтобы не считать в JS. */
export function moduleCatalog() {
  return MODULE_ORDER.map((id) => {
    const def = MODULES[id];
    return {
      id,
      name: def.name,
      effect: def.effect,
      basePrice: def.basePrice,
      maxLevel: MODULE_MAX_LEVEL,
      levels: Array.from({ length: MODULE_MAX_LEVEL }, (_, i) => {
        const level = i + 1;
        return {
          level,
          price: modulePrice(id, level),
          parts: moduleParts(id, level),
          effectText: moduleEffectText(id, level),
        };
      }),
    };
  });
}

/** Состояние модулей игрока: по каждому кораблю — слоты, установленное, эффекты. */
export function moduleStateFor(sql: SqlStorage, playerId: string) {
  const ships = sql.exec('SELECT id, type, durability, status FROM ships WHERE player_id = ? ORDER BY rowid', playerId).toArray()
    .map((row) => {
      const id = String(row.id);
      const type = String(row.type) as ShipType;
      const installed = installedOn(sql, id);
      const fx = moduleFx(installed);
      const slots = slotsOf(type);
      return {
        id,
        type,
        name: SHIPS[type]?.name ?? type,
        slots,
        used: installed.length,
        modules: installed.map((m) => ({
          id: m.module,
          name: MODULES[m.module].name,
          level: m.level,
          effectText: moduleEffectText(m.module, m.level),
          next: m.level >= MODULE_MAX_LEVEL ? null : {
            level: m.level + 1,
            price: modulePrice(m.module, m.level + 1),
            parts: moduleParts(m.module, m.level + 1),
            effectText: moduleEffectText(m.module, m.level + 1),
          },
        })),
        fx,
      };
    });
  return { maxLevel: MODULE_MAX_LEVEL, catalog: moduleCatalog(), ships };
}

export interface InstallResult {
  shipId: string;
  module: ModuleId;
  level: number;
  price: number;
  astra: number;
}

/**
 * Поставить или улучшить модуль. ASTRA и компоненты списываются одной
 * транзакцией вместе с записью в журнал; при любой ошибке не меняется ничего.
 */
export function installModule(
  sql: SqlStorage, playerId: string, idemKey: string, body: { shipId: string; module: string }, now: number,
): InstallResult {
  return withIdempotency(sql, playerId, 'module_install', idemKey, body, now, () => {
    assertPlayable(sql);
    if (!isModuleId(body.module)) throw new ApiError(400, 'bad_module');
    const module = body.module;
    const ship = shipOf(sql, playerId, body.shipId);
    // Формулы рейса считаются по модулям на момент старта, поэтому переставлять
    // модули в полёте нельзя: иначе награда не сошлась бы с расходом.
    if (ship.status !== 'idle') throw new ApiError(409, 'ship_busy');

    const installed = installedOn(sql, ship.id);
    const current = installed.find((m) => m.module === module)?.level ?? 0;
    if (current >= MODULE_MAX_LEVEL) throw new ApiError(409, 'module_max_level');
    if (current === 0 && installed.length >= slotsOf(ship.type)) throw new ApiError(409, 'module_slots_full');

    const level = current + 1;
    const price = modulePrice(module, level);
    const parts = moduleParts(module, level);
    if (getBalance(sql, playerId, 'astra') < price) throw new ApiError(409, 'insufficient_funds');
    for (const part of parts) {
      if (getResource(sql, playerId, part.resource) < part.amount) throw new ApiError(409, 'insufficient_resources');
    }

    // Плата уходит в систему. Отдельная причина в журнале, чтобы по сверке было
    // видно, сколько поглотили модули, а сколько крафт.
    applyDelta(sql, { playerId, asset: 'astra', delta: -price, reason: 'module_buy', sourceRef: ship.id, idemKey }, now);
    for (const part of parts) {
      applyResourceDelta(sql, {
        playerId, resource: part.resource, delta: -part.amount,
        reason: 'module_parts', sourceRef: ship.id, idemKey,
      }, now);
    }
    sql.exec(
      `INSERT INTO ship_modules (ship_id, module, level, installed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (ship_id, module) DO UPDATE SET level = excluded.level, installed_at = excluded.installed_at`,
      ship.id, module, level, now,
    );
    return {
      value: { shipId: ship.id, module, level, price, astra: getBalance(sql, playerId, 'astra') },
      store: true,
    };
  });
}
