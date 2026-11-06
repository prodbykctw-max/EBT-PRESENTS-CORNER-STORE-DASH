// Racing guide for the realistic look only (drive.js imports this file for both looks, but builds a Guide only when the
// realistic look is on, so the comic look never builds, updates or draws any of this):
//  * two red lines on the road ahead of the car, one each side of it, that follow the lane you are steering to
//    (a lane tap swings them across) and, near the store, bend in to the parking space;
//  * amber chevrons laid on the road through the one real bend of the route;
//  * (behind a flag, off by default) three chevrons that point you in to the curb before the parking space.
// Drawn like the hazard halos (runner.js): unlit, depth-tested, no depth write, pulled toward the camera with a polygon
// offset so they never z-fight the road, crosswalk paint or the P box. The red is an HDR colour, so the bloom pass
// (real-post.js) makes it glow.
import * as THREE from './vendor/three.module.min.js';
import { toV3 } from './city.js';
import { LEVEL } from './levels.js';
import { PLAYER } from './runner.js';

export const GUIDE = {
  startBehind: 4,      // the lines start this far behind the car's centre
  length: 46,          // ...and run this far ahead of that start (metres), or to the parking space if that is nearer
  inFade: 3,           // fade in over the first 3 m
  outFade: 15,         // fade out over the last 15 m
  settle: 10,          // from the car's own d to the lane's d over this many metres
  width: 0.16,         // each line's width
  gap: 0.15,           // clear of the car's side
  lift: 0.03,          // above the road
  homeIn: [45, 12],    // metres before the space: the lines blend from the lane to the space's d between these
  turn: 0.3,           // a bend is more than this many radians over 30 m
  every: 6,            // a chevron every 6 m through a bend
  lead: 10,            // ...starting this far before it
  pullin: new URLSearchParams(location.search).has('pullin'),   // QA flag: the optional pull-in chevrons at the space (off by default)
  pullinAt: [-34, -28, -22], pullinAngle: 35 * Math.PI / 180,
};
const N = Math.round(GUIDE.length) + 1;      // samples, 1 m apart
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ss = THREE.MathUtils.smoothstep;

export class Guide {
  /** route, ground, surfAt: the drive's own. spot: { s, d }. */
  constructor({ scene, route, ground, surfAt, spot }) {
    Object.assign(this, { route, ground, surfAt, spot });
    // the red lines: one mesh of two strips (N samples x 2 verts each), positions rewritten each frame, index built once
    const V = N * 2 * 2;
    this.pos = new Float32Array(V * 3); this.col = new Float32Array(V * 4).fill(1);
    const idx = [];
    for (let k = 0; k < 2; k++) for (let i = 0; i + 1 < N; i++) {
      const a = k * N * 2 + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mat = this.makeMat(new THREE.Color().setRGB(2.4, 0.12, 0.08));
    this.mat.vertexColors = true; this.mat.side = THREE.DoubleSide;
    this.lines = new THREE.Mesh(g, this.mat); this.lines.frustumCulled = false; this.lines.renderOrder = 3; this.lines.visible = false;
    scene.add(this.lines);
    this.scene = scene; this.chev = null; this.pull = null;
    this.cfg = GUIDE; this.ms = 0; this.updates = 0;   // QA: time spent in update()
  }

  /** same recipe as the hazard halo (runner.js) */
  makeMat(color) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  }

