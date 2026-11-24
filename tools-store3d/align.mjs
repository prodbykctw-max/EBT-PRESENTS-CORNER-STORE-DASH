// node tools-store3d/align.mjs [layout.json]  (no browser)
// Builds the store's structure from the layout (public/store3d/structure.js, the same code the page runs) and compares it with the
// game's mask: a cell of the 4 px mask is SOLID in the game when it is not floor; it is solid in 3D when a ray dropped from above its
// centre hits a solid mesh (a box that blocks: shelves, counters, walls, corrals) at least 0.1 m high. Overhead things (signs, lamps)
// are not solid. Reports disagreements, by category, and writes mismatch.json next to layout.json.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import * as THREE from '../public/drive/vendor/three.module.min.js';
import { buildStructure, m, resolveFixtures } from '../public/store3d/structure.js'; import { useAtlas } from '../public/store3d/products.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(ROOT, 'public/store3d/layout.json'), L = JSON.parse(fs.readFileSync(file, 'utf8'));
useAtlas({ cell: () => [0, 0, 1, 1] });
const S = buildStructure(L, {}, { look: process.env.STORELOOK });   // STORELOOK=atl checks the ATL look (store3d/atl.js)
const solids = S.info.solids.filter((b) => b.y1 - b.y0 >= 0.1 || b.y1 >= 0.1);
const { mw, mh, cell } = L.board, fixtures = resolveFixtures(L);
// spatial hash of solid boxes on the 4 px grid
const grid = new Map(); const key = (x, y) => x + ',' + y;
for (const b of solids) { const cx0 = Math.floor(b.x0 / m(cell) + 1e-6), cx1 = Math.ceil(b.x1 / m(cell) - 1e-6), cy0 = Math.floor(b.z0 / m(cell) + 1e-6), cy1 = Math.ceil(b.z1 / m(cell) - 1e-6);
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) { const k = key(x, y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b); } }
const solid3d = (cx, cy) => { const px = m(cx * cell + cell / 2), pz = m(cy * cell + cell / 2); for (const b of grid.get(key(cx, cy)) || []) if (px >= b.x0 && px < b.x1 && pz >= b.z0 && pz < b.z1 && b.y1 >= 0.1) return b.id || true; return false; };
// the band the 3D builds: the playfield rows and everything within the wall ring (beyond it is void)
const near = new Uint8Array(mw * mh), R = 20;
for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (L.field[y][x] === '1') for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < mw && Y < mh && Math.abs(dx) + Math.abs(dy) <= R + 6) near[Y * mw + X] = 1; }
const out = { cells: 0, agree: 0, floorButSolid3d: 0, solidButFree3d: 0, byFixture: {}, holeFixtures: {}, examples: [] };
for (let y = Math.floor(96 / cell) - 1; y < Math.floor(1640 / cell); y++) for (let x = 0; x < mw; x++) {
  if (!near[y * mw + x] && L.field[y][x] === '1') continue;
  if (!near[y * mw + x]) continue;
  const game = L.field[y][x] === '0', t3 = !!solid3d(x, y); out.cells++;
  if (game === t3) { out.agree++; continue; }
  const bx = x * cell + 2, by = y * cell + 2, f = fixtures.find((q) => bx >= q.rect[0] && bx < q.rect[2] && by >= q.rect[1] && by < q.rect[3]);
  const name = f ? f.id : 'other';
  if (!game && t3) { out.floorButSolid3d++; (f && f.hole ? out.holeFixtures : out.byFixture)[name + ':3D solid, game floor'] = ((f && f.hole ? out.holeFixtures : out.byFixture)[name + ':3D solid, game floor'] || 0) + 1; }
  else { out.solidButFree3d++; out.byFixture[name + ':game solid, 3D free'] = (out.byFixture[name + ':game solid, 3D free'] || 0) + 1; }
  if (out.examples.length < 12) out.examples.push({ x: bx, y: by, game: game ? 'solid' : 'floor', t3 });
}
const holeN = Object.values(out.holeFixtures).reduce((a, b) => a + b, 0), mism = out.floorButSolid3d + out.solidButFree3d;
out.pct = +(100 * mism / out.cells).toFixed(3); out.pctExcludingKnownHoles = +(100 * (mism - holeN) / out.cells).toFixed(3); out.knownHoleCells = holeN;
// the walkable side: every floor cell of the game (the field), is it clear in 3D?
let fl = 0, flBad = 0; for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (L.field[y][x] === '1') { fl++; if (solid3d(x, y)) flBad++; }
out.walkableCells = fl; out.walkableButSolid3d = flBad;
let so = 0, soBad = 0; for (let y = Math.floor(96 / cell); y < Math.floor(1640 / cell); y++) for (let x = 0; x < mw; x++) if (L.field[y][x] === '0' && near[y * mw + x]) { so++; if (!solid3d(x, y)) soBad++; }
out.solidCells = so; out.solidButFree3d2 = soBad;
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(path.dirname(file), 'mismatch.json'), JSON.stringify(out, null, 1));
// a picture of it (PGM: grey = agree floor, white = agree solid, red/blue in the PPM below)
if (process.env.ALIGN_PPM) {
  const buf = Buffer.alloc(mw * mh * 3);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { const game = L.field[y][x] === '0', t3 = !!solid3d(x, y), o = (y * mw + x) * 3; let c = game && t3 ? [255, 255, 255] : !game && !t3 ? [90, 90, 90] : game ? [40, 120, 255] : [255, 40, 40]; if (!near[y * mw + x] && game) c = [30, 30, 30]; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; }
  fs.writeFileSync(process.env.ALIGN_PPM, Buffer.concat([Buffer.from(`P6 ${mw} ${mh} 255\n`), buf]));
}
