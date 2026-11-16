// Node-only checks of the wide sidewalks (public/drive/setback.js) on the real world.json and route:  node tools-walk/setback.test.mjs [W=5.5]
//  1. after the set-back no drawn building has a vertex or an edge inside any street's corridor (the curb + W)
//  2. only removal: every new footprint lies inside its old one (except buildings moved whole), so no new overlap and nothing pokes into a cross street
//  3. buildings that overlapped before may still do so (OSM does that); no PAIR overlaps more than it did
//  4. what was done: how many buildings were cut / moved whole, and how much footprint area went
import fs from 'fs'; import assert from 'assert';
import { loadCityNode } from '../tools-roam/node-world.mjs';
const T = +process.argv[2] || undefined;
const { SIDEWALK, makeCorridors } = await import('../public/drive/setback.js');
const raw = JSON.parse(fs.readFileSync(new URL('../public/drive/world.json', import.meta.url)));
const before = raw.buildings.map((b) => ({ id: b.id, pts: b.pts.map((p) => [...p]), canopy: b.canopy, minH: b.minH, kind: b.kind }));
const N = await loadCityNode();
const { W, route, city } = N;
const st = city.sidewalks;
console.log('stats', JSON.stringify(st));
const C = makeCorridors(W, route, T);
let fail = 0; const bad = (m) => { if (fail++ < 15) console.log('FAIL', m); };
const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const byId = new Map(before.map((b) => [b.id, b]));
let moved = 0, whole = 0, outside = 0, inRoute = 0;
for (const b of W.buildings) {
  if (b.canopy || b.minH > 2.5 || b.kind === 'skyline') continue;
  let cx = 0, cy = 0; for (const [x, y] of b.pts) { cx += x; cy += y; } cx /= b.pts.length; cy /= b.pts.length;
  const hero = (x, y) => x > -25 && x < 39 && y > -18 && y < 6;
  if (hero(cx, cy)) continue;
  // 1: vertices and edges
  for (let i = 0; i < b.pts.length; i++) {
    const [ax, ay] = b.pts[i], [bx, by] = b.pts[(i + 1) % b.pts.length], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k <= n; k++) { const d = C.depth(ax + (bx - ax) * k / n, ay + (by - ay) * k / n); if (d > 0.01) { bad(`building ${b.id} still ${d.toFixed(3)} m inside a corridor`); k = n; i = 1e9; } }
  }
  if (!b.setback) continue; moved++;
  if (b.setback.whole || b.setback.kept) { whole++; continue; }
  // 2: new ring inside the old ring (sample the new ring's vertices and edge midpoints)
  const old = b.setback.from;
  for (let i = 0; i < b.pts.length; i++) {
    const [ax, ay] = b.pts[i], [bx, by] = b.pts[(i + 1) % b.pts.length];
    for (const t of [0, 0.5]) { const x = ax + (bx - ax) * t, y = ay + (by - ay) * t; let near = false; for (let q = 0; q < old.length && !near; q++) { const [px, py] = old[q], [rx, ry] = old[(q + 1) % old.length], dx = rx - px, dy = ry - py, u = Math.max(0, Math.min(1, ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(x - px - u * dx, y - py - u * dy) < 0.06) near = true; } if (!near && !inPoly(x, y, old)) { bad(`building ${b.id}: new outline leaves the old one at ${x.toFixed(1)},${y.toFixed(1)}`); i = 1e9; break; } }
  }
}
// 3: pair overlap, before vs after, among buildings within reach of a changed one
const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;
const bbox = (p) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of p) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; };
const overlap = (p, q) => { const A = bbox(p), B = bbox(q); const x0 = Math.max(A[0], B[0]), y0 = Math.max(A[1], B[1]), x1 = Math.min(A[2], B[2]), y1 = Math.min(A[3], B[3]); if (x0 >= x1 || y0 >= y1) return 0; let n = 0; for (let x = x0 + 0.25; x < x1; x += 0.5) for (let y = y0 + 0.25; y < y1; y += 0.5) if (inPoly(x, y, p) && inPoly(x, y, q)) n++; return n * 0.25; };
const live = W.buildings.filter((b) => !b.canopy && !(b.minH > 2.5) && b.pts.length >= 3);
const changed = live.filter((b) => b.setback);
let worse = 0, pairs = 0;
for (const a of changed) {
  const A0 = byId.get(a.id).pts, bA = bbox(a.pts);
  for (const o of live) {
    if (o === a) continue; const bO = bbox(o.pts);
    if (bA[0] > bO[2] + 8 || bO[0] > bA[2] + 8 || bA[1] > bO[3] + 8 || bO[1] > bA[3] + 8) continue;
    pairs++; const O0 = (byId.get(o.id) || o).pts, was = overlap(A0, O0), now = overlap(a.pts, o.pts);
    if (now > was + 0.5) { worse++; bad(`overlap grew ${was.toFixed(1)} -> ${now.toFixed(1)} m2 between ${a.id} and ${o.id}${a.setback.whole ? ' (moved whole)' : ''}`); }
  }
}
console.log(JSON.stringify({ T: T ?? SIDEWALK.W, changedBuildings: moved, movedWhole: whole, pairsChecked: pairs, overlapsThatGrew: worse, areaBefore: Math.round(st.areaBefore), areaAfter: Math.round(st.areaAfter), failures: fail }));
assert.equal(fail, 0, 'sidewalk set-back failed');
console.log('OK');
