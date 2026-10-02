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
    // curb-to-curb widths measured from the mapped sidewalks (world.json route.curb, every curbStep m) replace
    // OSM's width guess wherever they exist: Auburn Ave is ~12–14 m kerb to kerb, not the 9 m a "2 lanes" tag gives
    const C = W.route.curb, step = W.route.curbStep || 10, known = (C || []).map((v, k) => (v == null ? null : [k * step, v])).filter(Boolean);
    if (known.length) {
      const measured = (s) => {
        if (s <= known[0][0]) return known[0][1];
        if (s >= known.at(-1)[0]) return known.at(-1)[1];
        let k = 1; while (known[k][0] < s) k++;
        const [s0, w0] = known[k - 1], [s1, w1] = known[k]; return w0 + (w1 - w0) * (s - s0) / (s1 - s0);
      };
      raw.forEach((r, i) => { r[0] = Math.min(8, Math.max(3.6, measured(i) / 2)); });
    }
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
  /** the road is two travel lanes in the middle and, where the street is wide enough, a standard 2.4 m curbside
   *  parking lane on each side; the travel lanes take the rest (Auburn's are wide: shared with bikes, streetcar
   *  in the westbound one) */
  travel(s) { const hw = this.hw(s); return Math.min(hw, Math.max(3.45, hw - 2.4)); }
  park(s) { return this.hw(s) - this.travel(s); }
  /** centre of travel lane k (0 = right/your lane, 1 = left) */
  lane(s, k) { const t = this.travel(s); return k === 0 ? -t / 2 : t / 2; }
  /** centre of the parking lane on a side (-1 right, +1 left), or null where there's no room for one */
  parkD(s, side) { const p = this.park(s); return p >= 2 ? side * (this.travel(s) + p / 2) : null; }
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
    Object.assign(this, { route, s: s0, d: -route.hw(s0) / 2, v: 0, dv: 0, targetD: -route.hw(s0) / 2, stun: 0, invuln: 0, brakeT: 0, offBrake: 1, accel: 0 });
  }
  /** tight + snappy: the lateral position is a stiff critically-damped spring on the finger/keys */
  step(dt, { targetD, brake, gas = 0, top = 30, cruise, stopAt, steer, lanes }) {
    const hw = this.route.hw(this.s), lim = hw - PLAYER.halfW - 0.05;
    if (steer === undefined) {
      // lateral path - the player's stiff lane steering (drive.js sets targetD to a lane centre) and the QA autopilot
      // (sets targetD to any line): the lateral position is a stiff critically-damped spring on targetD
      this.targetD = Math.max(-lim, Math.min(lim, targetD));
      const w = 16; // spring stiffness (rad/s): ~0.2 s to settle, no overshoot
      const acc = w * w * (this.targetD - this.d) - 2 * w * this.dv;
      // a car can't glide sideways standing still: side speed grows with road speed
      const side = Math.min(18, 3 + Math.abs(this.v) * 0.6);
      this.dv += acc * dt; this.dv = Math.max(-side, Math.min(side, this.dv));
      // Stiff lane steering: the whole car slides across as one rigid body and its nose never leaves the road's
      // heading. (This line used to angle the nose into the move - the front-end steer the lane model replaces.)
      this.yaw = 0;
    } else {
      // NOT CALLED any more: nothing passes `steer` since the player moved to stiff lane steering above. Kept so the
      // old nose-steering can come back by passing `steer` from drive.js's car.step call.
      // the player: GTA Chinatown Wars-style handling (its documented behaviour; Rockstar never published the
      // numbers). ◀ ▶ turn the nose: no turning standing still, the sharpest turns at city speeds, wider as you go
      // faster. The car's path lags its nose a little (it slides into a turn, then grips). Hands off the arrows,
      // the steering assist straightens you parallel to the road, with a light pull toward the nearest of the four
      // lanes (your parking lane, your lane, the oncoming lane, the far parking lane).
      const sp = Math.abs(this.v), back = this.v < -0.1 ? -1 : 1;
      this.yaw = this.yaw || 0; this.travel = this.travel ?? this.yaw;
      const omega = 2.4 * Math.min(1, sp / 6) / (1 + sp * 0.04);                   // turn rate, rad/s
      if (steer) this.yaw += steer * omega * dt * back;
      else {
        const ls = lanes && lanes.length ? lanes : [this.d], lane = ls.reduce((a, c) => Math.abs(c - this.d) < Math.abs(a - this.d) ? c : a, ls[0]);
        const want = Math.max(-0.055, Math.min(0.055, (lane - this.d) * 0.04)) * back;  // light lane pull (quarter of the original)
        this.yaw += (want - this.yaw) * Math.min(1, dt * 3.2);                      // assist: back parallel to the road
      }
      this.yaw = Math.max(-0.75, Math.min(0.75, this.yaw));
      const grip = Math.max(4.5, 7 - sp * 0.1);                                     // path catches up with the nose
      this.travel += (this.yaw - this.travel) * Math.min(1, dt * grip);
      this.dv = this.v * Math.sin(this.travel);
      this.targetD = this.d;
    }
    // the four lanes are the road: the outermost lane is as far as you go (a scrape straightens you out)
    const lo = lanes ? Math.max(-lim, Math.min(...lanes) - 0.4) : -lim, hi = lanes ? Math.min(lim, Math.max(...lanes) + 0.4) : lim;
    this.d += this.dv * dt;
    if (this.d < lo || this.d > hi) { this.d = Math.max(lo, Math.min(hi, this.d)); if (steer !== undefined) { this.yaw *= 0.3; this.travel *= 0.3; } this.scrape = 0.2; }

    // speed: YOU drive it. GAS pulls (harder from low speed, easing off near the top), off the gas the car
    // coasts down on engine braking, BRAKE is progressive (a tap bites at ~40 %, holding builds to full in about
    // a quarter second), and holding BRAKE at a standstill backs up. `cruise` (old auto-drive) still works for tools.
    if (cruise !== undefined && !gas && !brake) { gas = cruise > 0 ? 1 : 0; top = cruise || top; }
    this.brakeT = brake ? this.brakeT + dt : 0;
    this.stopT = brake && Math.abs(this.v) < 0.4 ? (this.stopT || 0) + dt : 0;
    let vmax = top * cornerFactor(this.route, this.s, Math.max(0, this.v));
    if (this.stun > 0) { vmax = Math.min(vmax, 6); this.stun -= dt; }
    if (stopAt !== undefined && this.s < stopAt + 1) vmax = Math.min(vmax, stopAt - this.s > 0.4 ? Math.max(1.2, Math.sqrt(2 * 3.4 * (stopAt - this.s))) : 0);   // parking assist: eases you into the space
    const v0 = this.v;
    const reversing = brake && (this.v < -0.05 || this.stopT > 0.5);   // half a second at a standstill first
    if (reversing) {
      this.v = Math.max(-5, this.v - 3.5 * dt);                                   // back up, gently, to 11 mph
    } else if (brake) {
      const bite = Math.min(1, 0.4 + this.brakeT * 2.4), dec = 18 * bite * dt;
      this.v = this.v > 0 ? Math.max(0, this.v - dec) : Math.min(0, this.v + dec);
    } else if (gas) {
      if (this.v < 0) this.v = Math.min(0, this.v + 12 * dt);                    // stop the reverse first
      else if (this.v < vmax) this.v = Math.min(vmax, this.v + (7.5 - 4 * this.v / top) * gas * dt);
      else this.v = Math.max(vmax, this.v - 9 * dt);                            // over the corner / assist limit
    } else {
      const coast = this.v > vmax ? 9 : 1.6;                                    // engine braking
      this.v = this.v > 0 ? Math.max(0, this.v - coast * dt) : Math.min(0, this.v + 3 * dt);
    }
    this.accel = this.accel * 0.85 + ((this.v - v0) / dt) * 0.15;   // smoothed, for weight transfer / brake lights
    this.s += this.v * dt;
    this.invuln = Math.max(0, this.invuln - dt);
  }
  get pose() {
    const p = this.route.at(this.s, this.d);
    p.a += this.yaw || 0;   // where the nose points
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
  cone: { L: 0.8, W: 0.8, solid: 0.35 },   // drawn 1.45x (HAZARD_SCALE); the hit box matches barricade: { L: 0.6, W: 1.8, solid: 0.7 },
  panhandler: { L: 0.7, W: 0.7, solid: 0.6 },
  // scenery (never collides)
  bus: { L: 12, W: 2.55, solid: 0 }, worksign: { L: 1, W: 1, solid: 0 }, walker: { L: 0.5, W: 0.5, solid: 0 },
  stander: { L: 0.5, W: 0.5, solid: 0 }, cyclist: { L: 1.8, W: 0.6, solid: 0 },
  tram: { L: 24.8, W: 2.65, solid: 1 },   // the Atlanta Streetcar (tram.js moves and draws it)
  // city life: police cruisers and driverless robotaxis in the traffic mix, stray dogs on the sidewalks, and
  // the kids selling water / panhandlers who work the red lights (people and dogs jump clear: never hurt)
  police: { L: 4.95, W: 1.9, solid: 1 }, robotaxi: { L: 4.7, W: 1.95, solid: 1 },
  dog: { L: 0.8, W: 0.35, solid: 0.5 }, officer: { L: 0.5, W: 0.5, solid: 0 }, seller: { L: 0.6, W: 0.6, solid: 0.6 }, cooler: { L: 0.7, W: 0.45, solid: 0 },
};
// half wheelbase / half track used to seat each vehicle on the road
const VEHICLE = { sedan: [1.35, 0.8], suv: [1.42, 0.86], bus: [3.6, 1.15], tram: [11, 1.3], police: [1.47, 0.82], robotaxi: [1.5, 0.83] };
const CARS = new Set(['sedan', 'suv', 'police', 'robotaxi']);
const ON_FOOT = new Set(['panhandler', 'seller', 'dog']);   // hit one and they leap clear: a scare, never an injury
/** the traffic mix: mostly private cars, about one in ten a driverless robotaxi, one in twenty a police cruiser */
const carType = () => pickWeighted([['sedan', 5], ['suv', 3], ['robotaxi', 0.9], ['police', 0.5]]);
const parkedType = () => pickWeighted([['sedan', 5], ['suv', 3], ['police', 0.25]]);
/** does o block e's lane? vehicles by lane; people and dogs only if they're actually in e's path */
const blocks = (o, e) => Math.abs(o.d - e.d) < (VEHICLE[o.type] ? 1.8 : (e.W || 1.8) / 2 + (o.W || 0.5) / 2 + 0.25);
// obstacles drawn bigger than life and ringed with a warning halo while they're in the street ahead
const HAZARD_SCALE = { cone: 1.45, barricade: 1.25, dog: 1.5, seller: 1.2, panhandler: 1.2 };
const HALO = { cone: [0.75, 0xff7a1a], barricade: [1.3, 0xff7a1a], dog: [1.1, 0xffd400], seller: [1.0, 0xff3b3b], panhandler: [1.0, 0xff3b3b] };
const COATS = [0x8a5a32, 0x2a2420, 0xc9a877, 0x6b4a33, 0xe6dccb, 0x4a3b30, 0xa0703f];
const PAINT = [0xb8bcc2, 0x1d1f24, 0xe9e9e6, 0x7a1a1a, 0x1f3c78, 0x5a5f66, 0x24542f, 0xc4a44a, 0x8a8f96, 0x2b2b30];
const SHIRTS = [0xd94f3d, 0x3b6fb6, 0xf0c33c, 0x2e2e2e, 0xe8e8e8, 0x3d9a5b, 0x8e44ad, 0xff8c1a, 0x1abc9c, 0x7f8c8d];
const BUS_STRIPE = [0x1d5fbf, 0xc62828];

