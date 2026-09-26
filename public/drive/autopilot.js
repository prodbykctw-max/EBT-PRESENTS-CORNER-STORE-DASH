// QA autopilot (test harness only: index.html?qa&bot; the game never loads this). Drives the run the way a player
// would, with the same inputs a player has: drags into the clearest gap (what a touch drag does to targetD), brakes
// (↓) when every gap is closing, honks (H) at panhandlers. Anything that goes wrong is logged: every hit with what
// was hit and where, script errors, the car stalling, the car leaving the road, a non-finite pose.
import { PLAYER } from './runner.js';

const LOOK_T = 3.0;      // seconds of road read ahead
const MARGIN = 0.35;     // lateral clearance the bot insists on (metres, each side)

export function autopilot(d, { log = console.log } = {}) {
  const { car, world, route } = d;
  const report = { hits: [], errors: [], popIn: [], popOut: [], teleports: [], stalls: 0, offroad: 0, brakes: 0, honks: 0, ticks: 0 };
  window.__botReport = report;

  // see hits exactly as the game scores them
  const update = world.update.bind(world);
  // pop-in audit: nothing may appear, vanish or jump while it's on screen
  let lastAll = new Set(), lastVis = new Map();
  const where = (o) => (o.g ? { x: o.x, y: o.y, z: o.z } : o.x !== undefined && o.pts ? { x: o.x, y: o.y, z: o.zAbs } : route.at(o.s, o.d));
  const note = (list, o, p, what) => { if (list.length < 40) { const rec = { t: +d.time.toFixed(1), what, type: o.type || (o.g ? 'person/' + o.g.kind : '?'), at: [Math.round(p.x), Math.round(p.y)], carS: Math.round(car.s) }; list.push(rec); log('BOT', what, JSON.stringify(rec)); } };
  world.update = (...a) => {
    const out = update(...a);
    const all = new Set(), vis = new Map();
    for (const o of [...world.ents, ...world.ambient, ...(world.crowd?.people || [])]) {
      if (o.alive === false || o.dead || o.flying || (o.pts && o.x === undefined) || (o.g && !o.on)) continue;
      all.add(o); const p = where(o);
      if (world.visible(p.x, p.y, p.z, 0.3)) vis.set(o, p);
    }
    if (report.ticks > 0) {
      for (const [o, p] of vis) {
        if (!lastAll.has(o)) note(report.popIn, o, p, 'POP-IN');
        else if (lastVis.has(o)) { const q = lastVis.get(o); if (Math.hypot(p.x - q.x, p.y - q.y) > 6) note(report.teleports, o, p, 'TELEPORT'); }
      }
      for (const [o, p] of lastVis) if (!all.has(o) && !(o.alive === false && o.hitDone)) note(report.popOut, o, p, 'POP-OUT');
    }
    lastAll = all; lastVis = vis;
    for (const h of out.hits) {
      const rec = { t: +d.time.toFixed(1), hit: h.e.type, s: Math.round(car.s), carD: +car.d.toFixed(2), objD: +h.e.d.toFixed(2), v: +car.v.toFixed(1) };
      report.hits.push(rec); log('BOT HIT', JSON.stringify(rec));
    }
    return out;
  };
  addEventListener('error', (e) => report.errors.push(String(e.message)));
  const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));

  const hazards = () => {
    const out = [];
    for (const e of world.ents) {
      if (!e.alive || e.scenery || !e.solid || e.flying || e.hitDone) continue;
      if (e.type === 'panhandler' && e.leaving) continue;
      out.push({ s: e.s, d: e.d, L: e.L, W: e.W + (e.type === 'panhandler' ? 1.2 : 0), vs: e.parked ? 0 : e.v || 0, type: e.type });
    }
    for (const a of world.ambient) {   // cross traffic nosing into the route
      if (a.deck || a.x === undefined || route.distTo(a.x, a.y) > route.hw(car.s) + 3) continue;
      const pr = route.project(a.x, a.y);
      out.push({ s: pr.s, d: pr.d, L: 2.4, W: a.type === 'bus' ? 12 : 5, vs: 0, type: a.type + ' (cross)' });
    }
    return out;
  };

  let braking = false, lastHonk = 0, slowFor = 0;
  const tick = () => {
    if (d.state !== 'driving') { if (d.state === 'parked' || d.state === 'late') finish(); return; }
    report.ticks++;
    const hw = route.hw(car.s), lim = hw - PLAYER.halfW - 0.05, H = hazards();
    // blocked-until time for each candidate lateral position
    const cands = []; for (let c = -lim; c <= lim + 1e-6; c += 0.2) cands.push(c);
    // where a player would want to be: the right lane (two-way streets), then the curb by the P space on the approach
    const approach = car.s > d.spot.s - 95;
    const want = approach ? d.spot.d : route.oneway(car.s) ? car.d : route.lane(car.s, 0), wantW = approach ? 6 : 1.5;
    let best = null;
    for (const c of cands) {
      let cost = Math.abs(c - car.d) * 2 + Math.abs(c - want) * wantW, soonest = Infinity;
      for (const h of H) {
        const gap = h.s - car.s, reach = PLAYER.halfL + h.L / 2;
        if (gap < -reach) continue;                                    // already behind us
        const closing = car.v - h.vs, t = gap <= reach ? 0 : (gap - reach) / Math.max(closing, 0.5);
        if (t > LOOK_T) continue;
        const need = PLAYER.halfW + h.W / 2 + MARGIN;
        // the car also has to get there: sweep from where it is now for anything we reach within ~0.6 s
        const lo = t < 0.6 ? Math.min(c, car.d) : c, hi = t < 0.6 ? Math.max(c, car.d) : c;
        if (h.d + need > lo && h.d - need < hi) { cost += 1000 * (LOOK_T + 0.2 - t); soonest = Math.min(soonest, t); }
      }
      for (const tk of world.tokens) if (tk.alive && tk.s > car.s && tk.s - car.s < 35 && Math.abs(tk.d - c) < 1) cost -= 4;
      if (!best || cost < best.cost) best = { c, cost, soonest };
    }
    car.targetD = best.c;
    // no clear gap inside ~1.3 s at this speed: brake like a player would, and hold it (wait) until one opens
    const mustBrake = best.soonest < 1.3;
    if (mustBrake !== braking) { braking = mustBrake; key('ArrowDown', braking); if (braking) report.brakes++; }
    const beg = H.find((h) => h.type === 'panhandler' && h.s - car.s < 55 && h.s > car.s && Math.abs(h.d - best.c) < 2.5);
    if (beg && d.time - lastHonk > 1.5) { key('KeyH', true); key('KeyH', false); lastHonk = d.time; report.honks++; }
    // sanity: a stalled car, a car off the road, a broken pose
    slowFor = car.v < 1 && !braking ? slowFor + 0.05 : 0;
    if (slowFor > 2) { report.stalls++; slowFor = 0; log('BOT STALL at s', Math.round(car.s)); }
    if (Math.abs(car.d) > hw + 0.3) { report.offroad++; log('BOT OFFROAD', car.d.toFixed(2), 'hw', hw.toFixed(2)); }
    if (![car.s, car.d, car.v, car.pose.x, car.pose.y].every(Number.isFinite)) report.errors.push('non-finite car state');
  };
  const timer = setInterval(tick, 50);
  let done = false;
  function finish() {
    if (done) return; done = true; clearInterval(timer); if (braking) key('ArrowDown', false);
    log('BOT DONE', JSON.stringify({ popIn: report.popIn.length, popOut: report.popOut.length, teleports: report.teleports.length, hits: report.hits.length, errors: report.errors.length, stalls: report.stalls, offroad: report.offroad, brakes: report.brakes, honks: report.honks }));
  }
  return report;
}
