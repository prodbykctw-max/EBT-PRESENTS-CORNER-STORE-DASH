/** Bootstrap: wire the game, renderer, input and HUD together and run the loop. */

import { Game, STATE } from './game.js';
import { Renderer } from './renderer.js';
import { bindInput } from './input.js';
import { fetchTop, submitScore, rememberName, recallName } from './leaderboard.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#stage');
const els = {
  score: $('#score'),
  lives: $('#lives'),
  time: $('#time'),
  progress: $('#progress'),
  list: $('#list'),
  board: $('#board'),
  boardNote: $('#board-note'),
  name: $('#name'),
  restart: $('#restart'),
};

const game = new Game({ onChange: paint });
const renderer = new Renderer(canvas, game.maze);
let submitted = false;

els.name.value = recallName();
els.name.addEventListener('change', () => rememberName(els.name.value));

function paint(snap) {
  els.score.textContent = snap.score.toLocaleString();
  els.lives.textContent = '🛒'.repeat(Math.max(0, snap.lives)) || '—';
  els.time.textContent = `${snap.timeLeft}s`;
  els.progress.textContent = `${snap.collected}/${snap.total}`;
  els.list.replaceChildren(...snap.items.map((i) => {
    const li = el('li', i.collected ? 'done' : '');
    li.append(el('span', undefined, i.emoji), String(i.label));
    return li;
  }));
}

/** Element builder: text always goes in via textContent, never as HTML. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function renderBoard({ source, rows }) {
  els.boardNote.textContent = source === 'remote' ? 'Live D1 leaderboard' : 'Offline — showing local scores';
  els.board.replaceChildren(...(rows.length
    ? rows.map((r, i) => {
      const li = document.createElement('li');
      li.append(el('b', undefined, i + 1), el('span', undefined, r.name), el('em', undefined, Number(r.score).toLocaleString()));
      return li;
    })
    : [el('li', 'empty', 'No runs logged yet.')]));
}

async function finishRun() {
  if (submitted) return;
  submitted = true;
  const name = els.name.value.trim() || 'SHOPPER';
  rememberName(name);
  await submitScore({
    name,
    score: game.score,
    items: game.collected,
    timeLeft: game.timeLeft,
    won: game.state === STATE.WON,
  });
  renderBoard(await fetchTop());
}

function restart() {
  submitted = false;
  game.newRun();
}

bindInput({
  surface: canvas,
  onTurn: (dir) => game.player.turn(dir),
  onStart: () => game.start(),
  onRestart: restart,
});

els.restart.addEventListener('click', restart);
globalThis.addEventListener('resize', () => renderer.resize());

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  game.update(dt);
  renderer.draw(game);
  if (game.state === STATE.WON || game.state === STATE.OVER) finishRun();
  requestAnimationFrame(loop);
}

paint(game.snapshot());
fetchTop().then(renderBoard);
requestAnimationFrame(loop);

// Exposed for the Puppeteer QA pass in tests/qa.mjs.
globalThis.__CSD__ = { game, renderer, restart };
