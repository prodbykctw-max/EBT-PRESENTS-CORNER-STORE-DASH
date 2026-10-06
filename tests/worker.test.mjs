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
