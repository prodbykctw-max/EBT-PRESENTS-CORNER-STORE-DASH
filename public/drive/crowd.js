// Procedural sidewalk crowd. One parametric low-poly person (~200 tris) drawn as ONE InstancedMesh, varied per
// instance: height, build, skin, top, bottoms, hair/hat/bag. The walk cycle runs in the vertex shader (legs and arms
// swing about hip/shoulder pivots, body bob), so hundreds of people cost one draw call and no skeletons: phone-safe.
// Behaviour runs in route space (s along, d across): people move in small groups along each sidewalk band (clear
// of buildings and of the route's roadway), step round trees/lamps/benches/shelters and oncoming groups, stand and
// talk, wait at bus shelters, hang out at the corner store, and flinch back from the curb when the car or the horn
// comes close. The whole route is populated from the start; only the stretch around the car is simulated and drawn,
// so nobody is ever spawned, moved or removed where the player could see it.
import * as THREE from './vendor/three.module.min.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { LEVEL } from './levels.js';
import { uploadUsed, shadowSplit } from './runner.js';

const rnd = (a, b) => a + Math.random() * (b - a);
// palettes (sRGB); skin weighted to the neighbourhood
const SKIN = [0x3a2219, 0x4a2c1e, 0x5c3824, 0x6e4430, 0x7d4f35, 0x8e5d3f, 0xa66f4b, 0xc48a65, 0xe0b08c];
const TOPS = [0xd94f3d, 0x3b6fb6, 0xf0c33c, 0x2b2b30, 0xeeeeea, 0x3d9a5b, 0x8e44ad, 0xff8c1a, 0x1abc9c, 0x7f8c8d,
  0xc0392b, 0x16325c, 0xf4d8b0, 0x6b4f3a, 0xe84393, 0x0f0f12, 0x9aa5b1];
const BOTTOMS = [0x1f2a44, 0x2b2b30, 0x3c4b63, 0x5a5048, 0x151518, 0x6e7b8b, 0xb8a98a, 0x4a3b2f, 0x273b2a];
const ACCENT = [0x121212, 0x2a1a12, 0x3d2616, 0x7a1f1f, 0x1d3f8a, 0xe6e6e6, 0xd4a017, 0x2e7d32];
const ACC = { cap: 1, long: 2, bag: 4, hood: 8 };
const SIM = [-130, 380];   // route-space window around the car that is always simulated (plus anyone on screen)   // accessory bits (vertex attr aAcc, instance mask)
// radius each street-furniture type blocks on the sidewalk (m)
const FURNITURE = { tree_round: 0.45, tree_upright: 0.35, lamp: 0.2, signal: 0.25, bench: 0.85, bin: 0.3, hydrant: 0.25, shelter: 1.6 };

// ------------------------------------------------------------------ the person (faces +Z, feet at y = 0)
function personGeometry() {
  const parts = [];
  // slot: 0 skin 1 top 2 bottoms 3 accent 4 shoes | part: 0 body 1 leg L 2 leg R 3 arm L 4 arm R | pivot: joint height
  const add = (g, slot, part, pivot, acc = 0) => {
    g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv');
    const n = g.attributes.position.count, info = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) info.set([slot, part, pivot, acc], i * 4);
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));   // packed: WebGL caps a draw at 16 attributes
    parts.push(g);
  };
  const box = (w, h, d, x, y, z, slot, part, pivot, acc, taperTop = 1) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (taperTop !== 1) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) { p.setX(i, p.getX(i) * taperTop); } }
    g.translate(x, y, z); add(g, slot, part, pivot, acc);
  };
  const HIP = 0.9, SH = 1.4;
  for (const [sx, part] of [[-1, 1], [1, 2]]) {                                    // legs + shoes
    box(0.15, 0.8, 0.17, sx * 0.1, 0.49, 0, 2, part, HIP);
    box(0.15, 0.09, 0.27, sx * 0.1, 0.045, 0.05, 4, part, HIP);
  }
  box(0.36, 0.2, 0.21, 0, 0.93, 0, 2, 0, 0);                                         // hips (bottoms)
  box(0.44, 0.52, 0.24, 0, 1.24, 0, 1, 0, 0, 0, 0.8);                                // torso, shoulders wider than waist
  box(0.1, 0.1, 0.1, 0, 1.53, 0, 0, 0, 0);                                           // neck
  const head = new THREE.IcosahedronGeometry(0.115, 1); head.scale(0.92, 1.05, 1); head.translate(0, 1.64, 0.01); add(head, 0, 0, 0);
  const hair = new THREE.IcosahedronGeometry(0.122, 1); hair.scale(0.95, 0.75, 1.02); hair.translate(0, 1.7, -0.01); add(hair, 3, 0, 0);
  for (const [sx, part] of [[-1, 3], [1, 4]]) {                                     // arms (sleeve) + hands
    box(0.11, 0.58, 0.13, sx * 0.275, 1.12, 0, 1, part, SH);
    box(0.09, 0.1, 0.1, sx * 0.275, 0.78, 0, 0, part, SH);
  }
  box(0.27, 0.07, 0.27, 0, 1.77, 0.02, 3, 0, 0, ACC.cap);                            // cap crown …
  box(0.22, 0.025, 0.15, 0, 1.745, 0.17, 3, 0, 0, ACC.cap);                          // … and brim
  box(0.24, 0.34, 0.07, 0, 1.52, -0.1, 3, 0, 0, ACC.long);                            // long hair / locs down the back
  box(0.3, 0.36, 0.14, 0, 1.22, -0.19, 3, 0, 0, ACC.bag);                             // backpack
  box(0.3, 0.12, 0.12, 0, 1.5, -0.14, 1, 0, 0, ACC.hood);                             // hoodie hood (top colour)
  const g = mergeGeometries(parts); g.computeBoundingSphere();
  return g;
}

