// node --test tests/worker.test.mjs — leaderboard Worker validation, CORS, rate limit, errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { validate, itemsPoints, MAX_SCORE, ITEM_POINTS } from '../worker/score-rules.js';
import { SHOPPING_LIST, TUNING } from '../public/src/config.js';

const ORIGIN = 'https://ebt-corner-store-dash.prodbykctw.workers.dev';

function fakeDB() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        bind(...a) { this.a = a; return this; },
        async run() { if (/INSERT/.test(sql)) rows.push(this.a); return {}; },
        async first() { return /COUNT/.test(sql) ? rows.filter((r) => r[1] > this.a[0]).length + 1 : 1; },
        async all() { return { results: rows.map(([name, score]) => ({ name, score })) }; },
      };
    },
  };
}
const limiter = (n) => { let c = 0; return { limit: async () => ({ success: ++c <= n }) }; };
const post = (body, headers = {}) => new Request(ORIGIN + '/api/scores', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body),
});
const perfect = { name: 'ACE', score: 4400, items: 8, time_left: 149, won: true };

test('worker constants match the game config', () => {
  assert.deepEqual([...ITEM_POINTS].sort(), SHOPPING_LIST.map((i) => i.points).sort());
  assert.equal(MAX_SCORE, 1400 + TUNING.TIME_LIMIT * TUNING.TIME_BONUS + TUNING.LIVES * TUNING.LIFE_BONUS);
  assert.equal(MAX_SCORE, 4400);
});

test('itemsPoints takes the most valuable items', () => {
  assert.equal(itemsPoints(0), 0);
  assert.equal(itemsPoints(2), 500);
  assert.equal(itemsPoints(8), 1400);
});

test('honest runs validate', () => {
  assert.equal(validate(perfect), null);
  assert.equal(validate({ score: 1400 + 80 * 10 + 1 * 500, items: 8, time_left: 79, won: true }), null);
  assert.equal(validate({ score: 650, items: 4, time_left: 0, won: false }), null);
  assert.equal(validate({ score: 0, items: 0, time_left: 120, won: false }), null);
});

test('impossible runs are rejected', () => {
  assert.ok(validate({ ...perfect, score: 100000 }));
  assert.ok(validate({ ...perfect, score: 4401 }));
  assert.ok(validate({ ...perfect, items: 7 }));
  assert.ok(validate({ ...perfect, time_left: 151 }));
  assert.ok(validate({ score: 1401, items: 8, time_left: 0, won: false }));
  assert.ok(validate({ score: 600, items: 2, time_left: 10, won: false }));
  assert.ok(validate({ score: 4400, items: 8, time_left: 20, won: true }));
  assert.ok(validate({ ...perfect, items: 9 }));
  assert.ok(validate({ ...perfect, score: 12.5 }));
});

test('POST stores a valid run, no CORS headers', async () => {
  const env = { DB: fakeDB(), SCORE_LIMIT: limiter(5) };
  const r = await worker.fetch(post(perfect), env);
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.equal(env.DB.rows.length, 1);
});

test('POST from another origin is 403', async () => {
  const env = { DB: fakeDB() };
  const r = await worker.fetch(post(perfect, { origin: 'https://evil.example' }), env);
  assert.equal(r.status, 403);
  assert.equal(env.DB.rows.length, 0);
});

test('POST with no Origin header is 403 (curl / scripts), nothing stored', async () => {
  const env = { DB: fakeDB() };
  const req = new Request(ORIGIN + '/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(perfect) });
  assert.equal(req.headers.get('origin'), null);
  const r = await worker.fetch(req, env);
  assert.equal(r.status, 403);
  assert.equal(env.DB.rows.length, 0);
  // the Worker's own origin and the Pages origin still get in (see also the Pages test below)
  assert.equal((await worker.fetch(post(perfect), env)).status, 201);
});

test('rate limit: 6th POST in the window is 429', async () => {
  const env = { DB: fakeDB(), SCORE_LIMIT: limiter(5) };
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await worker.fetch(post(perfect), env)).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
});

test('500 hides the error text', async () => {
  const env = { DB: { prepare() { throw new Error('D1 internal detail'); } } };
  const r = await worker.fetch(new Request(ORIGIN + '/api/scores'), env);
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'server error' });
});

// ── live game (v: 2): standalone store + drive ──────────────────────────────
import { validateLive, speedBonus, LIVE, LIVE_MAX_SCORE } from '../worker/score-rules.js';
import { readFileSync } from 'node:fs';

