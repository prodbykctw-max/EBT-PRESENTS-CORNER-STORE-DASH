// Running anywhere on foot: the chase's collision world, the trail the bully follows and the controls' maths.
// (owner, Nov 2026: "I should be able to run through any and every part of the street outside and everything. I should only not be able to go in the buildings.")
//
// Everything here is plain numbers and arrays: no three.js, no DOM, and above all no Math.random and no three.js object (a Mesh, a Material or a
// Geometry draws uuids from Math.random, which the traffic and the crowd share: the street must come out the same with or without this file).
// drive.js builds one WalkWorld after the crowd exists and every on-foot step asks it. world plane: x east, y north (the frame of world.json).
import { LEVEL, deckTop } from './levels.js';

export const BODY = 0.42;           // radius of a person with his arms swinging (drive.js uses the same)
const CELL = 10, MARGIN = 1.0;      // the hash's cell, and how far past a thing's own bounds it is listed (so one cell lookup finds everything within MARGIN of a point)
const PCELL = 40;                   // building footprints, for the "inside a building" test
const cellKey = (gx, gy) => (gx + 16384) * 32768 + (gy + 16384);

// ------------------------------------------------------------------ the freeway as walls
// An elevated road is drawn with a jersey barrier on both edges (roads.js buildFreeway) and, where it is low, a solid slab underneath.
// So: the edges are walls wherever the deck's top is not clear overhead (up to HI above the ground: the slab's 1.3 m soffit leaves 2.2 m of
// headroom there), a wall goes across the road where it climbs past LO (a ramp's foot: from there on it is a slope up to a deck you would
// fall through) and across it again where it passes HI (the headroom under the ramp is gone below that), and across the end of a deck that
// stops in mid air. Past HI the deck is overhead and the street runs on under it, round the piers.
export const FREEWAY = { LO: 0.3, HI: 3.5, EDGE: 0.1, PIER_R: 0.62 };
const normalsOf = (p) => p.map((_, i) => {   // roads.js normals(): the left-hand unit normal at each sample
  const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
  let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1;
  return [-dy / L, dx / L];
});
/** pieces: the elevated roads of roads.js (buildStreets(...).freeway.pieces): { p: [[x, y, ground, h]...], width, lift }. Returns wall segments (ax, ay, bx, by)
 *  and pier circles (x, y, r), flat arrays. */
export function freewayColliders(pieces, ground) {
  const segs = [], circles = [];
  const seg = (ax, ay, bx, by) => { if (Math.hypot(bx - ax, by - ay) > 0.02) segs.push(ax, ay, bx, by); };
  for (const r of pieces) {
    const p = r.p, hw = r.width / 2, n = normalsOf(p), E = hw + FREEWAY.EDGE;
    // how far the deck's top stands above the ground under it (the same rule the deck mesh is drawn by)
    const up = p.map((q) => deckTop(ground, q[0], q[1], q[3]) + r.lift - (ground(q[0], q[1]) + LEVEL.TERRAIN));
    const cls = up.map((u) => (u < FREEWAY.LO ? 0 : u <= FREEWAY.HI ? 1 : 2));
    // a wall straight across the road at a sample (t = 0) or part of the way along the stretch from sample i to i + 1
    const cap = (i, t = 0) => {
      const j = Math.min(p.length - 1, i + 1), x = p[i][0] + (p[j][0] - p[i][0]) * t, y = p[i][1] + (p[j][1] - p[i][1]) * t;
      let nx = n[i][0] + (n[j][0] - n[i][0]) * t, ny = n[i][1] + (n[j][1] - n[i][1]) * t; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      seg(x + nx * E, y + ny * E, x - nx * E, y - ny * E);
    };
    const at = (i, T) => (T - up[i]) / (up[i + 1] - up[i]);   // where along the stretch from sample i to i + 1 the deck's height passes T
    let run = 0, nextPier = 12;
    for (let i = 0; i < p.length; i++) {
      if (i) run += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (i + 1 >= p.length) { if (cls[i] === 1) cap(i); continue; }   // a deck that ends with its slab still low: closed
      if (i === 0 && cls[0] === 1) cap(0);
      const A = p[i], B = p[i + 1];
      if (cls[i] <= 1 || cls[i + 1] <= 1) {                              // low somewhere on this stretch: the barrier is a wall on both sides
        for (const side of [1, -1]) seg(A[0] + n[i][0] * E * side, A[1] + n[i][1] * E * side, B[0] + n[i + 1][0] * E * side, B[1] + n[i + 1][1] * E * side);
      }
      if (cls[i] !== cls[i + 1]) {                                      // across the road at the very place its height passes LO (the foot of the ramp) and HI (the headroom goes)
        const lo = Math.min(cls[i], cls[i + 1]), hi = Math.max(cls[i], cls[i + 1]);
        if (lo === 0) cap(i, Math.min(1, Math.max(0, at(i, FREEWAY.LO))));
        if (hi === 2) cap(i, Math.min(1, Math.max(0, at(i, FREEWAY.HI))));
      }
      // pier bents (same placement as roads.js): two round columns, or one in the middle of a narrow deck
      if (A[3] > 3 && run >= nextPier) {
        nextPier = run + 26;
        for (const o of hw > 5 ? [-(hw - 1.6), hw - 1.6] : [0]) circles.push(A[0] + n[i][0] * o, A[1] + n[i][1] * o, FREEWAY.PIER_R);
      }
    }
  }
  return { segs: Float64Array.from(segs), circles: Float64Array.from(circles) };
}

