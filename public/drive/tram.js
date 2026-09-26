// Atlanta Streetcar. The rails are the real OSM track (railway=tram) set into the pavement; the car runs
// westbound on Auburn Ave, i.e. TOWARD the player in the oncoming lane, on its real track, and dwells at the real
// MARTA streetcar platforms. In route space it's one long solid entity (so collisions, traffic following it and
// the QA autopilot all just work); it draws as three sections that each sit on the track, so it bends through curves.
import * as THREE from './vendor/three.module.min.js';
import { LEVEL, standOn } from './levels.js';
import { bakedGeometry, propMaterial } from './runner.js';

const GAUGE = 1.435, END = 9.0, MID = 6.8, LEN = END * 2 + MID + 0.2;   // metres (S70-class, ~24.8 m)
const CRUISE = 10.5, ACC = 1.1, DEC = 1.4, DWELL = [7, 10];   // a short dwell: it blocks the oncoming lane while it stands
const rnd = (a, b) => a + Math.random() * (b - a);

export class Streetcars {
  constructor({ W, route, ground, surfAt, scene, props, world, audio }) {
    Object.assign(this, { W, route, ground, surfAt, world, audio });
    const top = (x, y) => surfAt(x, y, ground(x, y) + 1.2) ?? ground(x, y) + LEVEL.ROAD;
    scene.add(this.rails(W.trams || [], top));

    // where the westbound track runs inside our road: its offset d at each route metre (null = not on the route)
    const r = route, n = Math.floor(r.length) + 1, best = new Array(n).fill(null);
    for (const line of W.trams || []) for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i], [bx, by] = line[i + 1], L = Math.hypot(bx - ax, by - ay);
      for (let t = 0; t <= L; t += 1) {
        const x = ax + (bx - ax) * t / L, y = ay + (by - ay) * t / L;
        if (r.distTo(x, y) > 8) continue;
        const p = r.project(x, y), k = Math.round(p.s);
        if (k < 0 || k >= n || p.d < 0.6 || p.d > r.hw(k) - 0.8) continue;   // the left (westbound) track, in the road
        if (best[k] === null || Math.abs(p.d - r.lane(k, 1)) < Math.abs(best[k] - r.lane(k, 1))) best[k] = p.d;
      }
    }
    for (let k = 0, last = -1; k < n; k++) if (best[k] !== null) {                 // bridge small gaps (junctions)
      if (last >= 0 && k - last > 1 && k - last < 18) for (let j = last + 1; j < k; j++) best[j] = best[last] + (best[k] - best[last]) * (j - last) / (k - last);
      last = k;
    }
    this.D = best.map((v, k) => { if (v === null) return null; let a = 0, c = 0; for (let j = k - 6; j <= k + 6; j++) if (best[j] != null) { a += best[j]; c++; } return a / c; });
    // the longest run of track along the route: that's where the car can run with us
    let s0 = 0, s1 = -1, a = -1;
    for (let k = 0; k <= n; k++) { if (k < n && this.D[k] !== null) { if (a < 0) a = k; } else if (a >= 0) { if (k - 1 - a > s1 - s0) { s0 = a; s1 = k - 1; } a = -1; } }
    this.s0 = s0 + LEN / 2; this.s1 = s1 - 2;
    // platforms on the car's side of the road, as stopping points (the car's front stops at the platform's east end)
    this.stops = (W.tramStops || []).filter(([x, y]) => r.distTo(x, y) < 14).map(([x, y]) => r.project(x, y))
      .filter((p) => p.d > 2 && p.s > this.s0 + 5 && p.s < this.s1).map((p) => ({ s: p.s, d: p.d })).sort((a, b) => b.s - a.s);   // in running order (westbound)

    // meshes: cab ends and middle sections, instanced; platform shelters
    const mat = propMaterial();
    this.endMesh = new THREE.InstancedMesh(bakedGeometry(props, 'prop_tram_end'), mat, 6);
    this.midMesh = new THREE.InstancedMesh(bakedGeometry(props, 'prop_tram_mid'), mat, 3);
    for (const m of [this.endMesh, this.midMesh]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.count = 0; m.name = 'inst_tram'; scene.add(m); }
    const sh = new THREE.InstancedMesh(bakedGeometry(props, 'prop_shelter'), mat, Math.max(1, this.stops.length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    this.stops.forEach((st, i) => {   // shelter on the sidewalk behind the platform, facing the road
      const p = r.at(st.s, r.hw(st.s) + 1.6);
      sh.setMatrixAt(i, m4.compose(pos.set(p.x, ground(p.x, p.y) + LEVEL.TERRAIN, -p.y), q.setFromEuler(e3.set(0, p.a, 0)), one));   // open side to the road
    });
    sh.count = this.stops.length; sh.castShadow = sh.receiveShadow = true; sh.name = 'street_tram_shelter'; scene.add(sh);
    this.shelters = this.stops.map((st) => { const p = r.at(st.s, r.hw(st.s) + 1.6); return [p.x, p.y]; });   // riders wait here (crowd.js)

    this.cars = [];
    this.next = rnd(28, 40);                                                      // a second car later in the run
    if (this.s1 - this.s0 > 200) this.spawn(rnd(Math.max(this.s0 + 150, 450), Math.min(this.s1 - 60, 880)));
  }

  /** steel rails with a dark flangeway groove, laid on whatever road surface is under them */
  rails(lines, top) {
    const pos = [], col = [], idx = [], steel = [0.62, 0.63, 0.66], groove = [0.07, 0.07, 0.08];
    const strip = (pts, off, w, c, lift) => {
      const base = pos.length / 3;
      pts.forEach(([x, y, nx, ny]) => {
        for (const o of [off - w / 2, off + w / 2]) { const px = x + nx * o, py = y + ny * o; pos.push(px, top(px, py) + lift, -py); col.push(...c); }
      });
      for (let i = 0; i + 1 < pts.length; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    };
    for (const line of lines) {
      const pts = [];
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, ay] = line[i], [bx, by] = line[i + 1], L = Math.hypot(bx - ax, by - ay); if (L < 0.01) continue;
        const nx = -(by - ay) / L, ny = (bx - ax) / L;
        for (let t = 0; t < L; t += 1.5) pts.push([ax + (bx - ax) * t / L, ay + (by - ay) * t / L, nx, ny]);
      }
      const [lx, ly] = line.at(-1), [px, py] = line.at(-2); const L = Math.hypot(lx - px, ly - py) || 1;
      pts.push([lx, ly, -(ly - py) / L, (lx - px) / L]);
      if (pts.length < 2) continue;
      for (const side of [-1, 1]) {
        strip(pts, side * GAUGE / 2, 0.07, steel, 0.012);                     // railhead, flush with the asphalt
        strip(pts, side * (GAUGE / 2 - 0.06), 0.045, groove, 0.011);          // flangeway on the inside
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.8, roughness: 0.32, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
    m.receiveShadow = true; m.name = 'tram_rails';
    return m;
  }

  trackD(s) { const k = Math.round(s); return this.D[k] ?? this.D[Math.max(0, Math.min(this.D.length - 1, k))] ?? this.route.lane(s, 1); }

  spawn(s) {
    const e = this.world.add('tram', { s, d: this.trackD(s), v: 0, dir: -1, color: 0xffffff, tram: { speed: 0, dwell: 0, served: new Set(), bellT: 0 } });
    // nothing else may already be standing in the car's footprint
    for (const o of this.world.ents) if (o !== e && o.dir === -1 && !o.curb && Math.abs(o.s - s) < LEN / 2 + 5 && Math.abs(o.d - e.d) < 2) o.alive = false;
    this.cars.push(e);
    return e;
  }

  update(dt, car) {
    const r = this.route, W = this.world;
    this.next -= dt;
    if (this.next <= 0 && this.cars.length < 2) {                                 // a new car enters at the far end, off screen
      const src = this.s1 - LEN / 2, p = r.at(src, this.trackD(src));
      if (!W.visible(p.x, p.y, p.z + 1.5, LEN / 2)) { this.spawn(src); this.next = 1e9; } else this.next = 0.5;
    }
    for (const e of this.cars) {
      const T = e.tram, front = e.s - LEN / 2;                                     // it drives toward lower s
      let want = CRUISE;
      // dwell at platforms: brake so the front stops at the platform, wait, ring, go
      const stop = this.stops.find((st) => !T.served.has(st) && st.s < e.s && front - st.s > -2);
      if (stop) {
        const gap = front - stop.s;
        if (gap < 0.6 && T.speed < 0.4) {
          if (!T.dwell) T.dwell = rnd(...DWELL);
          T.dwell -= dt; want = 0;
          if (T.dwell <= 0) { T.served.add(stop); T.dwell = 0; this.ring(e, car); }
        } else want = Math.min(want, Math.sqrt(Math.max(0, 2 * DEC * 0.8 * gap)));
      }
      // anything on its track ahead (a car, the player): stop short of it, and ring at the player
      for (const o of W.ents) if (o !== e && o.alive && !o.scenery && !o.flying && o.s < e.s && Math.abs(o.d - e.d) < 1.9) {
        const gap = front - (o.s + (o.L || 4.5) / 2); if (gap > 30 || gap < -1) continue;
        want = Math.min(want, Math.max(0, (gap - 4) * 0.8));
      }
      const pgap = front - (car.s + 2.5);
      if (pgap > -1 && pgap < 35 && Math.abs(car.d - e.d) < 2.1) { want = Math.min(want, Math.max(0, (pgap - 5) * 0.8)); if (pgap < 25) this.ring(e, car); }
      // red light: stop at the line
      const sl = W.signals?.stopFor(front, T.speed, -1);
      if (sl != null) want = Math.min(want, Math.sqrt(Math.max(0, 2 * DEC * 0.9 * (front - sl - 0.3))));
      // a flagger at a work zone the player is coming through holds it short of the zone
      const zone = (W.workZones || []).find(([a, b]) => car.s > a - 70 && car.s < b + 5);
      if (zone && front > zone[1] + 4 && front < zone[1] + 70) want = Math.min(want, Math.max(0, (front - zone[1] - 6) * 0.8));
      // the end of its run along our road: it turns away there; wait out of sight
      if (front - 2 < this.s0 - LEN / 2) want = 0;
      T.speed += Math.max(-DEC * 1.6 * dt, Math.min(ACC * dt, want - T.speed));
      e.v = -T.speed; e.d = this.trackD(e.s);
      T.bellT -= dt;
      const p = r.at(e.s, e.d);
      if (front - 2 < this.s0 - LEN / 2 && !W.visible(p.x, p.y, p.z + 1.5, LEN / 2)) e.alive = false;
    }
    this.cars = this.cars.filter((e) => e.alive);
    this.render();
  }

  ring(e, car) {
    if (e.tram.bellT > 0) return;
    e.tram.bellT = 3.5;
    if (Math.abs(e.s - car.s) < 120) this.audio.bell(0.55);
  }

  /** three sections, each seated on the road under its own two trucks, so the car bends through the curve */
  render() {
    const r = this.route, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    const on = (x, y) => this.surfAt(x, y, this.ground(x, y) + 1.2) ?? this.ground(x, y) + LEVEL.ROAD;
    let ne = 0, nm = 0;
    const put = (mesh, i, s, half, flip) => {
      const d = this.trackD(s), p = r.at(s, d), a = p.a + Math.PI;               // westbound: faces down-route
      const st = standOn(on, p.x, p.y, a, half * 0.7, 1.1);
      m4.compose(pos.set(p.x, st.z, -p.y), q.setFromEuler(e3.set(st.pitch, a - Math.PI / 2 + (flip ? Math.PI : 0), st.roll, 'YXZ')), one);
      mesh.setMatrixAt(i, m4);
    };
    for (const e of this.cars) {
      const sF = e.s - (MID / 2 + 0.1 + END / 2), sR = e.s + (MID / 2 + 0.1 + END / 2);
      put(this.endMesh, ne++, sF, END / 2, false);                                // leading cab
      put(this.midMesh, nm++, e.s, MID / 2, false);
      put(this.endMesh, ne++, sR, END / 2, true);                                 // trailing cab (mirrored)
    }
    this.endMesh.count = ne; this.midMesh.count = nm;
    this.endMesh.instanceMatrix.needsUpdate = true; this.midMesh.instanceMatrix.needsUpdate = true;
  }
}
export const TRAM_LEN = LEN;