// vertex/fragment patch shared by the colour material and the shadow depth material
const HEAD = /* glsl */`
attribute vec4 aInfo;   // x colour slot · y limb (0 body, 1/2 legs, 3/4 arms) · z joint height · w accessory bit
#define aSlot aInfo.x
#define aPart aInfo.y
#define aPivot aInfo.z
#define aAcc aInfo.w
attribute vec4 iAnim;   // x gait phase (rad) · y stride amount 0..1 · z accessory mask · w facing-lean
attribute vec2 iPose;   // x phone-in-hand 0/1 · y startle 0..1 (hands up)
mat3 crowdRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
float crowdAngle() {
  float sw = sin(iAnim.x) * 0.6 * iAnim.y;
  if (aPart > 0.5 && aPart < 1.5) return sw;
  if (aPart > 1.5 && aPart < 2.5) return -sw;
  float arm = aPart > 2.5 && aPart < 3.5 ? -sw * 0.85 : sw * 0.85;
  if (aPart > 3.5 && iPose.x > 0.5) arm = -1.15;                 // right hand up, looking at the phone
  if (aPart > 2.5) return mix(arm, -2.55, iPose.y);              // startled: both hands up
  return 0.0;
}
bool crowdHidden() { return aAcc > 0.5 && mod(floor(iAnim.z / aAcc + 0.001), 2.0) < 0.5; }
`;
const BEGIN = /* glsl */`
vec3 transformed = vec3(position);
if (crowdHidden()) transformed = vec3(0.0, 1.2, 0.0);           // accessory not worn: collapse inside the torso
float cA = crowdAngle();
if (aPart > 0.5) transformed = vec3(0.0, aPivot, 0.0) + crowdRotX(cA) * (transformed - vec3(0.0, aPivot, 0.0));
transformed.y += abs(sin(iAnim.x)) * 0.04 * iAnim.y;             // bob on each step
transformed.z += transformed.y * iAnim.w;                        // lean (into the walk / away from a startle)
`;
function patch(shader, colour) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + HEAD + (colour ? `attribute vec4 iPal;   // palette indices: skin, top, bottoms, accent
uniform vec3 uSkin[${SKIN.length}]; uniform vec3 uTop[${TOPS.length}]; uniform vec3 uBottom[${BOTTOMS.length}]; uniform vec3 uAccent[${ACCENT.length}];
varying vec3 vTint;` : ''))
    .replace('#include <begin_vertex>', BEGIN + (colour ? `
vTint = aSlot < 0.5 ? uSkin[int(iPal.x)] : aSlot < 1.5 ? uTop[int(iPal.y)] : aSlot < 2.5 ? uBottom[int(iPal.z)] : aSlot < 3.5 ? uAccent[int(iPal.w)] : vec3(0.06);` : ''));
  if (colour) {
    for (const [k, list] of [['uSkin', SKIN], ['uTop', TOPS], ['uBottom', BOTTOMS], ['uAccent', ACCENT]])
      shader.uniforms[k] = { value: list.map((h) => new THREE.Vector3(...new THREE.Color(h).toArray())) };   // linear
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = aPart > 0.5 ? crowdRotX(crowdAngle()) * vec3(normal) : vec3(normal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTint;');
  }
}

