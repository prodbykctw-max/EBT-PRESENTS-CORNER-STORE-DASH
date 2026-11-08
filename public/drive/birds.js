// City birds (rock pigeons, American crows, grackles), the way you actually see them from a car: flocks pecking about on the sidewalks that burst up and fly
// off over you as you drive up (or when you lean on the horn), plus flocks crossing the street overhead. Pure
// scenery: nothing to hit or dodge, but they cast shadows. The ground flocks are placed along the whole route at
// load (nothing ever appears on screen); flyers are dropped once they're out of view.
import * as THREE from './vendor/three.module.min.js';
import { bakedGeometry, propMaterial, uploadUsed } from './runner.js';

const PLUMAGE = [0x5d6169, 0x4a4e57, 0x6f747e, 0x3e4148, 0x7d8189, 0x2f3238, 0x575250];
// mesh 0 = pigeon, 1 = crow (grackles are the crow model smaller, with a blue-purple sheen). rate: wingbeats / s
const SPECIES = {
  pigeon: { mesh: 0, scale: 2, colors: PLUMAGE, rate: [8, 10], lift: [10, 13], n: [5, 12], w: 5 },
  crow: { mesh: 1, scale: 2.2, colors: [0x141418, 0x19191e, 0x0f0f12], rate: [3.5, 4.5], lift: [5, 6], n: [2, 5], w: 3 },
  grackle: { mesh: 1, scale: 1.55, colors: [0x1b1a2e, 0x16202a, 0x221a2c], rate: [9, 11], lift: [11, 13], n: [6, 14], w: 2 },
};
const pickSpecies = () => { const all = Object.values(SPECIES), tot = all.reduce((a, s) => a + s.w, 0); let r = Math.random() * tot; for (const s of all) if ((r -= s.w) <= 0) return s; return all[0]; };
const CAP = 200;
const REAL_RANGE = 170;   // m: how far from the camera the realistic pigeons are drawn (animals.js)
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

