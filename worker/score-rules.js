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
  MAX_NEAR_MISSES: 100,
  MAX_RUN_SECONDS: 3600,
};

// ── Plausibility bounds, worked out from the game's own geometry and rules (not tuned guesses) ──────────────────
// Each number below is copied from the file named beside it; tests/worker.test.mjs pins them to that source.
//
// The drive (public/drive/drive.js, runner.js):
//  - The clock (t = TIME_LIMIT) only runs while driving and only goes down (a hit can take a second more), so
//    time_left <= 70 - (the quickest possible drive).
//  - Quickest drive: your car sits at homeS < FOOT.start + FOOT.carAhead + 70 = 114 (drive.js, the search for a
//    level spot runs from firstS to firstS + 70) and the run ends when you stop within 2 m of spot.s (the store's
//    parking space; spot.s = 1122 on the route built from world.json, checked by tools-roam's RouteFrame).
//    car.step() has a top speed of 30 m/s (its default `top`; drive.js passes none), and the car starts at rest.
//  - Tokens: the only place they are made is plan() in runner.js: an 8-card line per 'tokens' event, events start
//    at s = 70, stop before spot.s - 95, and are spaced by at least 75 * (1 - min(0.25, 0.015 * k)) m (k = the
//    event's number). Counting the most events that fit gives the most tokens any route can hold.
export const DRIVE = {
  SPOT_S: 1122,
  PARK_REACH: 2,           // drive.js: parks only when |car.s - spot.s| < 2
  HOME_S_MAX: 113,         // last whole metre the search for the car's spot can pick (s < firstS + 70, firstS = 14 + 30)
  CAR_TOP: 30,             // runner.js RunnerCar.step default `top`, m/s
  TOKEN_FIRST_S: 70,
  TOKEN_END_MARGIN: 95,
  TOKEN_GAP_MIN: 75,       // rnd(75, 110) lower end
  TOKEN_GAP_SHRINK: 0.015, // per event
  TOKEN_GAP_SHRINK_CAP: 0.25,
  TOKENS_PER_EVENT: 8,
  CLOCK_ROUNDING: 0.01,    // the client sends time_left rounded to 0.01 s
};
export const DRIVE_MIN_SECONDS = (DRIVE.SPOT_S - DRIVE.PARK_REACH - DRIVE.HOME_S_MAX) / DRIVE.CAR_TOP;   // 33.57 s
export const DRIVE_MAX_TIME_LEFT = LIVE.DRIVE_TIME - DRIVE_MIN_SECONDS;                                   // 36.43 s
export const DRIVE_MAX_TOKENS = (() => {
  let events = 0;
  for (let s = DRIVE.TOKEN_FIRST_S, k = 0; s < DRIVE.SPOT_S - DRIVE.TOKEN_END_MARGIN; k++) {
    events++;
    s += DRIVE.TOKEN_GAP_MIN * (1 - Math.min(DRIVE.TOKEN_GAP_SHRINK_CAP, k * DRIVE.TOKEN_GAP_SHRINK));
  }
  return events * DRIVE.TOKENS_PER_EVENT;                                                                   // 15 events, 120 tokens
})();

// The store (standalone/csd.js): you move at most PSPEED px/s (the stick is clamped to length 1, the wall slide never
// adds speed), starting at SPAWN_P, and an item is taken when you are within PICK_R of its spot. Paying needs you
// inside a PADS rectangle grown by 6 (winCheck). run_seconds is floor(S.runT) and S.runT only counts after the
// store reveal (S.intro). So a won run took at least the straight-line length of the best route
// start -> the 7 spots (any order) -> a pad, less the pick-up radius at each end of every leg, divided by PSPEED.
export const STORE = {
  PSPEED: 260,
  PICK_R: 36,
  PAD_SLACK: 6,
  SPAWN: [415, 1380],
  ITEMS: [[228, 1070], [244, 889], [599, 1083], [239, 699], [209, 519], [190, 292], [612, 280]],   // ITEMS x, y (not moved by snapToField)
  PADS: [[452, 348, 500, 468], [452, 528, 500, 648], [452, 704, 500, 824]],
};
const distToRect = ([x, y], [x0, y0, x1, y1], g) => Math.hypot(Math.max(x0 - g - x, 0, x - (x1 + g)), Math.max(y0 - g - y, 0, y - (y1 + g)));
/** Shortest possible store run (seconds, before flooring) that bags every item and pays. */
export function minStoreSeconds() {
  const { SPAWN, ITEMS, PADS, PICK_R, PAD_SLACK, PSPEED } = STORE;
  let best = Infinity;
  const used = new Array(ITEMS.length).fill(false);
  const walk = (at, n, len) => {   // `at` is the last spot visited, len the path so far with each leg shortened by the pick-up radii
    if (len >= best) return;
    if (n === ITEMS.length) {
      const toPad = Math.min(...PADS.map((p) => distToRect(at, p, PAD_SLACK)));
      best = Math.min(best, len + Math.max(0, toPad - PICK_R));
      return;
    }
    for (let i = 0; i < ITEMS.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const leg = Math.hypot(ITEMS[i][0] - at[0], ITEMS[i][1] - at[1]);
      walk(ITEMS[i], n + 1, len + Math.max(0, leg - (n === 0 ? PICK_R : 2 * PICK_R)));
      used[i] = false;
    }
  };
  walk(SPAWN, 0, 0);
  return best / PSPEED;
}
export const STORE_MIN_SECONDS = minStoreSeconds();

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
  if (!Number.isFinite(dTime) || dTime < 0 || dTime > DRIVE_MAX_TIME_LEFT + DRIVE.CLOCK_ROUNDING) return 'drive out of range';
  if (!isInt(tokens) || tokens < 0 || tokens > DRIVE_MAX_TOKENS) return 'drive out of range';
  if (!isInt(near) || near < 0 || near > LIVE.MAX_NEAR_MISSES) return 'drive out of range';
  if (!isInt(bonus) || bonus < 0) return 'drive out of range';
  if (bonus > Math.round(dTime * 50 + tokens * 25 + near * 50 + 500 + 300)) return 'drive out of range';
  if (won && runSeconds < Math.floor(STORE_MIN_SECONDS)) return 'run_seconds out of range';
  const checkout = won ? LIVE.CHECKOUT + speedBonus(runSeconds) : 0;
  const store = score - bonus - checkout;
  if (!livePointsOptions(items).includes(store)) return 'score out of range';
  return null;
}