export class World {
  constructor({ route, props, scene, W, sEnd, audio, surfAt, camera, marks }) {
    Object.assign(this, { route, scene, W, sEnd, audio, surfAt, camera, marks });
    this.frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._sph = new THREE.Sphere();
    this.ents = []; this.tokens = [];
    this.meshes = {};
    const mat = propMaterial();
    const CAP = { sedan: 150, suv: 110, police: 24, robotaxi: 30, cone: 120, barricade: 16, panhandler: 12, seller: 16, cooler: 10,
      dog_a: 12, dog_b: 12, officer: 2, bus: 8, worksign: 10, cyclist: 8 };   // people on foot: crowd.js
    const GEO = { sedan: 'prop_sedan', suv: 'prop_suv', police: 'prop_police', robotaxi: 'prop_robotaxi', cone: 'prop_cone', barricade: 'prop_barricade',
      panhandler: 'prop_panhandler', seller: 'prop_seller', cooler: 'prop_cooler', dog_a: 'prop_dog_a', dog_b: 'prop_dog_b', officer: 'prop_person_walk',
      bus: 'prop_bus', worksign: 'prop_worksign', cyclist: 'prop_cyclist' };
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
    // hazard halos: a glowing warning ring on the road under every cone, barricade, dog or person in the street
    // ahead, so obstacles read at a glance on a phone
    const hg = new THREE.RingGeometry(0.62, 1.0, 28); hg.rotateX(-Math.PI / 2);
    this.halo = new THREE.InstancedMesh(hg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }), 200);
    this.halo.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(600).fill(1), 3);
    this.halo.count = 0; this.halo.frustumCulled = false; this.halo.renderOrder = 3; scene.add(this.halo);
    this.nextOncoming = 2; this.ambient = [];
    this.stats = { oncoming: 0 };   // QA: how much oncoming traffic a run actually got
    this.plan();
  }

  add(type, props) { const e = { type, ...TYPES[type], v: 0, dv: 0, yaw: 0, alive: true, color: 0xffffff, ...props }; this.ents.push(e); return e; }
  /** 1–3 oncoming cars (a platoon) from s on, moving toward the player; returns where the platoon ends */
  oncomingPlatoon(s) {
    const r = this.route, v0 = -rnd(9, 13), n = Math.random() < 0.6 ? 1 : Math.random() < 0.75 ? 2 : 3;
    for (let k = 0; k < n; k++, s += rnd(18, 28)) {
      if (r.oneway(s)) continue;
      this.add(carType(), { s, d: r.lane(s, 1), v: v0, v0, color: pick(PAINT), dir: -1 });
      this.stats.oncoming++;
    }
    return s;
  }

  /** Lay out the run: an event every 30-50 m (denser as you go), always leaving one lane open. */
  plan() {
    const r = this.route, sStop = this.sEnd;
    let s = 70, k = 0;
    while (s < sStop - 95) {
      const hw = r.hw(s), right = r.lane(s, 0), left = r.lane(s, 1), two = !r.oneway(s);
      const ev = pickWeighted([['slow', 2], ['parked', 2], ['construction', 1], ['tokens', 3]]);   // (panhandlers work the lights: planCorners)
      if (ev === 'slow') this.add(carType(), { s, d: right, v: rnd(9, 13), color: pick(PAINT), dir: 1 });
      if (ev === 'parked') {
        const n = Math.random() < 0.25 ? 2 : 1;
        for (let q = 0; q < n; q++) this.add(parkedType(), { s: s + q * 6.5, d: right - 0.35, color: pick(PAINT), dir: 1, parked: true });
        if (!two && Math.random() < 0.5) this.add('sedan', { s: s + 30, d: left + 0.35, color: pick(PAINT), dir: 1, parked: true });
      }
      if (ev === 'construction') {
        // taper the cones from the right curb to the centre line, then run them for 22 m; barricade at the head
        this.add('worksign', { s: s - 38, d: -(hw + 1.6), yawOff: Math.PI });
        // taper from the right edge line to the lane line, then cones along the lane line: the right lane is closed
        const edge = -hw + 0.35, line = (right + left) / 2 - 0.25;   // closes everything from the curb over (no parking in a work zone)
        (this.workZones ??= []).push([s - 42, s + 40]);
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
      s += rnd(75, 110) * (1 - Math.min(0.25, k * 0.015)); k++;   // roomier now that a real oncoming stream is the main pressure
    }
    // oncoming traffic already on the road, all the way down the far lane (fed from the far end in update)
    for (let s1 = 60; s1 < r.length - 10; s1 += rnd(50, 130)) s1 = this.oncomingPlatoon(s1);
    // cars parked along both curbs wherever there's a parking lane (~60 % full), clear of junctions and crosswalks
    const clearAt = (s1) => { for (let k = -8; k <= 8; k++) if (this.marks && this.marks[Math.round(s1) + k] === 0) return false; return true; };
    for (const side of [-1, 1]) for (let s1 = rnd(6, 12); s1 < r.length - 4; s1 += rnd(6.2, 7.2)) {
      const pd = r.parkD(s1, side); if (pd === null || !clearAt(s1) || Math.random() > 0.6) continue;
      if (side < 0 && (this.workZones || []).some(([a, b]) => s1 > a && s1 < b)) continue;   // coned off
      if (side < 0 && s1 > sStop - 14 && s1 < sStop + 16) continue;                          // the store's P space (room to pull in)
      this.add(parkedType(), { s: s1, d: pd + side * rnd(-0.1, 0.15), color: pick(PAINT), dir: side > 0 ? -1 : 1, parked: true, curb: true });
    }
    // a couple of cyclists in the bike lane (people on foot are the crowd: crowd.js)
    for (let q = 0; q < 5; q++) { const s0 = rnd(40, sStop - 60); this.add('cyclist', { s: s0, d: -(r.hw(s0) + 0.55), v: rnd(4.5, 6.5), color: pick(SHIRTS), dir: 1, scenery: true }); }
    // stray dogs nosing along the sidewalks; now and then one trots across the street in front of you
    for (let q = 0; q < 8; q++) {
      const s0 = rnd(50, sStop - 30), side = Math.random() < 0.5 ? 1 : -1, off = rnd(1.2, 2.0);
      this.add('dog', { s: s0, d: side * (r.hw(s0) + off), side, off, walk: rnd(1.0, 1.6) * (Math.random() < 0.5 ? 1 : -1), color: pick(COATS), gait: rnd(0, 6), pause: rnd(-4, 2), hd: 0 });
    }
    this.planAmbient();
  }

  /** the people who work the red lights: at signalised junctions a kid (or two) selling cold water from a cooler
   *  on the corner, or a panhandler with a sign. They wait at the stop line on the lane line; on red they walk
   *  down between the stopped cars to the driver's window; on green they linger a few seconds before drifting
   *  back up the line, which is exactly when they're in the way of anyone pulling off. */
  planCorners(signals) {
    const r = this.route;
    for (const n of signals?.nodes || []) {
      const line = n.lineIn;
      if (line < 90 || line > this.sEnd - 25 || (this.workZones || []).some(([a, b]) => line > a - 20 && line < b + 20)) continue;
      const roll = Math.random();
      if (roll > 0.85) continue;
      const kids = roll < 0.5, crew = kids ? (Math.random() < 0.45 ? 2 : 1) : 1;
      if (kids) this.add('cooler', { s: line - 2.5, d: -(r.hw(line - 2.5) + 1.3), scenery: true, yawOff: Math.PI / 2 });
      for (let k = 0; k < crew; k++) {
        const s0 = line - 0.6 - k * 1.3;
        this.add(kids ? 'seller' : 'panhandler', { s: s0, d: -(r.hw(s0) + 0.7), color: pick(SHIRTS), worker: true, node: n, line,
          post: s0, beat: line - rnd(8, 26) - k * 9, delay: rnd(1, 3.5), linger: rnd(2.5, 5), hd: Math.PI });
      }
    }
  }
  /** the painted line between our lane and the next one (the centre line on a two-way street) */
  laneLine(s) { return (this.route.lane(s, 0) + this.route.lane(s, 1)) / 2; }


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
    this.driveRoads = roads;
    for (let q = 0; q < 14; q++) this.spawnAmbient(true);
  }
  updateFrustum() {
    if (this.camera) { this._pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this._pm); }
  }
  /** on screen? (route-plane x, y; z = height; r = bounding radius in metres). Nothing may appear or vanish where it's seen. */
  visible(x, y, z, r = 4) {
    if (!this.camera) return false;
    this._sph.center.set(x, z ?? this.route.ground(x, y), -y); this._sph.radius = r;
    return this.frustum.intersectsSphere(this._sph);
  }
  /** Cross traffic enters the world only off-screen and well clear of the route (OSM splits streets at every
   *  junction, so a way's first point is often IN our road). `initial` = level load, before anything is seen. */
  spawnAmbient(initial) {
    if (!this.crossRoads.length) return;
    const r = this.route;
    for (let attempt = 0; attempt < 8; attempt++) {
      const rd = pick(this.crossRoads), bus = !rd.h && Math.random() < 0.3;   // buses stay on city streets
      const pts = Math.random() < 0.5 ? rd.pts : [...rd.pts].reverse();
      const hs = rd.h ? (pts === rd.pts ? rd.h : [...rd.h].reverse()) : null;
      const i = (Math.random() * (pts.length - 1)) | 0, t = Math.random();
      const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      if (!rd.h && r.distTo(x, y) < 18) continue;
      if (!initial && this.visible(x, y, hs ? r.ground(x, y) + hs[i] : undefined, bus ? 7 : 3.5)) continue;
      this.ambient.push(this.ambientOn(rd, pts, hs, bus ? 'bus' : carType(), i, t, bus ? pick(BUS_STRIPE) : pick(PAINT)));
      return;
    }
  }
  ambientOn(rd, pts, hs, type, i, t, color) {
    const RANK = { motorway: 6, trunk: 6, primary: 5, secondary: 4, tertiary: 3, residential: 2 };
    return { type, pts, hs, road: rd, deck: !!rd.h, dead_end: undefined, link: /_link/.test(rd.cls), bias: (RANK[rd.cls.replace('_link', '')] ?? 1) * 0.004, i, t,
      v: rd.h ? rnd(20, 27) : type === 'bus' ? 8 : rnd(9, 13), color, lane: laneFor(rd, type === 'bus' ? 'bus' : 'suv') };
  }
  /** at the end of its way a vehicle carries on along the connecting way (same street first), like real traffic */
  continueAmbient(a) {
    const o = this.nextWay(a); if (!o) return false;
    Object.assign(a, this.ambientOn(o.rd, o.pts, o.hs, a.type, 0, 0, a.color), { x: a.x, y: a.y, zAbs: a.zAbs, pitch: a.pitch });
    return true;
  }
  /** the way this vehicle carries on along at the end of its own (same street first), or null for a dead end */
  nextWay(a) {
    const end = a.pts[a.pts.length - 1], hEnd = a.hs ? a.hs[a.hs.length - 1] : 0, r = this.route;
    const near = (p) => Math.hypot(p[0] - end[0], p[1] - end[1]) < 1.5;
    const opts = [];
    for (const rd of this.driveRoads) {
      if (rd === a.road || (a.type === 'bus' && rd.h)) continue;
      const fwd = near(rd.pts[0]), back = near(rd.pts[rd.pts.length - 1]);
      if (!fwd && !back) continue;
      const pts = fwd ? rd.pts : [...rd.pts].reverse(), hs = rd.h ? (fwd ? rd.h : [...rd.h].reverse()) : null;
      if (Math.abs((hs ? hs[0] : 0) - hEnd) > 1) continue;              // no stepping off a deck onto the street below
      const along = pts.filter((p) => r.distTo(p[0], p[1]) < 9).length / pts.length;
      if (along >= 0.3) continue;                                        // never onto the route's own street
      opts.push({ rd, pts, hs, w: rd.name && rd.name === a.road.name ? 4 : 1 });
    }
    return opts.length ? pickWeighted(opts.map((o) => [o, o.w])) : null;
  }

  /** advance everything; returns events for the HUD/audio */
  update(dt, car, t, hornT) {
    const out = { hits: [], nearMiss: 0, tokens: 0 };
    const r = this.route;
    this.updateFrustum();
    const seen = (e, rad = 4) => { const p = r.at(e.s, e.d); return this.visible(p.x, p.y, p.z, rad); };
    // oncoming traffic: a steady stream that already fills the far lane (see plan) and is fed from the far end of
    // the street, past the store, where nobody is looking. Nothing ever has to appear on screen.
    this.nextOncoming -= dt;
    if (this.nextOncoming <= 0) {
      const src = r.length - 6;
      if (!seen({ s: src, d: r.lane(src, 1) }, 4)) {   // one car at a time: platoon spacing, then a real gap
        if (!this.srcLeft) { this.srcLeft = Math.random() < 0.6 ? 1 : Math.random() < 0.75 ? 2 : 3; this.srcV = -rnd(9, 13); }
        const v0 = this.srcV;                                   // a platoon shares one speed
        this.add(carType(), { s: src, d: r.lane(src, 1), v: v0, v0, color: pick(PAINT), dir: -1 });
        this.stats.oncoming++;
        this.nextOncoming = (--this.srcLeft ? rnd(18, 28) : rnd(50, 130)) / -v0;
      } else this.nextOncoming = 0.5;
    }
    // a blockage in the right lane: something stationary (parked car, work zone, a car waiting at one) and
    // everything stationary right behind it; stretchFrom(s) = far end of the first one within 25 m ahead of s
    const isStill = (o) => o.alive && !o.scenery && !o.flying && !o.curb && o.d < 0 && (o.solid >= 0.7 || o.type === 'cone') && (o.parked || Math.abs(o.v || 0) < 1);
    const stills = this.ents.filter(isStill).sort((a, b) => a.s - b.s);
    const stretchFrom = (s0) => {
      let end = -1;
      for (const o of stills) { if (o.s < s0 - 1) continue; if (end < 0 ? o.s - s0 > 25 : o.s - end > 15) break; end = o.s + (o.L || 1) / 2; }
      return end;
    };
    // courtesy: once the player has stopped behind one, oncoming cars wait just past its far end and wave them through
    const waitEnd = car.v < 3 ? stretchFrom(car.s) : -1;
    // work zones on a two-lane street run alternating traffic: as the player comes up to one, a flagger holds the
    // oncoming side just past its far end (cars already inside finish passing) so the open lane is theirs
    const zone = (this.workZones || []).find(([a, b]) => car.s > a - 70 && car.s < b + 5);
    for (const e of this.ents) if (e.dir === -1 && e.v0) {
      const yieldHere = (waitEnd > 0 && e.s > waitEnd + 8 && e.s - waitEnd < 40) || (zone && e.s > zone[1] + 6 && e.s < zone[1] + 70);
      e.v = yieldHere ? Math.min(0, e.v + 20 * dt) : Math.max(e.v0, e.v - 6 * dt);   // ease to a stop / back up to speed
      const front = e.s - (e.L || 4.5) / 2, line = this.signals?.stopFor(front, -e.v, -1);     // red light: stop at the line
      if (line != null) { const gap = front - line; e.v = Math.max(e.v, -(gap < 0.5 ? 0 : Math.sqrt(2 * 3 * gap))); }
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
      // HORN clears the way: anyone on foot in your path up ahead hops out of it (sideways, away from your line)
      // and waits a beat; a dog bolts for the sidewalk
      if (ON_FOOT.has(e.type) && hornT > 0 && !e.leaving && e.s > car.s - 2 && e.s - car.s < 40 && Math.abs(e.d - car.d) < 2) {
        if (e.type === 'dog') { if (!e.bolt) Object.assign(e, { crossing: 0, bolt: Math.sign(e.d - car.d || 1) }); }
        else Object.assign(e, { dodge: Math.sign(e.d - car.d || 1), dodgeT: 2.2 });
      }
      if (e.dodgeT > 0) {
        e.dodgeT -= dt;
        if (Math.abs(e.d - car.d) < 2.3 || Math.abs(e.s - car.s) > 6) e.d += e.dodge * 3.4 * dt * (Math.abs(e.d - car.d) < 2.3 ? 1 : 0);
        e.hd = e.dodge > 0 ? Math.PI / 2 : -Math.PI / 2; e.v = 0;
        if (e.dodgeT <= 0) e.dodge = 0;
      }
      else if (e.worker && !e.leaving) this.work(e, dt, car);
      else if (e.type === 'dog') this.dog(e, dt, car, seen);
      else if (e.type === 'panhandler' || e.type === 'seller') {
        if (e.leaving) { e.d += (e.home2 - e.d) * Math.min(1, dt * 3); }
        else {
          e.d = e.home + Math.sin(t * 0.8 + e.sway) * 0.6; // works the line between lanes
          if (hornT > 0 && e.s - car.s < 60 && e.s > car.s) { e.leaving = true; e.home2 = (Math.random() < 0.5 ? 1 : -1) * (r.hw(e.s) + 1.8); }
        }
      }
      // oncoming cars stop for anything in their lane: the car in front (maybe yielding), a car overtaking
      // toward them, or the player
      if (e.dir === -1 && e.v0) {
        const ahead = this.ents.find((o) => o !== e && o.alive && !o.scenery && !o.flying && (VEHICLE[o.type] || ON_FOOT.has(o.type)) && o.s < e.s && e.s - o.s < (o.L || 4.5) / 2 + (e.L || 4.5) / 2 + 3 && blocks(o, e));
        if (ahead) e.v = Math.max(e.v, Math.min(0, ahead.dir === -1 ? ahead.v : 0));
        // the player over the line in front of them: ease over toward their own curb and squeeze past slowly
        // (a real driver doesn't sit nose to nose); stop only if there's no room to get by
        const lane = r.lane(e.s, 1), room = r.parkD(e.s, 1) !== null ? r.travel(e.s) - 0.3 : r.hw(e.s) - 0.95;   // not into parked cars
        let aim = lane;
        if (car.s < e.s + 3 && e.s - car.s < 22 && car.d > lane - 3.2) {
          aim = Math.min(room, Math.max(lane, car.d + 2.15));
          const need = PLAYER.halfW + (e.W || 1.9) / 2 + 0.05;                      // side-by-side clearance, this car's width
          const clear = Math.abs(e.d - car.d) >= need;                              // already far enough over?
          if (aim - car.d < need) { if (e.s - car.s < 13) e.v = Math.max(e.v, 0); }  // can't get by: wait
          else e.v = Math.max(e.v, clear || e.s - car.s > 9 ? -4 : 0);               // move over first, then squeeze by
        }
        e.d += Math.max(-2 * dt, Math.min(2 * dt, aim - e.d));
      }
      // slow traffic in our direction drives like traffic: follows slower cars, and around a stationary blockage
      // it overtakes through the other lane when that's clear (and pulls back in), otherwise waits behind it
      if (CARS.has(e.type) && !e.parked && e.dir === 1 && !e.scenery) {
        e.cruise ??= e.v;
        const home = r.lane(e.s, 0), other = r.lane(e.s, 1);
        const ahead = this.ents.find((o) => o !== e && o.alive && !o.scenery && !o.flying && o.solid && o.s > e.s && o.s - e.s < 14 && blocks(o, e));
        if (!e.passing && ahead && isStill(ahead) && !r.oneway(e.s)) {
          const end = stretchFrom(e.s) + 8;
          // mirror check: no oncoming car in the way, and the player isn't beside them or coming up fast behind
          const playerComing = (car.s < e.s && car.v > e.v + 2 && e.s - car.s < Math.max(22, (car.v - e.v) * 3))   // closing in behind
            || (car.d > -0.5 && Math.abs(car.s - e.s) < 14);                                                      // or already beside/over the line
          const clear = !this.ents.some((o) => o.alive && o.dir === -1 && o.s > e.s - 5 && o.s < end + 60 && Math.abs(o.d - other) < 2) && !playerComing;
          if (clear) Object.assign(e, { passing: true, passEnd: end });
        }
        let target = home, want = e.cruise;
        if (e.passing) { target = e.s < e.passEnd ? other : home; if (e.s >= e.passEnd && Math.abs(e.d - home) < 0.2) e.passing = false; }
        else if (ahead) want = isStill(ahead) ? (ahead.s - e.s < 8 ? 0 : Math.min(e.cruise, (ahead.s - e.s - 8) * 1.5)) : Math.min(e.cruise, ahead.v || 0);
        // and never into the back of the player
        if (car.s > e.s && car.s - e.s < 16 && Math.abs(car.d - e.d) < 1.9) want = Math.min(want, car.s - e.s < 9 ? 0 : car.v);
        const sl = this.signals?.stopFor(e.s + (e.L || 4.5) / 2, e.v, 1);                        // red light
        if (sl != null) { const gap = sl - (e.s + (e.L || 4.5) / 2); want = Math.min(want, gap < 0.5 ? 0 : Math.sqrt(2 * 3 * gap)); }
        if (e.backup) { const gap = car.s - 6.5 - e.s; target = car.d; want = gap < 0.3 ? 0 : Math.min(e.cruise, Math.sqrt(2 * 5 * gap)); }   // BUSTED: pulls up behind you
        e.v += Math.max(-9 * dt, Math.min(4 * dt, want - e.v));
        e.d += Math.max(-2.5 * dt, Math.min(2.5 * dt, target - e.d));
      }
      // cyclists turn around at the ends of the mapped street instead of piling up there
      if (e.scenery && e.v && (e.s < 3 || e.s > r.length - 3)) { e.v = Math.abs(e.v) * (e.s < 3 ? 1 : -1); e.s = Math.max(3, Math.min(r.length - 3, e.s)); }
      if (e.dir === -1 && e.s < car.s - 40 && !seen(e)) e.alive = false;  // oncoming car passed and out of view
      if (e.dir === 1 && !e.parked && !e.scenery && e.s > r.length - 30) {
        if (!seen(e)) e.alive = false;                                 // drove on out of view
        else if (e.s > r.length - 12) Object.assign(e, { parked: true, v: 0, backup: false });   // the street ends in sight: it pulls up there
      }
      if ((e.s < -20 || e.s > r.length + 20) && (!seen(e) || e.s < -60 || e.s > r.length + 60)) e.alive = false;   // off the mapped street, out of sight

      // collision / near miss (route space box test)
      if (e.solid && !e.scenery && !e.hitDone) {
        const ds = Math.abs(e.s - car.s), dd = Math.abs(e.d - car.d);
        const hitS = PLAYER.halfL + e.L / 2 - 0.25, hitD = PLAYER.halfW + e.W / 2 - 0.12;
        if (ds < hitS && dd < hitD) {
          if (ON_FOOT.has(e.type)) {            // nobody gets hurt: they leap clear, you lose the moment
            e.leaving = true; e.home2 = Math.sign(e.d - car.d || 1) * (r.hw(e.s) + 1.8); e.hitDone = true;
            if (e.type === 'dog') Object.assign(e, { crossing: 0, bolt: Math.sign(e.d - car.d || 1) });
            if (car.invuln <= 0) out.hits.push({ e, power: 0.6, label: 'WATCH IT!' });
          } else if (e.solid < 0.8) {           // cones / barricades go flying
            Object.assign(e, { flying: true, fs: e.s, fd: e.d, fz: 0.2, fvs: car.v * rnd(0.6, 0.9), fvd: (e.d - car.d) * 6 + rnd(-2, 2), fvz: rnd(3, 6), spin: 0, hitDone: true, scenery: true });
            if (car.invuln <= 0) out.hits.push({ e, power: e.solid, label: e.type === 'cone' ? '' : 'CRASH' });
          } else if (car.invuln <= 0) {
            // BUSTED only if you drove into the cruiser; creeping or stopped, a scrape is just a scrape
            out.hits.push(e.type === 'police' && car.v > 3 ? { e, power: 1, label: 'BUSTED', busted: true } : { e, power: 1, label: 'CRASH' }); e.hitDone = true;
            if (e.dir !== -1) e.v = Math.max(e.v, 0) + car.v * 0.3;   // rear-ended: shoved on; oncoming: carries on past
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
      if (!a.pts[a.i + 1] && !this.continueAmbient(a)) {
        const e = a.pts[a.pts.length - 1], f = a.pts[a.pts.length - 2] || e;
        if (!a.deck && r.distTo(e[0], e[1]) < r.hw(r.project(e[0], e[1]).s) + 4) {
          // the mapped way ends in OUR road: never stop there. Carry straight on across, as into the street's
          // continuation, and leave once out of sight (below)
          const L = Math.hypot(e[0] - f[0], e[1] - f[1]) || 1;
          a.pts = [...a.pts, [e[0] + (e[0] - f[0]) / L * 30, e[1] + (e[1] - f[1]) / L * 30]];
          if (a.hs) a.hs = [...a.hs, a.hs[a.hs.length - 1]];
          a.dead_end = false; a.through = true;
        } else {                                                        // dead end elsewhere: leave once nobody's looking
          if (a.x === undefined || !this.visible(a.x, a.y, a.zAbs, a.type === 'bus' ? 7 : 3.5)) a.dead = true;
          a.moved = 0; continue;
        }
      }
      if (a.through && !a.pts[a.i + 2] && a.t > 0.5 && a.x !== undefined && !this.visible(a.x, a.y, a.zAbs, a.type === 'bus' ? 7 : 3.5)) { a.dead = true; continue; }
      const [p, q] = [a.pts[a.i], a.pts[a.i + 1]];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const nt = a.t + a.v * dt / L, nx = p[0] + (q[0] - p[0]) * Math.min(nt, 1), ny = p[1] + (q[1] - p[1]) * Math.min(nt, 1);
      a.moved = a.x === undefined ? 0 : Math.hypot(nx - a.x, ny - a.y);
      // red light for them: stop short of the route while the player is anywhere near
      const near = !a.deck && Math.hypot(nx - car.pose.x, ny - car.pose.y) < 260;   // decks pass over: no light
      // stop line: the vehicle's whole front half stays clear of the route's road (a 12 m bus stops further back)
      const clear = VEHICLE[a.type][0] + (a.type === 'bus' ? 2.6 : 1.2) + 3;
      if (a.dead_end === undefined) { const e = a.pts[a.pts.length - 1]; a.dead_end = r.distTo(e[0], e[1]) < r.hw(r.project(e[0], e[1]).s) + 3 && !this.nextWay(a); }
      const dNext = r.distTo(nx, ny), hwHere = dNext < 20 ? r.hw(r.project(nx, ny).s) : 0;
      // the stop line: approaching our road and not yet in it (a vehicle already in the junction clears it)
      const stopLine = dNext < 20 && dNext < hwHere + clear && dNext < r.distTo(a.x ?? nx, a.y ?? ny) && dNext > hwHere + 0.3;
      // a signalised junction: go on ITS green; elsewhere: yield while the player is near
      const gate = stopLine ? this.signals?.crossGate(nx, ny) ?? null : null, hold = gate === null ? near : !gate;
      if (a.dead_end && stopLine && a.x !== undefined && !this.visible(a.x, a.y, a.zAbs, a.type === 'bus' ? 7 : 3.5)) { a.dead = true; continue; }   // gave up, out of sight
      if (!((hold || a.dead_end) && stopLine)) {
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
          const e = { type: a.type, s: pr.s, d: pr.d, solid: 1, color: a.color, cross: a };
          out.hits.push(a.type === 'police' && car.v > 3 ? { e, power: 1, label: 'BUSTED', busted: true } : { e, power: 1, label: 'CRASH' }); a.hitT = 1.5;
        }
      }
      if (a.hitT) a.hitT = Math.max(0, a.hitT - dt);
    }
    this.ambient = this.ambient.filter((a) => !a.dead);
    for (let k = 0; k < 2 && this.ambient.length < 14; k++) this.spawnAmbient(false);
    return out;
  }

  /** a water seller / panhandler working a red light (see planCorners). They wait on the corner; a beat after the
   *  light goes red they cross at the crosswalk in front of the stopped cars and work down the lane line (to the
   *  player's window if they're stopped nearby). After green they linger, head back up the line and cross to the
   *  corner once there's a gap: right across the front of anyone pulling off. */
  work(e, dt, car) {
    const r = this.route, red = (this.signals?.routeAspect(e.node) ?? 'G') !== 'G';
    if (red) { e.redT = (e.redT || 0) + dt; e.greenT = 0; } else { e.greenT = (e.greenT || 0) + dt; e.redT = 0; }
    const xs = e.line + 1.6, curbD = -(r.hw(xs) + 0.7);                           // the crosswalk, and the corner
    e.phase ??= 'corner';
    const out = red ? e.redT > e.delay : e.greenT < e.linger;
    let ts = e.post, td = -(r.hw(e.post) + 0.7), sp = 1.3;
    e.atWindow = false;
    if (e.phase === 'corner' && red && e.redT > e.delay) e.phase = 'out';
    if (e.phase === 'out') { ts = xs; td = this.laneLine(xs); }
    if (e.phase === 'line') {
      if (out) {
        ts = e.beat; td = this.laneLine(e.beat);
        if (car.v < 1 && e.line - car.s > 2 && e.line - car.s < 40 && Math.abs(car.s - e.beat) < 14 && !this.ents.some((o) => o !== e && o.worker && o.atWindow)) {
          ts = car.s + 0.7; td = car.d + 1.4; e.atWindow = true;                  // the driver's window (driver sits left)
        }
      } else { ts = xs; td = this.laneLine(xs); sp = 1.6; }                        // back up the line, briskly
    }
    if (e.phase === 'back') { ts = xs; td = curbD; sp = 1.7; }
    const ds = ts - e.s, dd = td - e.d, L = Math.hypot(ds, dd);
    if (L > 0.05) { const k = Math.min(1, sp * dt / L); e.s += ds * k; e.d += dd * k; e.hd = Math.atan2(dd, ds); }
    else {
      e.hd = Math.atan2(car.d - e.d, car.s - e.s);                                // standing: face the traffic
      if (e.phase === 'out') e.phase = 'line';
      else if (e.phase === 'back') e.phase = 'corner';
      else if (e.phase === 'line' && !out) {
        // a pedestrian's gap: nothing in our lanes about to reach the crosswalk (cars at the line pulling off count)
        const coming = (o) => o.s < xs && xs - o.s < 4 + Math.max(o.v || 0, 2) * 2.5 && o.d < 0.5;
        if (!coming(car) && !this.ents.some((o) => o.alive && CARS.has(o.type) && !o.parked && o.dir === 1 && coming(o))) e.phase = 'back';
      }
    }
    e.v = 0;
  }
  /** a stray dog: ambles along its sidewalk with sniffing stops; sometimes trots across the street ahead of the
   *  player (only when it's on screen and nothing is coming the other way, so it's always a fair dodge) */
  dog(e, dt, car, seen) {
    const r = this.route, hw = r.hw(e.s);
    let vs = 0, vd = 0;
    if (e.bolt) {                                                  // spooked: runs for the nearest sidewalk
      vd = e.bolt * 6;
      if (Math.abs(e.d) > hw + 1.2 && Math.sign(e.d) === e.bolt) { Object.assign(e, { side: e.bolt, bolt: 0, leaving: false }); setTimeout(() => { e.hitDone = false; }, 1500); }
    } else if (e.crossing) {
      vd = e.crossing * 3.3; vs = Math.sign(e.walk) * 0.4;
      if (Math.abs(e.d) > hw + e.off && Math.sign(e.d) === e.crossing) { e.side = e.crossing; e.crossing = 0; }
    } else {
      e.pause -= dt;
      if (e.pause < -rnd(5, 10)) e.pause = rnd(1, 3);            // stops to sniff now and then
      vs = e.pause > 0 ? 0 : e.walk;
      vd = (e.side * (hw + e.off) - e.d) * 2;                     // keeps to the sidewalk as the street widens
      if (e.s < 8 || e.s > r.length - 8) e.walk = Math.abs(e.walk) * (e.s < 8 ? 1 : -1);
      const ahead = e.s - car.s, eta = ahead / Math.max(car.v, 1);   // seconds until the player gets here
      if (!e.crossed && ahead > 30 && eta > 2.3 && eta < 3.6 && car.v > 4 && Math.random() < dt * 1.2 && seen(e, 1)
        && !this.ents.some((o) => o !== e && o.alive && VEHICLE[o.type] && (o.parked || !o.v ? Math.abs(o.s - e.s) < 4.5   // a parked car in the way
          : (o.s - e.s) * Math.sign(o.v) < 0 && Math.abs(o.s - e.s) < Math.abs(o.v) * 4 + 6))                        // or traffic about to get there
        && !(this.workZones || []).some(([a, b]) => e.s > a && e.s < b)) { e.crossing = -e.side; e.crossed = true; }
    }
    e.s += vs * dt; e.d += vd * dt; e.v = 0;
    if (Math.abs(vs) + Math.abs(vd) > 0.2) { e.hd = Math.atan2(vd, vs); e.gait += dt * (e.bolt ? 16 : e.crossing ? 12 : 7); }
  }

  /** push every live entity into its InstancedMesh */
  render(car, t) {
    const counts = {}; for (const k in this.meshes) counts[k] = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), c = new THREE.Color(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    const sc3 = new THREE.Vector3(); let halos = 0;
    const put = (type, x, y, z, yaw, color, roll = 0, pitch = 0, sc = one) => {
      const im = this.meshes[type], i = counts[type]; if (i >= im.instanceMatrix.count) return;
      m4.compose(pos.set(x, z, -y), q.setFromEuler(e3.set(pitch, yaw - Math.PI / 2, roll, 'YXZ')), sc);
      im.setMatrixAt(i, m4); im.setColorAt(i, c.set(color)); counts[type]++;
    };
    // drawn: everything near the car, plus anything farther that the camera can see (the margin grows with
    // distance, so a turning camera never sweeps an undrawn car into view)
    const win0 = car.s - 60, win1 = car.s + 280, cam = this.camera?.position;
    for (const e of this.ents) {
      if (e.type === 'tram' || e.s < car.s - 400 || e.s > car.s + 800) continue;   // (tram.js draws the streetcar)
      const p = this.route.at(e.s, e.d);
      if ((e.s < win0 || e.s > win1) && !(cam && this.visible(p.x, p.y, p.z + 0.8, 4 + Math.hypot(p.x - cam.x, p.z - cam.y, -p.y - cam.z) * 0.04))) continue;
      let yaw = p.a + (e.dir === -1 ? Math.PI : 0) + (e.yawOff || 0) + (e.v < 0 && e.scenery ? Math.PI : 0);
      const inStreet = Math.abs(e.d) < this.route.hw(e.s) + 0.2, lvl = inStreet ? LEVEL.ROUTE : LEVEL.TERRAIN;
      // anything standing IN the street (cones, barricades, a panhandler) stands on the rendered road surface
      let z = inStreet ? (this.surfAt(p.x, p.y, p.z + 1.2) ?? p.z + lvl) : p.z + lvl, roll = 0, pitch = 0;
      const afoot = ON_FOOT.has(e.type) || e.type === 'cooler';
      if (afoot && !inStreet) z = Math.max(this.surfAt(p.x, p.y, p.z + 1.2) ?? -Infinity, p.z + LEVEL.TERRAIN);   // sidewalk / curb top
      if (inStreet && (e.type === 'cone' || e.type === 'barricade') && !e.flying) { // sit flat on the slope
        const g = this.route.ground, on = (x, y) => this.surfAt(x, y, g(x, y) + 1.2) ?? g(x, y) + lvl;
        const st = standOn(on, p.x, p.y, yaw, 0.2, 0.2); z = st.z; pitch = st.pitch; roll = st.roll;
      }
      if (VEHICLE[e.type] && !e.flying) { // all four wheels on the rendered road surface, whatever the slope
        const g = this.route.ground, on = (x, y) => this.surfAt(x, y, g(x, y) + 1.2) ?? g(x, y) + lvl;
        const st = standOn(on, p.x, p.y, yaw, VEHICLE[e.type][0], VEHICLE[e.type][1]);
        z = st.z; pitch = st.pitch; roll = st.roll;
      }
      if (e.hd !== undefined) yaw = p.a + e.hd;                 // people and dogs face where they're going
      else if (e.type === 'panhandler') yaw = p.a + Math.PI;
      if (e.flying) { z += e.fz; roll = e.spin; pitch = e.spin * 0.7; }
      if (afoot) { pitch = 0; roll = 0; }
      const big = HAZARD_SCALE[e.type];                                       // drawn bigger than life: they read on a phone
      put(e.type === 'dog' ? (Math.sin(e.gait) > 0 ? 'dog_a' : 'dog_b') : e.type, p.x, p.y, z, yaw, e.color, roll, pitch, big ? sc3.setScalar(big) : one);
      if (HALO[e.type] && !e.flying && !e.hitDone && Math.abs(e.d) < this.route.hw(e.s) + 0.3 && e.s > car.s - 4 && e.s - car.s < 110 && halos < 200) {
        const [rad, col] = HALO[e.type], pulse = 1 + 0.12 * Math.sin(t * 7 + e.s);
        m4.compose(pos.set(p.x, (inStreet ? (this.surfAt(p.x, p.y, p.z + 1.2) ?? z) : z) + 0.14, -p.y), q.identity(), sc3.set(rad * pulse, 1, rad * pulse));
        this.halo.setMatrixAt(halos, m4); this.halo.setColorAt(halos, c.set(col)); halos++;
      }
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
    this.halo.count = halos; this.halo.instanceMatrix.needsUpdate = true; this.halo.instanceColor.needsUpdate = true;
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
