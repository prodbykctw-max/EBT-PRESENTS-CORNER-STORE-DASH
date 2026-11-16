// Wide sidewalks: every building is set back so there is room between the curb and the facade.
// (owner, Nov 2026: "the sidewalk is not wide enough... that little concrete thing that people are walking on just too skinny... make it wider
// while pushing all of the buildings back. I wouldn't suggest making the street smaller")
//
// WHAT A SIDEWALK IS HERE. There is no sidewalk mesh: the terrain (the sidewalk texture) fills everything the roads, curbs and lawns do not, so the
// sidewalk is whatever lies between a street's curb (roads.js draws it at the road's half-width, 0.3 m thick) and the first building wall. The streets are
// right as they are, so the only way to widen the walk is to move the walls: every drawn building loses the part of its footprint that stands
// closer to a curbed street than SIDEWALK.W metres from the back of that street's curb. Only ever removed, never added: a building can't come to overlap
// another or reach into a cross street, and a row of fronts ends up on one straight line instead of each its own setback.
//
// WHERE: the corridor of a street is its centre line (a capsule: round at the ends and round the corner of a junction) out to  half-width + CURB + W.
// The corridors are the same polylines and widths roads.js draws (the route's own road with route.hw, and every curbed OSM road that is not elevated),
// so what is measured is what is on screen. A building vertex inside a corridor is pushed straight out of it, away from the nearest bit of the street; edges
// are cut every EDGE_STEP metres first so the new front is straight along a straight street and round round a bend.
// A building whose remaining footprint would be a sliver (less than MIN_KEEP of it, or under MIN_AREA m2) is moved back whole instead (it keeps its shape;
// where that would reach into something behind it, the front is just cut as far as it can go). The hand-built row at the corner store is not in
// W.buildings: drive.js moves that with `setBackHero` below.
//
// Pure numbers: no three.js, no Math.random, no DOM (the same rule as roam.js): the node tests (tools-walk/) run it on world.json directly.
export const SIDEWALK = { W: 5.5, CURB: 0.3, EDGE_STEP: 1.25, MIN_KEEP: 0.18, MIN_AREA: 14 };
const CELL = 24;
const CURBED = /^(primary|secondary|tertiary|residential|unclassified|living_street)(_link)?$/;   // roads.js CURBED: the streets that get a curb

const key = (gx, gy) => gx * 65536 + gy;
function nearestOnSeg(px, py, ax, ay, bx, by, o) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  o.x = ax + dx * t; o.y = ay + dy * t; return t;
}

/** The corridors: [ax, ay, bx, by, R] for every metre-ish of every curbed street. route: RouteFrame (X, Y, HW every 1 m); W: world.json. */
export function corridors(W, route, T = SIDEWALK.W) {
  const out = [];
  if (route) for (let i = 0; i + 1 < route.n; i += 2) {
    const j = Math.min(route.n - 1, i + 2);
    out.push([route.X[i], route.Y[i], route.X[j], route.Y[j], Math.max(route.HW[i], route.HW[j]) + SIDEWALK.CURB + T]);   // (the road is drawn at route.hw(s) = HW)
  }
  for (const rd of W.roads) {
    if (!CURBED.test(rd.cls) || rd.pts.length < 2) continue;
    if (rd.h && Math.max(...rd.h) > 0.3) continue;   // elevated (roads.js: a deck, not a street with a curb)
    const R = rd.width / 2 + SIDEWALK.CURB + T;
    for (let i = 0; i + 1 < rd.pts.length; i++) out.push([rd.pts[i][0], rd.pts[i][1], rd.pts[i + 1][0], rd.pts[i + 1][1], R]);
  }
  return out;
}

function indexOf(list) {
  const g = new Map();
  list.forEach((c, i) => {
    const R = c[4];
    for (let gx = Math.floor((Math.min(c[0], c[2]) - R) / CELL); gx <= Math.floor((Math.max(c[0], c[2]) + R) / CELL); gx++)
      for (let gy = Math.floor((Math.min(c[1], c[3]) - R) / CELL); gy <= Math.floor((Math.max(c[1], c[3]) + R) / CELL); gy++) {
        const k = key(gx, gy); let l = g.get(k); if (!l) g.set(k, (l = [])); l.push(i);
      }
  });
  return g;
}

const signedArea = (p) => p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0) / 2;
function selfCrosses(p) {   // does the ring cross itself (a collapsed or folded front)? small rings only
  const n = p.length, cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
    if (cr(a, b, c) * cr(a, b, d) < -1e-9 && cr(c, d, a) * cr(c, d, b) < -1e-9) return true;
  }
  return false;
}

/** the street set a world is widened against: { list, grid }, and the one question asked of it */
export function makeCorridors(W, route, T = SIDEWALK.W) {
  const list = corridors(W, route, T), grid = indexOf(list), tmp = { x: 0, y: 0 };
  /** how far (x, y) is inside the nearest corridor it is in: 0 if in none. Fills o with the point of the street it should be pushed away from. */
  const depth = (x, y, o) => {
    let worst = 0;
    for (const i of grid.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) || []) {
      const c = list[i]; nearestOnSeg(x, y, c[0], c[1], c[2], c[3], tmp);
      const d = Math.hypot(x - tmp.x, y - tmp.y), pen = c[4] - d;
      if (pen > worst) { worst = pen; if (o) { o.x = tmp.x; o.y = tmp.y; o.d = d; o.ax = c[0]; o.ay = c[1]; o.bx = c[2]; o.by = c[3]; } }
    }
    return worst;
  };
  return { list, grid, depth, T };
}

