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

/** the driver of the BUSTED backup cruiser: brisk, brakes late and firmly, keeps a short gap */
const BACKUP = { a: 3, b: 4.5, T: 0.5, s0: 2, bmax: 9 };
/** a work zone's flagger: a direction keeps the one lane for at most TURN_MAX s when the other is waiting (TURN_SOFT s when nobody of its own is
 *  about to arrive), so nobody waits much more than that and the time it takes the section to clear */
const TURN_MAX = 10, TURN_SOFT = 4;
/** the watchdog: a car that has not moved for STUCK_T s (and is not waiting for a red light or a person) gets helped, one step at a time */
const STUCK_T = 8;

export class Traffic {
  constructor(world, { PLAYER, CARS, ON_FOOT }) {
    Object.assign(this, { world, PLAYER, CARS, ON_FOOT, clock: 0, honkT: 0, curv: null });
    this.stats = { evacuated: 0, evacFailed: 0, pulledOut: 0, passes: 0, unstuck: 0, honks: 0, runnerBrakes: 0, runnerHits: 0, lanechanges: 0, standoffs: 0, asides: 0, slowPasses: 0, forced: 0, helped: 0, reversed: 0, ghosted: 0 };
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
    e.ref = ref; e.prof = { t: 0, T, x0: e.d - c - e.pers - (e.room || 0), v0: e.dd };   // (e.d already includes the lean away from people (room): left in, the car jumped sideways by it the moment it changed lane)
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
      obs.push({ o, s: o.s, d: o.d, L: o.L || 4.5, W: o.W || 1.8, vs: o.parked ? 0 : o.v || 0, vd: o.dd || 0, ped, veh: !ped && o.solid >= 0.7 && !!this.CARS.has(o.type),
        tg: o.prof && o.ref ? this.refD(o.ref, o.s) + (o.pers || 0) + (o.room || 0) : undefined });   // (tg: where a car that is changing lane is heading: two cars must not both decide to move into the same lane)
    }
    // cross-street traffic that is on (or about to be on) our road is an obstacle too
    for (const a of W.ambient) {
      if (a.deck || a.x === undefined || a.dead) continue;
      if (r.distTo(a.x, a.y) > 16) continue;
      const pr = r.project(a.x, a.y);
      if (Math.abs(pr.d) > r.hw(pr.s) + 5) continue;
      const sp = a.vs || 0, A = r.A[Math.round(clamp(pr.s, 0, r.n - 1))], c = Math.cos(a.h), sn = Math.sin(a.h);
      // its footprint along and across OUR street: a vehicle crossing at an angle lies across the street (a bus going straight
      // across takes 2.55 m of the street's length and 12 m of its width), so its own length and width are turned by the
      // angle between its heading and the route's
      const bus = a.type === 'bus', L0 = bus ? 12 : 4.6, W0 = bus ? 2.55 : 1.9, ct = Math.abs(Math.cos(a.h - A)), st = Math.abs(Math.sin(a.h - A));
      obs.push({ o: a, s: pr.s, d: pr.d, L: L0 * ct + W0 * st, W: L0 * st + W0 * ct, vs: sp * (c * Math.cos(A) + sn * Math.sin(A)), vd: sp * (-c * Math.sin(A) + sn * Math.cos(A)), ped: false, veh: true, cross: true });
    }
    obs.push({ o: car, s: car.s, d: car.d, L: 2 * this.PLAYER.halfL, W: 2 * this.PLAYER.halfW, vs: car.v, vd: car.dv || 0, ped: false, veh: true, player: true, tgt: car.targetD });
    for (const q of W.others || []) if (q.o?.visible) obs.push(   // (the bully: a person in the street while he can be seen, whether or not you are on foot yourself: he runs on behind you for a bit after you get in)
      { o: q, s: q.s, d: q.d, L: 0.9, W: 0.9, vs: q.v || 0, vd: q.dv || 0, ped: true, other: true });
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
      if (e.ghostUntil > this.clock && o.o === e.ghostOf) continue;     // a standoff with this one car that was given up on, out of sight (see standoff)
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
  behind(e, dir, lo, hi, look = 70, ignoreParked = false) {
    const ob = this.obs, S = e.s; let best = null;
    const i0 = this.lowerBound(dir > 0 ? S - look - 15 : S - 4), i1 = this.lowerBound(dir > 0 ? S + 4 : S + look + 15);
    for (let i = i0; i < Math.min(i1 + 1, ob.length); i++) {
      const o = ob[i]; if (o.o === e || !o.veh || o.ped || (ignoreParked && o.o.parked)) continue;
      const ds = dir * (S - o.s); if (ds <= -0.5) continue;
      const vlu = dir * o.vs; if (vlu < -2) continue;                      // going the other way
      const half = o.W / 2 + 0.1 + (o.player ? 0.45 : 0), tg = o.player ? o.tgt : o.tg;
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
    // (only what can be in [s0, s1] at some point in T: the longest thing here (the streetcar) reaches 13 m either side of its
    // centre, and nothing travels faster than about 30 m/s)
    const ob = this.obs, pad = 14 + 30 * T, i1 = this.lowerBound(s1 + pad);
    for (let i = this.lowerBound(s0 - pad); i < i1; i++) {
      const o = ob[i];
      if (o.o === e) continue;
      const a = o.s - o.L / 2 + Math.min(0, o.vs * T), b = o.s + o.L / 2 + Math.max(0, o.vs * T);
      if (b < s0 || a > s1) continue;
      const dl = Math.min(o.d, o.tg ?? o.d), dh = Math.max(o.d, o.tg ?? o.d);   // (a car on its way into this strip counts as being in it)
      if (dh + o.W / 2 + 0.2 > lo && dl - o.W / 2 - 0.2 < hi) return false;
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
    const zones = (W.workZones || []).map(([a, b], i) => { const z = ((this.zst ||= [])[i] ||= { turn: 1, t: 0, t2: 0, was: 1 }); z.a = a; z.b = b; z.c0 = a + 32; z.c1 = b - 2; return z; });
    this.zoneTurns(zones, drivers, car, dt);
    this.zones = zones;
    for (const e of drivers) this.plan(e, dt, car, hornT, runner, zones, sig, out);
    for (const e of drivers) this.move(e, dt);
    this.unstick(drivers, zones, car, runner, dt);
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
      // (the streetcar runs in the left lane too, towards us: for the flagger it is oncoming traffic, and it holds short of the section like the cars do: see tram.js)
      const trams = this.world.ents.filter((t) => t.alive && t.type === 'tram' && t.s - (t.L || 24.8) / 2 < z.c1 + 90 && t.s + (t.L || 24.8) / 2 > z.c0 - 4);
      const inOnc = drivers.some((e) => e.dir === -1 && e.s - e.L / 2 < z.c1 + 1 && e.s + e.L / 2 > z.c0 - 4) || trams.some((t) => t.s - (t.L || 24.8) / 2 < z.c1 + 1);
      // (you are one of the cars of ours: waiting at the cones in the right lane, or coming up to them)
      const youNear = car.s > z.a - 80 && car.s < z.c1 && car.d < -0.5, youWait = youNear && car.v < 5, youComing = youNear && car.s > z.a - 45 && car.v >= 5;
      const waitFwd = youWait || drivers.some((e) => e.dir === 1 && e.ref !== 'l1' && e.s > z.a - 80 && e.s < z.c1 && e.sp < 5);
      const waitOnc = drivers.some((e) => e.dir === -1 && e.s - e.L / 2 >= z.c1 + 1 && e.s < z.c1 + 90 && e.sp < 5) || trams.some((t) => t.s - (t.L || 24.8) / 2 >= z.c1 + 1 && Math.abs(t.v) < 3);
      // a platoon on its way keeps the turn a little longer, but never past TURN_MAX
      const comingFwd = youComing || drivers.some((e) => e.dir === 1 && e.ref !== 'l1' && e.s > z.a - 45 && e.s <= z.c0 && e.sp > 3);
      const comingOnc = drivers.some((e) => e.dir === -1 && e.s > z.c1 && e.s < z.c1 + 60 && e.sp > 3);
      const playerIn = car.s > z.a - 30 && car.s < z.c1 + 5 && car.d > -0.5;
      z.inFwd = inFwd; z.inOnc = inOnc;
      if (z.turn === 1) {
        if (inOnc && !inFwd) { z.turn = -1; z.t = 0; }                        // they are already in there: let them through
        else if (!playerIn && waitOnc && (z.t > TURN_MAX || (z.t > TURN_SOFT && !comingFwd) || !waitFwd && !comingFwd)) z.turn = -2;
      } else if (z.turn === -2) { if (!inFwd) { z.turn = -1; z.t = 0; } }                      // (cars that cannot get out of the section are the watchdog's: see unstick; letting the other direction in over them would be a head-on in one lane)
      else if (z.turn === -1) {
        if (inFwd && !inOnc) { z.turn = 1; z.t = 0; }
        else if (playerIn || (waitFwd && (z.t > TURN_MAX || (z.t > TURN_SOFT && !comingOnc) || !waitOnc && !comingOnc))) z.turn = 2;
      } else if (z.turn === 2) { if (!inOnc) { z.turn = 1; z.t = 0; } }
      if (z.turn !== z.was) { z.was = z.turn; z.t2 = 0; } else z.t2 += dt;      // (how long it has been in this state: a state that is stuck is the watchdog's business, see unstick)
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
    // backing out of a head-on that nobody else can solve (see unstick): a few metres straight back at walking pace, only while it is clear behind
    if (e.revT > 0) {
      e.revT -= dt;
      const tg0 = this.refD(e.ref, e.s) + e.pers, rb = this.ahead(e, -dir, 0, 3, Math.min(e.d, tg0), Math.max(e.d, tg0), 12);
      if (!rb || rb.gap > 1.5) { e.aF = 0; e.sp = 0; e.v = -dir * 2.2; e.stopT = 0; e.stillT = 0; e.faceT = 0; return; }
      e.revT = 0;
    }
    let sp = dir === -1 ? -e.v : e.v; if (sp < 0) sp = 0;
    e.sp = sp;
    const two = !r.oneway(e.s);
    // a standoff given up on (see standoff) ends the moment either car could be seen
    if (e.ghostUntil > this.clock && (this.onScreen(e) || !e.ghostOf?.alive || this.onScreen(e.ghostOf))) e.ghostUntil = 0;
    // desired speed: the driver's, less for a bend and when the street is full of people
    let v0 = Math.min(D.v0, this.curveV(e.s + (dir > 0 ? 8 : -8)));
    if ((W.workZones || []).some(([a, b]) => e.s > a - 8 && e.s < b + 8)) v0 = Math.min(v0, 8);
    else if (e.flee > this.clock) v0 = Math.max(v0, Math.min(sp + 4, D.v0 * 1.3, this.curveV(e.s + (dir > 0 ? 8 : -8))));
    if (e.backup) v0 = 20;
    e.v0now = v0;
    // the strip we occupy: from where we are to where we are heading (our lane's line plus our own habit of riding a little to one
    // side: e.d already includes that habit, so it is added once, to the line only)
    const tg0 = this.refD(e.ref, e.s) + e.pers + (e.room || 0);
    let lead = this.ahead(e, dir, sp, v0, Math.min(e.d, tg0), Math.max(e.d, tg0));
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
    // the parking lane we have pulled into ends somewhere: the line it is drawn along does not (it would jump two metres sideways, into
    // whatever is beside us), so we stop short of its end unless we are on our way back to the travel lane by then
    if (e.ref === 'pR' || e.ref === 'pL') {
      const side = e.ref === 'pR' ? -1 : 1;
      for (let k = 0; k <= 60; k += 2) {
        if (r.parkD(front + dir * k, side) !== null) continue;
        const as = idmAccel(sp, v0, Math.max(k - 1.5, 0.05), 0, D);
        if (as < a) { a = as; why = 'parkend'; }
        break;
      }
    }
    e.whyK = a > idmAccel(sp, v0, Infinity, 0, D) - 0.15 ? null : typeof why === 'string' ? why : why ? (why.o.parked ? 'parked' : why.o.type) + (why.player ? '(player)' : '') : 'free';
    e.whyO = e.whyK && typeof why === 'object' && why ? why.o : null;
    if (e.backup) {   // BUSTED: the backup cruiser pulls up behind you
      const gap = car.s - 6.5 - e.s; e.ref = 'l0';
      a = gap < 0.3 ? -D.bmax : clamp((Math.min(18, Math.sqrt(2 * 5 * gap)) - sp) * 1.5, -8, 3);
      if (lead && !lead.ob.player) {   // traffic queued up behind you is not driven through: it closes up on the back of the queue and stops behind it
        // (the following model with a hurried driver's numbers: later, firmer braking than the street's cars, a smaller gap)
        a = Math.min(a, idmAccel(sp, 20, Math.max(lead.gap, 0.05), lead.vlu, BACKUP));
      }
      this.finish(e, dt, a, sp);
      return;
    }

    // --- a pass that met the other direction head on: the car in the wrong lane backs out of it, else both drive through
    if (sp < 0.3 && lead && lead.ob.veh && !lead.ob.cross && (lead.ob.player ? (e.ref === 'l1' ? 1 : 0) !== (dir === -1 ? 1 : 0) : lead.ob.o.dir === -dir) && lead.gap < 9) e.faceT = (e.faceT || 0) + dt; else e.faceT = 0;
    if (e.faceT > 3) {
      const home = dir === -1 ? 1 : 0, c0 = this.refD(home ? 'l1' : 'l0', e.s);
      if ((e.ref === 'l1' ? 1 : 0) !== home && !e.prof && this.stripFree(e, c0 - e.W / 2, c0 + e.W / 2, e.s - e.L / 2 - 1, e.s + e.L / 2 + 4, 0.5)) { this.changeRef(e, home ? 'l1' : 'l0', 1.8); e.lane = home; e.passEnd = undefined; e.faceT = 0; }
      else if (e.faceT > 7 && !lead.ob.player) this.standoff(e, dir, lead.ob.o, car);
    }
    // --- give people and slow things room: shift to the far side of our lane when one is close to our side of it
    this.room(e, dir, sp, dt);
    // --- giving way to you
    this.giveWay(e, dir, sp, v0, car, hornT, two, zones);
    // --- passing / lane choice
    if (two ? dir === 1 : true) this.lanes(e, dir, sp, v0, lead, car, two, zones);

    // --- people in the street: hard braking gets a horn and a skid
    if (lead && lead.ob.ped && a < -4 && sp > 3 && this.honkT <= 0 && !e.honked) {
      e.honked = 1.6; this.honkT = 0.35; this.stats.honks++; (out.honks ||= []).push({ e, d: Math.abs(e.s - (runner ? runner.s : car.s)), skid: a < -6 });   // (heard from where you are: the runner on foot, else the car)
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

  /** The guarantee behind all of the above: no car stays stopped for ever. A car that has not moved for STUCK_T s (not for a red light, a tram
   *  at its platform, or a person in the road, which end by themselves) is followed to the head of its queue, and the head is helped in
   *  the mildest way that works: the flagger gives its direction the section, then it swings into the free parking lane, then (head on
   *  with something) whichever of the two has room behind backs out, and only out of sight does it drive through what is in its way
   *  (the same few seconds of ghosting as a standoff, and cancelled the moment anyone could see it). The same goes for a work zone
   *  stuck in the state where one direction is clearing the section and a car in it cannot get out. */
  unstick(drivers, zones, car, runner, dt) {
    this.unstickT = (this.unstickT || 0) + dt; if (this.unstickT < 0.5) return; this.unstickT = 0;
    for (const z of zones) {
      if ((z.turn !== -2 && z.turn !== 2) || z.t2 < STUCK_T) continue;
      // the section is being cleared for the other direction and has not cleared: the slowest car still in it is the one that is stuck
      const dir = z.turn === -2 ? 1 : -1;
      let w = null;
      for (const e of drivers) if (e.dir === dir && e.sp < 2 && (dir === 1 ? e.ref === 'l1' && e.s > z.a - 90 && e.s - e.L / 2 < z.c1 + 4 : e.s - e.L / 2 < z.c1 + 1 && e.s + e.L / 2 > z.c0 - 4) && (!w || e.sp < w.sp)) w = e;
      if (w && (w.stopT || 0) >= 4) this.help(w, Math.max(w.stopT || 0, z.t2), zones, car);
    }
    for (const e of drivers) {
      if ((e.stopT || 0) < STUCK_T || e.backup || e.revT > 0) continue;
      let h = e;
      for (let n = 0; n < 14 && h.whyK && h.whyO && h.whyO.drv && h.whyO !== h && h.whyO.alive; n++) h = h.whyO;
      const z = zones.find((q) => h.s > q.a - 100 && h.s < q.c1 + 100);
      // (waits that end by themselves: a red light, a tram at its platform or on the move, people in the road, you waiting. The one exception: in a work zone an
      // oncoming car held up by you standing still in the one lane has to give way, you cannot be made to)
      if (h.whyK === 'light' || (h.whyO && (h.whyO.worker || (h.whyO.type === 'tram' && (h.whyO.tram?.dwell > 0 || Math.abs(h.whyO.v || 0) > 0.5)) || this.ON_FOOT.has(h.whyO.type) || h.whyO === runner || (h.whyO === car && !(z && h.dir === -1 && Math.abs(car.v) < 0.5))))) continue;
      if ((h.stopT || 0) < STUCK_T) continue;
      // the flagger: the direction that has been held longest is given the section
      if (z && h.whyK === 'zone') {
        if (h.dir === 1 && (z.turn === -1 || z.turn === -2)) { z.turn = 2; z.t = 0; this.stats.forced++; continue; }
        if (h.dir === -1 && (z.turn === 1 || z.turn === 2)) { z.turn = -2; z.t = 0; this.stats.forced++; continue; }
      }
      this.help(h, h.stopT, zones, car);
    }
  }
  /** one step up the ladder for a car that has been stuck for t seconds, no more than one step every few seconds */
  help(h, t, zones, car) {
    if (this.clock < (h.helpAfter ?? 0)) return;
    const dir = h.dir, blocker = h.whyO && h.whyO.alive !== false ? h.whyO : null;
    h.helpAfter = this.clock + 3;
    // 1. into the parking lane, out of the way
    if (!h.prof && (h.ref === 'l0' || h.ref === 'l1') && this.pullAside(h, dir, 0, 1.9)) { h.evac = true; h.stopT = 0; this.stats.asides++; this.stats.helped++; return; }
    // 2. head on: back out, the one that has room behind it
    const clearBehind = (q) => { const tg = this.refD(q.ref, q.s) + q.pers; const rb = this.ahead(q, -q.dir, 0, 3, Math.min(q.d, tg), Math.max(q.d, tg), 12); return !rb || rb.gap > 6; };
    if (t > STUCK_T + 3) {
      const other = blocker && blocker.drv && blocker.dir === -dir ? blocker : null;
      // (a few metres, and not again for a while: backing out is to let something by, not to leave)
      if (this.clock > (h.revAfter ?? 0) && clearBehind(h)) { h.revT = 2.5; h.revAfter = this.clock + 25; this.stats.helped++; this.stats.reversed++; return; }
      if (other && this.clock > (other.revAfter ?? 0) && clearBehind(other)) { other.revT = 2.5; other.revAfter = this.clock + 25; this.stats.helped++; this.stats.reversed++; return; }
    }
    // 3. out of sight, and only then, through it
    if (t > STUCK_T + 6 && !this.onScreen(h) && !(blocker && blocker.s !== undefined && this.onScreen(blocker))) {
      h.ghostOf = blocker; h.ghostUntil = this.clock + 6; h.stopT = 0; this.stats.helped++; this.stats.ghosted++;
    }
  }

  /** two cars nose to nose that neither can get out of by going home. Nobody is ever seen driving through anybody: with a free
   *  parking lane the one in its own lane pulls into it and lets the other by (the other is the one that came round a queue, and
   *  goes home once it is past); with none, they wait. Only when neither can be seen, and neither is near you, do they
   *  drive through each other for a few seconds (the old way out of a street too narrow for them, now out of sight). */
  standoff(e, dir, other, car) {
    const home = dir === -1 ? 1 : 0;
    if ((e.ref === 'l1' ? 1 : 0) === home && !e.prof && this.pullAside(e, dir, 0, 1.9)) { e.evac = true; e.faceT = 0; this.stats.asides++; return; }
    if (this.onScreen(e) || this.onScreen(other) || (e.s > car.s - 15 && e.s < car.s + 140) || (other.s > car.s - 15 && other.s < car.s + 140)) return;
    e.ghostOf = other; e.ghostUntil = this.clock + 4; e.faceT = 0; this.stats.standoffs++;
  }
  /** could e be seen right now? (inside the camera's view, with a margin for its length) */
  onScreen(e) {
    const W = this.world, p = W.route.at(e.s, e.d);
    return !!W.visible(p.x, p.y, p.z + 0.8, Math.max(6, (e.L || 4.5) / 2 + 2));
  }

  /** a person (or a bike) close beside our line: lean away inside our lane, easing, before we get there */
  room(e, dir, sp, dt) {
    const r = this.world.route, tgtD = this.refD(e.ref, e.s) + e.pers;
    let want = 0;
    if (sp > 1.5 && !e.prof) {
      const lane = r.travel(e.s), slack = Math.max(0, lane / 2 - e.W / 2 - 0.25);
      const reach = 8 + sp * 2, ob = this.obs;
      const i0 = this.lowerBound(dir > 0 ? e.s + 1 : e.s - reach), i1 = Math.min(ob.length - 1, this.lowerBound(dir > 0 ? e.s + reach : e.s - 1));
      for (let i = i0; i <= i1; i++) {
        const o = ob[i];
        if (!o.ped || o.o === e) continue;
        const ds = dir * (o.s - e.s); if (ds < 1 || ds > reach) continue;
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
    if (e.stillT > 5) { e.sp = 1.2; e.v = e.dir * 1.2; e.stillT = 0; this.stats.unstuck++; }   // (sp is the speed along its own direction, v the signed one)
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
      const tg0 = this.refD(e.ref, S) + e.pers, lo = Math.min(e.d, tg0), hi = Math.max(e.d, tg0);
      if (dir === 1 && (this.zones || []).some((z) => z.turn !== 1 && S > z.a - 90 && S < z.c1)) return;   // waiting for the flagger: in line like everyone else
      const bl = this.blocker(e, dir, sp, v0, lo, hi);
      if (!bl) return;
      if (bl.kind === 'slow' && (two ? dir !== 1 : false)) return;
      const o = bl.ob;
      const lane2 = 1 - myLane, c2 = this.refD(lane2 ? 'l1' : 'l0', S);
      const endS = this.blockEnd(e, o, dir);
      const T = (dir * (endS - S) + e.L + 6) / Math.max(6, sp) + 2.4, zn = (this.zones || []).find((z) => z.turn === 1 && S > z.a - 60 && S < z.b + 12);
      if (!this.laneClear(e, c2, S - 8, endS + 12 + e.L, T, two, dir, car, sp, zn)) return;
      this.changeRef(e, lane2 ? 'l1' : 'l0', 2.2); e.lane = lane2; e.passEnd = endS; this.stats.passes++; if (bl.kind === 'slow') this.stats.slowPasses++;
    } else {
      // back into our own lane once we're clear of what we passed, and it is safe
      if (e.passEnd !== undefined && dir * (S - e.passEnd) < e.L / 2 + 1.2) return;
      const c0 = this.refD(home ? 'l1' : 'l0', S);
      // (the room it needs in front of its nose grows with its speed: a car creeping in a queue can slot in behind a stopped one)
      if (!this.stripFree(e, c0 - e.W / 2, c0 + e.W / 2, S - e.L / 2 - 4, S + e.L / 2 + Math.min(9, 3 + Math.max(0, sp) * 0.8), 1.2)) return;
      const bh = this.behind(e, dir, c0 - 1, c0 + 1);
      if (bh && bh.gap < Math.max(10, bh.ob.vs > sp ? (dir * bh.ob.vs - sp) * 3.5 + 10 : 8)) return;
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
    // walk the sorted obstacles from o in the direction of travel until the next one is 32 m past the end of the stretch
    // (it was a filter and a sort of the whole list)
    const ob = this.obs;
    for (let i = dir > 0 ? this.lowerBound(o.s) : this.lowerBound(o.s + 1e-6) - 1; i >= 0 && i < ob.length; i += dir) {
      const q = ob[i];
      if (dir * (q.s - end) >= 32) break;
      if (q === o || q.player || (q.ped && !q.o.worker) || q.cross) continue;
      if (dir * (q.s - o.s) < 0) continue;
      if (Math.abs(q.d - ld) > 2.2 || Math.abs(dir * q.vs) > 1.2) continue;
      if (dir * (q.s - end) > -q.L) { end = dir * Math.max(dir * end, dir * (q.s + dir * q.L / 2)); ld = q.d; }
    }
    return end;
  }
  /** is the strip at d = c clear from s0 to s1 for T seconds, including cars coming the other way and cars (and you)
   *  that would end up right behind us? */
  laneClear(e, c, s0, s1, T, two, dir, car, sp, zn) {
    const half = e.W / 2 + 0.2;
    // (what can matter: anything that is in, or can get into, the strip or up to our back bumper within T seconds)
    const ob = this.obs, pad = 20 + 30 * (T + 1), lo = Math.min(s0, s1, e.s) - pad, hi = Math.max(s0, s1, e.s) + pad, i1 = this.lowerBound(hi);
    for (let i = this.lowerBound(lo); i < i1; i++) {
      const o = ob[i];
      if (o.o === e) continue;
      if (zn && o.veh && o.o.dir === -dir && o.s > zn.c1 + 2) continue;      // (waiting at the flagger's line for us to get through)
      const dl = Math.min(o.d, o.tg ?? o.d), dh = Math.max(o.d, o.tg ?? o.d), dist = c < dl ? dl - c : c > dh ? c - dh : 0;
      if (dist > o.W / 2 + half + 0.35 && !(o.player && Math.abs(o.tgt - c) < o.W / 2 + half)) continue;
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
        const homeLane = dir === -1 ? 1 : 0, ref = homeLane ? 'l1' : 'l0', c = this.refD(ref, S);   // (home is the lane of our direction, whichever lane we swapped into)
        if (this.stripFree(e, c - e.W / 2, c + e.W / 2, S - e.L / 2 - 5, S + e.L / 2 + 8, 1.0)) {
          const bh = this.behind(e, dir, c - 1, c + 1);
          if (!bh || bh.gap > 10 + Math.max(0, dir * bh.ob.vs - sp) * 4) { this.changeRef(e, ref, 1.9); e.evac = false; e.lane = homeLane; }
        }
      }
      return;
    }
    if (e.prof && e.prof.t < 0.6 * e.prof.T) return;
    const th = this.threat(e, dir, car, hornT);
    if (!th) return;
    // somewhere to go: the free parking lane on our side, else the other travel lane when it's clear for the whole time
    const T = th.urgent ? 1.2 : 1.9, hold = th.ttc + 3.5;
    if (this.pullAside(e, dir, sp, T)) { e.evac = true; this.stats.evacuated++; return; }
    const lane2 = e.lane ? 0 : 1, c2 = this.refD(lane2 ? 'l1' : 'l0', S);
    if (!two && this.laneClear(e, c2, S - 8, S + 12 + sp * 3, hold, two, dir, car, sp) || (two && dir === 1 && this.canSwap(e, dir, c2, hold, car, sp))) {   // (oncoming cars never swap into your lane: that is where you will be)
      this.changeRef(e, lane2 ? 'l1' : 'l0', T); e.lane = lane2; e.evac = true; e.refT = this.clock; this.stats.evacuated++; return;
    }
    this.stats.evacFailed++;
    e.flee = this.clock + 1.2;       // nowhere to go: pick up the pace instead, and let it close slowly
  }
  /** swing into the free parking lane on e's own side, if there is one that keeps going for as far as e will run and nothing is in it:
   *  true if it did. (The parking lane next to our own lane, never across another lane.) */
  pullAside(e, dir, sp, T) {
    const r = this.world.route, S = e.s, pref = dir === -1 ? 'pL' : 'pR', pc = this.refD(pref, S);
    const side = dir === -1 ? 1 : -1, runTo = 14 + sp * T + sp * sp / 8;
    let hasPark = e.ref === (dir === -1 ? 'l1' : 'l0');
    for (let k = 0; hasPark && k <= runTo; k += 4) if (r.parkD(S + dir * k, side) === null) hasPark = false;
    if (!hasPark || !this.stripFree(e, pc - 1.0, pc + 1.0, S - 7, S + 9 + sp * T * 0.5 + sp * sp / 8, T)) return false;
    this.changeRef(e, pref, T);
    return true;
  }
  /** swap into the opposite lane of a two-way street to get out of your way: only if nothing is coming and you aren't there */
  canSwap(e, dir, c2, hold, car, sp) { return this.laneClear(e, c2, e.s - 10, e.s + 14 + sp * 2.5, hold, true, dir, car, sp) && Math.abs(car.d - c2) > 2.6 && Math.abs((car.targetD ?? car.d) - c2) > 2.6; }

  /** are you closing on e in its lane (from behind, or head-on in the lane)? { ttc, urgent } or null */
  threat(e, dir, car, hornT) {
    const lat = Math.min(Math.abs(car.d - e.d), Math.abs((car.targetD ?? car.d) - e.d));
    const need = (e.W + 2 * this.PLAYER.halfW) / 2 + 0.55;
    if (lat > need) return null;
    const ds = dir * (e.s - car.s) - (e.L / 2 + this.PLAYER.halfL);      // clear distance between us along e's travel
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
    // a car that is touching another one, even a parked one, stays where it is: a space it cannot clear is not a space it pulls out of
    if (this.touching(o)) return;
    // in front: the space to drive off into, and a car-length of room to swing out
    if (!this.stripFree(o, o.d - 1.0, o.d + 1.0, S + L / 2 + 0.2, S + L / 2 + 9, 0.1)) return;
    // the lane: free for the whole manoeuvre, and nobody (you!) close behind in it. Behind it: far enough that nobody brakes
    if (!this.stripFree(o, c - 1.05, c + 1.05, S - 10, S + 30, 1.2)) return;
    const bh = this.behind(o, dir, c - 1.2, c + 1.2, 140, true);   // (o itself, and not the other parked cars: on a narrow street they reach into the lane's strip, and they are not going to run up behind it)
    if (bh) { const closing = Math.max(0, bh.vlu - 1); if (bh.gap < 40 + closing * 6) return; }
    if (car.s < S && car.s > S - 100 && Math.abs(car.d - c) < 3 && car.v > 1) return;
    this.unpark(o, 'l0');
  }
  /** is any other solid vehicle's box overlapping o's (or within a hand's width of it)? */
  touching(o) {
    const ob = this.obs, L = o.L || 4.5, W = o.W || 1.8;
    for (let i = this.lowerBound(o.s - L - 8); i < ob.length && ob[i].s < o.s + L + 8; i++) {
      const q = ob[i]; if (q.o === o || q.ped || !q.veh) continue;
      if (Math.abs(q.s - o.s) < (q.L + L) / 2 + 0.15 && Math.abs(q.d - o.d) < (q.W + W) / 2 + 0.1) return true;
    }
    return false;
  }
  unpark(o, ref) {
    Object.assign(o, { parked: false, curb: false, dir: 1, drv: newDriver(o.type), occupied: false, lane: 0, sp: 0, v: 0, aF: 0, stillT: 0, pers: rnd(-0.15, 0.15), off: 0, dd: 0, prof: null, lcT: -9 });
    o.cruise = o.drv.v0;
    const T = 2.4;
    // the offset from the parking-lane line eases into the lane
    o.ref = ref; const c = this.refD(ref, o.s); o.prof = { t: 0, T, x0: o.d - c - o.pers, v0: 0 }; o.refT = this.clock; this.stats.pulledOut++;
  }
}