export class Birds {
  /** groundAt(x, y): height of the walkable surface there; roofAt(x, y): top of whatever is there (roofs, decks);
   *  isFree(x, y): not inside a building */
  constructor({ scene, props, route, roofAt, groundAt, isFree, trees = [], occupied = () => false, visible, mobile, sEnd, animals, camera }) {
    Object.assign(this, { route, visible, roofAt, groundAt });
    this.animals = animals && animals.pigeons ? animals : null; this.camera = camera || null;   // the realistic look's birds (animals.js)
    this.max = mobile ? 2 : 3; this.flocks = []; this.next = rnd(3, 6);
    const mat = propMaterial();
    this.meshes = ['bird', 'crow'].flatMap((m) => ['up', 'down', 'sit'].map((k) => {
      const im = new THREE.InstancedMesh(bakedGeometry(props, `prop_${m}_${k}`), mat, CAP);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3).fill(1), 3);
      im.count = 0; im.frustumCulled = false; im.castShadow = true; im.name = (m === 'bird' ? 'birds_' : 'crows_') + k; scene.add(im);
      return im;
    }));
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.c = new THREE.Color();
    this.sc = new THREE.Vector3();                   // (a little over life size: they read from the high chase camera)
    // pecking flocks on the sidewalks, every ~90 m or so along the drive
    // in the gutter along the curb (a sidewalk flock would be hidden by the street trees), in a gap between parked
    // cars, and never under a canopy
    const underTree = (x, y) => trees.some(([tx, ty]) => Math.abs(tx - x) < 6 && Math.abs(ty - y) < 6 && Math.hypot(tx - x, ty - y) < 6);
    for (let s = rnd(50, 90); s < sEnd - 15; s += rnd(55, 100)) {
      let p = null;
      for (let k = 0; k < 8 && !p; k++) {
        const side = Math.random() < 0.5 ? 1 : -1, s1 = s + k * 3, d = side * (route.hw(s1) - rnd(0.9, 1.4)), q = route.at(s1, d);
        if ((!isFree || isFree(q.x, q.y)) && !underTree(q.x, q.y) && !occupied(s1, d)) p = Object.assign(q, { side, s: s1 });
      }
      if (!p) continue;
      const side = p.side;
      const birds = [], sp = pickSpecies();
      for (let k = 0, n = (rnd(...sp.n)) | 0; k < n; k++) {
        birds.push({ ox: rnd(-1.4, 1.4), oy: rnd(-1.4, 1.4), yaw: rnd(0, 6.3), ph: rnd(0, 6), rate: rnd(...sp.rate), glide: rnd(0, 3), color: pick(sp.colors), peck: rnd(0.5, 1.4) });
      }
      for (const b of birds) b.gz = groundAt(p.x + b.ox, p.y + b.oy);                 // each on the surface under it
      this.flocks.push({ sp, ground: true, s: p.s, side, x: p.x, y: p.y, z: groundAt(p.x, p.y), a: p.a, birds, t: 0 });
    }
  }

  /** a flock starts off one side of the street, ahead of the car, and crosses it just over the roofs on its path
   *  (never through a wall; towers are skipped) */
  spawn(car) {
    const r = this.route;
    for (let attempt = 0; attempt < 10; attempt++) {
      // time it so the flock crosses the street about when (and a little ahead of where) the car gets there
      const v = rnd(14, 19), lat = rnd(80, 120), side = Math.random() < 0.5 ? 1 : -1;
      const s = Math.min(r.length - 5, car.s + car.v * (lat / v) * rnd(0.8, 1.0) + rnd(20, 60));
      const from = r.at(s, side * lat), to = r.at(s + rnd(-30, 30), -side * rnd(90, 130));
      let top = r.ground(from.x, from.y) + rnd(6, 10);
      for (let k = 0; k <= 12; k++) { const f = k / 12; top = Math.max(top, this.roofAt(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f) + 4); }
      const alt = top + rnd(0, 3);
      if (alt - r.ground(car.pose.x, car.pose.y) > 34 || this.visible(from.x, from.y, alt, 8)) continue;
      const L = Math.hypot(to.x - from.x, to.y - from.y);
      const birds = [], sp = pickSpecies();
      for (let k = 0, n = (rnd(sp.n[0], sp.n[1] - 2)) | 0; k < n; k++) birds.push({ ox: rnd(-4, 4), oy: rnd(-4, 4), oz: rnd(-1.2, 1.2), ph: rnd(0, 6), rate: rnd(...sp.rate), glide: rnd(0, 3), color: pick(sp.colors) });
      this.flocks.push({ sp, x: from.x, y: from.y, z: alt, vx: (to.x - from.x) / L * v, vy: (to.y - from.y) / L * v, vz: rnd(0, 0.4), birds, t: 0, seen: false });
      return;
    }
  }

  /** a ground flock takes off: every bird springs up and away from the street, then climbs out ahead */
  takeOff(f) {
    f.ground = false; f.lifted = true; f.t = 0;
    for (const b of f.birds) {
      const a = f.a + f.side * rnd(0.05, 0.35) + rnd(-0.15, 0.15), v = rnd(8, 12);      // up and away down the street
      Object.assign(b, { x: f.x + b.ox, y: f.y + b.oy, z: b.gz, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rnd(3.5, 5.5), delay: rnd(0, 0.35), rate: rnd(...f.sp.lift) });
    }
  }

  update(dt, car, t, horn = 0) {
    this.next -= dt;
    if (this.next <= 0 && this.flocks.filter((f) => !f.ground && !f.lifted).length < this.max) { this.spawn(car); this.next = rnd(5, 10); }
    const counts = [0, 0, 0, 0, 0, 0], { m4, q, e, p, c, sc } = this;
    let sp = SPECIES.pigeon;
    const put = (pk, x, y, z, yaw, pitch, color) => {
      const k = sp.mesh * 3 + pk, i = counts[k]; if (i >= CAP) return;
      m4.compose(p.set(x, z, -y), q.setFromEuler(e.set(pitch, yaw - Math.PI / 2, 0, 'YXZ')), sc.setScalar(sp.scale));
      this.meshes[k].setMatrixAt(i, m4); this.meshes[k].setColorAt(i, c.set(color)); counts[k]++;
    };
    // the realistic birds (animals.js; the pigeon model for every species): drawn within REAL_RANGE of the camera, the rest are too small to see (the props.glb birds are drawn at any distance)
    const AN = this.animals, cam = this.camera ? this.camera.position : null, tint = new THREE.Color();
    const inRange = (x, y) => !cam || (x - cam.x) ** 2 + (-y - cam.z) ** 2 < REAL_RANGE * REAL_RANGE;
    const putReal = (x, y, z, yaw, pitch, color, pose) => {
      m4.compose(p.set(x, z, -y), q.setFromEuler(e.set(pitch, yaw - Math.PI / 2, 0, 'YXZ')), sc.setScalar(sp.scale));
      if (sp === SPECIES.pigeon) { const g = ((color >> 16 & 255) + (color >> 8 & 255) + (color & 255)) / 765, m = 0.78 + (g - 0.19) * 1.3; tint.setRGB(m, m, m); }   // the old plumage greys, as a brightness around the photo's own colours
      else tint.setRGB((color >> 16 & 255) / 150, (color >> 8 & 255) / 150, (color & 255) / 150);   // crows and grackles: there is no crow model, so the pigeon is drawn nearly black (grackles with their blue-purple sheen), bigger or smaller by the species' scale
      AN.pigeon(m4, tint, pose, cam);
    };
    // pecking: the head goes down in a bump once per cycle (the cycle the old pose used: sin(t * peck * 3 + ph) > 0.55 is the part from 0.09 to 0.41 of it)
    const dipOf = (b) => { const x = (t * b.peck * 3 + b.ph) / (2 * Math.PI), k = (x - Math.floor(x) - 0.09) / 0.32; return k > 0 && k < 1 ? Math.sin(Math.PI * k) ** 0.7 : 0; };
    const flapping = (b, keep) => keep || (t + b.glide) % 2.6 < 1.8;
    if (AN) AN.beginBirds();
    // flap-and-glide: bursts of wingbeats, then a short glide with the wings held down (0 = wings up, 1 = down)
    const pose = (b, keep) => ((keep || (t + b.glide) % 2.6 < 1.8) && Math.sin((t + b.ph) * b.rate * 2 * Math.PI) > 0 ? 0 : 1);
    for (const f of this.flocks) {
      f.t += dt; sp = f.sp;
      if (f.ground) {
        const ahead = f.s - car.s;
        if ((ahead < 20 + car.v * 0.5 && ahead > -6) || (horn && Math.abs(ahead) < 45)) this.takeOff(f);
        else {
          for (const b of f.birds) {                     // milling about: pecking, turning
            const peck = Math.sin(t * b.peck * 3 + b.ph) > 0.55 ? 0.55 : 0;
            if (AN) { if (inRange(f.x, f.y)) putReal(f.x + b.ox, f.y + b.oy, b.gz, b.yaw + Math.sin(t * 0.3 + b.ph) * 0.4, 0, b.color, { t, ph: b.ph, dip: dipOf(b) }); }
            else put(2, f.x + b.ox, f.y + b.oy, b.gz, b.yaw + Math.sin(t * 0.3 + b.ph) * 0.4, peck, b.color);
          }
          continue;
        }
      }
      if (f.lifted) {                                    // each bird on its own after take-off
        let any = false;
        for (const b of f.birds) {
          if (f.t < b.delay) { if (AN) { if (inRange(b.x, b.y)) putReal(b.x, b.y, b.z, b.yaw, 0, b.color, { t, ph: b.ph, dip: 0 }); } else put(2, b.x, b.y, b.z, b.yaw, 0, b.color); any = true; continue; }
          b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vz = Math.max(0.6, b.vz - 2.2 * dt);
          if (this.visible(b.x, b.y, b.z, 1)) any = true;
          if (AN) { if (inRange(b.x, b.y)) putReal(b.x, b.y, b.z, Math.atan2(b.vy, b.vx), -0.35 * Math.min(1, b.vz / 4), b.color, { fly: ((t + b.ph) * b.rate) % 1, glide: !flapping(b, f.t < 1.4), unfold: Math.min(1, (f.t - b.delay) / 0.3) }); }   // (the wings grow out of the shoulders over the first 0.3 s)
          else put(pose(b, f.t < 1.4), b.x, b.y, b.z, Math.atan2(b.vy, b.vx), -0.35 * Math.min(1, b.vz / 4), b.color);
        }
        if (!any && f.t > 2) f.dead = true;
        continue;
      }
      // a crossing flock
      f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      const on = this.visible(f.x, f.y, f.z, 8);
      if (on) f.seen = true;
      if ((f.seen && !on) || f.t > 32 || Math.hypot(f.x - car.pose.x, f.y - car.pose.y) > 260) f.dead = !on;
      const yaw = Math.atan2(f.vy, f.vx), cs = Math.cos(yaw), sn = Math.sin(yaw);
      for (const b of f.birds) {
        if (AN) { if (inRange(f.x, f.y)) putReal(f.x + b.ox * cs - b.oy * sn, f.y + b.ox * sn + b.oy * cs, f.z + b.oz, yaw, 0, b.color, { fly: ((t + b.ph) * b.rate) % 1, glide: !flapping(b, false), unfold: 1 }); continue; }
        const k = pose(b, false);
        put(k, f.x + b.ox * cs - b.oy * sn, f.y + b.ox * sn + b.oy * cs, f.z + b.oz + (k === 0 ? 0.08 : 0), yaw, 0, b.color);
      }
    }
    this.flocks = this.flocks.filter((f) => !f.dead);
    if (AN) AN.endBirds();
    this.meshes.forEach((im, k) => { im.count = counts[k]; uploadUsed(im.instanceMatrix, im.count); uploadUsed(im.instanceColor, im.count); });
  }
}
