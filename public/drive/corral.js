// The pedestrians' corral: where on each side of the route a person may stand, measured exactly from the buildings
// the player can see, and from the other roads that run along the pavement.
//
// Everything is route space (s along, d across, the crowd's d: + toward the buildings on that side). For every 0.5 m of the
// route and each side we keep [lo, hi]: lo is where the pavement starts (the old 2 m band's start, see crowd.js), hi is the
// farthest from the road a body may be: the first place whose distance to a wall (a wall's real 2D segment, not a sampled
// footprint test) is under CLEAR, measured along the d line analytically, so there is no scan step to overshoot a corner.
// Where another road's roadway (and its curb) lies across the band:
//   - for a short run along the route (a side street's mouth: people cross it straight, at the d they are on) the band is unchanged
//     and the column is flagged MOUTH (nobody stands or waits there);
//   - for a long run (a street that runs along the pavement) the cells are cut out of the band, and the longest free piece
//     (continuing the one before it) is what is left; none left = CLOSED.
// A column is also CLOSED where the pavement has no room for a body (the wall is closer than a body to the curb).
// The hero row (hand-built, not in the footprints) contributes the real wall slices of its meshes.
export const COL = 0.5;            // m between columns
export const CLEAR = 0.45;         // body centre to wall (the arms reach ~0.38 m)
export const F_CLOSED = 1, F_MOUTH = 2, F_CUT = 4, F_HERO = 8;
const CELL = 8, LAT = 0.25, MOUTH_MAX = 16, ROAD_MARGIN = 0.65, MIN_FROM_CURB = 0.55, HERO_STRIP = 0.9;

/** wall segments of the hand-built row: each mesh sliced at body height (0.4, 1.0 and 1.6 m above the ground), world plane x, y = -z */
export function heroSegments(root, ground0) {
  const out = [], v = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0 }));
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !/^HERO_/.test(o.name)) return;
    const P = o.geometry.attributes.position, I = o.geometry.index, n = I ? I.count : P.count, e = o.matrixWorld.elements;
    for (let k = 0; k < n; k += 3) {
      for (let q = 0; q < 3; q++) {
        const i = I ? I.getX(k + q) : k + q, x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        v[q].x = e[0] * x + e[4] * y + e[8] * z + e[12]; v[q].y = e[1] * x + e[5] * y + e[9] * z + e[13]; v[q].z = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      for (const h of [0.4, 1.0, 1.6]) {
        const Z = ground0 + h, pts = [];
        for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
          const za = v[a].y - Z, zb = v[b].y - Z;
          if (za * zb < 0) { const t = za / (za - zb); pts.push(v[a].x + (v[b].x - v[a].x) * t, -(v[a].z + (v[b].z - v[a].z) * t)); }
        }
        if (pts.length === 4 && Math.hypot(pts[0] - pts[2], pts[1] - pts[3]) > 0.02) out.push(pts[0], pts[1], pts[2], pts[3]);
      }
    }
  });
  return Float32Array.from(out);
}

/** the interval of d (along the line P + d*u) closer than r to segment A-B, or null */
function capsule(px, py, ux, uy, ax, ay, bx, by, r, out) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 2; k++) {
    const cx = k ? bx : ax, cy = k ? by : ay, ox = px - cx, oy = py - cy, b = ox * ux + oy * uy, c = ox * ox + oy * oy - r * r, D = b * b - c;
    if (D < 0) continue;
    const q = Math.sqrt(D); if (-b - q < lo) lo = -b - q; if (-b + q > hi) hi = -b + q;
  }
  let sx = bx - ax, sy = by - ay; const L = Math.hypot(sx, sy);
  if (L > 1e-9) {
    sx /= L; sy /= L; const vx = -sy, vy = sx;
    const a0 = (px - ax) * sx + (py - ay) * sy, a1 = ux * sx + uy * sy, p0 = (px - ax) * vx + (py - ay) * vy, p1 = ux * vx + uy * vy;
    let t0 = -Infinity, t1 = Infinity, ok = true;
    const slab = (c0, c1, m, M) => {
      if (Math.abs(c1) < 1e-9) { if (c0 < m || c0 > M) ok = false; return; }
      let a = (m - c0) / c1, b = (M - c0) / c1; if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
    };
    slab(a0, a1, 0, L); slab(p0, p1, -r, r);
    if (ok && t0 <= t1) { if (t0 < lo) lo = t0; if (t1 > hi) hi = t1; }
  }
  if (lo > hi) return false;
  out[0] = lo; out[1] = hi; return true;
}

/**
 * route: RouteFrame · old: the crowd's original 2 m bands {1: [lo[], hi[]], -1: ...} (lo is reused) · walls: Float32Array of
 * building wall segments (ax, ay, bx, by) · hero: Float32Array of the hand-built row's wall slices · roads: SegIndex of the
 * other roads (covering(x, y, skip, margin)) · spot: the parking space {s, d} (its stall is kept clear of the pavement strip in front of it)
 */
