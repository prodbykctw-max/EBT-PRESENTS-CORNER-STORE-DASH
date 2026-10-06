/**
 * Assemble the standalone game: shell2.html + csd.js + board.b64 + player.b64 -> index.html.
 * Node port of the recipe in corner-store-dash-handoff.md ("Rebuilding index.html").
 *
 *   node standalone/build.mjs
 *
 * Also copies the result to public/standalone.html so the Worker / dev server
 * serves the v2.1 game (same-origin /api/* lights up the global leaderboard).
 */

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const shell = readFileSync(here('shell2.html'), 'utf8');
const game = readFileSync(here('csd.js'), 'utf8');
const b64 = readFileSync(here('board.b64'), 'utf8').trim();
const playerB64 = readFileSync(here('player.b64'), 'utf8').trim();
const bullyB64 = readFileSync(here('bully.b64'), 'utf8').trim();
const itemsB64 = readFileSync(here('items.b64'), 'utf8').trim();
// GSAP (motion): one vendored copy, shared with the drive (public/drive/vendor/gsap.min.js)
const gsapSrc = readFileSync(here('../public/drive/vendor/gsap.min.js'), 'utf8');

// shell2.html carries literal \u escapes for a few glyphs; unescape after substitution.
const out = shell
  .replace('%%B64%%', b64)
  .replace('%%PLAYER%%', playerB64)
  .replace('%%BULLY%%', bullyB64)
  .replace('%%ITEMS%%', itemsB64)
  .replace('%%GAME%%', game)
  .replaceAll('\\u2026', '…')
  .replaceAll('\\uD83D\\uDD0A', '🔊')
  .replaceAll('\\u25B2', '▲')
  .replaceAll('\\u25BC', '▼')
  .replaceAll('\\u25C0', '◀')
  .replaceAll('\\u25B6', '▶')
  .replaceAll('\\u23F8', '⏸')
  .replaceAll('\\u00b7', '·')
  .replaceAll('\\u00a9', '©')
  .replaceAll('\\u2014', '—')
  // last and verbatim: the glyph unescaping above is for shell2.html / csd.js, never library code
  .replace('%%GSAP%%', () => gsapSrc);

writeFileSync(here('index.html'), out);
copyFileSync(here('index.html'), here('../public/standalone.html'));
// repo root -> GitHub Pages serves the game at /. There the drive lives at public/drive/ (the repo's own
// drive/ folder is the Blender/OSM toolchain), so this copy loads it from there.
const DRIVE = 'var DRIVE_URL="./drive/drive.js";';
if (!out.includes(DRIVE)) throw new Error('DRIVE_URL not found in the assembled game');
let pagesCopy = out.replace(DRIVE, 'var DRIVE_URL="./public/drive/drive.js";');
// ...and so do the tab icons (public/favicon.ico, public/icons/)
for (const [from, to] of [['href="favicon.ico"', 'href="public/favicon.ico"'], ['href="icons/', 'href="public/icons/']]) {
  if (!pagesCopy.includes(from)) throw new Error(`${from} not found in the assembled game`);
  pagesCopy = pagesCopy.replaceAll(from, to);
}
writeFileSync(here('../index.html'), pagesCopy);
// the files AI assistants read: edit them in public/ (the main link serves them); the GitHub Pages copy gets the same
for (const f of ['llms.txt', 'llms-full.txt']) copyFileSync(here(`../public/${f}`), here(`../${f}`));
console.log(`standalone/index.html assembled (${out.length} chars) -> also copied to public/standalone.html and ./index.html (+ llms.txt, llms-full.txt)`);