export const LIVE_MAX_SCORE = 800 + LIVE.CHECKOUT + LIVE.SPEED_MAX
  + Math.round(DRIVE_MAX_TIME_LEFT * 50 + DRIVE_MAX_TOKENS * 25 + LIVE.MAX_NEAR_MISSES * 50 + 800);

// ── v3: the scoring of Nov 2026 (standalone/csd.js, the constants under DOOR) ──
// { v: 3, ..., items_points, beat_out, no_catch }. The items come in a fresh random order each run (startRun
// shuffles S.order), so RICE & BEANS (200) can be any of them; the other six are 100. An item within 4 s of the one
// before is a combo: its points x2, the next x3, then x3 on (a gap or a catch starts again at x1). Paying (won):
// 500 + max(0, 3000 - 25 * floor(seconds in the store)) + 2000 if you paid before the bully walked in (beat_out;
// he always walks in by BULLY_IN_MAX = 30 s, so only with run_seconds < 30) + 1000 if he never caught you
// (no_catch). Drive bonus as in v2.
export const LIVE3 = { SPEED_MAX: 3000, SPEED_PER_SECOND: 25, BEAT_OUT: 2000, NO_CATCH: 1000, COMBO_MAX: 3, BULLY_IN_MAX: 30 };

/** Every item total `n` grabbed items can add up to, over every order (RICE & BEANS anywhere) and combo pattern. */
export function comboPointsOptions(n) {
  // state: last multiplier, RICE & BEANS grabbed yet -> totals so far
  let states = new Map([['0,0', new Set([0])]]);
  for (let i = 0; i < n; i++) {
    const next = new Map();
    const add = (k, t) => { if (!next.has(k)) next.set(k, new Set()); next.get(k).add(t); };
    for (const [key, totals] of states) {
      const [m, rice] = key.split(',').map(Number);
      for (const k of new Set(i === 0 ? [1] : [1, Math.min(LIVE3.COMBO_MAX, m + 1)])) {
        for (const t of totals) {
          if (i - rice < LIVE.ITEMS - 1) add(`${k},${rice}`, t + 100 * k);   // one of the six 100s, if any are left
          if (!rice) add(`${k},1`, t + 200 * k);                             // RICE & BEANS
        }
      }
    }
    states = next;
  }
  const all = new Set();
  for (const [key, t] of states) if (n < LIVE.ITEMS || key.endsWith(',1')) for (const x of t) all.add(x);
  return [...all].sort((a, b) => a - b);
}

export function speedBonus3(runSeconds) {
  return Math.max(0, LIVE3.SPEED_MAX - LIVE3.SPEED_PER_SECOND * runSeconds);
}

export function validateLive3(p) {
  const v2 = validateLive({ ...p, score: 0, items: 0, won: false });   // the drive and run_seconds checks of v2
  if (v2 && v2 !== 'score out of range') return v2;
  const score = Number(p?.score);
  const items = Number(p?.items ?? 0);
  const runSeconds = Number(p?.run_seconds ?? 0);
  const itemPts = Number(p?.items_points ?? -1);
  const won = p?.won === true;
  const beat = p?.beat_out === true, noCatch = p?.no_catch === true;
  const bonus = Number(p?.drive?.bonus ?? 0);
  if (!isInt(score) || score < 0) return 'score out of range';
  if (!isInt(items) || items < 0 || items > LIVE.ITEMS) return 'items out of range';
  if (won && items !== LIVE.ITEMS) return 'items out of range';
  if (!won && (beat || noCatch)) return 'score out of range';
  if (beat && runSeconds >= LIVE3.BULLY_IN_MAX) return 'score out of range';
  if (won && runSeconds < Math.floor(STORE_MIN_SECONDS)) return 'run_seconds out of range';
  if (!comboPointsOptions(items).includes(itemPts)) return 'items_points out of range';
  const checkout = won ? LIVE.CHECKOUT + speedBonus3(runSeconds) + (beat ? LIVE3.BEAT_OUT : 0) + (noCatch ? LIVE3.NO_CATCH : 0) : 0;
  if (score !== itemPts + checkout + bonus) return 'score out of range';
  return null;
}
