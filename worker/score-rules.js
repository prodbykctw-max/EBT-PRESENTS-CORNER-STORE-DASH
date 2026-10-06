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