const liveRun = (o = {}) => ({ v: 2, name: 'KCT', items: 7, run_seconds: 60, won: true,
  drive: { bonus: 0, time_left: 0, tokens: 0, near_misses: 0 }, ...o });
// a won run with no drive: 800 items + 500 checkout + (1500 - 15*60)
const liveWon = liveRun({ score: 800 + 500 + 600 });

test('live rules match the game source', () => {
  const csd = readFileSync(new URL('../standalone/csd.js', import.meta.url), 'utf8');
  const pts = [...csd.matchAll(/pts:(\d+)/g)].map((m) => +m[1]).sort((a, b) => a - b);
  assert.deepEqual(pts, [100, 100, 100, 100, 100, 100, 200]);
  // the v3 scoring (the v2 rules stay for pages cached before it)
  assert.match(csd, /COMBO_WINDOW=4, COMBO_MAX=3, CHECKOUT_PTS=500, SPEED_MAX=3000, SPEED_PER_S=25, BEAT_OUT=2000, NO_CATCH=1000;/);
  assert.match(csd, /Math\.max\(0,SPEED_MAX-S\.runSecs\*SPEED_PER_S\)/);
  assert.match(csd, /addScore\(CHECKOUT_PTS\+timeBonus\+\(S\.beatOut\?BEAT_OUT:0\)\+\(S\.noCatch\?NO_CATCH:0\)\)/);
  assert.match(csd, /var body=\{v:3,/);
  const drive = readFileSync(new URL('../public/drive/drive.js', import.meta.url), 'utf8');
  assert.match(drive, /const TIME_LIMIT = 70;/);
  assert.match(drive, /timeLeft \* 50 \+ tokens \* 25 \+ nearMisses \* 50 \+ \(result\.cleanPark \? 500 : 0\) \+ \(hits === 0 \? 300 : 0\)/);
  assert.equal(speedBonus(0), 1500);
  assert.equal(speedBonus(100), 0);
});

test('honest live runs validate', () => {
  assert.equal(validateLive(liveWon), null);
  // with a drive: 41.37 s left, 12 tokens, 3 near misses, clean, no hits
  const bonus = Math.round(41.37 * 50 + 12 * 25 + 3 * 50 + 500 + 300);
  assert.equal(validateLive(liveRun({ score: 1900 + bonus, drive: { bonus, time_left: 41.37, tokens: 12, near_misses: 3 } })), null);
  // caught with 3 items, with or without RICE & BEANS
  assert.equal(validateLive(liveRun({ score: 300, items: 3, won: false })), null);
  assert.equal(validateLive(liveRun({ score: 400, items: 3, won: false })), null);
  assert.equal(validateLive(liveRun({ score: 0, items: 0, won: false })), null);
  assert.equal(validateLive(liveRun({ score: 800 + 500, run_seconds: 300 })), null);   // too slow for a speed bonus
});

test('impossible live runs are rejected', () => {
  assert.ok(validateLive({ ...liveWon, score: liveWon.score + 1 }));
  assert.ok(validateLive({ ...liveWon, items: 6 }));
  assert.ok(validateLive({ ...liveWon, run_seconds: -1 }));
  assert.ok(validateLive({ ...liveWon, run_seconds: 1.5 }));
  assert.ok(validateLive(liveRun({ score: 500, items: 3, won: false })));
  assert.ok(validateLive(liveRun({ score: 99999, drive: { bonus: 99999 - 1900, time_left: 70, tokens: 0, near_misses: 0 } })));
  assert.ok(validateLive(liveRun({ score: 1900 + 100, drive: { bonus: 100, time_left: 99, tokens: 0, near_misses: 0 } })));
  assert.ok(validateLive(liveRun({ score: 1900 + 100, drive: { bonus: 100, time_left: 1, tokens: 9999, near_misses: 0 } })));
  assert.ok(LIVE_MAX_SCORE < 100000);
});

test('live runs post through the Worker and are ranked', async () => {
  const DB = fakeDB();
  const res = await worker.fetch(post(liveWon), { DB });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).rank, 1);
  assert.equal(DB.rows[0][3], 60);   // time_left column holds the store seconds for live runs
  const bad = await worker.fetch(post({ ...liveWon, score: liveWon.score + 7 }), { DB });
  assert.equal(bad.status, 400);
});

test('the GitHub Pages copy gets CORS; other sites do not', async () => {
  const PAGES = 'https://prodbykctw-max.github.io';
  const DB = fakeDB();
  const pre = await worker.fetch(new Request(ORIGIN + '/api/scores', { method: 'OPTIONS', headers: { origin: PAGES } }), { DB });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), PAGES);
  const res = await worker.fetch(post(liveWon, { origin: PAGES }), { DB });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('access-control-allow-origin'), PAGES);
  const evil = await worker.fetch(post(liveWon, { origin: 'https://evil.example' }), { DB });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const evilPre = await worker.fetch(new Request(ORIGIN + '/api/scores', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), { DB });
  assert.equal(evilPre.status, 403);
});

