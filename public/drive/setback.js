// Wide sidewalks: every building is set back so there is room between the curb and the facade.
// (owner, Nov 2026: "the sidewalk is not wide enough... that little concrete thing that people are walking on just too skinny... make it wider
// while pushing all of the buildings back. I wouldn't suggest making the street smaller")
//
// WHAT A SIDEWALK IS HERE. There is no sidewalk mesh: the terrain (the sidewalk texture) fills everything the roads, curbs and lawns do not, so the
// sidewalk is whatever lies between a street's curb (roads.js draws it at the road's half-width, 0.3 m thick) and the first building wall. The streets are
// right as they are, so the only way to widen the walk is to move the walls: every drawn building loses the part of its footprint that stands closer to a
// curbed street than SIDEWALK.W metres from the back of that street's curb. That is a polygon difference (the footprint minus the street's "corridor"), so a building
// is only ever cut, never grown: it cannot come to overlap another one or reach into a cross street, a row of fronts ends up on one straight line instead of each its
// own setback, and a corner is round round a junction like the corner of the road. (polygon-clipping, vendor/: MIT, a few ms for the whole city.)
//
// THE CORRIDOR of a street is its centre line (a capsule: round at the ends and round the corner of a junction) out to  half-width + CURB + W. They are the same
// polylines and widths roads.js draws: the route's own road (route.HW, the half-width the road ribbon, the curbs and the car are made from) and every curbed OSM road that is
// not elevated. What is left of a footprint after the cut is one or more pieces; a piece too small to be a building (PIECE_MIN m2) is dropped. A building that the cut
// would leave as a sliver (less than MIN_KEEP of it, or under MIN_AREA m2) is moved back whole instead, with its shape (away from the street, until it is out of every corridor); where
// that is not possible either it keeps what the cut left. The hand-built row at the corner store is not in W.buildings: city.js `setBackHero` moves that.
//
// Pure numbers: no three.js, no Math.random, no DOM (the same rule as roam.js): the node tests (tools-walk/) run it on world.json directly.
import { slicer } from './steps.js';
import './vendor/polygon-clipping.umd.min.js';   // (UMD: sets globalThis.polygonClipping)
const pc = globalThis.polygonClipping;

export const SIDEWALK = { W: 5.5, CURB: 0.3, MIN_KEEP: 0.18, MIN_AREA: 20, PIECE_MIN: 6, CAP: 8, ROUTE_STEP: 6 };
const CELL = 24;
const CURBED = /^(primary|secondary|tertiary|residential|unclassified|living_street)(_link)?$/;   // roads.js CURBED: the streets that get a curb
const key = (gx, gy) => gx * 65536 + gy;

function nearestOnSeg(px, py, ax, ay, bx, by, o) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  o.x = ax + dx * t; o.y = ay + dy * t; return t;
}

/** The corridors: [ax, ay, bx, by, R] along every street. route: RouteFrame (X, Y, HW every 1 m); W: world.json. */
export function corridors(W, route, T = SIDEWALK.W) {
  const out = [], k = SIDEWALK.ROUTE_STEP;
  if (route) for (let i = 0; i < route.n - 1; i += k) {
    const j = Math.min(route.n - 1, i + k); let hw = 0; for (let q = i; q <= j; q++) hw = Math.max(hw, route.HW[q]);
    out.push([route.X[i], route.Y[i], route.X[j], route.Y[j], hw + SIDEWALK.CURB + T]);   // (the road is drawn at route.hw(s) = HW)
  }
  for (const rd of W.roads) {
    if (!CURBED.test(rd.cls) || rd.pts.length < 2) continue;
    if (rd.h && Math.max(...rd.h) > 0.3) continue;   // elevated (roads.js: a deck, not a street with a curb)
    const R = rd.width / 2 + SIDEWALK.CURB + T;
    for (let i = 0; i + 1 < rd.pts.length; i++) out.push([rd.pts[i][0], rd.pts[i][1], rd.pts[i + 1][0], rd.pts[i + 1][1], R]);
  }
  return out;
}

