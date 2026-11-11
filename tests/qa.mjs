/**
 * QA pass. Three layers:
 *   1. Headless logic checks — run always, no dependencies. Flood-fill the map,
 *      then drive a bot through a full run to prove the game is winnable.
 *      (These cover the v1 prototype in public/src, which is no longer the live game.)
 *   2. Browser smoke test of that v1 prototype — only if puppeteer is installed (npm i).
 *   3. Browser test of the LIVE game, public/standalone.html (what the Worker serves at /):
 *      boots, plays a store run through window.__csd, and checks the score it posts against the
 *      Worker's own rules and what the end screen says for each answer the server can give.
 *
 * Usage: npm run qa
 */

import { Maze } from '../public/src/maze.js';
import { Game, STATE } from '../public/src/game.js';
import { SHOPPING_LIST, MAP, GRID } from '../public/src/config.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nCorner Store Dash — QA\n');
console.log('Map integrity (v1 prototype)');

const maze = new Maze();
check('map rows are all 19 wide', MAP.every((r) => r.length === GRID.COLS));
check('map is square-ish', maze.rowCount === MAP.length, `${maze.rowCount} rows`);
check('shopping list covers every item tile', maze.itemTiles.length <= SHOPPING_LIST.length
  || maze.itemTiles.length % SHOPPING_LIST.length === 0, `${maze.itemTiles.length} tiles`);

const reachable = maze.reachableFrom(maze.spawn);
const unreachable = [];
for (let y = 0; y < maze.rowCount; y += 1) {
  for (let x = 0; x < maze.cols; x += 1) {
    if (maze.isWall(x, y)) continue;
    if (!reachable.has(`${x},${y}`)) unreachable.push(`${x},${y}`);
  }
}
check('every open tile is reachable from spawn', unreachable.length === 0, unreachable.join(' '));
check('bully pen is reachable', reachable.has(`${maze.penSpawn.x},${maze.penSpawn.y}`));
check('checkout is reachable', reachable.has(`${maze.checkout.x},${maze.checkout.y}`));

console.log('\nSimulated run (v1 prototype)');

/** Greedy bot: always walk the shortest path to the nearest thing it still needs. */
function botTarget(game) {
  const pending = game.items.filter((i) => !i.collected);
  if (!pending.length) return game.maze.checkout;
  // Plan from the tile the shopper is committed to, the way a human reads the next aisle.
  const from = game.player.next;
  return pending
    .map((i) => ({ i, d: Math.abs(i.x - from.x) + Math.abs(i.y - from.y) }))
    .sort((a, b) => a.d - b.d)[0].i;
}

function simulate({ bullyOff = false, seconds = 140 } = {}) {
  const game = new Game();
  game.start();
  if (bullyOff) game.bully.update = () => {};
  const dt = 1 / 60;
  for (let f = 0; f < seconds * 60; f += 1) {
    if (game.state === STATE.WON || game.state === STATE.OVER) break;
    if (game.state === STATE.CAUGHT) game.start();
    const target = botTarget(game);
    const step = game.maze.nextStepToward(game.player.next, { x: target.x, y: target.y });
    if (step) game.player.turn(step);
    game.update(dt);
  }
  return game;
}

const clean = simulate({ bullyOff: true });
check('bot can collect the whole list', clean.listComplete, `${clean.collected}/${clean.items.length}`);
check('bot reaches checkout and wins', clean.state === STATE.WON, clean.state);
check('winning score includes bonuses', clean.score > 1400, String(clean.score));

const chased = simulate({ bullyOff: false });
check('bully leaves the pen and engages', chased.lives < 3 || chased.state === STATE.WON,
  `lives=${chased.lives} state=${chased.state}`);
check('run always terminates', chased.state !== STATE.PLAYING, chased.state);

const locked = new Game();
locked.start();
locked.player.reset(locked.maze.checkout);
locked.update(1 / 60);
check('checkout stays locked until the list is done', locked.state === STATE.PLAYING);

console.log('\nBrowser smoke test (v1 prototype)');

let puppeteer = null;
try {
  ({ default: puppeteer } = await import('puppeteer'));
} catch {
  console.log('  [SKIP] puppeteer not installed — run `npm install --include=dev` to enable');
}

