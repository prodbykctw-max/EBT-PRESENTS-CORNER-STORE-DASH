// Runner mode ("Temple Run with cars"): the car auto-drives the route; the player only chooses where
// across the road to be. Everything gameplay-relevant lives in ROUTE SPACE: s = metres along the route,
// d = metres left(+)/right(-) of the centre line. That makes lanes, dodging and collision trivial and exact.
import * as THREE from './vendor/three.module.min.js';
import { LEVEL, standOn, deckTop } from './levels.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ---------------------------------------------------------------- route frame
export class RouteFrame {
  constructor(W, ground, extendTo) {
    // resample the Dijkstra route every 1 m, extended past the parking space
    const src = W.route.pts.map((p) => [p[0], p[1]]);
    if (extendTo) {
      const [ax, ay] = src[src.length - 2], [bx, by] = src[src.length - 1];
      const L = Math.hypot(bx - ax, by - ay); src.push([bx + (bx - ax) / L * extendTo, by + (by - ay) / L * extendTo]);
    }
    const X = [], Y = [];
    for (let i = 0; i + 1 < src.length; i++) {
      const [ax, ay] = src[i], [bx, by] = src[i + 1], L = Math.hypot(bx - ax, by - ay);
      for (let t = 0; t < L; t += 1) { X.push(ax + (bx - ax) * t / L); Y.push(ay + (by - ay) * t / L); }
    }
    X.push(src.at(-1)[0]); Y.push(src.at(-1)[1]);
    // OSM junctions leave little jogs in the polyline; smooth it into a road you'd actually drive
    // (two moving-average passes over ±9 m, ends pinned), so the road ribbon and the car follow real curves
    for (let pass = 0; pass < 2; pass++) {
      const sx = X.slice(), sy = Y.slice(), R = 9;
      for (let i = R; i < X.length - R; i++) {
        let ax = 0, ay = 0; for (let k = -R; k <= R; k++) { ax += sx[i + k]; ay += sy[i + k]; }
        X[i] = ax / (2 * R + 1); Y[i] = ay / (2 * R + 1);
      }
    }
    this.n = X.length; this.length = this.n - 1; this.X = X; this.Y = Y;
    // smoothed tangent (±8 m) so the camera and the car never snap at OSM vertices
    this.A = X.map((_, i) => {
      const a = Math.max(0, i - 8), b = Math.min(this.n - 1, i + 8);
      return Math.atan2(Y[b] - Y[a], X[b] - X[a]);
    });
    this.Z = X.map((x, i) => ground(x, Y[i]));
    this.ground = ground;
    // road half-width and one-way flag from the nearest OSM road at each metre
    const segs = [];
    for (const r of W.roads) if (!r.bridge) for (let i = 0; i + 1 < r.pts.length; i++) segs.push([r.pts[i], r.pts[i + 1], r]);
    const raw = X.map((x, i) => {
      let best = null, bd = 1e9;
      for (const [a, b, r] of segs) {
        if (Math.min(a[0], b[0]) > x + 20 || Math.max(a[0], b[0]) < x - 20 || Math.min(a[1], b[1]) > Y[i] + 20 || Math.max(a[1], b[1]) < Y[i] - 20) continue;
        const d = distSeg(x, Y[i], a[0], a[1], b[0], b[1]);
        if (d < bd && !/footway|path|service/.test(r.cls)) { bd = d; best = r; }
      }
      return best ? [Math.max(7, best.width) / 2, !!best.oneway] : [4.5, false];
    });
    // average the real width over ±15 m: follows the street without "breathing" under the car
    this.HW = raw.map((_, i) => { let a = 0, c = 0; for (let k = Math.max(0, i - 15); k <= Math.min(this.n - 1, i + 15); k++) { a += raw[k][0]; c++; } return a / c; });
    this.ONEWAY = raw.map((r) => r[1]);
    // spatial grid of samples for distance-to-route queries (ambient traffic stops at the route)
    this.grid = new Map();
    for (let i = 0; i < this.n; i += 3) { const k = gkey(X[i], Y[i]); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(i); }
  }
  i(s) { return Math.max(0, Math.min(this.n - 1, s)); }
  /** world (x, y, z, heading) for route coords */
  at(s, d = 0) {
    const f = this.i(s), i = Math.min(this.n - 2, f | 0), t = f - i;
    const x = this.X[i] + (this.X[i + 1] - this.X[i]) * t, y = this.Y[i] + (this.Y[i + 1] - this.Y[i]) * t;
    const a = lerpAngle(this.A[i], this.A[i + 1], t);
    const wx = x - Math.sin(a) * d, wy = y + Math.cos(a) * d;
    return { x: wx, y: wy, z: this.ground(wx, wy), a };
  }
  hw(s) { return this.HW[Math.round(this.i(s))]; }
  hwAt(x, y) { return this.hw(this.project(x, y).s); }
  /** centre of lane k (0 = right/your lane, 1 = left) — the road is always laid out as two lanes */
  lane(s, k) { const hw = this.hw(s); return k === 0 ? -hw / 2 : hw / 2; }
  oneway(s) { return this.ONEWAY[Math.round(this.i(s))]; }
  /** project a world point to route space (nearest sample) */
  project(x, y) {
    let bi = 0, bd = 1e9;
    for (let i = 0; i < this.n; i += 2) { const d = (this.X[i] - x) ** 2 + (this.Y[i] - y) ** 2; if (d < bd) { bd = d; bi = i; } }
    const a = this.A[bi];
    return { s: bi, d: -(x - this.X[bi]) * Math.sin(a) + (y - this.Y[bi]) * Math.cos(a) };
  }
  distTo(x, y) {
    let bd = 1e9; const gx = Math.floor(x / 20), gy = Math.floor(y / 20);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of this.grid.get((gx + a) + ',' + (gy + b)) || []) bd = Math.min(bd, Math.hypot(this.X[i] - x, this.Y[i] - y));
    return bd;
  }
}
const gkey = (x, y) => Math.floor(x / 20) + ',' + Math.floor(y / 20);
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// ---------------------------------------------------------------- the player's car
export const PLAYER = { halfL: 2.5, halfW: 0.98 };
export class RunnerCar {
  constructor(route, s0) {
    Object.assign(this, { route, s: s0, d: -route.hw(s0) / 2, v: 0, dv: 0, targetD: -route.hw(s0) / 2, stun: 0, invuln: 0 });
  }
  /** tight + snappy: the lateral position is a stiff critically-damped spring on the finger/keys */
  step(dt, { targetD, brake, cruise, stopAt }) {
    const hw = this.route.hw(this.s), lim = hw - PLAYER.halfW - 0.05;
    this.targetD = Math.max(-lim, Math.min(lim, targetD));
    const w = 16; // spring stiffness (rad/s): ~0.2 s to settle, no overshoot
    const acc = w * w * (this.targetD - this.d) - 2 * w * this.dv;
    this.dv += acc * dt; this.dv = Math.max(-18, Math.min(18, this.dv));
    this.d += this.dv * dt; this.d = Math.max(-lim, Math.min(lim, this.d));

    // speed: cruise ramps up; corners, brake, stun and the parking stop pull it down
    let vt = cruise * cornerFactor(this.route, this.s, this.v);
    if (brake) vt = 0;                       // BRAKE stops you dead and holds you there
    if (this.stun > 0) { vt = Math.min(vt, 6); this.stun -= dt; }
    if (stopAt !== undefined) vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 3.4 * (stopAt - this.s))));
    const a = vt > this.v ? 6.5 : (brake ? 16 : 9);
    this.v += Math.sign(vt - this.v) * Math.min(Math.abs(vt - this.v), a * dt);
    this.s += this.v * dt;
    this.invuln = Math.max(0, this.invuln - dt);
  }
  get pose() {
    const p = this.route.at(this.s, this.d);
    p.a += Math.atan2(this.dv, Math.max(this.v, 4)) * 0.9; // nose into the dodge
    return p;
  }
}
function cornerFactor(route, s, v) {
  // look ahead proportional to speed; slow for the Luckie → Auburn bend like a real driver would
  const ahead = 20 + v * 1.2; let maxTurn = 0;
  const a0 = route.at(s).a;
  for (let k = 8; k < ahead; k += 8) maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(route.at(s + k).a - a0), Math.cos(route.at(s + k).a - a0))));
  return maxTurn > 1.0 ? 0.45 : maxTurn > 0.55 ? 0.7 : 1;
}