/** a corridor as a polygon ring (CCW): a rectangle with a half circle on each end. The circle is drawn a hair outside (circumscribed), never inside, so no point of it is nearer than R. */
function capsuleRing(c, ox, oy) {
  const [ax, ay, bx, by, R] = c, th = Math.atan2(by - ay, bx - ax), N = SIDEWALK.CAP, r = R / Math.cos(Math.PI / (2 * N)), ring = [];
  for (let k = 0; k <= N; k++) { const a = th - Math.PI / 2 + Math.PI * k / N; ring.push([bx - ox + Math.cos(a) * r, by - oy + Math.sin(a) * r]); }
  for (let k = 0; k <= N; k++) { const a = th + Math.PI / 2 + Math.PI * k / N; ring.push([ax - ox + Math.cos(a) * r, ay - oy + Math.sin(a) * r]); }
  return ring;
}

const signedArea = (p) => p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0) / 2;

/** the street set a world is widened against, and the questions asked of it */
export function makeCorridors(W, route, T = SIDEWALK.W) {
  const list = corridors(W, route, T), grid = new Map(), tmp = { x: 0, y: 0 };
  list.forEach((c, i) => {
    const R = c[4] + 0.2;
    for (let gx = Math.floor((Math.min(c[0], c[2]) - R) / CELL); gx <= Math.floor((Math.max(c[0], c[2]) + R) / CELL); gx++)
      for (let gy = Math.floor((Math.min(c[1], c[3]) - R) / CELL); gy <= Math.floor((Math.max(c[1], c[3]) + R) / CELL); gy++) {
        const k = key(gx, gy); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i);
      }
  });
  /** how far (x, y) is inside the deepest corridor it is in: 0 if in none. o (optional) gets the nearest point of that street (x, y) and its segment. */
  const depth = (x, y, o) => {
    let worst = 0;
    for (const i of grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) || []) {
      const c = list[i]; nearestOnSeg(x, y, c[0], c[1], c[2], c[3], tmp);
      const pen = c[4] - Math.hypot(x - tmp.x, y - tmp.y);
      if (pen > worst) { worst = pen; if (o) { o.x = tmp.x; o.y = tmp.y; } }
    }
    return worst;
  };
  /** the corridors whose reach meets the box */
  const near = (x0, y0, x1, y1) => {
    const set = new Set();
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) for (const i of grid.get(key(gx, gy)) || []) set.add(i);
    return [...set].map((i) => list[i]).filter((c) => Math.max(x0, Math.min(c[0], c[2]) - c[4]) <= Math.min(x1, Math.max(c[0], c[2]) + c[4]) && Math.max(y0, Math.min(c[1], c[3]) - c[4]) <= Math.min(y1, Math.max(c[1], c[3]) + c[4]));
  };
  return { list, depth, near, T };
}

/** the deepest a ring (its vertices and every metre of its edges) is inside a corridor */
export function ringDepth(ring, C) {
  let worst = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 1));
    for (let k = 0; k < n; k++) worst = Math.max(worst, C.depth(ax + (bx - ax) * k / n, ay + (by - ay) * k / n));
  }
  return worst;
}

function tidy(ring) {   // drop the closing repeat, repeated points and points in line with their neighbours
  let r = ring.slice(); if (r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]) r.pop();
  for (let pass = 0; pass < 3; pass++) {
    const keep = [];
    for (let i = 0; i < r.length; i++) {
      const a = keep.length ? keep.at(-1) : r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.03) continue;
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      if (Math.abs(cr) / L < 0.01 && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0) continue;
      keep.push(b);
    }
    if (keep.length < 3) break; r = keep;
  }
  return r;
}

/** the whole ring moved away from the streets it is in, with its shape, until it is out of every corridor (or null if it cannot be) */
function moveWhole(pts, C) {
  const o = {}; let q = pts.map((p) => [p[0], p[1]]);
  for (let it = 0; it < 8; it++) {
    let worst = 0, wx = 0, wy = 0;
    for (const [x, y] of q) { const pen = C.depth(x, y, o); if (pen > worst) { worst = pen; const d = Math.hypot(x - o.x, y - o.y); if (d > 1e-6) { wx = (x - o.x) / d; wy = (y - o.y) / d; } } }
    if (worst < 0.01) return ringDepth(q, C) < 0.05 ? q : null;
    if (!wx && !wy) return null;
    q = q.map(([x, y]) => [x + wx * (worst + 0.01), y + wy * (worst + 0.01)]);
  }
  return null;
}