// ------------------------------------------------------------------ the collision world
function closestOnSeg(ax, ay, bx, by, px, py, out) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  out.x = ax + dx * t; out.y = ay + dy * t; return t;
}
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * walls: Float32Array/Float64Array (ax, ay, bx, by) of the buildings' footprint edges · hero: the same for the hand-built row · extra: more of the same (the freeway)
 * circles: flat (x, y, r) of everything that stands (trees, lamps, poles, benches, bins, hydrants, shelters, piers) · footprints: rings of [x, y]
 * bounds: { x0, x1, y0, y1 } the edge of the map you cannot run past
 */
export function buildWalkWorld({ walls = [], hero = [], extra = [], circles = [], footprints = [], bounds = null }) {
  // --- segments (the hero row is sliced at three heights, so the same edge comes up more than once: kept once)
  const seg = [], seen = new Set();
  const add = (arr) => {
    for (let i = 0; i + 3 < arr.length; i += 4) {
      let ax = arr[i], ay = arr[i + 1], bx = arr[i + 2], by = arr[i + 3];
      if (!(Math.hypot(bx - ax, by - ay) > 1e-3)) continue;
      if (ax > bx || (ax === bx && ay > by)) { let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; }
      const k = Math.round(ax * 50) + '|' + Math.round(ay * 50) + '|' + Math.round(bx * 50) + '|' + Math.round(by * 50);
      if (seen.has(k)) continue; seen.add(k); seg.push(ax, ay, bx, by);
    }
  };
  add(walls); add(hero); add(extra);
  const S = Float64Array.from(seg), nSeg = S.length / 4;
  const grid = new Map();
  const put = (g, k, v) => { let l = g.get(k); if (!l) g.set(k, (l = [])); l.push(v); };
  for (let i = 0; i < nSeg; i++) {
    const ax = S[i * 4], ay = S[i * 4 + 1], bx = S[i * 4 + 2], by = S[i * 4 + 3];
    for (let gx = Math.floor((Math.min(ax, bx) - MARGIN) / CELL); gx <= Math.floor((Math.max(ax, bx) + MARGIN) / CELL); gx++)
      for (let gy = Math.floor((Math.min(ay, by) - MARGIN) / CELL); gy <= Math.floor((Math.max(ay, by) + MARGIN) / CELL); gy++) put(grid, cellKey(gx, gy), i);
  }
  const C = Float64Array.from(circles), nCir = C.length / 3, cgrid = new Map();
  for (let i = 0; i < nCir; i++) {
    const x = C[i * 3], y = C[i * 3 + 1], r = C[i * 3 + 2] + MARGIN;
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++) for (let gy = Math.floor((y - r) / CELL); gy <= Math.floor((y + r) / CELL); gy++) put(cgrid, cellKey(gx, gy), i);
  }
  const pgrid = new Map(), rings = footprints;
  rings.forEach((ring, i) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let gx = Math.floor(x0 / PCELL); gx <= Math.floor(x1 / PCELL); gx++) for (let gy = Math.floor(y0 / PCELL); gy <= Math.floor(y1 / PCELL); gy++) put(pgrid, cellKey(gx, gy), i);
  });
  const none = [], tmp = { x: 0, y: 0 }, stamp = new Int32Array(nSeg); let stampN = 0;

  const world = {
    nSeg, nCir, nRing: rings.length, segs: S, circles: C, bounds,
    cellSegs: (x, y) => grid.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) || none,
    cellCircles: (x, y) => cgrid.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) || none,
    /** inside a building footprint? */
    inFootprint(x, y) {
      for (const i of pgrid.get(cellKey(Math.floor(x / PCELL), Math.floor(y / PCELL))) || none) if (inRing(x, y, rings[i])) return true;
      return false;
    },
    /** how far a body of radius r at (x, y) sticks into a wall or a post (0 when clear), and inside a footprint counts as a full body in */
    depth(x, y, r = BODY) {
      let worst = 0;
      for (const i of this.cellSegs(x, y)) {
        closestOnSeg(S[i * 4], S[i * 4 + 1], S[i * 4 + 2], S[i * 4 + 3], x, y, tmp);
        const d = Math.hypot(x - tmp.x, y - tmp.y); if (r - d > worst) worst = r - d;
      }
      for (const i of this.cellCircles(x, y)) {
        const d = Math.hypot(x - C[i * 3], y - C[i * 3 + 1]) - C[i * 3 + 2]; if (r - d > worst) worst = r - d;
      }
      if (this.inFootprint(x, y)) worst = Math.max(worst, r);
      return worst;
    },
    /** is a body of radius r at (x, y) touching anything solid */
    solid(x, y, r = BODY) { return this.depth(x, y, r) > 1e-6; },
    /** Push the body m ({x, y}) out of walls, posts and the edge of the map, sliding along them: up to 3 passes (a corner needs two walls). Contact normals go into `ns`
     *  (nx, ny pairs, if given) so the caller can take the speed out of what it ran into. `prev` ({x, y}, the last clear spot) tells which side of a wall a body that landed exactly on it came from.
     *  If it is still inside something afterwards, it goes back to `prev`. Returns the number of contacts (or -1 if it had to go back). */
    resolve(m, r = BODY, ns = null, prev = null) {
      let n = 0;
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (const i of this.cellSegs(m.x, m.y)) {
          const ax = S[i * 4], ay = S[i * 4 + 1], bx = S[i * 4 + 2], by = S[i * 4 + 3];
          closestOnSeg(ax, ay, bx, by, m.x, m.y, tmp);
          let dx = m.x - tmp.x, dy = m.y - tmp.y; const d = Math.hypot(dx, dy);
          if (d >= r) continue;
          if (d > 1e-7) { dx /= d; dy /= d; }
          else {   // dead on the wall: the side it came from, else either
            const sx = bx - ax, sy = by - ay, L = Math.hypot(sx, sy) || 1; dx = -sy / L; dy = sx / L;
            if (prev && (prev.x - tmp.x) * dx + (prev.y - tmp.y) * dy < 0) { dx = -dx; dy = -dy; }
          }
          m.x = tmp.x + dx * (r + 1e-4); m.y = tmp.y + dy * (r + 1e-4); moved = true; n++;
          if (ns) ns.push(dx, dy);
        }
        for (const i of this.cellCircles(m.x, m.y)) {
          const cx = C[i * 3], cy = C[i * 3 + 1], R = C[i * 3 + 2] + r;
          let dx = m.x - cx, dy = m.y - cy; const d = Math.hypot(dx, dy);
          if (d >= R) continue;
          if (d > 1e-7) { dx /= d; dy /= d; } else { dx = 1; dy = 0; }
          m.x = cx + dx * (R + 1e-4); m.y = cy + dy * (R + 1e-4); moved = true; n++;
          if (ns) ns.push(dx, dy);
        }
        if (!moved) break;
      }
      if (bounds) {
        if (m.x < bounds.x0) { m.x = bounds.x0; if (ns) ns.push(1, 0); n++; } else if (m.x > bounds.x1) { m.x = bounds.x1; if (ns) ns.push(-1, 0); n++; }
        if (m.y < bounds.y0) { m.y = bounds.y0; if (ns) ns.push(0, 1); n++; } else if (m.y > bounds.y1) { m.y = bounds.y1; if (ns) ns.push(0, -1); n++; }
      }
      // still in something (an acute corner the three passes did not settle, or a footprint with no wall in reach): back to the last clear spot
      if (this.depth(m.x, m.y, r) > 0.01 || this.inFootprint(m.x, m.y)) {
        if (prev) { m.x = prev.x; m.y = prev.y; return -1; }
      }
      return n;
    },
    /** can a body of radius r go in a straight line from a to b without touching anything */
    clearLine(ax, ay, bx, by, r = BODY) {
      const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 0.5));
      for (let k = 0; k <= n; k++) { const t = k / n; if (this.solid(ax + (bx - ax) * t, ay + (by - ay) * t, r)) return false; }
      return true;
    },
    /** distance along the ray (x, y) + t (dx, dy) (unit) to the first wall, or Infinity if none within maxT. (The chase camera pulls in at walls.) */
    rayHit(x, y, dx, dy, maxT) {
      let best = Infinity; stampN++;
      const steps = Math.ceil(maxT / 3);
      for (let k = 0; k <= steps; k++) {
        const t = Math.min(maxT, k * 3);
        for (const i of this.cellSegs(x + dx * t, y + dy * t)) {
          if (stamp[i] === stampN) continue; stamp[i] = stampN;
          const ax = S[i * 4], ay = S[i * 4 + 1], ex = S[i * 4 + 2] - ax, ey = S[i * 4 + 3] - ay, den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-9) continue;
          const tt = ((ax - x) * ey - (ay - y) * ex) / den, u = ((ax - x) * dy - (ay - y) * dx) / den;
          if (tt >= 0 && tt <= maxT && u >= 0 && u <= 1 && tt < best) best = tt;
        }
      }
      return best;
    },
  };
  return world;
}