// ---------------------------------------------------------------- world population
const TYPES = {
  sedan: { L: 4.5, W: 1.8, solid: 1 }, suv: { L: 4.75, W: 1.95, solid: 1 },
  cone: { L: 0.45, W: 0.45, solid: 0.35 }, barricade: { L: 0.6, W: 1.8, solid: 0.7 },
  panhandler: { L: 0.7, W: 0.7, solid: 0.6 },
  // scenery (never collides)
  bus: { L: 12, W: 2.55, solid: 0 }, worksign: { L: 1, W: 1, solid: 0 }, walker: { L: 0.5, W: 0.5, solid: 0 },
  stander: { L: 0.5, W: 0.5, solid: 0 }, cyclist: { L: 1.8, W: 0.6, solid: 0 },
};
// half wheelbase / half track used to seat each vehicle on the road
const VEHICLE = { sedan: [1.35, 0.8], suv: [1.42, 0.86], bus: [3.6, 1.15] };
const PAINT = [0xb8bcc2, 0x1d1f24, 0xe9e9e6, 0x7a1a1a, 0x1f3c78, 0x5a5f66, 0x24542f, 0xc4a44a, 0x8a8f96, 0x2b2b30];
const SHIRTS = [0xd94f3d, 0x3b6fb6, 0xf0c33c, 0x2e2e2e, 0xe8e8e8, 0x3d9a5b, 0x8e44ad, 0xff8c1a, 0x1abc9c, 0x7f8c8d];
const BUS_STRIPE = [0x1d5fbf, 0xc62828];