/** Set every drawn building back (changes W.buildings: b.pts, and a piece that was cut in two becomes two buildings). Returns what it did, for the tests.
 *  Skips canopies, raised floors (you drive under those) and skyline silhouettes. `skip(b)` (optional): more to leave alone (the hero lots: the hand-built row replaces
 *  them, and city.js `setBackHero` moves that). */
export function widenSidewalks(W, route, o = {}) { let it = widenSidewalksSteps(W, route, o), r = it.next(); while (!r.done) r = it.next(); return r.value; }

/** the same, as a generator that yields now and then (the prepared drive's build gives the page a turn: about 0.7 s of work in all) */
export function* widenSidewalksSteps(W, route, { T = SIDEWALK.W, skip = null } = {}) {
  const due = slicer(8);
  if (!pc) throw new Error('polygon-clipping did not load');
  const C = makeCorridors(W, route, T), stats = { corridors: C.list.length, buildings: 0, cut: 0, whole: 0, kept: 0, split: 0, dropped: 0, holes: 0, errors: 0, areaBefore: 0, areaAfter: 0 };
  const extra = [], drop = new Set();
  for (const b of W.buildings) {
    if (b.canopy || b.pts.length < 3 || b.minH > 2.5 || b.kind === 'skyline' || (skip && skip(b))) continue;
    stats.buildings++; if (due()) yield 'sidewalks';
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, cx = 0, cy = 0;
    for (const [x, y] of b.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); cx += x; cy += y; }
    cx /= b.pts.length; cy /= b.pts.length;
    if (ringDepth(b.pts, C) < 1e-6) continue;            // nothing of it is inside a corridor
    const A0 = Math.abs(signedArea(b.pts)), caps = C.near(x0, y0, x1, y1), ox = Math.round(cx), oy = Math.round(cy);
    let pieces;
    try {
      pieces = pc.difference([b.pts.map(([x, y]) => [x - ox, y - oy])], ...caps.map((c) => [capsuleRing(c, ox, oy)]));   // (no union first: the difference takes them all, about 3x faster)
    } catch (e) { stats.errors++; continue; }
    const polys = [];
    for (const p of pieces) {
      if (p.length > 1) stats.holes++;                      // a corridor wholly inside the footprint: the building keeps its outer ring (it never happens on the data, see the tests)
      const ring = tidy(p[0].map(([x, y]) => [x + ox, y + oy]));
      if (ring.length >= 3 && Math.abs(signedArea(ring)) >= SIDEWALK.PIECE_MIN) polys.push(ring);
    }
    const A1 = polys.reduce((s, r) => s + Math.abs(signedArea(r)), 0);
    b.setback = { from: b.pts, area: A0 };   // (kept for the tests; nothing at run time reads it)
    if (A1 < SIDEWALK.MIN_AREA || A1 < A0 * SIDEWALK.MIN_KEEP) {
      const moved = moveWhole(b.pts, C);
      if (moved) { stats.whole++; b.setback.whole = true; b.pts = moved; stats.areaBefore += A0; stats.areaAfter += A0; continue; }
      if (!polys.length) {   // nothing is left of it and it cannot be moved (a booth on the median between two streets 8 m apart): a small one goes, a big one keeps its place (a narrow walk there)
        if (A0 < 60) { stats.dropped++; drop.add(b); } else { stats.kept++; b.setback.kept = true; }
        continue;
      }
    }
    stats.areaBefore += A0; stats.areaAfter += A1;
    polys.sort((a, c) => Math.abs(signedArea(c)) - Math.abs(signedArea(a)));
    stats.cut++; b.pts = polys[0];
    for (let i = 1; i < polys.length; i++) { stats.split++; extra.push({ ...b, pts: polys[i], setback: { from: b.setback.from, area: A0, piece: i } }); }
  }
  if (drop.size) W.buildings = W.buildings.filter((b) => !drop.has(b));
  W.buildings.push(...extra);
  return stats;
}
