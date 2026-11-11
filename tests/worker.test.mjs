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
  // with a drive: 30.5 s left, 12 tokens, 3 near misses, clean, no hits
  const bonus = Math.round(30.5 * 50 + 12 * 25 + 3 * 50 + 500 + 300);
  assert.equal(validateLive(liveRun({ score: 1900 + bonus, drive: { bonus, time_left: 30.5, tokens: 12, near_misses: 3 } })), null);
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
  assert.ok(validateLive(liveRun({ score: 800 + 500 + 1500, run_seconds: 0 })));   // paid at the register with no time spent in the store
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
  const bonus = Math.round(30.5 * 50 + 12 * 25 + 3 * 50 + 500 + 300);
  assert.equal(validateLive3(run3({ score: 3300 + 1000 + bonus, no_catch: true, drive: { bonus, time_left: 30.5, tokens: 12, near_misses: 3 } })), null);
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

// ── plausibility bounds (W1b): the forged payload from the audit, a realistic one, and the source the bounds come from ──
import { DRIVE, DRIVE_MAX_TIME_LEFT, DRIVE_MAX_TOKENS, DRIVE_MIN_SECONDS, STORE, STORE_MIN_SECONDS } from '../worker/score-rules.js';

// what the audit posted: all 7 items in 0 s, every drive maximum, every bonus. Its parts add up (24,400) so only the bounds stop it.
const forged = { v: 3, name: 'ACE', items: 7, items_points: 2100, run_seconds: 0, won: true, beat_out: true, no_catch: true, score: 24400,
  drive: { bonus: 15800, time_left: 70, tokens: 260, near_misses: 100 } };
// a plausible good run: 45 s in the store, all 7 with a combo, caught once, a clean park with 18 s left
const realistic = (() => {
  const items_points = comboPointsOptions(7)[3];
  const drive = { time_left: 18.4, tokens: 42, near_misses: 6 };
  drive.bonus = Math.round(drive.time_left * 50 + drive.tokens * 25 + drive.near_misses * 50 + 500 + 300);
  return { v: 3, name: 'KCT', items: 7, items_points, run_seconds: 45, won: true, beat_out: false, no_catch: false, drive,
    score: items_points + 500 + speedBonus3(45) + drive.bonus };
})();

test('the forged 24,400 payload from the audit is rejected, and each bound works on its own', () => {
  assert.equal(forged.score, 2100 + 500 + 3000 + 2000 + 1000 + 15800);   // its parts add up, so only the bounds catch it
  assert.ok(validateLive3(forged));
  assert.equal(validateLive3(realistic), null);
  assert.ok(validateLive3({ ...realistic, run_seconds: 0, score: realistic.score - speedBonus3(45) + speedBonus3(0) }), 'store run of 0 s');
  const dr = (o) => { const d = { ...realistic.drive, ...o }; d.bonus = Math.round(d.time_left * 50 + d.tokens * 25 + d.near_misses * 50 + 800); return { ...realistic, drive: d, score: realistic.score - realistic.drive.bonus + d.bonus }; };
  assert.equal(validateLive3(dr({})), null);
  assert.ok(validateLive3(dr({ time_left: 70 })), 'a full clock left means a 0 s drive');
  assert.ok(validateLive3(dr({ time_left: 40 })), 'the route cannot be driven in 30 s');
  assert.ok(validateLive3(dr({ tokens: 260 })), 'more tokens than the route holds');
  assert.ok(validateLive3(dr({ tokens: DRIVE_MAX_TOKENS + 1 })));
  assert.equal(validateLive3(dr({ time_left: Math.floor(DRIVE_MAX_TIME_LEFT * 100) / 100, tokens: DRIVE_MAX_TOKENS })), null, 'the limits themselves are allowed');
  // v2 (pages cached before v3) has the same bounds, so it is no way round them
  assert.ok(validateLive(liveRun({ score: 800 + 500 + 1500 + 15800, run_seconds: 0, drive: { bonus: 15800, time_left: 70, tokens: 260, near_misses: 100 } })));
});

test('a realistic v3 run posts through the Worker; the forged one does not', async () => {
  const DB = fakeDB();
  assert.equal((await worker.fetch(post(realistic), { DB })).status, 201);
  assert.equal((await worker.fetch(post(forged), { DB })).status, 400);
  assert.equal(DB.rows.length, 1);
});

test('derived bounds have sensible values', () => {
  assert.ok(STORE_MIN_SECONDS > 4 && STORE_MIN_SECONDS < 10, String(STORE_MIN_SECONDS));
  assert.ok(DRIVE_MIN_SECONDS > 30 && DRIVE_MIN_SECONDS < 40);
  assert.equal(DRIVE_MAX_TOKENS, 120);
  // the fastest legitimate payload the older tests use stays valid
  assert.equal(validateLive3(run3({ score: 2100 + 500 + 2500 + 2000 + 1000, items_points: 2100, run_seconds: 20, beat_out: true, no_catch: true })), null);
});