export class World {
  constructor({ route, props, scene, W, sEnd, audio, surfAt }) {
    Object.assign(this, { route, scene, W, sEnd, audio, surfAt });
    this.ents = []; this.tokens = [];
    this.meshes = {};
    const mat = propMaterial();
    const CAP = { sedan: 40, suv: 30, cone: 120, barricade: 16, panhandler: 6, bus: 8, worksign: 10, walker: 70, stander: 30, cyclist: 8 };
    const GEO = { sedan: 'prop_sedan', suv: 'prop_suv', cone: 'prop_cone', barricade: 'prop_barricade', panhandler: 'prop_panhandler',
      bus: 'prop_bus', worksign: 'prop_worksign', walker: 'prop_person_walk', stander: 'prop_person_stand', cyclist: 'prop_cyclist' };
    for (const [t, cap] of Object.entries(CAP)) {
      const im = new THREE.InstancedMesh(bakedGeometry(props, GEO[t]), mat, cap);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      im.castShadow = true; im.receiveShadow = true; im.count = 0; im.frustumCulled = false; im.name = 'inst_' + t;
      this.meshes[t] = im; scene.add(im);
    }
    // EBT tokens: gold discs with an emissive rim, spinning
    const tg = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 20); tg.rotateX(Math.PI / 2);
    this.tokenMesh = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0xffc81a, metalness: 0.85, roughness: 0.25, emissive: 0x6b4a00, emissiveIntensity: 0.6 }), 260);
    this.tokenMesh.count = 0; this.tokenMesh.frustumCulled = false; scene.add(this.tokenMesh);
    this.nextOncoming = 2; this.ambient = [];
    this.plan();
  }

  add(type, props) { const e = { type, ...TYPES[type], v: 0, dv: 0, yaw: 0, alive: true, color: 0xffffff, ...props }; this.ents.push(e); return e; }

  /** Lay out the run: an event every 30-50 m (denser as you go), always leaving one lane open. */
  plan() {
    const r = this.route, sStop = this.sEnd;
    let s = 70, k = 0;
    while (s < sStop - 95) {
      const hw = r.hw(s), right = r.lane(s, 0), left = r.lane(s, 1), two = !r.oneway(s);
      const ev = pickWeighted([['slow', 2], ['parked', 2], ['construction', 1], ['panhandler', 0.8], ['tokens', 3]]);
      if (ev === 'slow') this.add(pick(['sedan', 'suv', 'sedan']), { s, d: right, v: rnd(9, 13), color: pick(PAINT), dir: 1 });
      if (ev === 'parked') {
        const n = Math.random() < 0.25 ? 2 : 1;
        for (let q = 0; q < n; q++) this.add(pick(['sedan', 'suv']), { s: s + q * 6.5, d: right - 0.35, color: pick(PAINT), dir: 1, parked: true });
        if (!two && Math.random() < 0.5) this.add('sedan', { s: s + 30, d: left + 0.35, color: pick(PAINT), dir: 1, parked: true });
      }
      if (ev === 'construction') {
        // taper the cones from the right curb to the centre line, then run them for 22 m; barricade at the head
        this.add('worksign', { s: s - 38, d: -(hw + 1.6), yawOff: Math.PI });
        // taper from the right edge line to the lane line, then cones along the lane line: the right lane is closed
        const edge = -hw + 0.35, line = (right + left) / 2 - 0.25;
        for (let q = 0; q <= 5; q++) this.add('cone', { s: s + q * 2.4, d: edge + q / 5 * (line - edge) });
        for (let q = 1; q <= 8; q++) this.add('cone', { s: s + 12 + q * 2.8, d: line });
        this.add('barricade', { s: s + 4, d: right, yawOff: Math.PI });
        s += 30;
      }
      if (ev === 'panhandler') this.add('panhandler', { s, d: (right + left) / 2, home: (right + left) / 2, color: pick(SHIRTS), dir: -1, sway: rnd(0, 6) }); // works the lane line
      if (ev === 'tokens') {
        const lane = Math.random() < 0.5 ? right : left, weave = Math.random() < 0.4;
        for (let q = 0; q < 8; q++) this.tokens.push({ s: s + q * 4, d: weave ? Math.sin(q / 7 * Math.PI) * (left - right) / 2 * (lane > 0 ? -1 : 1) + lane : lane, alive: true });
      }
      s += rnd(58, 85) * (1 - Math.min(0.25, k * 0.015)); k++;
    }
    // sidewalk life along the whole route: people, a couple of cyclists
    for (let q = 0; q < 70; q++) this.spawnWalker(rnd(0, sStop + 30));
    for (let q = 0; q < 5; q++) { const s0 = rnd(40, sStop - 60); this.add('cyclist', { s: s0, d: -(r.hw(s0) + 0.55), v: rnd(4.5, 6.5), color: pick(SHIRTS), dir: 1, scenery: true }); }
    this.planAmbient();
  }

  spawnWalker(s) {
    const hw = this.route.hw(s), side = Math.random() < 0.5 ? 1 : -1;
    const standing = Math.random() < 0.25;
    this.add(standing ? 'stander' : 'walker', { s, d: side * (hw + rnd(1.6, 4)), v: standing ? 0 : rnd(0.9, 1.6) * (Math.random() < 0.5 ? 1 : -1), color: pick(SHIRTS), dir: 1, scenery: true, bob: rnd(0, 6) });
  }

  /** cross-street traffic (cars + city buses) that waits at the lights instead of entering the route */
  planAmbient() {
    const r = this.route, roads = this.W.roads.filter((rd) => /primary|secondary|tertiary|residential|motorway|trunk/.test(rd.cls) && rd.pts.length > 1);
    // cross streets that actually meet the route, plus the freeway decks that pass over it
    this.crossRoads = roads.filter((rd) => {
      const mid = rd.pts[(rd.pts.length / 2) | 0], dm = r.distTo(mid[0], mid[1]);
      if (rd.h) return Math.max(...rd.h) > 3 && rd.pts.some((p) => r.distTo(p[0], p[1]) < 60);
      // never the route's own street (OSM's copy of Luckie/Auburn): only streets that genuinely cross it
      const along = rd.pts.filter((p) => r.distTo(p[0], p[1]) < 9).length / rd.pts.length;
      return dm > 14 && along < 0.3 && rd.pts.some((p) => r.distTo(p[0], p[1]) < 10);
    });
    for (let q = 0; q < 14; q++) this.spawnAmbient(true);
  }
  spawnAmbient(anywhere) {
    if (!this.crossRoads.length) return;
    const rd = pick(this.crossRoads), bus = !rd.h && Math.random() < 0.3;   // buses stay on city streets
    const pts = Math.random() < 0.5 ? rd.pts : [...rd.pts].reverse();
    const hs = rd.h ? (pts === rd.pts ? rd.h : [...rd.h].reverse()) : null;
    const RANK = { motorway: 6, trunk: 6, primary: 5, secondary: 4, tertiary: 3, residential: 2 };
    this.ambient.push({ type: bus ? 'bus' : pick(['sedan', 'suv']), pts, hs, deck: !!rd.h, link: /_link/.test(rd.cls), bias: (RANK[rd.cls.replace('_link', '')] ?? 1) * 0.004, i: 0, t: anywhere ? Math.random() : 0, v: rd.h ? rnd(20, 27) : bus ? 8 : rnd(9, 13),
      color: bus ? pick(BUS_STRIPE) : pick(PAINT), lane: laneFor(rd, bus ? 'bus' : 'suv') });
  }

  /** advance everything; returns events for the HUD/audio */
  update(dt, car, t, hornT) {
    const out = { hits: [], nearMiss: 0, tokens: 0 };
    const r = this.route;
    // oncoming traffic on two-way stretches, spawned ahead but never onto a blocked meeting point
    this.nextOncoming -= dt;
    if (this.nextOncoming <= 0 && car.s < this.sEnd - 120) {
      this.nextOncoming = rnd(5, 9) * (1 - Math.min(0.25, t / 120));
      const s0 = car.s + 170, v0 = -rnd(9, 13);
      if (!r.oneway(s0)) {
        const meet = car.s + 170 * car.v / (car.v + -v0 + 0.01);
        const blocked = this.ents.some((e) => e.alive && e.solid >= 0.7 && !e.scenery && e.d < 0 && Math.abs(e.s + (e.v || 0) * ((meet - car.s) / Math.max(car.v, 5)) - meet) < 38);
        if (!blocked) this.add(pick(['sedan', 'suv', 'sedan']), { s: s0, d: r.lane(s0, 1), v: v0, color: pick(PAINT), dir: -1 });
      }
    }
    for (const e of this.ents) {
      if (!e.alive) continue;
      if (e.flying) { // knocked cones / barricades tumble away
        e.fs += e.fvs * dt; e.fd += e.fvd * dt; e.fz += e.fvz * dt; e.fvz -= 22 * dt; e.spin += dt * 9;
        if (e.fz < 0) { e.fz = 0; e.fvz *= -0.3; e.fvs *= 0.6; e.fvd *= 0.6; }
        e.s = e.fs; e.d = e.fd;
        if (Math.abs(e.fvs) < 0.3 && e.fz === 0) e.flying = false;
        continue;
      }
      if (!e.parked) e.s += (e.v || 0) * dt;
      if (e.type === 'panhandler') {
        if (e.leaving) { e.d += (e.home2 - e.d) * Math.min(1, dt * 3); }
        else {
          e.d = e.home + Math.sin(t * 0.8 + e.sway) * 0.6; // works the line between lanes
          if (hornT > 0 && e.s - car.s < 60 && e.s > car.s) { e.leaving = true; e.home2 = (Math.random() < 0.5 ? 1 : -1) * (r.hw(e.s) + 1.8); }
        }
      }
      // slow cars brake behind obstacles in their lane instead of driving through them
      if ((e.type === 'sedan' || e.type === 'suv') && !e.parked && e.v > 0) {
        const ahead = this.ents.find((o) => o !== e && o.alive && !o.scenery && o.solid && o.s > e.s && o.s - e.s < 12 && Math.abs(o.d - e.d) < 1.6);
        if (ahead) e.v = Math.max(0, Math.min(e.v, (ahead.v || 0)));
      }
      // walkers turn around at the ends of the mapped street instead of piling up there
      if (e.scenery && e.v && (e.s < 3 || e.s > r.length - 3)) { e.v = Math.abs(e.v) * (e.s < 3 ? 1 : -1); e.s = Math.max(3, Math.min(r.length - 3, e.s)); }
      // walkers wrap around the player's window so the sidewalks never empty
      if (e.scenery && (e.type === 'walker' || e.type === 'stander') && (e.s < car.s - 40 || e.s > car.s + 260)) {
        e.s = car.s + (e.s < car.s ? rnd(160, 250) : rnd(-30, 0)); e.d = Math.sign(e.d) * (r.hw(e.s) + rnd(1.6, 4));
      }
      if (e.dir === -1 && e.s < car.s - 40) e.alive = false; // oncoming car passed and gone
      if (e.dir === 1 && !e.parked && !e.scenery && e.s > r.length - 30) e.alive = false; // drove on out of view

      // collision / near miss (route space box test)
      if (e.solid && !e.scenery && !e.hitDone) {
        const ds = Math.abs(e.s - car.s), dd = Math.abs(e.d - car.d);
        const hitS = PLAYER.halfL + e.L / 2 - 0.25, hitD = PLAYER.halfW + e.W / 2 - 0.12;
        if (ds < hitS && dd < hitD) {
          if (e.type === 'panhandler') {        // nobody gets hurt: he jumps clear, you lose the moment
            e.leaving = true; e.home2 = Math.sign(e.d - car.d || 1) * (r.hw(e.s) + 1.8); e.hitDone = true;
            if (car.invuln <= 0) out.hits.push({ e, power: 0.6, label: 'WATCH IT!' });
          } else if (e.solid < 0.8) {           // cones / barricades go flying
            Object.assign(e, { flying: true, fs: e.s, fd: e.d, fz: 0.2, fvs: car.v * rnd(0.6, 0.9), fvd: (e.d - car.d) * 6 + rnd(-2, 2), fvz: rnd(3, 6), spin: 0, hitDone: true, scenery: true });
            if (car.invuln <= 0) out.hits.push({ e, power: e.solid, label: e.type === 'cone' ? '' : 'CRASH' });
          } else if (car.invuln <= 0) {
            out.hits.push({ e, power: 1, label: 'CRASH' }); e.v = Math.max(e.v, 0) + car.v * 0.3; e.hitDone = true;
            setTimeout(() => { e.hitDone = false; }, 900);
          }
        } else if (!e.parked && e.dir === -1 && !e.missed && ds < 2 && dd < hitD + 1.3) { e.missed = true; out.nearMiss++; }
      }
    }
    this.ents = this.ents.filter((e) => e.alive);
    for (const tk of this.tokens) {
      if (tk.alive && Math.abs(tk.s - car.s) < 2.6 && Math.abs(tk.d - car.d) < 1.5) { tk.alive = false; out.tokens++; }
    }
    // cross traffic
    for (const a of this.ambient) {
      const [p, q] = [a.pts[a.i], a.pts[a.i + 1]];
      if (!q) { Object.assign(a, { dead: true }); continue; }
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const nt = a.t + a.v * dt / L, nx = p[0] + (q[0] - p[0]) * Math.min(nt, 1), ny = p[1] + (q[1] - p[1]) * Math.min(nt, 1);
      a.moved = a.x === undefined ? 0 : Math.hypot(nx - a.x, ny - a.y);
      // red light for them: stop short of the route while the player is anywhere near
      const near = !a.deck && Math.hypot(nx - car.pose.x, ny - car.pose.y) < 260;   // decks pass over: no light
      // stop line: the vehicle's whole front half stays clear of the route's road (a 12 m bus stops further back)
      const clear = VEHICLE[a.type][0] + (a.type === 'bus' ? 2.6 : 1.2) + 3;
      if (!(near && r.distTo(nx, ny) < 20 && r.distTo(nx, ny) < r.hw(r.project(nx, ny).s) + clear && r.distTo(nx, ny) < r.distTo(a.x ?? nx, a.y ?? ny))) {
        a.t = nt; if (a.t >= 1) { a.i++; a.t = 0; }
      }
      a.x = nx; a.y = ny; a.h = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const zOld = a.zAbs;
      a.z = a.hs ? a.hs[a.i] + ((a.hs[a.i + 1] ?? a.hs[a.i]) - a.hs[a.i]) * Math.min(a.t, 1) : 0;
      a.grade = a.hs ? ((a.hs[a.i + 1] ?? a.hs[a.i]) - a.hs[a.i]) / L : 0; // deck climb per metre (on top of the terrain's)
      a.zAbs = r.ground(nx, ny) + a.z;
      if (zOld !== undefined && a.moved > 0.01) a.pitch = (a.pitch || 0) * 0.8 + Math.atan2(a.zAbs - zOld, a.moved) * 0.2;
      // in our road while we're close? it's solid — test it like any obstacle
      if (!a.deck && r.distTo(nx, ny) < 8 && Math.hypot(nx - car.pose.x, ny - car.pose.y) < 20) {
        const pr = r.project(nx, ny);
        if (Math.abs(pr.s - car.s) < PLAYER.halfL + VEHICLE[a.type][0] + 0.4 && Math.abs(pr.d - car.d) < PLAYER.halfW + VEHICLE[a.type][1] + 0.1 && !a.hitT) {
          out.hits.push({ e: { type: a.type, s: pr.s, d: pr.d, solid: 1, color: a.color }, power: 1, label: 'CRASH' }); a.hitT = 1.5;
        }
      }
      if (a.hitT) a.hitT = Math.max(0, a.hitT - dt);
    }
    this.ambient = this.ambient.filter((a) => !a.dead);
    while (this.ambient.length < 14) this.spawnAmbient(false);
    return out;
  }

  /** push every live entity into its InstancedMesh */
  render(car, t) {
    const counts = {}; for (const k in this.meshes) counts[k] = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), c = new THREE.Color(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    const put = (type, x, y, z, yaw, color, roll = 0, pitch = 0, sc = one) => {
      const im = this.meshes[type], i = counts[type]; if (i >= im.instanceMatrix.count) return;
      m4.compose(pos.set(x, z, -y), q.setFromEuler(e3.set(pitch, yaw - Math.PI / 2, roll, 'YXZ')), sc);
      im.setMatrixAt(i, m4); im.setColorAt(i, c.set(color)); counts[type]++;
    };
    const win0 = car.s - 60, win1 = car.s + 280;
    for (const e of this.ents) {
      if (e.s < win0 || e.s > win1) continue;
      const p = this.route.at(e.s, e.d);
      let yaw = p.a + (e.dir === -1 ? Math.PI : 0) + (e.yawOff || 0) + (e.v < 0 && e.scenery ? Math.PI : 0);
      const inStreet = Math.abs(e.d) < this.route.hw(e.s) + 0.2, lvl = inStreet ? LEVEL.ROUTE : LEVEL.TERRAIN;
      // anything standing IN the street (cones, barricades, a panhandler) stands on the rendered road surface
      let z = inStreet ? (this.surfAt(p.x, p.y, p.z + 1.2) ?? p.z + lvl) : p.z + lvl, roll = 0, pitch = 0;
      if (inStreet && (e.type === 'cone' || e.type === 'barricade') && !e.flying) { // sit flat on the slope
        const g = this.route.ground, on = (x, y) => this.surfAt(x, y, g(x, y) + 1.2) ?? g(x, y) + lvl;
        const st = standOn(on, p.x, p.y, yaw, 0.2, 0.2); z = st.z; pitch = st.pitch; roll = st.roll;
      }
      if (VEHICLE[e.type] && !e.flying) { // all four wheels on the rendered road surface, whatever the slope
        const g = this.route.ground, on = (x, y) => this.surfAt(x, y, g(x, y) + 1.2) ?? g(x, y) + lvl;
        const st = standOn(on, p.x, p.y, yaw, VEHICLE[e.type][0], VEHICLE[e.type][1]);
        z = st.z; pitch = st.pitch; roll = st.roll;
      }
      if (e.type === 'walker' && e.v) z += Math.abs(Math.sin(t * 7 + e.bob)) * 0.06;
      if (e.type === 'panhandler') yaw = p.a + Math.PI;
      if (e.flying) { z += e.fz; roll = e.spin; pitch = e.spin * 0.7; }
      if (e.type === 'panhandler') { pitch = 0; roll = 0; }
      put(e.type, p.x, p.y, z, yaw, e.color, roll, pitch);
    }
    for (const a of this.ambient) if (a.x !== undefined) {
      const ox = -Math.sin(a.h) * a.lane, oy = Math.cos(a.h) * a.lane, x = a.x + ox, y = a.y + oy, g = this.route.ground;
      const [hl, hw] = VEHICLE[a.type];
      // every wheel reads the rendered surface under it: its own deck (below the expected height + 1.2 m, so a
      // deck overhead is never picked), or the street
      const expect = (px, py) => (a.deck ? deckTop(g, px, py, a.z) : g(px, py)) + LEVEL.ROAD;
      const on = (px, py) => this.surfAt(px, py, expect(px, py) + (a.deck ? 2.1 : 1.2)) ?? expect(px, py); // decks: merged surface up to 2 m
      const st = standOn(on, x, y, a.h, hl, hw);
      put(a.type, x, y, st.z, a.h, a.color, st.roll, st.pitch);
    }
    for (const k in this.meshes) { const im = this.meshes[k]; im.count = counts[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    // tokens
    let n = 0; const spin = t * 4;
    for (const tk of this.tokens) {
      if (!tk.alive || tk.s < win0 || tk.s > win1 || n >= 260) continue;
      const p = this.route.at(tk.s, tk.d);
      m4.compose(pos.set(p.x, p.z + LEVEL.ROUTE + 1.0 + Math.sin(t * 3 + tk.s) * 0.12, -p.y), q.setFromEuler(e3.set(0, spin + tk.s, 0)), one);
      this.tokenMesh.setMatrixAt(n++, m4);
    }
    this.tokenMesh.count = n; this.tokenMesh.instanceMatrix.needsUpdate = true;
  }
}

/** Mesh geometry in true metres. meshopt quantisation stores positions as normalised int16 and puts the
 *  dequantising scale/offset on the NODE, so the raw geometry is ~2 units long. Bake the node transform
 *  into float attributes (instancing ignores the node). */
export function bakedGeometry(root, name) {
  root.updateMatrixWorld(true);
  const node = root.getObjectByName(name);
  if (!node) throw new Error('props.glb is missing ' + name);
  const g = new THREE.BufferGeometry();
  for (const [key, attr] of Object.entries(node.geometry.attributes)) {
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
    g.setAttribute(key, new THREE.BufferAttribute(out, attr.itemSize));
  }
  if (node.geometry.index) g.setIndex(node.geometry.index.clone());
  g.applyMatrix4(node.matrixWorld);
  g.computeBoundingSphere();
  return g;
}

/** a lane offset that keeps the WHOLE vehicle on its road: anywhere across a one-way road (ramps are only
 *  ~6 m wide), the right-hand lane of a two-way street */
function laneFor(rd, type) {
  const room = Math.max(0, rd.width / 2 - VEHICLE[type][1] - (rd.h ? 0.9 : 0.35)); // ramps curve: keep clear of the edge
  return rd.oneway ? rnd(-room, room) : -Math.min(rd.width / 4, room);
}

function pickWeighted(list) {
  const tot = list.reduce((a, [, w]) => a + w, 0); let r = Math.random() * tot;
  for (const [v, w] of list) { if ((r -= w) <= 0) return v; }
  return list[0][0];
}

/** One material for every prop: vertex colours, and pure-white vertices take the per-instance tint. */
export function propMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `
      #include <color_vertex>
      #ifdef USE_INSTANCING_COLOR
        // undo the blanket tint and re-apply it only to "paint" (white) vertices
        vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, step(0.985, min(color.r, min(color.g, color.b))));
      #endif`);
  };
  return m;
}
