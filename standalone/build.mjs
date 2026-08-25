/**
 * Assemble the standalone game: shell2.html + csd.js + board.b64 -> index.html.
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

// shell2.html carries literal \u escapes for a few glyphs; unescape after substitution.
const out = shell
  .replace('%%B64%%', b64)
  .replace('%%GAME%%', game)
  .replaceAll('\\u2026', '…')
  .replaceAll('\\uD83D\\uDD0A', '🔊')
  .replaceAll('\\u25B2', '▲')
  .replaceAll('\\u25BC', '▼')
  .replaceAll('\\u25C0', '◀')
  .replaceAll('\\u25B6', '▶')
  .replaceAll('\\u23F8', '⏸')
  .replaceAll('\\u00b7', '·')
  .replaceAll('\\u2014', '—');

writeFileSync(here('index.html'), out);
copyFileSync(here('index.html'), here('../public/standalone.html'));
console.log(`standalone/index.html assembled (${out.length} chars) -> also copied to public/standalone.html`);
