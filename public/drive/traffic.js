// Traffic that drives like traffic. Everything here runs in route space (s along the street, d across it) and moves the
// cars of runner.js's World: no mesh, no THREE, so the logic reads (and tests) on its own.
//
//   Along the street   the Intelligent Driver Model (IDM; Treiber, Hennecke & Helbing 2000). Each driver has a desired
//                      speed, a safe time gap, a comfortable acceleration and braking. The acceleration is one smooth
//                      formula of the gap to whatever is ahead and the closing speed, so cars ease up to a queue and
//                      ease away from it: no instant stops, no phantom braking. What's "ahead" is anything solid in
//                      the car's path: a car, a parked car, a cone, the streetcar, you, the runner on foot, a dog, and
//                      virtual things: the stop line at a red light, the end of a work zone held for the other
//                      direction.
//   Across the street  a lane is a reference line (the centre of a lane) plus an offset that is always eased out by a
//                      cubic Hermite curve with zero speed at both ends: a lane change takes 1.4-3 s and has no kink.
//                      Lane changes follow the MOBIL rules (Kesting, Treiber & Helbing 2007): change when it is
//                      better and safe, where safe means the car that would end up behind never has to brake hard
//                      (you count as that car, with a bigger margin), and the oncoming lane must be clear for the
//                      whole manoeuvre.
//   Giving way         a car that sees you closing on it in its lane (or hears the HORN) moves over into the free
//                      parking lane, or the other travel lane when that is clear; oncoming cars do the same when you
//                      are in theirs. Nobody pulls out, merges or changes lane in front of you.
//   People             the runner on foot, dogs and the people who work the lights are obstacles with their own
//                      predicted sideways movement: cars brake early (hard, with a horn and a skid if they must).
//
// Constants are SI (m, s). The 25 mph downtown limit is 11.2 m/s; drivers want 5-30 % over it, like Atlanta drivers.
export const LIMIT = 11.2;
const SPEED_OVER = [1.05, 1.3];

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const hermite = (x0, v0, T, t) => {   // from (x0, v0) at t = 0 to (0, 0) at t = T: position and velocity
  const u = clamp(t / T, 0, 1), u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, dh00 = (6 * u2 - 6 * u) / T, dh10 = (3 * u2 - 4 * u + 1);
  return [h00 * x0 + h10 * T * v0, dh00 * x0 + dh10 * v0];
};

/** IDM acceleration. v own speed, v0 desired speed, gap bumper-to-bumper to the leader (Infinity: none), vl leader
 *  speed along our direction (negative for head-on), p {a, b, T, s0, bmax} */
export function idmAccel(v, v0, gap, vl, p) {
  const free = 1 - Math.pow(Math.max(0, v) / Math.max(v0, 0.5), 4);
  if (gap === Infinity) return p.a * free;
  const sStar = p.s0 + Math.max(0, v * p.T + v * (v - vl) / (2 * Math.sqrt(p.a * p.b)));
  return Math.max(-p.bmax, p.a * (free - (sStar / Math.max(gap, 0.05)) ** 2));
}

/** a driver: desired speed over the limit, how brisk, how big a gap they keep */
export function newDriver(type) {
  const calm = type === 'robotaxi', cop = type === 'police';
  return {
    v0: LIMIT * (calm ? 1.08 : cop ? 1.22 : rnd(...SPEED_OVER)),
    a: calm ? 1.5 : rnd(1.5, 2.1), b: calm ? 2.0 : rnd(2.0, 2.8), T: calm ? 1.4 : rnd(1.0, 1.5), s0: rnd(2.0, 2.7), bmax: 9,
  };
}

export class Traffic {
  constructor(world, { PLAYER, CARS, ON_FOOT }) {
    Object.assign(this, { world, PLAYER, CARS, ON_FOOT, clock: 0, honkT: 0, curv: null });
    this.stats = { evacuated: 0, evacFailed: 0, pulledOut: 0, passes: 0, unstuck: 0, honks: 0, runnerBrakes: 0, runnerHits: 0, lanechanges: 0, standoffs: 0, slowPasses: 0 };
  }

  // ------------------------------------------------------------------ the road ahead
  /** safe speed round the bend at s (lateral acceleration <= 2.3 m/s^2), from how fast the route's heading turns */
  curveV(s) {
    const r = this.world.route;
    if (!this.curv) {
      const n = r.n, k = new Float32Array(n);
      for (let i = 4; i < n - 4; i++) k[i] = Math.abs(Math.atan2(Math.sin(r.A[i + 4] - r.A[i - 4]), Math.cos(r.A[i + 4] - r.A[i - 4]))) / 8;
      this.curv = k;
    }
    let kmax = 0; const i0 = clamp(Math.round(s), 0, r.n - 1);
    for (let i = Math.max(0, i0 - 6); i <= Math.min(r.n - 1, i0 + 14); i += 2) kmax = Math.max(kmax, this.curv[i]);
    return kmax < 0.004 ? 99 : Math.max(5.5, Math.sqrt(2.3 / kmax));
  }

  refD(ref, s) {
    const r = this.world.route;
    switch (ref) {
      case 'l0': return r.lane(s, 0);
      case 'l1': return r.lane(s, 1);
      case 'pR': return r.parkD(s, -1) ?? r.lane(s, 0) - (r.travel(s) / 2 - 1.05);
      default: return r.parkD(s, 1) ?? r.lane(s, 1) + (r.travel(s) / 2 - 1.05);
    }
  }
  /** the lateral position the reference puts a car at, lateral extent for the free-space checks */
  laneOfRef(ref) { return ref === 'pR' || ref === 'pL' ? null : ref === 'l0' ? 0 : 1; }

