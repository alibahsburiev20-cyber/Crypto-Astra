// Сгенерировано scripts/build-minigame.mjs из worker/src/shared/minigame.ts.
// Руками не править: сервер и браузер должны считать одинаково.
export const FIELD_W = 1000;
export const SHIP_HALF = 30;
export const RUN_MS = 45_000;
export const TICK_MS = 50;
export const TICKS = RUN_MS / TICK_MS;
export const MAX_SPEED = 900;
export const SLACK_PX = 14;
export const ASTER_R = 34;
export const CRYSTAL_R = 28;
export const WIN_SCORE = 150;
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function seedOf(seed) {
    const next = rng(seed);
    return Math.floor(next() * 0xffffffff) >>> 0;
}
export function makeField(seed) {
    const rand = rng(seedOf(seed));
    const asteroids = [];
    let t = 4000;
    while (t < RUN_MS - 800) {
        asteroids.push({
            t,
            x: 60 + rand() * (FIELD_W - 120),
            r: ASTER_R,
            speed: 0.32 + rand() * 0.22,
        });
        const gap = 760 + rand() * 460 - (t / RUN_MS) * 300;
        t += Math.max(430, gap);
    }
    const crystals = [];
    let c = 1600;
    while (c < RUN_MS - 900) {
        crystals.push({ t: c, x: 50 + rand() * (FIELD_W - 100), r: CRYSTAL_R });
        c += 1100 + rand() * 700;
    }
    return { seed, asteroids, crystals };
}
export function shipXAt(points, t) {
    if (!points.length)
        return null;
    if (t <= points[0].t)
        return points[0].x;
    for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        if (t <= b.t) {
            const span = b.t - a.t;
            if (span <= 0)
                return b.x;
            const k = (t - a.t) / span;
            return a.x + (b.x - a.x) * k;
        }
    }
    return points[points.length - 1].x;
}
export function validateTrace(points) {
    if (!Array.isArray(points) || points.length < 40 || points.length > 4000)
        return 'bad_trace';
    let prev = null;
    for (const p of points) {
        if (!p || !Number.isFinite(p.t) || !Number.isFinite(p.x))
            return 'bad_trace';
        if (p.x < 0 || p.x > FIELD_W)
            return 'bad_trace';
        if (prev) {
            const dt = p.t - prev.t;
            if (dt < 0)
                return 'bad_trace';
            const allowed = (MAX_SPEED * dt) / 1000 + SLACK_PX;
            if (Math.abs(p.x - prev.x) > allowed)
                return 'too_fast';
        }
        prev = p;
    }
    const last = points[points.length - 1];
    if (last.t < RUN_MS - 1500)
        return 'short';
    if (points[0].t > 2500)
        return 'short';
    return null;
}
export function expandTrace(xs, stepMs) {
    const step = Math.min(200, Math.max(20, Math.floor(Number(stepMs) || 40)));
    return xs.slice(0, 2000).map((value, i) => ({ t: i * step, x: Number(value) / 10 }));
}
export function evaluate(seed, points) {
    const empty = { ok: false, score: 0, hits: 0, picks: 0, win: false, ticks: 0 };
    const error = validateTrace(points);
    if (error)
        return { ...empty, error };
    const field = makeField(seed);
    let hits = 0;
    let picks = 0;
    for (const a of field.asteroids) {
        const x = shipXAt(points, a.t);
        if (x !== null && Math.abs(x - a.x) < a.r + SHIP_HALF)
            hits += 1;
    }
    for (const c of field.crystals) {
        const x = shipXAt(points, c.t);
        if (x !== null && Math.abs(x - c.x) < c.r + SHIP_HALF)
            picks += 1;
    }
    const score = Math.max(0, picks * 10 - hits * 15);
    return {
        ok: true,
        score,
        hits,
        picks,
        win: score >= WIN_SCORE,
        ticks: Math.round(points[points.length - 1].t / TICK_MS),
    };
}
export function rewardFor(result) {
    if (!result.ok)
        return { astra: 0, points: 0 };
    const astra = Math.max(1, Math.min(45, 4 + result.picks * 2 - result.hits * 2));
    const points = Math.max(0, result.picks + (result.win ? 20 : 4));
    return { astra, points };
}
export const WIN_TIERS = [
    { wins: 25, astra: 300, medal: 'clash_25', title: 'Пилот пояса' },
    { wins: 50, astra: 600, medal: 'clash_50', title: 'Ас пояса' },
    { wins: 100, astra: 1200, medal: 'clash_100', title: 'Легенда пояса' },
];
