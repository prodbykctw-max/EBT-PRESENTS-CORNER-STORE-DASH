// QA autopilot (test harness only: index.html?qa&bot; the game never loads this). Drives the run the way a player
// would, with the same inputs a player has: drags into the clearest gap (what a touch drag does to targetD), brakes
// (↓) when every gap is closing, honks (H) at panhandlers. It plays fair: it only reacts to what is on screen, a
// quarter second after seeing it, in the same world, traffic and crowd the game runs, so a clean run means a
// player could have had one. Attach it to the real game with autopilot(window.__drive) after START.
// Anything that goes wrong is logged: every hit with what
// was hit and where, script errors, the car stalling, the car leaving the road, a non-finite pose.
import { PLAYER } from './runner.js';

const LOOK_T = 3.0;      // seconds of road read ahead
const MARGIN = 0.35;     // lateral clearance the bot insists on (metres, each side)
// play fair: a player only sees what's on screen and needs a moment to react
const REACTION = 0.25;   // seconds between seeing and acting (steer / brake / horn)

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
      if (o.alive === false || o.dead || (o.pts && o.x === undefined) || (o.g && !o.on)) continue;
      if (o.flying) { all.add(o); continue; }   // a knocked cone tumbling away is still there, just moving fast
      all.add(o); const p = where(o);
      if (world.visible(p.x, p.y, p.z, 0.3)) vis.set(o, p);
    }
    if (report.ticks > 0 && d.state === 'driving' && d.time > 0) {   // the end-of-run camera cut is a cut, not pop-in
      for (const [o, p] of vis) {
        if (!lastAll.has(o)) note(report.popIn, o, p, 'POP-IN');
        else if (lastVis.has(o)) { const q = lastVis.get(o); if (Math.hypot(p.x - q.x, p.y - q.y) > 6) note(report.teleports, o, p, 'TELEPORT'); }
      }
      for (const [o, p] of lastVis) if (!all.has(o) && !(o.alive === false && o.hitDone)) note(report.popOut, o, p, 'POP-OUT');
    }
    lastAll = all; lastVis = vis;
    for (const h of out.hits) {
      const rec = { t: +d.time.toFixed(1), hit: h.e.type, s: Math.round(car.s), carD: +car.d.toFixed(2), objD: +h.e.d.toFixed(2), v: +car.v.toFixed(1), before: recorder.slice(-10) };
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
      const p = route.at(e.s, e.d); if (!world.visible(p.x, p.y, p.z + 0.5, 1)) continue;   // off screen: unseen
      if (e.type === 'dog' && e.crossing) {   // a dog trotting across: a player reads the path it's on, not just where it is
        const d1 = e.d + e.crossing * 3.3 * 1.0; out.push({ s: e.s, d: (e.d + d1) / 2, L: 1.2, W: Math.abs(d1 - e.d) + 0.6, vs: 0, type: e.type }); continue;
      }
      out.push({ s: e.s, d: e.d, L: e.L, W: e.W + (e.worker ? 0.3 : e.type === 'panhandler' ? 1.2 : 0), vs: e.parked ? 0 : e.v || 0, type: e.type });
    }
    for (const a of world.ambient) {   // cross traffic nosing into the route
      if (a.deck || a.x === undefined || route.distTo(a.x, a.y) > route.hw(car.s) + 3) continue;
      if (!world.visible(a.x, a.y, a.zAbs + 0.8, 2)) continue;
      const pr = route.project(a.x, a.y);
      out.push({ s: pr.s, d: pr.d, L: 2.4, W: a.type === 'bus' ? 12 : 5, vs: 0, type: 'X' + a.type });
    }
    return out;
  };

  let braking = false, wantBrake = false, lastHonk = 0, slowFor = 0;
  const recorder = [];   // flight recorder: the last ~2 s of decisions, attached to every hit
  const pending = [], act = (fn) => pending.push([performance.now() + REACTION * 1000, fn]);   // decided now, done a beat later
  const tick = () => {
    while (pending.length && pending[0][0] <= performance.now()) pending.shift()[1]();
    if (d.state !== 'driving') { if (d.state === 'parked' || d.state === 'late' || d.state === 'busted') finish(); return; }
    report.ticks++;
    const hw = route.hw(car.s), lim = hw - PLAYER.halfW - 0.05, H = hazards();
    const seenTokens = world.tokens.filter((tk) => {
      if (!tk.alive || tk.s < car.s || tk.s - car.s > 35) return false;
      const p = route.at(tk.s, tk.d); return world.visible(p.x, p.y, p.z + 0.5, 0.6);
    });
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
        if (approach && h.s - h.L / 2 > d.spot.s + PLAYER.halfL + 1) continue;   // past where we stop to park
        // plan as if moving at least a crawl (a stopped car can still slide across); a car ahead that is pulling away
        // at our pace is something to follow, not a crash
        const closing = Math.max(car.v, 4) - h.vs;
        // beside us and behind our middle (and not catching up): driving on can't hit it, only sliding into it can
        const behindMid = gap < 0 && h.vs <= car.v + 1;
        const t = behindMid ? Infinity
          : gap <= reach ? (h.vs > 0 && car.v <= h.vs + 0.5 && gap > reach * 0.6 ? Infinity : 0)
          : closing <= 0 ? Infinity : (gap - reach) / closing;
        const need = PLAYER.halfW + h.W / 2 + MARGIN;
        if (behindMid) {   // don't slide into it: only moves that cross toward it cost anything
          const away = Math.sign(c - h.d) === Math.sign(car.d - h.d) && Math.abs(c - h.d) >= Math.abs(car.d - h.d);
          const lo = Math.min(c, car.d), hi = Math.max(c, car.d);
          if (!away && Math.abs(car.s - h.s) < reach && h.d + need - MARGIN > lo && h.d - need + MARGIN < hi) cost += 3000;
          continue;
        }
        if (t > LOOK_T) continue;
        // the car also has to get there: sweep from where it is now for anything we'd reach at our ACTUAL speed
        // before the move is done (stopped, sliding over clips nothing that isn't already beside us)
        const hitReach = reach - 0.25, tNow = gap <= hitReach ? 0 : (gap - hitReach) / Math.max(car.v - h.vs, 0.01);
        // moving away from it (staying on the same side) can't hit it; crossing past it can
        const away = Math.sign(c - h.d) === Math.sign(car.d - h.d) && Math.abs(c - h.d) >= Math.abs(car.d - h.d);
        const sweep = tNow < 0.8 && !away;
        const lo = sweep ? Math.min(c, car.d) : c, hi = sweep ? Math.max(c, car.d) : c;
        if (h.d + need > lo && h.d - need < hi) { cost += 1000 * (LOOK_T + 0.2 - t); soonest = Math.min(soonest, t); }
      }
      // the parking lane is for parking: only as a last resort (and at the store), never to undertake traffic
      const edge = route.travel(car.s) - 0.6;   // parking lanes: worse than waiting behind anything; our side opens only to park
      if (c > edge || (c < -edge && !approach)) cost += 4000;
      for (const tk of seenTokens) if (Math.abs(tk.d - c) < 1) cost -= 4;
      if (!best || cost < best.cost) best = { c, cost, soonest };
    }
    // every line is closing: hold this one and brake (a player waits, they don't creep toward the centre line)
    // and never roll into something right in front before we've actually moved clear of it
    const nose = H.some((h) => { const gap = h.s - car.s, reach = PLAYER.halfL + h.L / 2;
      return gap > 0 && gap < reach + 2.5 && h.vs < car.v + 1 && Math.abs(h.d - car.d) < PLAYER.halfW + h.W / 2 + 0.15; });
    // red lights: stop at the line like a driver (brake when the stopping distance, plus reaction, runs out)
    const redLine = world.signals?.stopFor(car.s + PLAYER.halfL, car.v, 1);
    const red = redLine != null && redLine - (car.s + PLAYER.halfL) < car.v * car.v / (2 * 9) + car.v * REACTION + 2.5;
    const mustBrake = best.soonest < 1.3 || nose || red;
    // one plan at a time: head for the best line whenever it's actually open (braking or not, e.g. pulling out of
    // a queue); when nothing is open, hold the line we're on and brake. Never flip back into a lane that's closed ahead.
    // (and when it's down to a crawl, wait tucked into our own lane if that's clear right beside us, not on the
    // centre line where oncoming traffic has to squeeze past)
    const homeHere = !H.some((h) => Math.abs(h.s - car.s) <= PLAYER.halfL + h.L / 2 + 1 && Math.abs(h.d - want) < PLAYER.halfW + h.W / 2 + 0.2);
    const line = best.soonest < 1.3 ? (car.v < 8 && homeHere ? want : car.targetD) : best.c;
    act(() => { car.targetD = line; });
    recorder.push({ s: Math.round(car.s), d: +car.d.toFixed(2), v: +car.v.toFixed(1), line: +line.toFixed(2), best: +best.c.toFixed(2), soon: isFinite(best.soonest) ? +best.soonest.toFixed(2) : 'inf', brake: mustBrake, nose, seen: H.filter((h) => h.s > car.s && h.s - car.s < 40).map((h) => h.type[0] + Math.round(h.s - car.s) + '@' + h.d.toFixed(1)).join(' ') });
    if (recorder.length > 40) recorder.shift();
    // no clear gap inside ~1.3 s at this speed: brake like a player would, and hold it (wait) until one opens
    if (mustBrake !== wantBrake) { wantBrake = mustBrake; act(() => { braking = mustBrake; key('ArrowDown', braking); if (braking) report.brakes++; }); }
    const beg = H.find((h) => h.type === 'panhandler' && h.s - car.s < 55 && h.s > car.s && Math.abs(h.d - best.c) < 2.5);
    if (beg && d.time - lastHonk > 1.5) { lastHonk = d.time; act(() => { key('KeyH', true); key('KeyH', false); report.honks++; }); }
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
    report.traffic = { ...world.stats };
    log('BOT DONE', JSON.stringify({ popIn: report.popIn.length, popOut: report.popOut.length, teleports: report.teleports.length, hits: report.hits.length, errors: report.errors.length, stalls: report.stalls, offroad: report.offroad, brakes: report.brakes, honks: report.honks }));
  }
  return report;
}