// ------------------------------------------------------------------ the trail
/** Where you have been, one crumb every 0.5 m (a ring of the last `cap`). The bully runs your trail: when he cannot see you he aims at the newest crumb he can. */
const AIM_CHECKS = 60;
export class Trail {
  constructor(cap = 800) { this.cap = cap; this.x = new Float32Array(cap); this.y = new Float32Array(cap); this.n = 0; this.last = null; this.reached = 0; }
  push(x, y, step = 0.5) {
    if (this.last && Math.hypot(x - this.last.x, y - this.last.y) < step) return false;
    const i = this.n % this.cap; this.x[i] = x; this.y[i] = y; this.n++; this.last = { x, y }; return true;
  }
  has(id) { return id >= Math.max(0, this.n - this.cap) && id < this.n; }
  px(id) { return this.x[id % this.cap]; }
  py(id) { return this.y[id % this.cap]; }
  /** the newest crumb a body at (x, y) has a clear line to, no older than the last one he reached; -1 if none */
  aim(world, x, y, r = BODY, stride = 2) {
    const lo = Math.max(this.reached, this.n - this.cap);
    let left = AIM_CHECKS;   // (at most this many lines are tested, newest first: 60 of them reach 60 m back at 2 crumbs a step; the cost is per call on a phone)
    for (let id = this.n - 1; id >= lo && left-- > 0; id -= stride) if (world.clearLine(x, y, this.px(id), this.py(id), r)) return id;
    return -1;
  }
}