test('bounds match the game source they were derived from', () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const csd = read('../standalone/csd.js'), drive = read('../public/drive/drive.js'), runner = read('../public/drive/runner.js');
  // store
  assert.match(csd, /var PSPEED=260,/);
  assert.match(csd, /PICK_R=36;/);
  assert.match(csd, /SPAWN_P=\{x:415,y:1380\}/);
  assert.match(csd, /var PADS=\[\[452,348,500,468\],\[452,528,500,648\],\[452,704,500,824\]\];/);
  assert.match(csd, /player\.x>p\[0\]-6&&player\.x<p\[2\]\+6&&player\.y>p\[1\]-6&&player\.y<p\[3\]\+6/);
  assert.match(csd, /if\(m>1\)\{ x\/=m; y\/=m; \}/);                     // the stick is never longer than 1
  assert.match(csd, /S\.runSecs=Math\.floor\(S\.runT\)/);
  const spots = [...csd.matchAll(/\{id:"([^"]+)",\s*x:(\d+),\s*y:(\d+),/g)];
  assert.equal(spots.length, STORE.ITEMS.length);
  for (const m of spots) assert.ok(STORE.ITEMS.some(([x, y]) => x === +m[2] && y === +m[3]), `item ${m[1]} is in STORE.ITEMS`);
  // drive
  assert.match(drive, /const FOOT = \{[^}]*start: 14, carAhead: 30,/);
  assert.match(drive, /for \(let s = firstS; s < firstS \+ 70; s \+= 1\)/);
  assert.match(drive, /Math\.abs\(car\.s - spot\.s\) < 2\) park\(\)/);
  assert.match(drive, /const spotS = route\.project\(SPOT\.x, SPOT\.y\)\.s;/);
  assert.match(drive, /const SPOT = \{ x: 0, y: 9\.0,/);
  assert.match(drive, /if \(!api\.freezeClock\) t -= dt;/);
  assert.doesNotMatch(drive, /(?<![\w.])t \+= /);                              // nothing ever adds time back
  assert.match(runner, /step\(dt, \{ targetD, brake, gas = 0, top = 30,/);
  const stepCall = drive.slice(drive.indexOf('car.step(FIXED, {'), drive.indexOf('});', drive.indexOf('car.step(FIXED, {')));
  assert.ok(stepCall.length > 40);
  assert.doesNotMatch(stepCall, /\btop\b|cruise/);                    // drive.js never asks for a faster car
  // tokens: one place makes them, 8 per event, with the spacing used for DRIVE_MAX_TOKENS
  assert.equal([...runner.matchAll(/this\.tokens\.push/g)].length, 1);
  assert.match(runner, /let s = 70, k = 0;\s*while \(s < sStop - 95\)/);
  assert.match(runner, /for \(let q = 0; q < 8; q\+\+\) this\.tokens\.push/);
  assert.match(runner, /s \+= rnd\(75, 110\) \* \(1 - Math\.min\(0\.25, k \* 0\.015\)\)/);
  assert.match(drive, /sEnd: spot\.s/);
});

test('the route really puts the store at s = 1122', { timeout: 120000 }, async () => {
  const { loadCityNode } = await import('../tools-roam/node-world.mjs');
  const { route } = await loadCityNode();
  assert.equal(route.project(0, 9.0).s, DRIVE.SPOT_S);
});

test('live names must be exactly three letters A-Z (what the game sends)', async () => {
  const names = ['KCT', 'EBT', 'AAA'];
  for (const name of names) assert.equal((await worker.fetch(post(run3({ score: 3300, name })), { DB: fakeDB() })).status, 201, name);
  const bad = ['', 'KC', 'KCTW', 'kct', 'K C', 'K.T', 'K1T', 'KÇT', 'КСТ', '<b>', 'SHOPPER', 'A'.repeat(16), ' KCT', 'KCT\n', null, 42, ['K', 'C', 'T']];
  for (const name of bad) {
    const DB = fakeDB();
    const r = await worker.fetch(post(run3({ score: 3300, name })), { DB });
    assert.equal(r.status, 400, JSON.stringify(name));
    assert.deepEqual(await r.json(), { error: 'invalid name' });
    assert.equal(DB.rows.length, 0);
  }
  // v2 (cached pages) sends the same three letters
  assert.equal((await worker.fetch(post({ ...liveWon, name: 'KCTW' }), { DB: fakeDB() })).status, 400);
  // the client picks its three letters only from LETTERS, and posts them joined
  const csd = readFileSync(new URL('../standalone/csd.js', import.meta.url), 'utf8');
  assert.match(csd, /LETTERS="ABCDEFGHIJKLMNOPQRSTUVWXYZ", initials=\["E","B","T"\]/);
  assert.match(csd, /var entry=\{initials:initials\.join\(""\),score:S\.score\}/);
  assert.match(csd, /name:entry\.initials/);
});
