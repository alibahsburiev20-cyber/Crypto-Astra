// «Пока вас не было»: короткая сводка того, что произошло за время отсутствия.
//
// Считается только по данным, которые уже пришли в /me: ничего не додумываем.
// Модуль отдельный, чтобы его можно было проверить без браузера.

export const MIN_GAP_MS = 15 * 60 * 1000;

/** Человеческая длительность: 45 мин, 3 ч 20 мин, 2 дн 4 ч. */
export function humanGap(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} дн ${restHours} ч` : `${days} дн`;
}

/**
 * @param {{ lastSeen: number, now: number, expeditions?: { active?: any, recent?: any[] },
 *           fuel?: { nextAt?: number|null }, season?: { daysLeft?: number } }} input
 * @returns {string} пустая строка, если рассказывать нечего
 */
export function offlineSummary(input) {
  const { lastSeen, now } = input;
  if (!Number.isFinite(lastSeen) || lastSeen <= 0) return '';
  const gap = now - lastSeen;
  // Часы устройства могут убежать вперёд — тогда «отсутствия» нет.
  if (!Number.isFinite(gap) || gap < MIN_GAP_MS) return '';

  const parts = [];
  const active = input.expeditions?.active;
  if (active && Number(active.endsAt) <= now) {
    parts.push(`рейс «${active.planet || active.label || 'в полёте'}» завершён — награда ждёт`);
  } else if (active) {
    parts.push('рейс ещё в полёте');
  }

  const done = (input.expeditions?.recent ?? []).filter((e) => Number(e.endedAt ?? e.endsAt ?? 0) > lastSeen).length;
  if (done > 0 && !active) parts.push(`рейсов завершено: ${done}`);

  const nextFuelAt = input.fuel?.nextAt;
  if (Number.isFinite(nextFuelAt) && Number(nextFuelAt) <= now) parts.push('топливо восстановилось');

  const daysLeft = input.season?.daysLeft;
  if (Number.isFinite(daysLeft) && daysLeft >= 0) parts.push(`до конца сезона ${daysLeft} дн`);

  if (!parts.length) return '';
  return `Пока вас не было ${humanGap(gap)}: ${parts.join('; ')}.`;
}
