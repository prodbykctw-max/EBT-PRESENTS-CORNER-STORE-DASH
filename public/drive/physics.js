// Top-down car physics (2D bicycle model with a slip-angle tyre model) + static collision against
// building footprints. Top-down gameplay needs no 3D rigid-body engine: this is ~0 KB instead of a
// ~2 MB WASM physics library, and it is fully tunable for arcade feel.
// World frame: metres, +x east, +y north. Heading 0 = east, CCW positive.

export const CAR = {
  mass: 1780,          // modern muscle coupe
  inertia: 3200,
  a: 1.5, b: 1.45,     // CG → front / rear axle (2.95 m wheelbase)
  width: 1.95, length: 5.05,
  engine: 12500,       // N of drive force at full throttle (arcade-strong: ~0-60 mph in 5 s)
  brake: 16000,
  reverse: 4200,
  drag: 0.42,          // aero, ∝ v²
  roll: 5,             // rolling resistance, ∝ v (top speed ≈ 42 m/s / 94 mph)
  cornerF: 7.2, cornerR: 7.8, // cornering stiffness (per rad, × load)
  grip: 1.15,          // μ
  handbrakeGrip: 0.42, // rear grip multiplier when the handbrake is on → drift
  maxSteer: 0.62,      // rad
};

export class Car {
  constructor(x, y, heading) {
    Object.assign(this, { x, y, heading, vx: 0, vy: 0, yawRate: 0, steer: 0, throttle: 0, brake: 0, handbrake: false });
    this.lastImpact = 0;
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get forwardSpeed() { return this.vx * Math.cos(this.heading) + this.vy * Math.sin(this.heading); }

  step(dt, input) {
    const c = CAR, cos = Math.cos(this.heading), sin = Math.sin(this.heading);
    // body-frame velocity (vf forward, vl left)
    let vf = this.vx * cos + this.vy * sin, vl = -this.vx * sin + this.vy * cos;
    const speed = Math.hypot(vf, vl);
    // steering: smoothed, and reduced at speed so the car stays drivable at 100+ km/h
    // keyboard steering is on/off, so it is speed-scaled and rate-limited like an arcade racer
    const target = input.steer * c.maxSteer / (1 + speed / 11);
    this.steer += (target - this.steer) * Math.min(1, dt * (input.steer ? 6 : 12));

    // slip angles (low-speed guard avoids the classic zero-velocity singularity)
    const vfx = Math.max(Math.abs(vf), 2.5) * Math.sign(vf || 1);
    const slipF = Math.atan2(vl + this.yawRate * c.a, Math.abs(vfx)) - this.steer * Math.sign(vfx);
    const slipR = Math.atan2(vl - this.yawRate * c.b, Math.abs(vfx));
    const load = c.mass * 9.81 / 2;
    const maxF = c.grip * load, rearGrip = input.handbrake ? c.handbrakeGrip : 1;
    const Ff = clamp(-c.cornerF * slipF * load, -maxF, maxF);
    const Fr = clamp(-c.cornerR * slipR * load, -maxF * rearGrip, maxF * rearGrip);

    // longitudinal
    let Fx = 0;
    if (input.throttle > 0) Fx += input.throttle * c.engine * (vf < 0 ? 1.6 : 1) * (1 - Math.min(speed / 62, 0.85));
    if (input.brake > 0) Fx -= vf > 0.5 ? input.brake * c.brake : input.brake * c.reverse * (vf > -9 ? 1 : 0);
    if (input.handbrake) Fx -= Math.sign(vf) * Math.min(Math.abs(vf) * c.mass * 2, c.brake * 0.35);
    Fx -= c.drag * vf * Math.abs(vf) + c.roll * vf * 10;

    const ax = Fx / c.mass + Ff * Math.sin(this.steer) / c.mass * -1 + this.yawRate * vl;
    const ay = (Fr + Ff * Math.cos(this.steer)) / c.mass - this.yawRate * vf;
    const torque = Ff * Math.cos(this.steer) * c.a - Fr * c.b;
    vf += ax * dt; vl += ay * dt;
    this.yawRate += (torque / c.inertia) * dt;
    // stability assist: off the keys (and not handbraking) the car settles instead of fishtailing
    if (!input.steer && !input.handbrake) this.yawRate *= 1 - Math.min(1, dt * 2.5);
    if (speed < 0.6 && !input.throttle) { vf *= 0.9; vl *= 0.9; this.yawRate *= 0.8; } // settle to rest
    vl *= 1 - Math.min(1, dt * 0.8); // tyre scrub

    this.heading += this.yawRate * dt;
    const c2 = Math.cos(this.heading), s2 = Math.sin(this.heading);
    this.vx = vf * c2 - vl * s2; this.vy = vf * s2 + vl * c2;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.slip = Math.abs(slipR) > 0.18 && speed > 8; // for tyre smoke / skid audio
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------- collision: car = 3 circles along its axis vs. building edges ----------------
export class Collision {
  constructor(polys, cell = 24) {
    this.cell = cell; this.grid = new Map();
    for (const p of polys) for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], seg = [a[0], a[1], b[0], b[1]];
      const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k = gx + ',' + gy; if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(seg);
      }
    }
  }
  near(x, y) {
    const out = [], gx = Math.floor(x / this.cell), gy = Math.floor(y / this.cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const s = this.grid.get(gx + i + ',' + (gy + j)); if (s) out.push(...s); }
    return out;
  }
  /** Push the car out of walls; returns the impact speed (m/s) of the hardest hit this step. */
  resolve(car) {
    const R = CAR.width / 2 + 0.05, offs = [-1.75, 0.05, 1.85]; // circles span the 5 m body (CG sits slightly aft)
    let hardest = 0;
    const segs = this.near(car.x, car.y);
    for (const o of offs) {
      const cx = car.x + Math.cos(car.heading) * o, cy = car.y + Math.sin(car.heading) * o;
      for (const [ax, ay, bx, by] of segs) {
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / L2));
        const px = ax + t * dx, py = ay + t * dy;
        let nx = cx - px, ny = cy - py; const d = Math.hypot(nx, ny);
        if (d >= R || d < 1e-6) continue;
        nx /= d; ny /= d;
        car.x += nx * (R - d); car.y += ny * (R - d);
        const vn = car.vx * nx + car.vy * ny;
        if (vn < 0) {
          hardest = Math.max(hardest, -vn);
          const e = 0.25, mu = 0.35; // bounce + wall scrape
          car.vx -= (1 + e) * vn * nx; car.vy -= (1 + e) * vn * ny;
          const tx = -ny, ty = nx, vt = car.vx * tx + car.vy * ty;
          car.vx -= tx * vt * mu; car.vy -= ty * vt * mu;
          car.yawRate += o * vn * 0.12;  // hit the nose or tail → spin
        }
      }
    }
    return hardest;
  }
}