if (puppeteer) {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { extname, join, normalize } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = new URL('../public/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

  const server = createServer(async (req, res) => {
    try {
      const path = normalize(decodeURI(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
      const file = join(root, path === '/' ? 'index.html' : path);
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(5199, r));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  // Two kinds of 404 are expected here and must not fail the run: the art in
  // public/assets is optional by design (see public/assets/README.md — the game
  // falls back to vector rendering, and the PWA manifest icons just go unused),
  // and this static server has no /api, so the leaderboard client falls back to
  // localStorage exactly as it does when the Worker is down. The browser logs
  // each of those as a console error; they are ignored here. Any other 404, and
  // any real page or console error, still fails the check.
  const EXPECTED_404 = /\/assets\/(board|icon-192|icon-512)\.png$|\/api\//;
  const EXPECTED_NOISE = /^Failed to load resource|icon from the Manifest/;
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() === 404 && !EXPECTED_404.test(r.url()) && errors.push(`404 ${r.url()}`));
  page.on('console', (m) => m.type() === 'error' && !EXPECTED_NOISE.test(m.text()) && errors.push(m.text()));
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await new Promise((r) => setTimeout(r, 1200));

  const state = await page.evaluate(() => ({
    state: globalThis.__CSD__.game.state,
    moved: globalThis.__CSD__.game.player.x !== globalThis.__CSD__.game.maze.spawn.x
      || globalThis.__CSD__.game.player.y !== globalThis.__CSD__.game.maze.spawn.y,
    canvasW: document.querySelector('#stage').width,
    listItems: document.querySelectorAll('#list li').length,
  }));

  check('page loads with no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  check('canvas is sized', state.canvasW > 0, `${state.canvasW}px`);
  check('HUD renders the shopping list', state.listItems === SHOPPING_LIST.length, `${state.listItems} rows`);
  check('SPACE starts the run', state.state === 'playing', state.state);
  check('arrow keys move the shopper', state.moved);

  // puppeteer wants a filesystem path string here, not a URL object
  await page.screenshot({ path: fileURLToPath(new URL('../qa-screenshot.png', import.meta.url)) });
  console.log('  screenshot -> qa-screenshot.png');

  await browser.close();
  server.close();
}

// ── layer 3: the live game ─────────────────────────────────────────────────────────────────────────────────
console.log('\nLive game (public/standalone.html)');

if (puppeteer) {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { extname, join, normalize } = await import('node:path');
  const { validateLive3 } = await import('../worker/score-rules.js');
  const root = new URL('../public/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

  // /api/scores is a stand-in for the Worker: `answer` is what it says to the next POST (null = hang up the connection)
  let answer = { status: 201, body: { ok: true, rank: 1 } };
  const posts = [];
  const server = createServer(async (req, res) => {
    const path = decodeURI(req.url.split('?')[0]);
    if (path === '/api/scores') {
      if (req.method === 'POST') {
        let raw = ''; for await (const c of req) raw += c;
        posts.push({ origin: req.headers.origin ?? null, body: JSON.parse(raw) });
        if (!answer) return req.socket.destroy();
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(answer.body));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ scores: [{ name: 'KCT', score: 1234 }] }));
    }
    try {
      const file = join(root, path === '/' ? 'standalone.html' : normalize(path).replace(/^(\.\.[/\\])+/, ''));
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(5198, r));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 740 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() === 404 && errors.push(`404 ${r.url()}`));
  // (the browser logs a failed /api call as "Failed to load resource": that is the point of the 400/429/500 checks below)
  page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto('http://localhost:5198/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__csd && window.__csd.S && window.__csd.S.mode === 'title', { timeout: 60000 });
  check('live game boots to the title screen with no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  // a store run: arrive from the drive (no bonus), start, 30 s of store time, take the 7 items, pay
  const run = await page.evaluate(async () => {
    const c = window.__csd, S = () => c.S, H = 1 / 120;
    c.arrive({ bonus: 0, bully: { lead: 25, caughtUp: false } });
    document.getElementById('btnStart').click();
    while (S().intro > 0) c.step(H, 12);
    c.freeze(true);
    c.step(H, 120 * 30);
    for (let i = 0; i < c.items.length; i++) { const p = S().curPos; c.tp(p.x, p.y); let n = 0; while (S().nGot === i && n++ < 240) c.step(H, 1); }
    c.tp(476, 408); let n = 0; while (!S().won && n++ < 240) c.step(H, 1);
    return { won: S().won, nGot: S().nGot, score: S().score, mode: S().mode };
  });
  check('a store run can be played to the register', run.won && run.nGot === 7, JSON.stringify(run));
  await new Promise((r) => setTimeout(r, 1700));   // the end screen comes up after a short beat

  const note = () => page.$eval('#lbNote', (e) => e.textContent);
  const submit = async (ans) => {
    answer = ans; posts.length = 0;
    await page.evaluate(() => document.getElementById('btnSubmit').click());
    await page.waitForFunction(() => !/^SAVING/.test(document.getElementById('lbNote').textContent), { timeout: 15000 });
    return note();
  };

  const ok = await submit({ status: 201, body: { ok: true, rank: 1 } });
  const sent = posts[0];
  check('the score is posted in the v3 format, three letters, with an Origin header', !!sent && sent.body.v === 3 && /^[A-Z]{3}$/.test(sent.body.name) && sent.origin === 'http://localhost:5198', JSON.stringify(sent));
  check("the posted score passes the Worker's own rules", !!sent && validateLive3(sent.body) === null, sent && String(validateLive3(sent.body)));
  check('accepted: the end screen shows the rank', /^YOU RANKED #1/.test(ok), ok);

  const rej = await submit({ status: 400, body: { error: 'score out of range' } });
  check('rejected (400): says the score was not accepted, not OFFLINE', rej === 'SCORE NOT ACCEPTED — NOT SAVED', rej);
  const many = await submit({ status: 429, body: { error: 'too many requests' } });
  const rowShown = await page.$eval('#submitRow', (e) => e.style.display !== 'none');
  check('rate limited (429): says to try again, and the submit button is back', many === 'TOO MANY TRIES — TRY AGAIN IN A MINUTE' && rowShown, `${many} / submit row shown: ${rowShown}`);
  const down = await submit({ status: 500, body: { error: 'server error' } });
  check('server error (500): still OFFLINE', down === 'OFFLINE — SAVED ON THIS DEVICE ONLY', down);
  const gone = await submit(null);
  check('no connection: OFFLINE', gone === 'OFFLINE — SAVED ON THIS DEVICE ONLY', gone);

  await browser.close();
  server.close();
} else {
  console.log('  [SKIP] puppeteer not installed — run `npm install --include=dev` to enable');
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