// ------------------------------------------------------------------ the controls
export const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));   // a - b, wrapped to -PI..PI

/** The drag (x screen-right, y screen-down, length at most 1) as a velocity in the world plane, for a camera looking along `yaw`:
 *  up the screen is away from the camera, the length of the drag is the speed. */
export function wishVelocity(sx, sy, yaw, run, out = { x: 0, y: 0 }) {
  const m = Math.hypot(sx, sy), k = m > 1 ? 1 / m : 1, up = -sy * k, right = sx * k, c = Math.cos(yaw), s = Math.sin(yaw);
  out.x = (c * up + s * right) * run; out.y = (s * up - c * right) * run;   // forward = (cos, sin); the right hand is (sin, -cos)
  return out;
}

/** The camera swings in behind the runner only as much as the thumb pushes UP and as fast as he runs (so up-left and up-right curve, like a car in GTA);
 *  straight left or right runs across the screen without the view orbiting; straight down runs at the camera. Returns the new camera yaw. */
export const CAMYAW = { rate: 1.5, ease: 0.4 };   // rad/s at full push and full speed; radians off straight at which the swing reaches that rate
export function camYawStep(yaw, heading, sx, sy, speedFrac, dt) {
  const fwd = Math.max(0, -sy), delta = angDiff(heading, yaw);
  const rate = CAMYAW.rate * Math.min(1, fwd) * Math.min(1, Math.max(0, speedFrac)) * Math.min(1, Math.abs(delta) / CAMYAW.ease);
  return yaw + Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
}

