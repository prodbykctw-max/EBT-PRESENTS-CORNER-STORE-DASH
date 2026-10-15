/**
 * Leaderboard score rules for the Worker (worker/index.js). Kept in its own
 * module: a Worker's entry module may only export handlers, so the constants
 * live here where tests can import them too.
 */

// ── Score rules, from public/src/config.js + public/src/game.js (the build
// that posts here; the standalone page keeps local scores) ──────────────────
// Items: SHOPPING_LIST points (config.js). Score = sum of bagged items, plus
// at checkout (won): ceil(timeLeft) * TIME_BONUS + lives * LIFE_BONUS.
// The client sends time_left = floor(timeLeft), so the bonus can use +1 s.
export const ITEM_POINTS = [100, 100, 150, 150, 200, 200, 250, 250];
export const TIME_LIMIT = 150; // TUNING.TIME_LIMIT (seconds)
export const TIME_BONUS = 10; // TUNING.TIME_BONUS (per second left)
export const LIVES = 3; // TUNING.LIVES
export const LIFE_BONUS = 500; // TUNING.LIFE_BONUS (per life left)
const ALL_ITEMS = ITEM_POINTS.length;
const ITEMS_TOTAL = ITEM_POINTS.reduce((a, b) => a + b, 0); // 1,400
// 1,400 + 150 * 10 + 3 * 500 = 4,400 — a perfect run.
export const MAX_SCORE = ITEMS_TOTAL + TIME_LIMIT * TIME_BONUS + LIVES * LIFE_BONUS;

/** Most points `n` bagged items can be worth (the n most valuable items). */
export function itemsPoints(n) {
  return [...ITEM_POINTS].sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
}

export function validate(payload) {
  const score = Number(payload?.score);
  const items = Number(payload?.items ?? 0);
  const timeLeft = Number(payload?.time_left ?? 0);
  const won = Boolean(payload?.won);
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return 'score out of range';
  if (!Number.isInteger(items) || items < 0 || items > ALL_ITEMS) return 'items out of range';
  if (!Number.isInteger(timeLeft) || timeLeft < 0 || timeLeft > TIME_LIMIT) return 'time_left out of range';
  if (won && items !== ALL_ITEMS) return 'items out of range';
  const bonus = won ? Math.min(timeLeft + 1, TIME_LIMIT) * TIME_BONUS + LIVES * LIFE_BONUS : 0;
  if (score > itemsPoints(items) + bonus) return 'score out of range';
  return null;
}

// ── Score rules for the LIVE game (standalone/csd.js + public/drive/drive.js) ──
// The live game sends { v: 2, name, score, items, run_seconds, won, drive: {...} }.
// Store: 7 items, six worth 100 and RICE & BEANS worth 200 (csd.js ITEMS).
// Paying at a register (won): 500 + max(0, 1500 - 15 * floor(seconds in the store)).
// Drive bonus (drive.js park()): round(timeLeft*50 + tokens*25 + nearMisses*50
//   + (cleanPark ? 500 : 0) + (hits === 0 ? 300 : 0)); 0 when busted or late.
export const LIVE = {
  ITEMS: 7,
  CHECKOUT: 500,
  SPEED_MAX: 1500,
  SPEED_PER_SECOND: 15,
  DRIVE_TIME: 70,     // drive.js TIME_LIMIT
  MAX_TOKENS: 260,    // runner.js tokenMesh capacity: no run can show more
  MAX_NEAR_MISSES: 100,
  MAX_RUN_SECONDS: 3600,
};

/** The store points `n` bagged items are worth: 100 each, or 100 more if RICE & BEANS is one of them. */
export function livePointsOptions(n) {
  if (n === 0) return [0];
  if (n === LIVE.ITEMS) return [100 * n + 100];          // the whole list always includes RICE & BEANS
  return [100 * n, 100 * n + 100];
}

export function speedBonus(runSeconds) {
  return Math.max(0, LIVE.SPEED_MAX - LIVE.SPEED_PER_SECOND * runSeconds);
}

const isInt = (x) => Number.isInteger(x);

export function validateLive(p) {
  const score = Number(p?.score);
  const items = Number(p?.items ?? 0);
  const runSeconds = Number(p?.run_seconds ?? 0);
  const won = p?.won === true;
  const d = p?.drive ?? {};
  const bonus = Number(d.bonus ?? 0);
  const dTime = Number(d.time_left ?? 0);
  const tokens = Number(d.tokens ?? 0);
  const near = Number(d.near_misses ?? 0);
  if (!isInt(score) || score < 0) return 'score out of range';
  if (!isInt(items) || items < 0 || items > LIVE.ITEMS) return 'items out of range';
  if (won && items !== LIVE.ITEMS) return 'items out of range';
  if (!isInt(runSeconds) || runSeconds < 0 || runSeconds > LIVE.MAX_RUN_SECONDS) return 'run_seconds out of range';
  if (!Number.isFinite(dTime) || dTime < 0 || dTime > LIVE.DRIVE_TIME) return 'drive out of range';
  if (!isInt(tokens) || tokens < 0 || tokens > LIVE.MAX_TOKENS) return 'drive out of range';
  if (!isInt(near) || near < 0 || near > LIVE.MAX_NEAR_MISSES) return 'drive out of range';
  if (!isInt(bonus) || bonus < 0) return 'drive out of range';
  if (bonus > Math.round(dTime * 50 + tokens * 25 + near * 50 + 500 + 300)) return 'drive out of range';
  const checkout = won ? LIVE.CHECKOUT + speedBonus(runSeconds) : 0;
  const store = score - bonus - checkout;
  if (!livePointsOptions(items).includes(store)) return 'score out of range';
  return null;
}

export const LIVE_MAX_SCORE = 800 + LIVE.CHECKOUT + LIVE.SPEED_MAX
  + Math.round(LIVE.DRIVE_TIME * 50 + LIVE.MAX_TOKENS * 25 + LIVE.MAX_NEAR_MISSES * 50 + 800);