  // a flat "^" lying on the road (forward = local +X, across = local Z)
  static chevronGeometry() {
    const P = [[-0.6, -1.3], [0.8, 0], [-0.6, 1.3]], Q = [[-1.15, -1.3], [0.25, 0], [-1.15, 1.3]];
    const v = [...P, ...Q].map(([f, l]) => [f, 0, l]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v.flat(), 3));
    g.setIndex([0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4]);   // (P0 P1 Q1) (P0 Q1 Q0) (P1 P2 Q2) (P1 Q2 Q1)
    return g;
  }
  place(mesh, i, s, d, a) {
    const { route, ground, surfAt } = this, p = route.at(s, d), z = (surfAt(p.x, p.y, ground(p.x, p.y) + 1.2) ?? ground(p.x, p.y) + LEVEL.ROUTE) + GUIDE.lift + 0.01;
    mesh.setMatrixAt(i, new THREE.Matrix4().compose(toV3(p.x, p.y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1)));
  }
  /** the bends between `from` and the approach (turn > 0.3 rad over 30 m): a chevron every 6 m from 10 m before the bend to its end, in your lane, pointing along the road a little ahead. Built once. */
  buildChevrons(from) {
    const { route, spot } = this, hi = Math.floor(spot.s - 50), at = [];
    let start = null;
    const turn = (s) => Math.abs(wrap(route.at(s + 15).a - route.at(s - 15).a));
    for (let s = Math.max(15, Math.ceil(from)); s <= hi + 1; s++) {
      const on = s <= hi && turn(s) > GUIDE.turn;
      if (on && start === null) start = s;
      if (!on && start !== null) { for (let c = start - GUIDE.lead; c <= s - 1; c += GUIDE.every) at.push(c); start = null; }
    }
    this.bends = at.slice();
    if (at.length) {
      const m = new THREE.InstancedMesh(Guide.chevronGeometry(), this.makeMat(new THREE.Color(0xffc23a)), at.length);
      m.material.side = THREE.DoubleSide; m.frustumCulled = false; m.renderOrder = 3; m.visible = false;
      at.forEach((s, i) => this.place(m, i, s, route.lane(s, 0), route.at(s + GUIDE.every).a));
      m.instanceMatrix.needsUpdate = true; this.scene.add(m); this.chev = m;
    }
    {   // built always (3 instances), drawn only when GUIDE.pullin is on
      const m = new THREE.InstancedMesh(Guide.chevronGeometry(), this.makeMat(new THREE.Color(0xffc23a)), GUIDE.pullinAt.length);
      m.material.side = THREE.DoubleSide; m.frustumCulled = false; m.renderOrder = 3; m.visible = false;
      GUIDE.pullinAt.forEach((o, i) => { const s = spot.s + o, k = ss(s, spot.s - GUIDE.homeIn[0], spot.s - GUIDE.homeIn[1]); this.place(m, i, s, route.lane(s, 0) + (spot.d - route.lane(s, 0)) * k, route.at(s).a - GUIDE.pullinAngle); });
      m.instanceMatrix.needsUpdate = true; this.scene.add(m); this.pull = m;
    }
  }

  /** show: only while driving. drawS / drawD: where the car is drawn. laneD(s): the d of the lane being steered to. */
  update(show, drawS, drawD, laneD) {
    if (this.chev) this.chev.visible = show;
    if (this.pull) this.pull.visible = show && GUIDE.pullin;
    const { route, spot, ground, surfAt, pos, col } = this;
    const s0 = drawS - GUIDE.startBehind, end = Math.min(s0 + GUIDE.length, spot.s), len = end - s0;
    if (!show || len < 1) { this.lines.visible = false; return; }
    const t0 = performance.now();
    this.lines.visible = true;
    const half = PLAYER.halfW + GUIDE.gap, w = GUIDE.width / 2;
    for (let i = 0; i < N; i++) {
      const s = Math.min(s0 + i, end);
      let d = drawD + (laneD(s) - drawD) * ss(s, drawS, drawS + GUIDE.settle);
      d += (spot.d - d) * ss(s, spot.s - GUIDE.homeIn[0], spot.s - GUIDE.homeIn[1]);
      const base = route.at(s, 0), sn = Math.sin(base.a), cs = Math.cos(base.a);
      const alpha = s0 + i > end ? 0 : Math.min(1, i / GUIDE.inFade, (end - s) / GUIDE.outFade);
      for (let k = 0; k < 2; k++) {
        const c = d + (k ? half : -half);   // route d grows to the left
        const cx = base.x - sn * c, cy = base.y + cs * c, g0 = ground(cx, cy);
        const z = (surfAt(cx, cy, g0 + 1.2) ?? g0 + LEVEL.ROUTE) + GUIDE.lift;
        for (let e = 0; e < 2; e++) {
          const o = (e ? w : -w), px = cx - sn * o, py = cy + cs * o;
          const v = (k * N + i) * 2 + e;
          pos[v * 3] = px; pos[v * 3 + 1] = z; pos[v * 3 + 2] = -py; col[v * 4 + 3] = alpha;
        }
      }
    }
    const gm = this.lines.geometry;
    gm.attributes.position.needsUpdate = true; gm.attributes.color.needsUpdate = true;
    this.ms += performance.now() - t0; this.updates++;
  }
}