  /** swing e onto another reference line, easing the offset out with zero speed at the end */
  changeRef(e, ref, T) {
    const c = this.refD(ref, e.s);
    e.ref = ref; e.prof = { t: 0, T, x0: e.d - c - e.pers, v0: e.dd };
    e.refT = this.clock; this.stats.lanechanges++;
  }

  // ------------------------------------------------------------------ what's out there
  /** everything solid in or near the street, sorted along it. `car` is you; `runner` the person on foot (or null) */
  collect(car, runner) {
    const W = this.world, r = W.route, obs = [];
    for (const o of W.ents) {
      if (!o.alive || o.flying) continue;
      if (o.scenery && o.type !== 'tram') continue;
      if (!(o.solid >= 0.35) && !o.worker) continue;
      if (o.type === 'cone' && o.hitDone) continue;
      const ped = this.ON_FOOT.has(o.type) || !!o.worker;
      obs.push({ o, s: o.s, d: o.d, L: o.L || 4.5, W: o.W || 1.8, vs: o.parked ? 0 : o.v || 0, vd: o.dd || 0, ped, veh: !ped && o.solid >= 0.7 && !!this.CARS.has(o.type) });
    }
    // cross-street traffic that is on (or about to be on) our road is an obstacle too
    for (const a of W.ambient) {
      if (a.deck || a.x === undefined || a.dead) continue;
      if (r.distTo(a.x, a.y) > 16) continue;
      const pr = r.project(a.x, a.y);
      if (Math.abs(pr.d) > r.hw(pr.s) + 5) continue;
      const sp = a.vs || 0, A = r.A[Math.round(clamp(pr.s, 0, r.n - 1))], c = Math.cos(a.h), sn = Math.sin(a.h);
      obs.push({ o: a, s: pr.s, d: pr.d, L: a.type === 'bus' ? 12 : 4.6, W: a.type === 'bus' ? 2.55 : 1.9, vs: sp * (c * Math.cos(A) + sn * Math.sin(A)), vd: sp * (-c * Math.sin(A) + sn * Math.cos(A)), ped: false, veh: true, cross: true });
    }
    obs.push({ o: car, s: car.s, d: car.d, L: 2 * this.PLAYER.halfL, W: 2 * this.PLAYER.halfW, vs: car.v, vd: car.dv || 0, ped: false, veh: true, player: true, tgt: car.targetD });
    for (const q of W.others || []) if (runner && q.o?.visible) obs.push({ o: q, s: q.s, d: q.d, L: 0.9, W: 0.9, vs: q.v || 0, vd: q.dv || 0, ped: true, other: true });
    if (runner) obs.push({ o: runner, s: runner.s, d: runner.d, L: 0.9, W: 0.9, vs: runner.v || 0, vd: runner.dv || 0, ped: true, runner: true });
    obs.sort((a, b) => a.s - b.s);
    this.obs = obs;
    return obs;
  }
  lowerBound(s) { const a = this.obs; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].s < s) lo = m + 1; else hi = m; } return lo; }

  /** the most restrictive thing ahead of e in the corridor [lo, hi] (centre positions): { a, gap, ob } or null.
   *  `look` metres; `ignore` skips one obstacle (the thing we're deciding about) */
  ahead(e, dir, sp, v0, lo0, hi0, look = 150, ignore = null) {
    const D = e.drv, ob = this.obs, S = e.s, m = 0.18 + 0.012 * sp;
    let best = null;
    const i0 = this.lowerBound(dir > 0 ? S - 4 : S - look - 15), i1 = this.lowerBound(dir > 0 ? S + look + 15 : S + 4);
    for (let i = i0; i < Math.min(i1 + 1, ob.length); i++) {
      const o = ob[i]; if (o.o === e || o.o === ignore) continue;
      if (e.ghostUntil > this.clock && o.veh && !o.player && o.o.dir === -dir) continue;     // a standoff that was given up on
      const ds = dir * (o.s - S); if (ds <= 0.2) continue;
      let gap = ds - (o.L + e.L) / 2; if (gap > look) continue;
      const vlu = dir * o.vs, tau = clamp(Math.max(gap, 0) / Math.max(1, sp - vlu), 0.3, o.ped ? 2.6 : 1.8);
      // its lateral extent now and where it's heading (people step into the road, cars change lane)
      const pad = o.ped ? 0.42 : 0.12, shift = o.vd * tau;
      const oLo = o.d - o.W / 2 - pad + Math.min(0, shift), oHi = o.d + o.W / 2 + pad + Math.max(0, shift);
      // in the middle of a lane change what counts is where we will be when we get there, not the whole sweep
      let lo = lo0, hi = hi0;
      if (e.prof) lo = hi = this.latAt(e, Math.max(gap, 0) / Math.max(sp, 1.5));
      if (oHi <= lo - e.W / 2 - m || oLo >= hi + e.W / 2 + m) continue;
      if (o.ped && o.o.worker && !o.o.leaving) {
        // someone working the lane line: we are not going to hit them, so we slow right down and go past with room
        const cl = Math.max(oLo + pad - (hi + e.W / 2), lo - e.W / 2 - (oHi - pad));
        if (cl >= 0.3) {
          const cap = 2.2 + 5 * clamp((cl - 0.3) / 0.7, 0, 1), near = 6 + sp * 1.5;
          if (gap < near) { const ac = clamp(D.a * (1 - Math.pow(sp / cap, 4)), -D.b * 1.4, D.a); if (!best || ac < best.a) best = { a: ac, gap, ob: o, vlu }; }
          continue;
        }
      }
      if (o.ped) gap -= 1.2;
      // squeezing past something in the other lane of a wide street needs no brakes when it stays well clear
      const a = idmAccel(sp, v0, Math.max(gap, 0.05), vlu, D);
      if (!best || a < best.a) best = { a, gap, ob: o, vlu };
    }
    return best;
  }

  /** where e's centre will be `tau` seconds on, riding out the lane change it is in the middle of */
  latAt(e, tau) {
    const base = this.refD(e.ref, e.s) + e.pers + (e.room || 0);
    if (!e.prof) return base + (e.off || 0);
    const t = Math.min(e.prof.T, e.prof.t + tau);
    return base + hermite(e.prof.x0, e.prof.v0, e.prof.T, t)[0];
  }

  /** nearest same-direction vehicle behind e in the corridor [lo, hi]: { gap, ob } or null (the player counts) */
  behind(e, dir, lo, hi, look = 70) {
    const ob = this.obs, S = e.s; let best = null;
    const i0 = this.lowerBound(dir > 0 ? S - look - 15 : S - 4), i1 = this.lowerBound(dir > 0 ? S + 4 : S + look + 15);
    for (let i = i0; i < Math.min(i1 + 1, ob.length); i++) {
      const o = ob[i]; if (o.o === e || !o.veh || o.ped) continue;
      const ds = dir * (S - o.s); if (ds <= -0.5) continue;
      const vlu = dir * o.vs; if (vlu < -2) continue;                      // going the other way
      const half = o.W / 2 + 0.1 + (o.player ? 0.45 : 0), tg = o.player ? o.tgt : undefined;
      const odLo = Math.min(o.d, tg ?? o.d) - half, odHi = Math.max(o.d, tg ?? o.d) + half;
      if (odHi <= lo - e.W / 2 || odLo >= hi + e.W / 2) continue;
      const gap = ds - (o.L + e.L) / 2;
      if (!best || gap < best.gap) best = { gap, ob: o, vlu };
    }
    return best;
  }

  /** is a lateral strip free of obstacles for [s0, s1] (route metres), ignoring e? `moving` obstacles are projected
   *  forward by `T` seconds: clear means clear for the whole time the car will take to get there */
  stripFree(e, lo, hi, s0, s1, T = 2.5) {
    for (const o of this.obs) {
      if (o.o === e) continue;
      const a = o.s - o.L / 2 + Math.min(0, o.vs * T), b = o.s + o.L / 2 + Math.max(0, o.vs * T);
      if (b < s0 || a > s1) continue;
      if (o.d + o.W / 2 + 0.2 > lo && o.d - o.W / 2 - 0.2 < hi) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ the step
  /** move every driving car one step. `car` = you; `runner` = the person on foot, if you're on foot */
  step(dt, car, hornT, runner, out) {
    const W = this.world, r = W.route, sig = W.signals;
    this.clock += dt; this.honkT -= dt;
    this.collect(car, runner);
    const drivers = [];
    for (const e of W.ents) {
      if (!e.alive || e.parked || e.scenery || e.flying || e.hold || !this.CARS.has(e.type) || !(e.dir === 1 || e.dir === -1)) continue;
      if (!e.drv) this.start(e);
      drivers.push(e);
    }
    // work zones: the right lane is closed, so cars in our direction use the left lane; oncoming cars wait at the far
    // end while someone is on their way through (the flagger), a car already inside finishes
    const zones = (W.workZones || []).map(([a, b], i) => { const z = ((this.zst ||= [])[i] ||= { turn: 1, t: 0 }); z.a = a; z.b = b; z.c0 = a + 32; z.c1 = b - 2; return z; });
    this.zoneTurns(zones, drivers, car, dt);
    this.zones = zones;
    for (const e of drivers) this.plan(e, dt, car, hornT, runner, zones, sig, out);
    for (const e of drivers) this.move(e, dt);
    // the streetcar can't swerve: if the runner is still under it when it arrives, that is a shove too
    if (runner) for (const tr of W.ents) if (tr.alive && tr.type === 'tram' && Math.abs(tr.s - runner.s) < (tr.L || 24.8) / 2 + 0.4 && Math.abs(tr.d - runner.d) < (tr.W || 2.65) / 2 + 0.4 && Math.abs(tr.v) > 0.3) {
      (out.runnerHits ||= []).push({ e: tr, sp: Math.abs(tr.v) }); this.stats.runnerHits++; if (tr.tram) tr.tram.speed *= 0.4;
    }
    this.feed(dt, car, runner);
    // pulling out of a parking space
    for (const o of W.ents) if (o.occupied && o.parked && o.alive) this.maybePullOut(o, car, runner);
  }

  /** a work zone is one lane wide where it is coned off, so the two directions take turns (a flagger): `turn` 1 = our
   *  direction goes, -2 = ours stop, waiting for the section to empty, -1 = the oncoming direction goes, 2 = theirs stop.
   *  A direction never waits more than about one turn-and-a-half; you in the left lane make it your turn. */
  zoneTurns(zones, drivers, car, dt) {
    for (const z of zones) {
      z.t += dt;
      // "in": cars of ours that are out in the left lane (committed: the other direction must not be let in under them), and
      // oncoming cars past their stop line. Cars of ours still in the right lane, held or stuck at the cones, are waiting.
      const inFwd = drivers.some((e) => e.dir === 1 && e.ref === 'l1' && e.s > z.a - 90 && e.s - e.L / 2 < z.c1 + 4);
      const inOnc = drivers.some((e) => e.dir === -1 && e.s - e.L / 2 < z.c1 + 1 && e.s + e.L / 2 > z.c0 - 4);
      const waitFwd = drivers.some((e) => e.dir === 1 && e.ref !== 'l1' && e.s > z.a - 80 && e.s < z.c1 && e.sp < 5);
      const waitOnc = drivers.some((e) => e.dir === -1 && e.s - e.L / 2 >= z.c1 + 1 && e.s < z.c1 + 90 && e.sp < 5);
      // a platoon on its way keeps the turn a little longer, but never past 20 s
      const comingFwd = drivers.some((e) => e.dir === 1 && e.ref !== 'l1' && e.s > z.a - 45 && e.s <= z.c0 && e.sp > 3);
      const comingOnc = drivers.some((e) => e.dir === -1 && e.s > z.c1 && e.s < z.c1 + 60 && e.sp > 3);
      const playerIn = car.s > z.a - 30 && car.s < z.c1 + 5 && car.d > -0.5;
      z.inFwd = inFwd; z.inOnc = inOnc;
      if (z.turn === 1) {
        if (inOnc && !inFwd) { z.turn = -1; z.t = 0; }                        // they are already in there: let them through
        else if (!playerIn && waitOnc && (z.t > 20 || (z.t > 8 && !comingFwd) || !waitFwd && !comingFwd)) z.turn = -2;
      } else if (z.turn === -2) { if (!inFwd) { z.turn = -1; z.t = 0; } }
      else if (z.turn === -1) {
        if (inFwd && !inOnc) { z.turn = 1; z.t = 0; }
        else if (playerIn || (waitFwd && (z.t > 20 || (z.t > 8 && !comingOnc) || !waitOnc && !comingOnc))) z.turn = 2;
      } else if (z.turn === 2) { if (!inOnc) { z.turn = 1; z.t = 0; } }
    }
  }

  start(e) {
    e.drv = newDriver(e.type);
    e.sp = e.dir === -1 ? -(e.v || 0) : e.v || 0;
    e.lane = e.dir === -1 ? 1 : 0; e.ref = e.ref || (e.lane ? 'l1' : 'l0');
    e.pers = rnd(-0.2, 0.2); e.off = 0; e.dd = 0; e.aF = 0; e.stillT = 0; e.prof = null; e.lcT = -9;
    if (!e.cruise) e.cruise = e.drv.v0;
  }

  plan(e, dt, car, hornT, runner, zones, sig, out) {
    const W = this.world, r = W.route, D = e.drv, dir = e.dir;
    let sp = dir === -1 ? -e.v : e.v; if (sp < 0) sp = 0;
    e.sp = sp;
    const two = !r.oneway(e.s);
    // desired speed: the driver's, less for a bend and when the street is full of people
    let v0 = Math.min(D.v0, this.curveV(e.s + (dir > 0 ? 8 : -8)));
    if ((W.workZones || []).some(([a, b]) => e.s > a - 8 && e.s < b + 8)) v0 = Math.min(v0, 8);
    else if (e.flee > this.clock) v0 = Math.max(v0, Math.min(sp + 4, D.v0 * 1.3, this.curveV(e.s + (dir > 0 ? 8 : -8))));
    if (e.backup) v0 = 20;
    e.v0now = v0;
    const lo0 = Math.min(e.d, this.refD(e.ref, e.s)), hi0 = Math.max(e.d, this.refD(e.ref, e.s));
    let lead = this.ahead(e, dir, sp, v0, lo0 + e.pers, hi0 + e.pers);
    let a = lead ? lead.a : idmAccel(sp, v0, Infinity, 0, D);
    let why = lead ? lead.ob : null;
    // the stop line at a red light
    const front = e.s + dir * (e.L || 4.5) / 2, line = sig?.stopFor(front, sp, dir);
    if (line != null) {
      const gap = dir > 0 ? line - front : front - line, as = idmAccel(sp, v0, Math.max(gap - 0.3, 0.05), 0, D);
      if (as < a) { a = as; why = 'light'; }
    }
    // alternating traffic at a work zone: the direction whose turn it isn't waits at its end of the one-lane stretch
    for (const z of zones) {
      let gap = null;
      if (dir === -1 && z.turn !== -1 && e.s - (e.L || 4.5) / 2 >= z.c1 + 1 && e.s < z.c1 + 100) gap = front - (z.c1 + 6);
      else if (dir === 1 && z.turn !== 1 && e.ref !== 'l1' && front <= z.c0 - 1 && e.s > z.c0 - 120) gap = (z.c0 - 6) - front;
      if (gap === null) continue;
      const as = idmAccel(sp, v0, Math.max(gap, 0.05), 0, D);
      if (as < a) { a = as; why = 'zone'; }
    }
    e.whyK = a > idmAccel(sp, v0, Infinity, 0, D) - 0.15 ? null : why === 'light' || why === 'zone' ? why : why ? (why.o.parked ? 'parked' : why.o.type) + (why.player ? '(player)' : '') : 'free';
    e.whyO = e.whyK && typeof why === 'object' && why ? why.o : null;
    if (e.backup) {   // BUSTED: the backup cruiser pulls up behind you
      const gap = car.s - 6.5 - e.s; e.ref = 'l0';
      a = gap < 0.3 ? -D.bmax : clamp((Math.min(18, Math.sqrt(2 * 5 * gap)) - sp) * 1.5, -8, 3);
      this.finish(e, dt, a, sp);
      return;
    }

    // --- a pass that met the other direction head on: the car in the wrong lane backs out of it, else both drive through
    if (sp < 0.3 && lead && lead.ob.veh && !lead.ob.player && !lead.ob.cross && lead.ob.o.dir === -dir && lead.gap < 9) e.faceT = (e.faceT || 0) + dt; else e.faceT = 0;
    if (e.faceT > 3) {
      const home = dir === -1 ? 1 : 0, c0 = this.refD(home ? 'l1' : 'l0', e.s);
      if ((e.ref === 'l1' ? 1 : 0) !== home && !e.prof && this.stripFree(e, c0 - e.W / 2, c0 + e.W / 2, e.s - e.L / 2 - 1, e.s + e.L / 2 + 4, 0.5)) { this.changeRef(e, home ? 'l1' : 'l0', 1.8); e.lane = home; e.passEnd = undefined; e.faceT = 0; }
      else if (e.faceT > 7) { e.ghostUntil = this.clock + 6; e.faceT = 0; this.stats.standoffs++; }
    }
    // --- give people and slow things room: shift to the far side of our lane when one is close to our side of it
    this.room(e, dir, sp, dt);
    // --- giving way to you
    this.giveWay(e, dir, sp, v0, car, hornT, two, zones);
    // --- passing / lane choice
    if (two ? dir === 1 : true) this.lanes(e, dir, sp, v0, lead, car, two, zones);

    // --- people in the street: hard braking gets a horn and a skid
    if (lead && lead.ob.ped && a < -4 && sp > 3 && this.honkT <= 0 && !e.honked) {
      e.honked = 1.6; this.honkT = 0.35; this.stats.honks++; (out.honks ||= []).push({ e, d: Math.abs(e.s - car.s), skid: a < -6 });
    }
    if (e.honked) e.honked -= dt;
    if (lead && lead.ob.runner && a < -2) this.stats.runnerBrakes++;
    // --- a runner right in front: soft bump, counted for the game to stagger the runner
    if (runner) {
      const ds = Math.abs(e.s - runner.s) - ((e.L || 4.5) / 2 + 0.45), dd = Math.abs(e.d - runner.d) - ((e.W || 1.8) / 2 + 0.38);
      if (ds < 0 && dd < 0 && sp > 0.5) { (out.runnerHits ||= []).push({ e, sp }); this.stats.runnerHits++; a = Math.min(a, -D.bmax); e.sp = sp = sp * 0.7; }
    }
    this.finish(e, dt, a, sp);
  }

  /** a person (or a bike) close beside our line: lean away inside our lane, easing, before we get there */
  room(e, dir, sp, dt) {
    const r = this.world.route, tgtD = this.refD(e.ref, e.s) + e.pers;
    let want = 0;
    if (sp > 1.5 && !e.prof) {
      const lane = r.travel(e.s), slack = Math.max(0, lane / 2 - e.W / 2 - 0.25);
      for (const o of this.obs) {
        if (!o.ped || o.o === e) continue;
        const ds = dir * (o.s - e.s); if (ds < 1 || ds > 8 + sp * 2) continue;
        const side = o.d - tgtD, need = e.W / 2 + o.W / 2 + 0.95;       // a metre clear of them
        if (Math.abs(side) < need && Math.abs(side) > 0.2) want += -Math.sign(side) * Math.min(slack, need - Math.abs(side));
      }
    }
    e.roomT = clamp(want, -1.2, 1.2);
    e.room = (e.room || 0) + (e.roomT - (e.room || 0)) * (1 - Math.exp(-dt / 0.45));
  }

  /** smooth the acceleration and step the speed */
  finish(e, dt, a, sp) {
    // brake hard when you must, but ease off the brake and onto the gas (a firm 0.3 s filter: no jerk)
    const k = a < e.aF ? 1 - Math.exp(-dt / 0.12) : 1 - Math.exp(-dt / 0.35);
    e.aF += (a - e.aF) * k;
    e.accel = e.aF;
    sp = Math.max(0, sp + e.aF * dt);
    e.sp = sp; e.v = e.dir * sp;
    e.stopT = sp < 0.3 ? (e.stopT || 0) + dt : 0;
    // never a car that sits still with nothing in the way: a gentle creep gets it going again
    e.stillT = sp < 0.3 && a > 0.2 ? e.stillT + dt : 0;
    if (e.stillT > 5) { e.sp = e.v = e.dir * 1.2; e.stillT = 0; this.stats.unstuck++; }
  }

  move(e, dt) {
    const r = this.world.route;
    e.s += e.v * dt;
    // lateral: reference lane + eased offset
    if (e.prof) {
      e.prof.t += dt; const [x, v] = hermite(e.prof.x0, e.prof.v0, e.prof.T, e.prof.t);
      e.off = x; if (e.prof.t >= e.prof.T) { e.prof = null; e.off = 0; }
    }
    const d0 = e.d, d1 = this.refD(e.ref, e.s) + e.pers + e.off + (e.room || 0);
    e.d = d1; e.dd = dt > 0 ? clamp((d1 - d0) / dt, -4, 4) : 0;
    // the nose follows the lane change a little
    e.yawLat = e.dir * Math.atan2(e.dd, Math.max(e.sp, 3)) * 0.8;
  }

  // ------------------------------------------------------------------ lanes
  lanes(e, dir, sp, v0, lead, car, two, zones) {
    const r = this.world.route, S = e.s;
    if (e.ref === 'pR' || e.ref === 'pL' || this.clock - e.refT < 1) return;   // busy giving way
    if (this.clock - e.lcT < 0.25) return; e.lcT = this.clock;
    const home = dir === -1 ? 1 : 0;
    const myLane = e.ref === 'l1' ? 1 : 0;
    if (myLane === home || !two) {
      // something in the way that we'd be better off driving round? Only real obstructions: cones, wrecks, a car that has
      // broken down, something much slower: never a queue of cars that are simply waiting their turn
      const lo = Math.min(e.d, this.refD(e.ref, S)) + e.pers, hi = Math.max(e.d, this.refD(e.ref, S)) + e.pers;
      if (dir === 1 && (this.zones || []).some((z) => z.turn !== 1 && S > z.a - 90 && S < z.c1)) return;   // waiting for the flagger: in line like everyone else
      const bl = this.blocker(e, dir, sp, v0, lo, hi);
      if (!bl) return;
      if (bl.kind === 'slow' && (two ? dir !== 1 : false)) return;
      const o = bl.ob;
      const lane2 = two ? 1 - myLane : 1 - myLane, c2 = this.refD(lane2 ? 'l1' : 'l0', S);
      const endS = this.blockEnd(e, o, dir);
      const T = (dir * (endS - S) + e.L + 6) / Math.max(6, sp) + 2.4, zn = (this.zones || []).find((z) => z.turn === 1 && S > z.a - 60 && S < z.b + 12);
      if (!this.laneClear(e, c2, S - 8, endS + 12 + e.L, T, two, dir, car, sp, zn)) return;
      this.changeRef(e, lane2 ? 'l1' : 'l0', 2.2); e.lane = lane2; e.passEnd = endS; this.stats.passes++; if (bl.kind === 'slow') this.stats.slowPasses++;
    } else {
      // back into our own lane once we're clear of what we passed, and it is safe
      if (e.passEnd !== undefined && dir * (S - e.passEnd) < e.L / 2 + 1.2) { e.retWhy = 'passEnd'; return; }
      const c0 = this.refD(home ? 'l1' : 'l0', S);
      if (!this.stripFree(e, c0 - e.W / 2, c0 + e.W / 2, S - e.L / 2 - 4, S + e.L / 2 + 9, 1.2)) { e.retWhy = 'strip'; return; }
      const bh = this.behind(e, dir, c0 - 1, c0 + 1);
      if (bh && bh.gap < Math.max(10, bh.ob.vs > sp ? (dir * bh.ob.vs - sp) * 3.5 + 10 : 8)) { e.retWhy = 'behind ' + bh.ob.o.type + ' gap ' + bh.gap.toFixed(1) + ' v ' + bh.ob.vs.toFixed(1); return; }
      this.changeRef(e, home ? 'l1' : 'l0', 2.2); e.lane = home; e.passEnd = undefined;
    }
  }
  /** the first thing in e's corridor ahead, if it is one worth driving round: { ob, gap, kind: 'static' | 'stalled' | 'slow' }.
   *  The first thing is also the only thing that counts: behind a queue of waiting cars there is nothing to pass. */
  blocker(e, dir, sp, v0, lo, hi) {
    const ob = this.obs, S = e.s, look = 24 + sp * 4.5;
    let best = null;
    const i0 = this.lowerBound(dir > 0 ? S - 4 : S - look - 15), i1 = this.lowerBound(dir > 0 ? S + look + 15 : S + 4);
    for (let i = i0; i < Math.min(i1 + 1, ob.length); i++) {
      const o = ob[i]; if (o.o === e) continue;
      const ds = dir * (o.s - S); if (ds <= 0.2) continue;
      const gap = ds - (o.L + e.L) / 2; if (gap > look) continue;
      if (o.d + o.W / 2 + 0.12 <= lo - e.W / 2 || o.d - o.W / 2 - 0.12 >= hi + e.W / 2) continue;
      if (best && gap >= best.gap) continue;
      const vl = dir * o.vs, oo = o.o;
      let kind = null;
      if (o.player || o.runner || o.other) kind = 'wait';
      else if (o.ped) kind = 'wait';                                   // people are waited for or edged past, never driven round in the other lane
      else if (oo.parked || oo.hold || oo.type === 'cone' || oo.type === 'barricade') kind = 'static';
      else if (o.veh && Math.abs(vl) < 0.8) kind = (oo.stopT || 0) > 12 && !oo.whyK && !this.world.signals?.stopFor(oo.s + dir * (oo.L || 4.5) / 2, 0, dir) ? 'stalled' : 'wait';
      else if (o.veh && vl >= 2.5 && vl < v0 - 3 && gap < 24 && !o.cross && !(oo.whyK && vl < 6)) kind = 'slow';   // (a creeping queue is a queue, not a slow car)
      else kind = 'wait';
      best = { ob: o, gap, kind };
    }
    // something standing in the lane is driven round late (about two seconds of lane change before it), not from far back:
    // a pass started early means a long time in the other lane
    if (best && (best.kind === 'static' || best.kind === 'stalled') && best.gap > 16 + sp * 1.7) return null;
    return best && best.kind !== 'wait' ? best : null;
  }
  /** far end of the contiguous stretch of obstructions in e's lane starting at o */
  blockEnd(e, o, dir) {
    let end = o.s + dir * (o.L / 2), ld = o.d;
    const list = this.obs.filter((q) => q !== o && !q.player && !(q.ped && !q.o.worker) && !q.cross).sort((a, b) => dir * (a.s - b.s));
    for (const q of list) {
      if (dir * (q.s - o.s) < 0) continue;
      if (Math.abs(q.d - ld) > 2.2 || Math.abs(dir * q.vs) > 1.2) continue;
      if (dir * (q.s - end) > -q.L && dir * (q.s - end) < 32) { end = dir * Math.max(dir * end, dir * (q.s + dir * q.L / 2)); ld = q.d; }
    }
    return end;
  }
  /** is the strip at d = c clear from s0 to s1 for T seconds, including cars coming the other way and cars (and you)
   *  that would end up right behind us? */
  laneClear(e, c, s0, s1, T, two, dir, car, sp, zn) {
    const half = e.W / 2 + 0.2;
    for (const o of this.obs) {
      if (o.o === e) continue;
      if (zn && o.veh && o.o.dir === -dir && o.s > zn.c1 + 2) continue;      // (waiting at the flagger's line for us to get through)
      if (Math.abs(o.d - c) > o.W / 2 + half + 0.35 && !(o.player && Math.abs(o.tgt - c) < o.W / 2 + half)) continue;
      const vl = dir * o.vs;
      if (vl < -1) {
        // (a work zone's flagger holds oncoming cars beyond its far end while we go through: they can stop in time)
        if (zn && o.s > zn.c1 + 8 + o.vs * o.vs / 5) continue;
        // coming at us: where will it be when we're through?
        const near = o.s - o.L / 2 + o.vs * T, startGap = dir * (o.s - e.s);
        if (startGap > -5 && dir * (near - s1) < 8 + Math.abs(o.vs) * 0.8) return false;
        continue;
      }
      // going our way, or standing: it must not be in the strip, and must not be about to run up behind us
      // something ahead of us in that lane that is on the move (a car going our way): we would simply follow it
      if (dir * (o.s - e.s) > 0 && vl > 2.0 && !o.player) { if (dir * (o.s - e.s) - (e.L + o.L) / 2 >= 5 + sp * 0.45) continue; return false; }
      const a = o.s - o.L / 2 + Math.min(0, o.vs * T), b = o.s + o.L / 2 + Math.max(0, o.vs * T);
      if (b >= s0 && a <= s1 && Math.abs(vl) < 40) {
        const behindUs = dir * (e.s - o.s) > 0;
        if (!behindUs) return false;
        const gap = dir * (e.s - o.s) - (e.L + o.L) / 2, closing = vl - sp;
        if (gap < 10 + Math.max(0, closing) * (o.player ? 5 : 3.5)) return false;
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ giving way
  giveWay(e, dir, sp, v0, car, hornT, two, zones) {
    const r = this.world.route, S = e.s;
    const homeRef = dir === -1 ? 'l1' : 'l0';
    // 1) already giving way: come back once the threat has passed and it's safe
    if (e.ref === 'pR' || e.ref === 'pL' || (e.evac && e.ref !== homeRef && e.ref !== 'l' + (e.lane || 0))) {
      if (this.clock - e.refT < 1.4) return;
      const passed = dir * (car.s - e.s) > e.L / 2 + 3 && dir > 0 || (dir < 0 && Math.abs(car.d - e.d) > 4.2) || (dir < 0 && car.s > e.s + 8);
      const threat = this.threat(e, dir, car, hornT);
      const parkEnds = (e.ref === 'pR' || e.ref === 'pL') && r.parkD(S + dir * (8 + sp * 1.5), e.ref === 'pR' ? -1 : 1) === null;
      if ((!threat && (passed || this.clock - e.refT > 2.5)) || parkEnds) {
        const ref = e.lane ? 'l1' : 'l0', c = this.refD(ref, S);
        if (this.stripFree(e, c - e.W / 2, c + e.W / 2, S - e.L / 2 - 5, S + e.L / 2 + 8, 1.0)) {
          const bh = this.behind(e, dir, c - 1, c + 1);
          if (!bh || bh.gap > 10 + Math.max(0, dir * bh.ob.vs - sp) * 4) { this.changeRef(e, ref, 1.9); e.evac = false; }
        }
      }
      return;
    }
    if (e.prof && e.prof.t < 0.6 * e.prof.T) return;
    const th = this.threat(e, dir, car, hornT);
    if (!th) return;
    // somewhere to go: the free parking lane on our side, else the other travel lane when it's clear for the whole time
    const T = th.urgent ? 1.2 : 1.9, hold = th.ttc + 3.5;
    const pref = dir === -1 ? 'pL' : 'pR', pc = this.refD(pref, S);
    // (the parking lane next to our own lane, never across another lane, and only where it keeps going for as far as we will run)
    const side = dir === -1 ? 1 : -1, runTo = 14 + sp * T + sp * sp / 8;
    let hasPark = e.ref === (dir === -1 ? 'l1' : 'l0');
    for (let k = 0; hasPark && k <= runTo; k += 4) if (r.parkD(S + dir * k, side) === null) hasPark = false;
    if (hasPark && this.stripFree(e, pc - 1.0, pc + 1.0, S - 7, S + 9 + sp * T * 0.5 + sp * sp / 8, T)) { this.changeRef(e, pref, T); e.evac = true; this.stats.evacuated++; return; }
    if (two || true) {
      const lane2 = e.lane ? 0 : 1, c2 = this.refD(lane2 ? 'l1' : 'l0', S);
      if (!two && this.laneClear(e, c2, S - 8, S + 12 + sp * 3, hold, two, dir, car, sp) || (two && this.canSwap(e, dir, c2, hold, car, sp))) {
        this.changeRef(e, lane2 ? 'l1' : 'l0', T); e.lane = lane2; e.evac = true; e.refT = this.clock; this.stats.evacuated++; return;
      }
    }
    this.stats.evacFailed++;
    e.flee = this.clock + 1.2;       // nowhere to go: pick up the pace instead, and let it close slowly
  }
  /** swap into the opposite lane of a two-way street to get out of your way: only if nothing is coming and you aren't there */
  canSwap(e, dir, c2, hold, car, sp) { return this.laneClear(e, c2, e.s - 10, e.s + 14 + sp * 2.5, hold, true, dir, car, sp) && Math.abs(car.d - c2) > 2.6 && Math.abs((car.targetD ?? car.d) - c2) > 2.6; }

  /** are you closing on e in its lane (from behind, or head-on in the lane)? { ttc, urgent } or null */
  threat(e, dir, car, hornT) {
    const lat = Math.min(Math.abs(car.d - e.d), Math.abs((car.targetD ?? car.d) - e.d));
    const need = (e.W + 2 * this.PLAYER.halfW) / 2 + 0.55;
    if (lat > need) return null;
    const ds = dir * (e.s - car.s) - (e.L / 2 + this.PLAYER.halfL);      // clear distance between us along e's travel
    const closing = dir * (car.v) - e.sp * 1;                             // you toward it: positive closing
    const closeRate = dir > 0 ? car.v - e.sp : car.v + e.sp * 1;          // (head-on: both speeds add)
    if (dir > 0) {
      if (ds < -2) return null;                                          // you're past it
      const horn = hornT > 0 && ds < 90;
      const c = closeRate;
      if (c > 1.2 && (ds / c < 7 || ds < 14)) return { ttc: Math.max(0.5, ds / c), urgent: ds / c < 3.5 };
      if (horn && c > -3) return { ttc: Math.max(1, ds / Math.max(c, 3)), urgent: true };
      return null;
    }
    // oncoming car e, you in its lane ahead of it (you're at lower s)
    if (car.s > e.s + 3) return null;
    const gap = e.s - e.L / 2 - (car.s + this.PLAYER.halfL), c = car.v + e.sp;
    if (gap < -1) return null;
    if (c > 1 && (gap / c < 6.5 || gap < 18)) return { ttc: Math.max(0.5, gap / c), urgent: gap / c < 3.2 };
    if (hornT > 0 && gap < 80) return { ttc: Math.max(1, gap / Math.max(c, 4)), urgent: true };
    return null;
  }

  // ------------------------------------------------------------------ the flow
  /** cars join the street from behind the player's back and from the far end, only where nobody is looking */
  feed(dt, car, runner) {
    const W = this.world, r = W.route;
    this.feedT = (this.feedT ?? 1) - dt;
    if (this.feedT > 0) return;
    this.feedT = rnd(1.2, 2.6);
    // same direction: join near the start of the mapped street while the player is well past it; later behind the player
    const base = runner ? runner.s : car.s;
    const at = clamp(base - 110, 6, r.length - 40);
    if (at > 130 && r.oneway(at) !== undefined) {
      const near = W.ents.some((o) => o.alive && !o.scenery && o.dir === 1 && !o.curb && Math.abs(o.s - at) < 55 && o.d < 0.5 + r.lane(o.s, 1));
      if (!near && !W.visible(...this.pt(at, r.lane(at, 0)), 5)) {
        const d = r.lane(at, 0);
        W.add(W.carType(), { s: at, d, v: LIMIT * rnd(0.9, 1.1), color: W.paint(), dir: 1, flow: true });
      }
    }
  }
  pt(s, d) { const p = this.world.route.at(s, d); return [p.x, p.y, p.z + 0.8]; }

  /** a parked car with a driver in it pulls out when the street is clear enough that it never cuts anyone off */
  maybePullOut(o, car, runner) {
    const r = this.world.route, S = o.s;
    if (this.clock < (o.pullAfter ?? 0)) return;
    const who = runner ? runner.s : car.s;
    // when the player is on the way (a pull-out you can watch from a distance)
    if (S - who > 140 || S - who < -25) return;
    o.pullAfter = this.clock + 0.6;
    if (Math.random() > 0.25) return;
    const dir = 1, c = r.lane(S, 0), L = o.L || 4.5;
    // in front: the space to drive off into, and a car-length of room to swing out
    if (!this.stripFree(o, o.d - 1.0, o.d + 1.0, S + L / 2 + 0.2, S + L / 2 + 9, 0.1)) return;
    // the lane: free for the whole manoeuvre, and nobody (you!) close behind in it. Behind it: far enough that nobody brakes
    if (!this.stripFree(o, c - 1.05, c + 1.05, S - 10, S + 30, 1.2)) return;
    const bh = this.behind({ s: S, L, W: o.W || 1.8, e: o }, dir, c - 1.2, c + 1.2, 140);
    if (bh) { const closing = Math.max(0, bh.vlu - 1); if (bh.gap < 40 + closing * 6) return; }
    if (car.s < S && car.s > S - 100 && Math.abs(car.d - c) < 3 && car.v > 1) return;
    this.unpark(o, 'l0');
  }
  unpark(o, ref) {
    Object.assign(o, { parked: false, curb: false, dir: 1, drv: newDriver(o.type), occupied: false, lane: 0, sp: 0, v: 0, aF: 0, stillT: 0, pers: rnd(-0.15, 0.15), off: 0, dd: 0, prof: null, ref: 'pR', lcT: -9 });
    o.cruise = o.drv.v0;
    const T = 2.4; o.ref = 'pR';
    // the offset from the parking-lane line eases into the lane
    o.ref = ref; const c = this.refD(ref, o.s); o.prof = { t: 0, T, x0: o.d - c - o.pers, v0: 0 }; o.refT = this.clock; this.stats.pulledOut++;
  }
}