// ── live game (v: 3): combos, beat-him-out, no-catch, the bigger speed bonus ──
import { validateLive3, comboPointsOptions, speedBonus3 } from '../worker/score-rules.js';
const run3 = (o = {}) => ({ v: 3, name: 'KCT', items: 7, run_seconds: 40, won: true, items_points: 800,
  beat_out: false, no_catch: false, drive: { bonus: 0, time_left: 0, tokens: 0, near_misses: 0 }, ...o });

test('v3 combo totals', () => {
  assert.deepEqual(comboPointsOptions(0), [0]);
  assert.deepEqual(comboPointsOptions(2), [200, 300, 400, 500]);
  // all 7 in one streak, RICE & BEANS at x3: 100 + 200 + 300*4 + 600
  assert.equal(Math.max(...comboPointsOptions(7)), 2100);
  assert.deepEqual(comboPointsOptions(1), [100, 200]);
  assert.equal(Math.min(...comboPointsOptions(7)), 800);
  assert.equal(speedBonus3(0), 3000);
  assert.equal(speedBonus3(40), 2000);
  assert.equal(speedBonus3(120), 0);
});

test('honest v3 runs validate', () => {
  // 800 items + 500 + 2000 speed (40 s)
  assert.equal(validateLive3(run3({ score: 3300 })), null);
  // perfect: combo all the way, beat him out, never caught, 20 s
  assert.equal(validateLive3(run3({ score: 2100 + 500 + 2500 + 2000 + 1000, items_points: 2100, run_seconds: 20, beat_out: true, no_catch: true })), null);
  // with a drive bonus
  const bonus = Math.round(41.37 * 50 + 12 * 25 + 3 * 50 + 500 + 300);
  assert.equal(validateLive3(run3({ score: 3300 + 1000 + bonus, no_catch: true, drive: { bonus, time_left: 41.37, tokens: 12, near_misses: 3 } })), null);
  // caught with 3 items in a streak
  assert.equal(validateLive3(run3({ score: 600, items: 3, items_points: 600, won: false })), null);
  assert.equal(validateLive3(run3({ score: 0, items: 0, items_points: 0, won: false })), null);
  // RICE & BEANS can come first or second (the order is shuffled each run)
  assert.equal(validateLive3(run3({ score: 200, items: 1, items_points: 200, won: false })), null);
  assert.equal(validateLive3(run3({ score: 700, items: 3, items_points: 700, won: false })), null);              // 200, 200, 300
  assert.equal(validateLive3(run3({ score: 2000 + 500 + 2000, items_points: 2000 })), null);                     // 100, 400, then x3 on
});

test('impossible v3 runs are rejected', () => {
  assert.ok(validateLive3(run3({ score: 3301 })));
  assert.ok(validateLive3(run3({ score: 3300 + 2000, beat_out: true, won: true, items: 6 })));
  assert.ok(validateLive3(run3({ score: 2400, items_points: 2400, run_seconds: 40 + 0 })));       // more than any streak
  assert.ok(validateLive3(run3({ score: 1000, items: 3, items_points: 1000, won: false })));       // 3 items top out at 900
  assert.ok(validateLive3(run3({ score: 600, items: 2, items_points: 600, won: false })));         // 2 items top out at 500
  assert.ok(validateLive3(run3({ score: 1000 + 500 + 2275 + 2000, items_points: 1000, run_seconds: 29 + 1 + 0, beat_out: true })));  // he's always in by 30 s
  assert.ok(validateLive3(run3({ score: 2300, items: 3, items_points: 300, won: false, beat_out: true })));  // bonus without paying
  assert.ok(validateLive3(run3({ score: 3300, run_seconds: 1.5 })));
  assert.ok(validateLive3(run3({ score: 3300 + 100, drive: { bonus: 100, time_left: 99, tokens: 0, near_misses: 0 } })));
  assert.ok(validateLive3(run3({ score: 3300, items_points: undefined })));
});

test('v3 runs post through the Worker', async () => {
  const DB = fakeDB();
  const res = await worker.fetch(post(run3({ score: 3300 })), { DB });
  assert.equal(res.status, 201);
  const bad = await worker.fetch(post(run3({ score: 3301 })), { DB: fakeDB() });
  assert.equal(bad.status, 400);
});
