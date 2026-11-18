/**
 * Прикидка рекламного дохода по трафику.
 *
 * Запуск: npm run ads-forecast -- --dau 100 --hours 2.5
 * Все параметры опциональны, значения по умолчанию — консервативные.
 *
 * Считаем в показах, а не в часах: время в игре само по себе денег не приносит,
 * оно только даёт больше возможностей для rewarded (и то с суточным лимитом).
 */
interface Params {
  dau: number;
  hours: number;
  bannerCpm: number;
  bannerPerSession: number;
  sessions: number;
  rewardedCpm: number;
  optIn: number;
  rewardViews: number;
  rewardCap: number;
  days: number;
}

function parse(argv: string[]): Params {
  const get = (flag: string, fallback: number): number => {
    const i = argv.indexOf(flag);
    if (i < 0) return fallback;
    const v = Number(argv[i + 1]);
    return Number.isFinite(v) ? v : fallback;
  };
  const p: Params = {
    dau: get('--dau', 100),
    hours: get('--hours', 2.5),
    // Фаусет-инвентарь: по кейсу Bitmedia реальный CPM там ~$0.67.
    bannerCpm: get('--banner-cpm', 0.7),
    bannerPerSession: get('--banner-per-session', 1),
    sessions: get('--sessions', 1.5),
    // Rewarded в Telegram у AdsGram: заявленный диапазон $1.5–6.
    rewardedCpm: get('--rewarded-cpm', 3),
    optIn: get('--opt-in', 0.4),
    rewardViews: get('--reward-views', 2.5),
    rewardCap: get('--reward-cap', 3),
    days: get('--days', 30),
  };
  p.hours = Math.max(0, p.hours);
  p.optIn = Math.min(1, Math.max(0, p.optIn));
  return p;
}

function money(x: number, digits = 2): string {
  return `$${x.toFixed(digits)}`;
}

export function forecast(p: Params) {
  const bannerImpressions = p.dau * p.sessions * p.bannerPerSession;
  const rewardedImpressions = p.dau * p.optIn * Math.min(p.rewardViews, p.rewardCap);
  const bannerPerDay = (bannerImpressions / 1000) * p.bannerCpm;
  const rewardedPerDay = (rewardedImpressions / 1000) * p.rewardedCpm;
  const perDay = bannerPerDay + rewardedPerDay;
  const perMonth = perDay * p.days;
  const dauFor = (target: number) => (perDay > 0 ? (target / p.days) / perDay * p.dau : Infinity);
  return {
    bannerImpressions, rewardedImpressions,
    bannerPerDay, rewardedPerDay, perDay, perMonth,
    perUserHour: perDay / (p.dau * p.hours),
    dauFor100: dauFor(100), dauFor1000: dauFor(1000),
  };
}

if (process.argv[1]?.endsWith('ads-forecast.ts')) {
  const p = parse(process.argv.slice(2));
  const r = forecast(p);
  console.log(`\nПрикидка рекламного дохода: ${p.dau} игроков в день по ${p.hours} ч, ${p.days} дней\n`);
  console.log(`Показы в сутки: баннер ${r.bannerImpressions.toFixed(0)}, rewarded ${r.rewardedImpressions.toFixed(0)}`);
  console.log(`Баннер:   ${money(r.bannerPerDay)}/день  (CPM ${money(p.bannerCpm)})`);
  console.log(`Rewarded: ${money(r.rewardedPerDay)}/день  (CPM ${money(p.rewardedCpm)}, opt-in ${(p.optIn * 100).toFixed(0)}%)`);
  console.log(`Итого:    ${money(r.perDay)}/день, ${money(r.perMonth)}/месяц`);
  console.log(`На игро-час: ${money(r.perUserHour, 4)}`);
  console.log(`До $100/мес нужно ~${Math.ceil(r.dauFor100)} игроков в день, до $1000/мес — ~${Math.ceil(r.dauFor1000)}.\n`);
}