// ------------------------------------------------------------------ crowd
export class Crowd {
  /**
   * route: RouteFrame · ground(x,y) · surfAt(x,y,below) road-surface height or null · onRoute(x,y) on the route's roadway
   * isFree(x,y) outside buildings · furniture: {type: [[x,y,...],...]} street props · visible(x,y,z,r) camera test · camera
   * spot: parking space {s,d} (the corner store is on its side) · mobile: phone budget
   */
  constructor({ route, ground, surfAt, onRoute, isFree, furniture, visible, camera, spot, mobile, scene }) {
    Object.assign(this, { route, ground, surfAt, visible, camera });
    // the whole route is populated from the start (one person per ~5 m of sidewalk, 6.5 m on phones); only the
    // stretch around the car is simulated and drawn, so nobody ever has to be moved or spawned in view
    this.spacing = mobile ? 6.5 : 5;
    // --- sidewalk bands every 2 m on each side: from just past the curb/roadway out to the building line
    const n = Math.ceil(route.length / 2) + 1;
    this.band = { 1: [new Float32Array(n), new Float32Array(n)], [-1]: [new Float32Array(n), new Float32Array(n)] };
    for (const side of [1, -1]) for (let i = 0; i < n; i++) {
      const s = i * 2, hw = route.hw(s);
      let lo = hw + 0.9;
      while (lo < hw + 4 && onRoute(...xy(route.at(s, side * lo)))) lo += 0.3;       // wider pavement than the frame
      lo += 0.35;
      let hi = lo;
      for (let dd = lo; dd <= hw + 5; dd += 0.25) { const p = route.at(s, side * dd); if (!isFree(p.x, p.y)) break; hi = dd; }
      this.band[side][0][i] = lo; this.band[side][1][i] = Math.max(lo, hi - 0.35);
    }
    // --- street furniture in route space, per side (people walk round it)
    this.obst = { 1: [], [-1]: [] }; const shelters = [];
    for (const [type, list] of Object.entries(furniture || {})) for (const [x, y] of list) {
      if (!FURNITURE[type]) continue;
      const pr = route.project(x, y); if (pr.s < 0 || pr.s > route.length) continue;
      if (Math.abs(pr.d) > route.hw(pr.s) + 6 || route.distTo(x, y) > 12) continue;
      const side = Math.sign(pr.d) || 1; this.obst[side].push({ s: pr.s, d: Math.abs(pr.d), r: FURNITURE[type] });
      if (type === 'shelter') shelters.push({ s: pr.s, side, d: Math.abs(pr.d) });
    }
    for (const side of [1, -1]) this.obst[side].sort((a, b) => a.s - b.s);

    // --- the mesh
    const geo = personGeometry();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    mat.onBeforeCompile = (sh) => patch(sh, true);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (sh) => patch(sh, false);

    // --- population: anchored groups (store front, bus shelters), then groups spread evenly down both sidewalks
    this.groups = []; this.people = [];
    const store = Math.sign(spot.d) || -1;
    this.addGroup({ kind: 'talk', s: spot.s + 4, side: store, n: 3, anchored: true });
    this.addGroup({ kind: 'wait', s: spot.s - 6, side: store, n: 2, anchored: true });
    for (const sh of shelters) this.addGroup({ kind: 'wait', s: sh.s + rnd(-1, 1), side: sh.side, n: 1 + ((Math.random() * 3) | 0), anchored: true, dAt: sh.d + 1.2 });
    for (const side of [1, -1]) for (let s = rnd(2, 8); s < route.length - 4;) {
      const g = this.addGroup({ ...this.randomGroup(s), side });
      s += g.members.length * this.spacing * rnd(0.6, 1.4);            // stratified: even overall, never regular
    }
    // one instance slot per person: whatever the camera sees can be drawn (only the drawn ones cost GPU time)
    const cap = this.people.length;
    const inst = (k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.attr = { iAnim: inst(4), iPose: inst(2), iPal: inst(4) };
    for (const [k, a] of Object.entries(this.attr)) geo.setAttribute(k, a);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    Object.assign(this.mesh, { name: 'crowd', frustumCulled: false, castShadow: !mobile, receiveShadow: true, customDepthMaterial: depth, count: 0 });
    shadowSplit(this.mesh);
    scene.add(this.mesh);
    this.t = 0;
  }

  bandAt(side, s) {
    const i = Math.max(0, Math.min(this.band[side][0].length - 1, Math.round(s / 2)));
    return [this.band[side][0][i], this.band[side][1][i]];
  }
  randomGroup(s) {
    const r = Math.random();
    const kind = r < 0.7 ? 'walk' : r < 0.9 ? 'talk' : 'solo';
    const n = kind === 'walk' ? (Math.random() < 0.6 ? 1 : Math.random() < 0.75 ? 2 : 3) : kind === 'talk' ? 2 + ((Math.random() * 3) | 0) : 1;
    return { kind, s, side: Math.random() < 0.5 ? 1 : -1, n };
  }
  person() {
    const acc = (Math.random() < 0.22 ? ACC.cap : 0) | (Math.random() < 0.25 ? ACC.long : 0) | (Math.random() < 0.2 ? ACC.bag : 0) | (Math.random() < 0.18 ? ACC.hood : 0);
    const ix = (a) => (Math.random() * a.length) | 0;
    return { h: rnd(0.9, 1.1), w: rnd(0.88, 1.15), pal: [ix(SKIN), ix(TOPS), ix(BOTTOMS), ix(ACCENT)], acc,
      phase: rnd(0, 6.28), phone: 0, startle: 0, lean: 0, ds: 0, dd: 0, s: 0, d: 0, yaw: 0, yi: 0 };
  }
  addGroup({ kind, s, side, n, anchored = false, dAt }) {
    const g = { kind, s, side, anchored, dir: kind === 'walk' ? (Math.random() < 0.5 ? 1 : -1) : 0, v: rnd(1.05, 1.6), lane: rnd(0.15, 0.85), members: [] };
    const [lo, hi] = this.bandAt(side, s);
    g.cd = dAt ?? lo + g.lane * (hi - lo);
    for (let k = 0; k < n; k++) {
      const p = this.person(); p.g = g;
      if (kind === 'walk') { p.dd = (k - (n - 1) / 2) * 0.62; p.ds = rnd(-0.25, 0.25); }
      else { const a = (k / n) * Math.PI * 2 + rnd(-0.3, 0.3), rr = n === 1 ? 0 : 0.55; p.ds = Math.cos(a) * rr; p.dd = Math.sin(a) * rr; }
      if (kind === 'wait' || kind === 'solo') p.phone = Math.random() < 0.55 ? 1 : 0;
      if (kind === 'talk') p.phone = Math.random() < 0.15 ? 1 : 0;
      p.s = s + p.ds; p.d = g.cd + p.dd;
      g.members.push(p); this.people.push(p); this.face(p);
    }
    this.groups.push(g);
    return g;
  }

  update(dt, car, hornT) {
    this.t += dt;
    if (!this._init) { this._init = true; for (const m of this.people) this.traits(m); }
    const r = this.route, sim0 = car.s + SIM[0], sim1 = car.s + SIM[1];
    this.watch(dt);
    // simulate what's near the car or on screen; everyone else is out of sight and simply waits
    const active = this.groups.filter((g) => (g.s > sim0 && g.s < sim1) || g.members.some((m) => m.on));
    const walkers = { 1: [], [-1]: [] };
    for (const g of active) if (g.kind === 'walk') walkers[g.side].push(g);
    for (const g of active) {
      const [lo, hi] = this.bandAt(g.side, g.s), half = g.kind === 'walk' ? ((g.members.length - 1) / 2) * 0.62 + 0.3 : 0.6;
      let target = g.anchored ? g.cd : Math.min(Math.max(lo + g.lane * (hi - lo), lo + half), Math.max(lo + half, hi - half));
      let single = false;
      if (g.kind === 'walk') {
        g.s += g.dir * g.v * dt;
        if (g.s < 3 || g.s > r.length - 3) { g.dir = g.s < 3 ? 1 : -1; g.s = Math.max(3, Math.min(r.length - 3, g.s)); }
        // street furniture a few steps ahead: pass on the roomier side, or go single file
        // (the list is sorted by s: start a little before the first one that can be within 3.5 m and stop a little past it, instead of
        // walking every tree and lamp on that side of the route for every group, every frame; same order, same pick)
        const obs = this.obst[g.side];
        let lo0 = 0, hi0 = obs.length;
        while (lo0 < hi0) { const mid = (lo0 + hi0) >> 1; if (obs[mid].s < g.s - 3.6) lo0 = mid + 1; else hi0 = mid; }
        for (let oi = lo0; oi < obs.length && obs[oi].s <= g.s + 3.6; oi++) {
          const o = obs[oi];
          const ahead = (o.s - g.s) * g.dir; if (ahead < -0.8 || ahead > 3.5) continue;
          if (Math.abs(o.d - g.cd) > o.r + half + 0.15) continue;
          const left = o.d - o.r - half - 0.2, right = o.d + o.r + half + 0.2;
          if (left >= lo) target = right <= hi && right - g.cd < g.cd - left ? right : left;
          else if (right <= hi) target = right;
          else { single = true; target = o.d - o.r - 0.35 >= lo - 0.2 ? Math.max(lo, o.d - o.r - 0.35) : Math.min(hi, o.d + o.r + 0.35); }
          break;
        }
        // oncoming groups: both keep to their own right
        for (const o of walkers[g.side]) {
          if (o === g || o.dir === g.dir) continue;
          const gap = (o.s - g.s) * g.dir; if (gap < 0 || gap > 4) continue;
          if (Math.abs(o.cd - g.cd) < half + 0.7) target += -g.dir * g.side * 0.55;
        }
        target = Math.min(hi, Math.max(lo, target));
      }
      g.cd += Math.max(-1.3 * dt, Math.min(1.3 * dt, target - g.cd));
      // the car or the horn: flinch away from the curb
      const near = g.s - car.s, curbSide = Math.sign(car.d) === g.side && Math.abs(car.d) > r.hw(car.s) - 2.2;
      const scare = (near > -3 && near < 7 && curbSide ? 1 : 0) || (hornT > 0 && Math.abs(near) < 25 ? 0.55 : 0);
      // the runner and the bully coming up the pavement: who sees it, who steps where (see react)
      const picks = this.thr.length ? [] : null;
      g.members.forEach((m, k) => {
        m.startle = Math.max(scare, m.startle - dt * 1.4);
        // m.shove: knocked aside (drive.js, when the runner or the bully barges into them on foot), easing back over ~2 s
        if (m.shove) { m.shove *= Math.exp(-dt * 0.9); if (Math.abs(m.shove) < 0.01) m.shove = 0; }
        const [mlo, mhi] = this.bandAt(g.side, m.s);
        m.sT = g.s + (single ? -g.dir * k * 0.85 : m.ds);
        m.dT = Math.min(mhi + 0.3, g.cd + (single ? 0 : m.dd) + m.startle * 0.9 + (m.shove || 0));   // where they'd stand if nobody came
        m.lo = mlo; m.hi = mhi;
        if (picks) this.react(m, g, dt, picks);
        else this.calm(m, dt);
      });
      if (picks && picks.length > 1) this.spread(picks);
      g.members.forEach((m, k) => {
        // move: critically damped springs (no overshoot, no snapping, the same at any frame rate). Along the walk they ride
        // the group's own speed; across they ease to where they'd stand, or to the gap they've picked to let you by
        const evading = m.ev !== null;
        const vt = g.kind === 'walk' ? g.dir * g.v : 0;
        const dT = evading ? Math.min(m.hi + 0.1, Math.max(m.lo - 0.25, m.ev + (m.shove || 0))) : m.dT;
        const w = evading ? m.wEv : 6.5;
        this.spring(m, 's', 'vs', m.sT, vt, 6, dt);
        const d0 = m.d;
        this.spring(m, 'd', 'vd', dT, 0, w, dt);
        const vmax = 4.2;
        if (m.vd > vmax) m.vd = vmax; else if (m.vd < -vmax) m.vd = -vmax;
        if (m.ev !== null || m.shove) this.keepOut(m, g.side, d0);
        const speed = Math.hypot(m.vs, m.vd);
        m.sp += (speed - m.sp) * Math.min(1, dt * 12);
        // legs follow the ground actually covered (a step aside is a few quick steps, standing is a slow weight shift)
        m.phase += dt * (m.sp > 0.2 ? m.sp * 2 * Math.PI / (1.35 * m.h) : 0.7);
        m.lean = Math.min(0.09, m.sp * 0.025) - Math.max(m.startle, m.fl) * 0.08;
        if (m.fl > 0) m.fl = Math.max(0, m.fl - dt * 1.6);
        if (m.hop >= 0) { m.hop += dt / 0.4; if (m.hop >= 1) m.hop = -1; }
        this.face(m);
        const da = Math.atan2(Math.sin(m.yawT - m.yaw), Math.cos(m.yawT - m.yaw));
        const turn = da * Math.min(1, dt * (m.lkT > 0 ? 12 : 7)), cap = 14 * dt;   // eased, and never faster than a quick turn on the spot
        m.yaw += Math.max(-cap, Math.min(cap, turn));
        m.dirty = true;
      });
    }
    this.render(car);
  }

  // ------------------------------------------------------------------ people see you coming
  /** per person, once: how attentive they are. About one in five is distracted (a phone, a conversation) and only looks up
   *  when you're nearly on them, so running into someone is rare, not impossible. */
  traits(m) {
    const late = Math.random() < 0.2;
    Object.assign(m, {
      late, flinchy: Math.random() < 0.5,
      tl: late ? rnd(0.2, 0.34) : rnd(1.6, 2.1),     // seconds before you'd reach them that they notice you (the bully: shorter)
      dl: late ? rnd(0.1, 0.18) : rnd(0.14, 0.34),   // …and how long they take to start moving once they have
      wEv: late ? 9 : rnd(7, 10.5),                  // how brisk the step aside is (spring rate)
      vs: m.g.kind === 'walk' ? m.g.dir * m.g.v : 0, vd: 0, sp: 0, sT: m.s, dT: m.d, lo: 0, hi: 0,
      ev: null, evSide: 0, nt: -1, rl: 0, lkT: 0, lkS: 0, lkD: 0, fl: 0, hop: -1, yawT: m.yaw, yi: 1,
    });
  }
  /** the runner and the bully this frame (drive.js sets crowd.runner / crowd.chaser every on-foot step: route-space s, d, v) */
  watch(dt) {
    const T = this.thr || (this.thr = []), W = this._w || (this._w = {}); T.length = 0;
    for (const who of ['runner', 'chaser']) {
      const o = this[who]; if (!o) continue;
      const w = W[who] || (W[who] = { t: NaN, age: 9, d: 0, s: 0, dv: 0, init: false });
      if (o.t !== w.t) { w.t = o.t; w.age = 0; } else w.age += dt;
      if (w.age > 0.3) { w.init = false; continue; }                    // not on foot any more: nobody reacts
      if (w.init && Math.abs(o.s - w.s) < 3 && dt > 1e-5) w.dv += ((o.d - w.d) / dt - w.dv) * Math.min(1, dt * 10);   // sideways speed
      else w.dv = 0;
      w.init = true; w.d = o.d; w.s = o.s;
      T.push({ who, s: o.s, d: o.d, v: o.v, dv: w.dv, clear: who === 'runner' ? 0.95 : 1.05 });
    }
  }
  /** nobody is coming: wind down any reaction */
  calm(m, dt) {
    if (m.nt >= 0) m.nt = -1;
    // (they close back up a moment after you've gone by; sooner if the spot they stepped to is now in the way of a tree or bench)
    if (m.ev !== null) { m.rl -= dt; if (m.rl <= 0 || this.blocked(m.g.side, m.s, m.ev)) { m.ev = null; m.evSide = 0; } }
    if (m.lkT > 0) m.lkT -= dt;
  }
  /** Anyone ahead of the runner (or the bully) within a few seconds of reaching them sees them coming: they look, a
   *  moment later they step out of the way (toward the buildings, or toward the curb if that side has the room), some
   *  flinch or hop back, and they close back up once you're past. Distance scales with speed because it's seconds. */
  react(m, g, dt, picks) {
    const side = g.side;
    let seen = false, hold = false, need = false, ints = null, lookAt = null, dirS = 1, byRunner = false;
    for (const tr of this.thr) {
      if (Math.abs(m.s - tr.s) > 24) continue;
      const speed = Math.abs(tr.v), moving = speed >= 0.5;
      dirS = tr.v >= 0 ? 1 : -1;
      const rel = (m.s - tr.s) * dirS, cdr = side * tr.d, cdv = side * tr.dv;   // crowd d: + toward the buildings
      if (Math.abs(cdr - m.d) > 4.5) continue;                                   // across the street: not their business
      let tA;
      if (moving) {
        const closing = speed - m.vs * dirS;
        if (rel < -0.9 || (closing < 0.35 && rel > 1.2)) continue;
        tA = rel <= 0 ? 0 : rel / Math.max(0.35, closing);
      } else { if (Math.abs(rel) > 1.6) continue; tA = 0; }
      const bully = tr.who === 'chaser';
      // the bully's path clears a little later (shorter look-ahead, a longer pause before they move); once they're stepping aside
      // they hold it until he's past too, instead of drifting back in front of him
      const tl = (bully ? Math.min(m.tl, 1.15) : m.tl) * (m.ev !== null ? 1.5 : 1);
      if (tA > tl && rel > 1.5) { if (bully && m.ev !== null && rel < 16 && moving) hold = true; continue; }
      seen = true; hold = true; if (!bully) byRunner = true;
      lookAt = tr;
      const c = Math.min(m.hi + 0.6, Math.max(m.lo - 0.8, cdr + Math.max(-2, Math.min(2, cdv)) * Math.min(tA, 0.4)));   // where they'll be when they reach them
      // (a runner who is changing lanes could end up anywhere across it, so the gap widens with his sideways speed)
      const cl = tr.clear + Math.min(0.35, 0.08 + 0.15 * Math.abs(cdv));
      (ints || (ints = [])).push([c - cl, c + cl, c]);
      if ((m.dT > c - cl - 0.05 && m.dT < c + cl + 0.05) || (m.d > c - cl - 0.05 && m.d < c + cl + 0.05)) need = true;
    }
    if (!seen) {
      if (m.nt >= 0 && m.ev === null) m.nt = -1;
      if (hold) m.rl = 0.5;
      this.calm(m, dt); return;
    }
    // noticed: look; after their reaction time, move
    if (m.nt < 0) m.nt = 0; else m.nt += dt;
    const dly = m.dl + (byRunner ? 0 : 0.22);
    if (m.nt > 0.04) { m.lkT = 0.9; m.lkS = lookAt.s; m.lkD = lookAt.d; }
    m.rl = 0.5;
    if (!need) { if (m.ev !== null && m.nt >= dly) this.evade(m, side, ints, picks, dirS); return; }
    if (m.nt < dly) return;
    this.evade(m, side, ints, picks, dirS);
  }
  /** pick the gap: just outside every path that's coming, on a side with room (not through a tree or a wall) */
  evade(m, side, ints, picks, dirS) {
    const lo = m.lo - 0.25, hi = m.hi + 0.1;   // right up to the wall, or to the very edge of the curb
    const inside = (x, eps = 0) => ints.some((i) => x > i[0] - eps && x < i[1] + eps);
    const cand = [];
    for (const i of ints) for (const x of [i[1] + 0.05, i[0] - 0.05]) {
      if (x < lo || x > hi || inside(x, 0.02) || this.blocked(side, m.s, x, m.d)) continue;
      cand.push(x);
    }
    let x = null;
    if (cand.length) {
      let best = Infinity;
      for (const c of cand) {
        const sd = c > ints[0][2] ? 1 : -1;
        const cost = Math.abs(c - m.d) + (c < m.d ? 2 : 0) + (m.evSide && sd !== m.evSide ? 8 : 0);
        if (cost < best) { best = cost; x = c; }
      }
    } else {   // no room to get clear: go to the edge farthest from the path, as far as the pavement and the furniture allow
      const c0 = ints[0][2], far = m.evSide ? (m.evSide > 0 ? hi : lo) : c0 > (lo + hi) / 2 ? lo : hi;   // (keeping to the side they chose)
      x = null; for (let k = 0; k <= 12 && x === null; k++) { const t = far + (far === lo ? 1 : -1) * 0.12 * k; if (!this.blocked(side, m.s, t, m.d)) x = t; }
      if (x === null) x = m.d;   // boxed in by furniture: stay put (and flinch)
    }
    const started = m.ev === null;
    m.ev = x; m.evSide = x > ints[0][2] ? 1 : -1;
    if (started && m.flinchy) { m.fl = 1; m.hop = 0; m.vs += dirS * 1.3; }   // a flinch: hands up and a little hop back
    picks.push(m);
  }
  /** two people stepping to the same side shouldn't stack on each other: the outer one takes the outer spot */
  spread(picks) {
    for (const sd of [1, -1]) {
      const grp = picks.filter((m) => m.ev !== null && m.evSide === sd && Math.abs(m.ev - picks.find((o) => o.evSide === sd).ev) < 0.5);
      if (grp.length < 2) continue;
      grp.sort((a, b) => (b.d - a.d) * sd);                         // the one nearest the edge they're heading for goes first
      grp.forEach((m, k) => { const nx = Math.min(m.hi + 0.1, Math.max(m.lo - 0.25, m.ev + sd * 0.42 * (grp.length - 1 - k))); if (!this.blocked(m.g.side, m.s, nx, m.d)) m.ev = nx; });
    }
  }
  /** is standing at crowd-d x (at s) inside a trunk, pole, bench or shelter? `from` is where they are now: crossing one is blocked too */
  blocked(side, s, x, from) {
    const obs = this.obst[side];
    let a = 0, b = obs.length;
    while (a < b) { const mid = (a + b) >> 1; if (obs[mid].s < s - 3) a = mid + 1; else b = mid; }
    for (let i = a; i < obs.length && obs[i].s <= s + 3; i++) {
      const o = obs[i], gap = o.r + 0.3, ds = Math.abs(o.s - s); if (ds >= gap) continue;
      const hw = Math.sqrt(gap * gap - ds * ds), lo = o.d - hw, hi = o.d + hw;
      if (x > lo && x < hi) return true;
      if (from !== undefined && ((from <= lo && x >= hi) || (from >= hi && x <= lo))) return true;
    }
    return false;
  }
  /** last line of defence: nobody ends a frame inside street furniture or a wall (pushed out along the pavement's width) */
  keepOut(m, side, d0) {
    const obs = this.obst[side];
    let a = 0, b = obs.length;
    while (a < b) { const mid = (a + b) >> 1; if (obs[mid].s < m.s - 2.5) a = mid + 1; else b = mid; }
    for (let i = a; i < obs.length && obs[i].s <= m.s + 2.5; i++) {
      const o = obs[i], gap = o.r + 0.27, ds = o.s - m.s; if (Math.abs(ds) >= gap) continue;
      const hw = Math.sqrt(gap * gap - ds * ds); if (Math.abs(m.d - o.d) >= hw) continue;
      if (Math.abs(d0 - o.d) < hw) continue;   // they were already standing in it (a group placed beside a bin): let them walk out, don't snap them
      const up = d0 >= o.d;
      m.d = up ? o.d + hw : o.d - hw; m.vd = up ? Math.max(0, m.vd) : Math.min(0, m.vd);
    }
    if (m.ev !== null) {   // (only someone stepping aside is held to the pavement's width: the standing groups keep their places)
      if (m.d > m.hi + 0.1) { m.d = Math.max(d0 > m.hi + 0.1 ? Math.min(d0, m.d) : m.hi + 0.1, m.hi + 0.1); if (m.vd > 0) m.vd = 0; }
      if (m.d < m.lo - 0.25) { m.d = Math.min(d0 < m.lo - 0.25 ? Math.max(d0, m.d) : m.lo - 0.25, m.lo - 0.25); if (m.vd < 0) m.vd = 0; }
    }
  }
  /** critically damped spring on m[key] toward target (moving at tv), velocity in m[vkey]; exact for any dt */
  spring(m, key, vkey, target, tv, w, dt) {
    const x = m[key] - target, v = m[vkey] - tv, e = Math.exp(-w * dt), k = v + w * x;
    m[key] = target + (x + k * dt) * e; m[vkey] = tv + (v - w * k * dt) * e;
  }

  /** facing: along the walk; talkers face the middle of their circle; everyone else (and anyone startled) faces the road.
   *  Someone who has seen you coming looks at you, and turns to where they're stepping while they step. (This sets the
   *  target; update eases the body round to it.) */
  face(m) {
    const g = m.g, side = g.side, a = this.route.at(m.s).a, road = a + (g.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    let t;
    if (m.lkT > 0 && m.ev !== null && Math.abs(m.vd) > 0.9) t = a + Math.atan2(side * m.vd, m.vs * 0.5);
    else if (m.lkT > 0 && Math.hypot(m.lkS - m.s, m.lkD - side * m.d) > 0.4) t = a + Math.atan2(m.lkD - side * m.d, m.lkS - m.s);
    else t = m.startle > 0.3 ? road
      : g.kind === 'walk' ? a + (g.dir > 0 ? 0 : Math.PI)
      : g.kind === 'talk' && g.members.length > 1 ? a + Math.atan2(-m.dd * g.side, -m.ds) : road;
    m.yawT = t;
    if (!m.yi) { m.yaw = t; m.yi = 1; }
  }

  /** draw everyone the camera can see (with a margin, so nobody pops in at the edge of the frame) */
  render(car) {
    const r = this.route, M = this.mesh, A = this.attr, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0),
      pos = new THREE.Vector3(), sc = new THREE.Vector3(), cam = this.camera.position, cap = M.instanceMatrix.count;
    // where the crowd casts shadows (desktop), the people inside the sun's shadow box go first and the shadow pass draws
    // only them (see World.render: same box, same generous margin, so the shadow map is unchanged)
    const SB = M.castShadow && car ? this.shadowBox : null, cp = SB ? r.at(car.s, car.d) : null;
    let ax, ay, lim;
    if (SB) { const zA = new THREE.Vector3().copy(SB.dir).normalize(); ax = new THREE.Vector3(0, 1, 0).cross(zA).normalize(); ay = zA.clone().cross(ax); lim = SB.half() + 25; }
    let lo = 0, hi = 0;
    for (const m of this.people) {
      if (m.dirty || m.x === undefined) {                       // moved (or never placed): find the ground under them
        const p = r.at(m.s, m.g.side * m.d), gz = this.ground(p.x, p.y);
        m.x = p.x; m.y = p.y; m.z = Math.max(this.surfAt(p.x, p.y, gz + 1.2) ?? -Infinity, gz + LEVEL.TERRAIN);   // crosswalk or sidewalk
        m.dirty = false;
      }
      // margin grows with distance (≈2.3°): a turning camera sweeps far-off sidewalks into view within a frame
      const far = Math.hypot(m.x - cam.x, m.z - cam.y, -m.y - cam.z);
      m.on = this.visible(m.x, m.y, m.z + 0.9, 3 + far * 0.04) && lo + hi < cap;
      if (!m.on) continue;
      let i;
      if (SB) {
        const rx = m.x - cp.x, ry = m.z - cp.z, rz = -m.y + cp.y;
        i = Math.abs(rx * ax.x + ry * ax.y + rz * ax.z) <= lim && Math.abs(rx * ay.x + ry * ay.y + rz * ay.z) <= lim ? lo++ : cap - 1 - hi++;
      } else i = lo++;
      // model faces +Z; heading a in the route plane maps to three yaw a + π/2
      m4.compose(pos.set(m.x, m.z + (m.hop >= 0 ? 0.12 * Math.sin(Math.PI * m.hop) : 0), -m.y), q.setFromAxisAngle(up, m.yaw + Math.PI / 2), sc.set(m.w, m.h, m.w));
      M.setMatrixAt(i, m4);
      A.iAnim.setXYZW(i, m.phase, Math.min(1.15, Math.max(0.05, m.sp / 1.3)), m.acc, m.lean);
      A.iPose.setXY(i, m.phone && m.startle < 0.3 && !(m.fl > 0.3) && !(m.lkT > 0) ? 1 : 0, Math.min(1, Math.max(m.startle, m.fl) * 1.4));
      A.iPal.setXYZW(i, ...m.pal);
    }
    if (hi) {   // close the gap: the ones outside the shadow box (filled from the back) move up behind the rest
      M.instanceMatrix.array.copyWithin(lo * 16, (cap - hi) * 16, cap * 16);
      for (const a of Object.values(A)) a.array.copyWithin(lo * a.itemSize, (cap - hi) * a.itemSize, cap * a.itemSize);
    }
    const n = lo + hi;
    M.count = n; M.userData.shadowCount = lo; uploadUsed(M.instanceMatrix, n);
    for (const a of Object.values(A)) uploadUsed(a, n);   // only the people drawn this frame (the buffers hold the whole route)
  }
}
const xy = (p) => [p.x, p.y];
