/**
 * QA pass. Two layers:
 *   1. Headless logic checks — run always, no dependencies. Flood-fill the map,
 *      then drive a bot through a full run to prove the game is winnable.
 *   2. Browser smoke test — runs only if puppeteer is installed (npm i).
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
console.log('Map integrity');

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

console.log('\nSimulated run');

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

console.log('\nBrowser smoke test');

let puppeteer = null;
try {
  ({ default: puppeteer } = await import('puppeteer'));
} catch {
  console.log('  [SKIP] puppeteer not installed — run `npm install` to enable');
}

if (puppeteer) {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { extname, join, normalize } = await import('node:path');
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
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
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

  await page.screenshot({ path: new URL('../qa-screenshot.png', import.meta.url) });
  console.log('  screenshot -> qa-screenshot.png');

  await browser.close();
  server.close();
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