// ------------------------------------------------------------------ moving a person
/** A mover is { x, y, vx, vy, kvx, kvy (a knock that fades), good ({x, y}: the last spot that was clear) }. One fixed step of its motion. */
export const KNOCK_FADE = 4;   // 1/s: a knock's speed dies away as exp(-KNOCK_FADE t)
export function integrate(m, dt) {
  m.x += (m.vx + m.kvx) * dt; m.y += (m.vy + m.kvy) * dt;
  const k = Math.exp(-dt * KNOCK_FADE); m.kvx *= k; m.kvy *= k;
}
/** Speed eases toward the wish (wx, wy) with time constant tau and at most aMax m/s² (a vector, so a turn is as quick as a start or a stop).
 *  Returns the acceleration along the way he is facing (the lean). */
export function approach(m, wx, wy, tau, aMax, dt, heading = 0) {
  let ax = (wx - m.vx) / tau, ay = (wy - m.vy) / tau; const a = Math.hypot(ax, ay);
  if (a > aMax) { ax *= aMax / a; ay *= aMax / a; }
  m.vx += ax * dt; m.vy += ay * dt;
  return ax * Math.cos(heading) + ay * Math.sin(heading);
}
const NS = [];
export const killInto = (m, nx, ny) => {   // the speed into a wall (nx, ny point out of it) is lost; the speed along it stays
  let vn = m.vx * nx + m.vy * ny; if (vn < 0) { m.vx -= vn * nx; m.vy -= vn * ny; }
  vn = m.kvx * nx + m.kvy * ny; if (vn < 0) { m.kvx -= vn * nx; m.kvy -= vn * ny; }
};
/** Last of a step, after the cars and the people: out of every wall and post (they always win), sliding along them. Returns the number of contacts. */
export function wallPass(world, m, r = BODY) {
  NS.length = 0;
  const g = m.good || (m.good = { x: m.x, y: m.y });
  const n = world.resolve(m, r, NS, g);
  if (n < 0) { m.vx = m.vy = m.kvx = m.kvy = 0; return n; }
  for (let k = 0; k < NS.length; k += 2) killInto(m, NS[k], NS[k + 1]);
  if (world.depth(m.x, m.y, r) <= 0.01 && !world.inFootprint(m.x, m.y)) { g.x = m.x; g.y = m.y; }
  return n;
}