export function buildCorral({ route, old, walls, hero, roads, spot }) {
  const t0 = performance.now();
  const nBuild = walls.length / 4, seg = new Float32Array(walls.length + hero.length);
  seg.set(walls); seg.set(hero, walls.length);
  const nSeg = seg.length / 4;
  // grid of the segments near the route only (cells within a cell of it)
  const near = new Set(), ck = (x, y) => Math.floor(x / CELL) * 65536 + Math.floor(y / CELL);
  for (let i = 0; i <= route.length; i += 4) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) near.add(ck(route.X[Math.min(route.n - 1, i)] + a * CELL, route.Y[Math.min(route.n - 1, i)] + b * CELL));
  const grid = new Map();
  for (let i = 0; i < nSeg; i++) {
    const ax = seg[i * 4], ay = seg[i * 4 + 1], bx = seg[i * 4 + 2], by = seg[i * 4 + 3];
    for (let gx = Math.floor(Math.min(ax, bx) / CELL); gx <= Math.floor(Math.max(ax, bx) / CELL); gx++)
      for (let gy = Math.floor(Math.min(ay, by) / CELL); gy <= Math.floor(Math.max(ay, by) / CELL); gy++) {
        const k = gx * 65536 + gy; if (!near.has(k)) continue;
        let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i);
      }
  }
  // the other roads near the route, in a grid of their own (the road index's cells are 30 m and full of segments that are nowhere near)
  const rseg = [], rseen = new Set(), rgrid = new Map(), tRoads0 = performance.now();
  if (roads.g) for (let i = 0; i <= route.length; i += 16) {
    const x = route.X[Math.min(route.n - 1, i)], y = route.Y[Math.min(route.n - 1, i)];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const sg of roads.g.get(Math.floor(x / roads.cell) + a + ',' + (Math.floor(y / roads.cell) + b)) || []) {
      if (sg[5] === 'route' || rseen.has(sg)) continue; rseen.add(sg);
      const reach = sg[4] + ROAD_MARGIN + 0.1;
      rseg.push(sg);
      for (let gx = Math.floor((Math.min(sg[0], sg[2]) - reach) / CELL); gx <= Math.floor((Math.max(sg[0], sg[2]) + reach) / CELL); gx++)
        for (let gy = Math.floor((Math.min(sg[1], sg[3]) - reach) / CELL); gy <= Math.floor((Math.max(sg[1], sg[3]) + reach) / CELL); gy++) {
          const k = gx * 65536 + gy; if (!near.has(k)) continue;
          let l = rgrid.get(k); if (!l) rgrid.set(k, (l = [])); l.push(sg);
        }
    }
  }
  /** is (x, y) on another road's roadway or curb (+ a body's width)? */
  const onOtherRoad = (x, y) => {
    const l = rgrid.get(ck(x, y)); if (!l) return false;
    for (const [ax, ay, bx, by, hw] of l) {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < hw + ROAD_MARGIN) return true;
    }
    return false;
  };
  const tRoads = performance.now() - tRoads0;
  const N = Math.ceil(route.length / COL) + 1, KMAX = 26, out = {};
  const stamp = new Int32Array(nSeg), iv = [0, 0], cand = [];
  let stampId = 0;
  for (const side of [1, -1]) {
    const LO = new Float32Array(N), HI = new Float32Array(N), FL = new Uint8Array(N), HIW = new Float32Array(N), MN = new Float32Array(N);
    const covd = new Uint8Array(N * KMAX);   // per column, per lattice point d = dS + LAT*k: 0 free · 1 covered by another road · 2 not in the band
    const dS = new Float32Array(N), kLo = new Int16Array(N), kHi = new Int16Array(N);
    // 1) walls, per column
    for (let i = 0; i < N; i++) {
      const s = Math.min(i * COL, route.length), f = Math.min(route.n - 1.0001, s), j = f | 0, t = f - j;
      const x0 = route.X[j] + (route.X[j + 1] - route.X[j]) * t, y0 = route.Y[j] + (route.Y[j + 1] - route.Y[j]) * t;
      const a = route.A[j] + Math.atan2(Math.sin(route.A[j + 1] - route.A[j]), Math.cos(route.A[j + 1] - route.A[j])) * t;
      const ux = -Math.sin(a) * side, uy = Math.cos(a) * side, hw = route.hw(s);
      const dA = hw - 0.5, dMax = hw + 6;
      stampId++;
      let hiW = Infinity, hero_ = false;
      for (const dq of [dA, (dA + dMax) / 2, dMax]) {
        const l = grid.get(ck(x0 + ux * dq, y0 + uy * dq)); if (!l) continue;
        for (const si of l) {
          if (stamp[si] === stampId) continue; stamp[si] = stampId;
          if (!capsule(x0, y0, ux, uy, seg[si * 4], seg[si * 4 + 1], seg[si * 4 + 2], seg[si * 4 + 3], CLEAR, iv)) continue;
          if (iv[1] <= dA) continue;
          if (iv[0] < hiW) { hiW = iv[0]; hero_ = si >= nBuild; }
        }
      }
      HIW[i] = hiW;
      const lo2 = (() => { const q = Math.min(old[side][0].length - 1.0001, s / 2), k = q | 0; return old[side][0][k] + (old[side][0][k + 1] - old[side][0][k]) * (q - k); })();
      const ds = hw + MIN_FROM_CURB; dS[i] = ds;
      let hi = Math.min(hiW, hw + 4.65), lo = Math.max(ds, Math.min(lo2, hi)), fl = 0;
      if (hero_ && hiW < ds + 1e-3) {                         // the hand-built row: a facade right at the curb; the strip in front of it, on the road's edge, is the standing room
        fl |= F_HERO; hi = hiW; lo = Math.max(hw - 1.0, hi - HERO_STRIP);
        if (spot && Math.abs(s - spot.s) < 3.6) lo = Math.min(hi, Math.max(lo, hw + 0.04));   // the parking space's own length: keep clear of the car in the stall
      } else if (hi < ds) { fl |= F_CLOSED; lo = hi = ds; }
      LO[i] = lo; HI[i] = hi; FL[i] = fl;
      MN[i] = Math.min(hi, fl & F_HERO ? lo : hw + 0.05);   // the nearest to the road anyone may be at all: the curb's inner edge (the hero row: its strip on the road's edge)
      // 2) other roads' coverage of the cells of this column, on a fixed lattice of d (so a run along s can be followed)
      if (!(fl & F_CLOSED)) {
        const k0 = Math.max(0, Math.ceil((lo - ds - 1e-6) / LAT)), k1 = Math.min(KMAX - 1, Math.floor((hi - ds + 1e-6) / LAT));
        kLo[i] = k0; kHi[i] = k1;
        for (let k = 0; k < KMAX; k++) covd[i * KMAX + k] = 2;
        for (let k = k0; k <= k1; k++) {
          const d = ds + k * LAT;
          covd[i * KMAX + k] = onOtherRoad(x0 + ux * d, y0 + uy * d) ? 1 : 0;
        }
      } else { kLo[i] = 0; kHi[i] = -1; }
    }
    // 3) a covered cell is a mouth (passable, nobody stands) when the run of covered columns at its d is short, else it is blocked
    const MM = Math.round(MOUTH_MAX / COL);
    for (let k = 0; k < KMAX; k++) {
      let i = 0;
      while (i < N) {
        if (covd[i * KMAX + k] !== 1) { i++; continue; }
        let j = i; while (j < N && covd[j * KMAX + k] === 1) j++;
        const mouth = j - i <= MM || i === 0 || j === N;
        if (mouth) for (let q = i; q < j; q++) covd[q * KMAX + k] = 3;   // 3: covered but passable
        i = j;
      }
    }
    // 4) per column: the free run (continuing the previous one)
    let pl = NaN, ph = NaN, mouthN = 0, cutN = 0, closedN = 0;
    for (let i = 0; i < N; i++) {
      if (FL[i] & F_CLOSED) { closedN++; pl = NaN; continue; }
      const ds = dS[i], k0 = kLo[i], k1 = kHi[i];
      let anyMouth = false, anyBlocked = false;
      for (let k = k0; k <= k1; k++) { const c = covd[i * KMAX + k]; if (c === 3) anyMouth = true; else if (c === 1) anyBlocked = true; }
      if (anyMouth) { FL[i] |= F_MOUTH; mouthN++; }
      if (!anyBlocked) { pl = LO[i]; ph = HI[i]; continue; }
      FL[i] |= F_CUT; cutN++;
      cand.length = 0;
      for (let k = k0; k <= k1;) {
        if (covd[i * KMAX + k] === 1) { k++; continue; }
        let m = k; while (m + 1 <= k1 && covd[i * KMAX + m + 1] !== 1) m++;
        cand.push([k === k0 ? LO[i] : ds + k * LAT, m === k1 ? HI[i] : ds + m * LAT]);
        k = m + 1;
      }
      if (!cand.length) { FL[i] |= F_CLOSED; LO[i] = HI[i] = ds; MN[i] = Math.min(MN[i], ds); closedN++; pl = NaN; continue; }
      let best = cand[0], bs = -Infinity;
      for (const c of cand) {
        const overlap = Number.isNaN(pl) ? 0 : Math.max(0, Math.min(c[1], ph) - Math.max(c[0], pl)), score = overlap * 4 + (c[1] - c[0]);
        if (score > bs) { bs = score; best = c; }
      }
      LO[i] = best[0]; HI[i] = best[1]; MN[i] = Math.min(HI[i], Math.max(MN[i], best[0] - 0.0)); pl = best[0]; ph = best[1];
    }
    out[side] = { lo: LO, hi: HI, mn: MN, fl: FL, hiW: HIW, n: N, stats: { mouth: mouthN, cut: cutN, closed: closedN } };
  }
  out.n = N; out.ms = performance.now() - t0; out.segments = nSeg; out.roadSegs = rseg.length; out.msRoads = tRoads; out.onOtherRoad = onOtherRoad;
  return out;
}
