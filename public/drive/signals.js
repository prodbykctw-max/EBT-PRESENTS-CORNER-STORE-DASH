// Working traffic signals at every signalised intersection on the route (OSM highway=traffic_signals).
// Each runs a real cycle: Auburn/Luckie green → yellow → all-red → cross-street green → yellow → all-red. The
// corridor is timed as a green wave (each light's green starts about when traffic moving at the corridor speed
// gets there, ± a few seconds), the way downtown arterials are, so keeping pace mostly meets greens and getting
// held up in traffic meets reds. Everyone obeys: our direction and oncoming traffic stop at their stop lines, the
// streetcar too, and cross traffic moves on ITS green. The lamps on the mast heads really light.
import * as THREE from './vendor/three.module.min.js';

const GREEN = [20, 27], YELLOW = 3, ALL_RED = 1, CROSS = [8, 10], WAVE = 21;   // seconds; WAVE: corridor speed (m/s)
const rnd = (a, b) => a + Math.random() * (b - a);
// lamp positions on the prop_signal model (Blender → three: (x, y, z) → (x, z, -y)): three heads along the arm,
// red / yellow / green top to bottom, facing -X
const HEADS = [2.4, 4.6, 6.3], LAMP_Z = [6.4, 6.07, 5.74];
const ON = [new THREE.Color(1, 0.12, 0.06), new THREE.Color(1, 0.72, 0.08), new THREE.Color(0.15, 1, 0.45)], OFF = new THREE.Color(0.05, 0.05, 0.06);

export class Signals {
  constructor({ route, nodes, marks, scene, startDelay = 3 }) {
    this.route = route; this.t = 0;
    this.nodes = (nodes || []).filter((n) => n.s > 8 && n.s < route.length - 8).sort((a, b) => a.s - b.s).map((n) => {
      const g = rnd(...GREEN), x = rnd(...CROSS), cycle = g + YELLOW + ALL_RED + x + YELLOW + ALL_RED;
      // stop lines: just outside the unpainted junction / crosswalk zone on each approach
      let a = Math.round(n.s), b = a;
      while (a > 0 && marks?.[a] === 0 && n.s - a < 25) a--;
      while (b < (marks?.length || 0) - 1 && marks[b] === 0 && b - n.s < 25) b++;
      const arrive = startDelay + n.s / WAVE;                                   // green wave: arrive mid-green
      const off = ((g * rnd(0.15, 0.75) - arrive) % cycle + cycle) % cycle;
      return { ...n, g, x, cycle, off, lineIn: a - 1, lineOut: b + 1 };
    });

    // lamp overlays: every lamp on every mast head, recoloured each frame (lit / dark), plus a soft glow on the lit one
    const disc = new THREE.CircleGeometry(0.115, 14); disc.rotateY(-Math.PI / 2);
    const glow = new THREE.CircleGeometry(0.42, 16); glow.rotateY(-Math.PI / 2);
    const masts = this.nodes.flatMap((n) => n.masts.map((m) => ({ n, m })));
    this.lamps = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, masts.length * 9));
    this.glows = new THREE.InstancedMesh(glow, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }), Math.max(1, masts.length * 3));
    const M = new THREE.Matrix4(), L = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    this.slots = [];
    masts.forEach(({ n, m }, mi) => {
      M.compose(p.set(m.x, m.z, -m.y), q.setFromEuler(e3.set(0, m.yaw - Math.PI / 2, 0)), one);
      HEADS.forEach((hy, h) => {
        LAMP_Z.forEach((lz, k) => {
          const i = mi * 9 + h * 3 + k;
          this.lamps.setMatrixAt(i, L.copy(M).multiply(new THREE.Matrix4().makeTranslation(-0.235, lz, -hy)));
        });
        this.slots.push({ n, dir: m.dir, base: mi * 9 + h * 3, glow: mi * 3 + h, M: M.clone(), hy });
      });
    });
    this.lamps.count = masts.length * 9; this.glows.count = masts.length * 3;
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.lamps.count * 3 || 3), 3);
    this.glows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.glows.count * 3 || 3), 3);
    for (const im of [this.lamps, this.glows]) { im.frustumCulled = false; im.name = 'signal_lamps'; scene.add(im); }
    this.update(0);
  }

  /** the route's own aspect at node n ('G' | 'Y' | 'R') and the cross street's */
  routeAspect(n) { const t = (this.t + n.off) % n.cycle; return t < n.g ? 'G' : t < n.g + YELLOW ? 'Y' : 'R'; }
  crossAspect(n) {
    const t = (this.t + n.off) % n.cycle, a = n.g + YELLOW + ALL_RED;
    return t < a ? 'R' : t < a + n.x ? 'G' : t < a + n.x + YELLOW ? 'Y' : 'R';
  }

  update(dt) {
    this.t += dt;
    const c = new THREE.Color(), M = new THREE.Matrix4(), T = new THREE.Matrix4();
    for (const sl of this.slots) {
      const a = this.routeAspect(sl.n), lit = a === 'R' ? 0 : a === 'Y' ? 1 : 2;
      for (let k = 0; k < 3; k++) this.lamps.setColorAt(sl.base + k, k === lit ? ON[k] : OFF);
      this.glows.setMatrixAt(sl.glow, M.copy(sl.M).multiply(T.makeTranslation(-0.25, LAMP_Z[lit], -sl.hy)));
      this.glows.setColorAt(sl.glow, c.copy(ON[lit]));
    }
    this.lamps.instanceColor.needsUpdate = true; this.glows.instanceColor.needsUpdate = true; this.glows.instanceMatrix.needsUpdate = true;
  }

  /** stop line a vehicle whose FRONT is at `front` must stop at (or null to go on): dir 1 = our direction,
   *  -1 = oncoming. On yellow it only stops if it comfortably can (like a driver: no slamming into the box). */
  stopFor(front, speed, dir, look = 120) {
    for (const n of dir > 0 ? this.nodes : [...this.nodes].reverse()) {
      const line = dir > 0 ? n.lineIn : n.lineOut, gap = dir > 0 ? line - front : front - line;
      if (gap < -0.5) continue;                     // already past it
      if (gap > look) return null;
      const a = this.routeAspect(n);
      if (a === 'G') return null;
      if (a === 'Y' && speed * speed / (2 * 5) > gap) return null;   // too close to stop: go through
      return line;
    }
    return null;
  }

  /** cross traffic at world (x, y): true = its light is green, false = hold at the line, null = no signal here */
  crossGate(x, y) {
    const r = this.route; if (r.distTo(x, y) > 30) return null;
    const s = r.project(x, y).s;
    const n = this.nodes.find((n) => Math.abs(n.s - s) < 25);
    return n ? this.crossAspect(n) === 'G' : null;
  }

  /** the next light for the player: { aspect, gap } within `look` metres, else null (for the HUD) */
  next(front, look = 110) {
    const n = this.nodes.find((n) => n.lineIn - front > -0.5);
    if (!n || n.lineIn - front > look) return null;
    return { aspect: this.routeAspect(n), gap: n.lineIn - front };
  }
}