// ------------------------------------------------------------------ the bully
/** Where he is running to: you, if he can see you (a clear line for his body), else the newest crumb of your trail he can see. st = { t, tx, ty, sees }. */
export function chaseTarget(world, trail, him, me, st, dt) {
  st.t = (st.t ?? 0) - dt;
  if (st.t <= 0 || st.tx === undefined) {   // looks again ten times a second, not every step
    st.t = 0.1;
    trail.reached = Math.max(trail.reached, trail.n - trail.cap);   // (the ring overwrites its oldest crumbs: never point at one that is gone)
    // crumbs he has run through: on to just past the newest one within 0.9 m of him among the next 60 (the next crumb alone could be out of reach for good after a cut corner)
    for (let id = Math.min(trail.n - 1, trail.reached + 59); id >= trail.reached; id--) if (Math.hypot(him.x - trail.px(id), him.y - trail.py(id)) < 0.9) { trail.reached = id + 1; break; }
    st.sees = world.clearLine(him.x, him.y, me.x, me.y, BODY);
    if (st.sees) {   // running straight at you: the crumbs he is nearest to are the ones he has passed, so a corner he cuts does not leave the old ones to be run back to
      let best = trail.reached, bd = 1e9;
      for (let id = trail.reached, e = Math.min(trail.n, trail.reached + 120); id < e; id += 2) { const q = Math.hypot(him.x - trail.px(id), him.y - trail.py(id)); if (q < bd) { bd = q; best = id; } }
      if (bd < 3) trail.reached = best;
    }
    if (!st.sees) {
      let id = trail.aim(world, him.x, him.y, BODY, 2);
      if (id < 0) id = Math.max(trail.reached, trail.n - trail.cap);   // no crumb in view: the oldest he has not reached
      if (id >= trail.n) id = trail.n - 1;
      if (id >= 0 && trail.has(id)) { st.tx = trail.px(id); st.ty = trail.py(id); } else st.sees = true;
    }
  }
  if (st.sees) { st.tx = me.x; st.ty = me.y; }
  return st;
}

// ------------------------------------------------------------------ putting the world together (drive.js and the node test build it the same way)
// street furniture at body height (radius of the actual models between knee and shoulder, measured off the meshes; the crowd's own radii are bigger, they keep a polite distance):
// tree trunks 0.24 m x the tree's scale, poles ~0.2
export const PROP_R = { tree_round: 0.24, tree_upright: 0.17, lamp: 0.2, signal: 0.17, bench: 0.9, bin: 0.33, hydrant: 0.21, shelter: 1.8 };
/** furniture: city.furniture ({ type: [[x, y, yaw, color, scale]...] }), with the streetcar platforms' shelters ([x, y]) added to `shelter` by the caller */
export function furnitureCircles(furniture) {
  const out = [];
  for (const [type, list] of Object.entries(furniture)) {
    const r = PROP_R[type]; if (!r) continue;
    for (const it of list) out.push(it[0], it[1], r * (it[4] || 1));
  }
  return out;
}
/** The one collision world: the buildings (their edges and footprints), the hand-built row, the freeway's barriers and piers, every post and tree, and the edge of the map.
 *  city: buildCity()'s result · heroWalls: heroSegments() · shelters: [[x, y]] streetcar platforms · W: world.json */
export function walkWorldFor({ city, heroWalls, shelters = [], W }) {
  const fw = freewayColliders(city.freeway.pieces || [], city.ground);
  const furniture = { ...city.furniture, shelter: [...(city.furniture.shelter || []), ...shelters] };
  const E = W.elevation, PAD = 150;   // 150 m of (flat, empty) ground past the data's edge to run on...
  // ...but never past what is drawn: the terrain mesh covers the elevation grid plus makeGround's PAD (400 m) all round (city.ground.grid), and the edge stays 10 m inside that
  const G = city.ground.grid, inset = 10;
  const gx0 = G.x0 + inset, gx1 = G.x0 + G.nx * G.step - inset, gy0 = G.y0 + inset, gy1 = G.y0 + G.ny * G.step - inset;
  return buildWalkWorld({
    walls: city.walls, hero: heroWalls, extra: fw.segs, footprints: city.footprints,
    circles: [...furnitureCircles(furniture), ...fw.circles],
    bounds: { x0: Math.max(gx0, E.x0 - PAD), x1: Math.min(gx1, E.x0 + (E.gx - 1) * E.step + PAD), y0: Math.max(gy0, E.y0 - PAD), y1: Math.min(gy1, E.y0 + (E.gy - 1) * E.step + PAD) },
  });
}
