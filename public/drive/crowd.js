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
      phase: rnd(0, 6.28), phone: 0, startle: 0, lean: 0, ds: 0, dd: 0, s: 0, d: 0, yaw: 0 };
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
    const r = this.route, sim0 = car.s + SIM[0], sim1 = car.s + SIM[1];
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
        for (const o of this.obst[g.side]) {
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
      g.members.forEach((m, k) => {
        m.startle = Math.max(scare, m.startle - dt * 1.4);
        const s = g.s + (single ? -g.dir * k * 0.85 : m.ds), d = g.cd + (single ? 0 : m.dd) + m.startle * 0.9;
        m.s += (s - m.s) * Math.min(1, dt * 6); m.d += (Math.min(hi + 0.3, d) - m.d) * Math.min(1, dt * 4);
        if (g.kind === 'walk') m.phase += dt * g.v * 2 * Math.PI / (1.35 * m.h);
        else m.phase = 0.6 * Math.sin(this.t * 0.7 + k);      // standing: a slow weight shift
        m.lean = g.kind === 'walk' ? 0.03 : 0;
        m.lean -= m.startle * 0.08;
        this.face(m);
        m.dirty = true;
      });
    }
    this.render();
  }

  /** facing: along the walk; talkers face the middle of their circle; everyone else (and anyone startled) faces the road */
  face(m) {
    const g = m.g, a = this.route.at(m.s).a, road = a + (g.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    m.yaw = m.startle > 0.3 ? road
      : g.kind === 'walk' ? a + (g.dir > 0 ? 0 : Math.PI)
      : g.kind === 'talk' && g.members.length > 1 ? a + Math.atan2(-m.dd * g.side, -m.ds) : road;
  }

  /** draw everyone the camera can see (with a margin, so nobody pops in at the edge of the frame) */
  render() {
    const r = this.route, M = this.mesh, A = this.attr, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0),
      pos = new THREE.Vector3(), sc = new THREE.Vector3(), cam = this.camera.position;
    let i = 0;
    for (const m of this.people) {
      if (m.dirty || m.x === undefined) {                       // moved (or never placed): find the ground under them
        const p = r.at(m.s, m.g.side * m.d), gz = this.ground(p.x, p.y);
        m.x = p.x; m.y = p.y; m.z = Math.max(this.surfAt(p.x, p.y, gz + 1.2) ?? -Infinity, gz + LEVEL.TERRAIN);   // crosswalk or sidewalk
        m.dirty = false;
      }
      // margin grows with distance (≈2.3°): a turning camera sweeps far-off sidewalks into view within a frame
      const far = Math.hypot(m.x - cam.x, m.z - cam.y, -m.y - cam.z);
      m.on = this.visible(m.x, m.y, m.z + 0.9, 3 + far * 0.04) && i < M.instanceMatrix.count;
      if (!m.on) continue;
      // model faces +Z; heading a in the route plane maps to three yaw a + π/2
      m4.compose(pos.set(m.x, m.z, -m.y), q.setFromAxisAngle(up, m.yaw + Math.PI / 2), sc.set(m.w, m.h, m.w));
      M.setMatrixAt(i, m4);
      A.iAnim.setXYZW(i, m.phase, m.g.kind === 'walk' ? 1 : 0.05, m.acc, m.lean);
      A.iPose.setXY(i, m.phone && m.startle < 0.3 ? 1 : 0, Math.min(1, m.startle * 1.4));
      A.iPal.setXYZW(i, ...m.pal);
      i++;
    }
    M.count = i; M.instanceMatrix.needsUpdate = true;
    for (const a of Object.values(A)) a.needsUpdate = true;
  }
}
const xy = (p) => [p.x, p.y];