/** one footprint ring set back: returns the new ring, or null if nothing of it is inside a corridor. */
function setBackRing(pts, C, cx, cy) {
  const o = {};
  // anything of it inside a corridor? (vertices, and the edges between them, tested every metre)
  let touched = false;
  for (let i = 0; i < pts.length && !touched; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 1));
    for (let k = 0; k < n; k++) if (C.depth(ax + (bx - ax) * k / n, ay + (by - ay) * k / n) > 1e-6) { touched = true; break; }
  }
  if (!touched) return null;
  // cut the edges to EDGE_STEP, then push every vertex out of every corridor it is in
  const cut = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / SIDEWALK.EDGE_STEP));
    for (let k = 0; k < n; k++) cut.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  const push = (q) => {   // out of the corridors, a few passes (a corner needs two streets)
    for (let it = 0; it < 6; it++) {
      const pen = C.depth(q[0], q[1], o); if (pen <= 1e-4) return;
      let dx = q[0] - o.x, dy = q[1] - o.y; const d = Math.hypot(dx, dy);
      if (d > 1e-6) { dx /= d; dy /= d; } else { const sx = o.bx - o.ax, sy = o.by - o.ay, L = Math.hypot(sx, sy) || 1; dx = -sy / L; dy = sx / L; if ((cx - o.x) * dx + (cy - o.y) * dy < 0) { dx = -dx; dy = -dy; } }
      q[0] += dx * (pen + 0.002); q[1] += dy * (pen + 0.002);
    }
  };
  for (const q of cut) push(q);
  // tidy: drop repeated and in-line vertices (a straight front was cut every 1.25 m)
  let ring = cut;
  for (let pass = 0; pass < 2; pass++) {
    const keep = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.04) continue;
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      if (Math.abs(cr) / L < 0.015 && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) > 0) continue;   // in line with its neighbours, same way on
      keep.push(b);
    }
    ring = keep.length >= 3 ? keep : ring;
  }
  return ring;
}

/** Set every drawn building back (mutates W.buildings[i].pts). Returns { moved, whole, cut, dropped, ... } for the tests. Skips canopies, raised floors (you drive under those)
 *  and skyline silhouettes. `skip(b)` (optional): more to leave alone (the hero lots: the hand-built row replaces them, and is moved by setBackHero). */
export function widenSidewalks(W, route, { T = SIDEWALK.W, skip = null } = {}) {
  const C = makeCorridors(W, route, T), stats = { corridors: C.list.length, buildings: 0, touched: 0, cut: 0, whole: 0, kept: [], areaBefore: 0, areaAfter: 0 };
  for (const b of W.buildings) {
    if (b.canopy || b.pts.length < 3 || b.minH > 2.5 || b.kind === 'skyline' || (skip && skip(b))) continue;
    stats.buildings++;
    let cx = 0, cy = 0; for (const [x, y] of b.pts) { cx += x; cy += y; } cx /= b.pts.length; cy /= b.pts.length;
    const A0 = Math.abs(signedArea(b.pts)), ring = setBackRing(b.pts, C, cx, cy);
    if (!ring) continue;
    stats.touched++;
    const A1 = Math.abs(signedArea(ring)), flipped = Math.sign(signedArea(ring)) !== Math.sign(signedArea(b.pts));
    b.setback = { from: b.pts, area: A0 };   // (kept for the tests and the doc; nothing at run time reads it)
    if (ring.length < 3 || flipped || selfCrosses(ring) || A1 < SIDEWALK.MIN_AREA || A1 < A0 * SIDEWALK.MIN_KEEP) { stats.whole++; b.setback.whole = true; b.pts = setBackWhole(b.pts, C, cx, cy, ring); }
    else { stats.cut++; b.pts = ring; }
    stats.areaBefore += A0; stats.areaAfter += Math.abs(signedArea(b.pts));
  }
  return stats;
}

/** a sliver is not worth keeping as a sliver: the whole building moves back instead, by the deepest any vertex is in a corridor, along the way that pushed it. */
function setBackWhole(pts, C, cx, cy) {
  const o = {};
  let best = 0, mx = 0, my = 0;
  for (const [x, y] of pts) {
    const pen = C.depth(x, y, o); if (pen <= best) continue;
    let dx = x - o.x, dy = y - o.y; const d = Math.hypot(dx, dy) || 1; best = pen; mx = dx / d; my = dy / d;
  }
  if (!best) return pts;
  // the same push for the whole ring; a second round for a corridor the first push ran into
  let q = pts.map(([x, y]) => [x + mx * best, y + my * best]);
  for (let it = 0; it < 3; it++) {
    let worst = 0, wx = 0, wy = 0;
    for (const [x, y] of q) { const pen = C.depth(x, y, o); if (pen > worst) { worst = pen; const d = Math.hypot(x - o.x, y - o.y) || 1; wx = (x - o.x) / d; wy = (y - o.y) / d; } }
    if (worst < 0.02) break;
    q = q.map(([x, y]) => [x + wx * worst, y + wy * worst]);
  }
  return q;
}
