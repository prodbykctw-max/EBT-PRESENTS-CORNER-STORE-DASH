// Node-only checks of free roam (public/drive/roam.js) against the real city data. No browser.
//   node tools-roam/collide.test.mjs [runsPerStart=200] [seconds=20]
// Builds the same collision world drive.js builds (walkWorldFor) from world.json + hero.glb + props.glb + trees.glb, then throws random-direction runs at it from five starts and
// checks, with a brute force that does not use the world's own spatial hash, that nobody is ever inside a building footprint, closer than r - 1 cm to any wall, ramp barrier,
// ramp cap or pier, or on a freeway slab that is low enough to fall through. Also: the exact route projection, the controls' maths, and the bully's trail-following.
// Not covered here: the streetcar platforms' shelters (tram.js needs the whole game to build), and cars and people (moving things are drive.js's job, tested in the browser).
import assert from 'assert';
import { loadCityNode } from './node-world.mjs';

const RUNS = +process.argv[2] || 200, SECS = +process.argv[3] || 20, HZ = 120, DT = 1 / HZ;
const t0 = Date.now();
const { W, route, ground, city, walk, roam, heroWalls } = await loadCityNode();
const { BODY, integrate, approach, wallPass, wishVelocity, steerStick, STEER, camYawStep, Trail, chaseTarget, angDiff, FREEWAY } = roam;
console.log(`world built in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${walk.nSeg} wall segments (${city.walls.length / 4} building edges, ${heroWalls.length / 4} hero-row slices, rest freeway), ${walk.nCir} posts and piers, ${walk.nRing} footprints, ${city.freeway.pieces.length} elevated roads`);

let failures = 0;
const fail = (msg) => { failures++; if (failures <= 20) console.log('FAIL', msg); };
const rng = (() => { let a = 0x9e3779b9; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

// ---------------------------------------------------------------- brute force (every segment, every footprint: no hash)
const S = walk.segs, C = walk.circles;
function bruteDepth(x, y, r) {
  let worst = 0;
  for (let i = 0; i < walk.nSeg; i++) {
    const ax = S[i * 4], ay = S[i * 4 + 1], bx = S[i * 4 + 2], by = S[i * 4 + 3], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0, d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (r - d > worst) worst = r - d;
  }
  for (let i = 0; i < walk.nCir; i++) { const d = Math.hypot(x - C[i * 3], y - C[i * 3 + 1]) - C[i * 3 + 2]; if (r - d > worst) worst = r - d; }
  return worst;
}
const ringHas = (x, y, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const bruteInside = (x, y) => city.footprints.some((r) => ringHas(x, y, r));
// a freeway slab low enough to fall through: inside a deck's width where its top is LO..HI above the ground
const { deckTop } = await import(new URL('../public/drive/levels.js', import.meta.url).href);
const { LEVEL } = await import(new URL('../public/drive/levels.js', import.meta.url).href);
const slabs = [];
for (const r of city.freeway.pieces) for (let i = 0; i + 1 < r.p.length; i++) slabs.push({ A: r.p[i], B: r.p[i + 1], hw: r.width / 2, lift: r.lift });
const upAt = (q, lift, x, y) => deckTop(ground, x, y, q[3]) + lift - (ground(x, y) + LEVEL.TERRAIN);
function onSlab(x, y) {
  for (const { A, B, hw, lift } of slabs) {
    if (Math.abs(A[0] - x) > 80 && Math.abs(B[0] - x) > 80) continue;
    const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1, t = ((x - A[0]) * dx + (y - A[1]) * dy) / L2;
    if (t < 0.02 || t > 0.98) continue;
    if (Math.hypot(x - A[0] - dx * t, y - A[1] - dy * t) >= hw - 0.2) continue;
    const u = upAt(A, lift, A[0] + dx * t, A[1] + dy * t) * (1 - t) + upAt(B, lift, A[0] + dx * t, A[1] + dy * t) * t;
    if (u >= FREEWAY.LO + 0.05 && u <= FREEWAY.HI - 0.05) return true;
  }
  return false;
}

// ---------------------------------------------------------------- 1. the hash against the brute force
{
  let bad = 0, n = 0;
  for (let k = 0; k < 4000; k++) {
    const s = rng() * route.length, d = (rng() - 0.5) * 60, p = route.at(s, d);
    const a = walk.depth(p.x, p.y, 0.42) > 0.0005, b = bruteDepth(p.x, p.y, 0.42) > 0.0005 || bruteInside(p.x, p.y);
    n++; if (a !== b) { bad++; fail(`hash vs brute force at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}: ${a} vs ${b}`); }
  }
  console.log(`1. spatial hash agrees with brute force at ${n - bad}/${n} random points`);
}

// ---------------------------------------------------------------- 2. exact projection
{
  let worst = 0, n = 0;
  for (let k = 0; k < 3000; k++) {
    const s = 1 + rng() * (route.length - 2), d = (rng() - 0.5) * 40, p = route.at(s, d), pr = route.projectFine(p.x, p.y);
    const q = route.at(pr.s, pr.d); worst = Math.max(worst, Math.hypot(q.x - p.x, q.y - p.y)); n++;
    if (Math.hypot(q.x - p.x, q.y - p.y) > 0.01) fail(`projectFine round trip off by ${Math.hypot(q.x - p.x, q.y - p.y).toFixed(3)} m at s=${s.toFixed(1)} d=${d.toFixed(1)}`);
  }
  console.log(`2. projectFine: at(projectFine(p)) is within ${(worst * 1000).toFixed(2)} mm of p over ${n} points (route.project alone steps in 2 m)`);
  // s moves smoothly with a runner (project() steps every 2 m)
  let prev = null, maxStep = 0;
  for (let x = 0; x < 100; x += 0.05) { const p = route.at(14 + x, -8), pr = route.projectFine(p.x, p.y); if (prev !== null) maxStep = Math.max(maxStep, Math.abs(pr.s - prev - 0.05)); prev = pr.s; }
  console.log(`   running 100 m along the sidewalk, s never jumps more than ${(maxStep * 1000).toFixed(2)} mm from its true step`);
  if (maxStep > 0.01) fail('projectFine not smooth');
}

// ---------------------------------------------------------------- 3. the controls' maths
{
  const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
  let v = wishVelocity(0, -1, 0, 5.6); assert(near(v.x, 5.6) && near(v.y, 0), 'up is away from the camera');
  v = wishVelocity(1, 0, 0, 5.6); assert(near(v.x, 0) && near(v.y, -5.6), 'right of a camera facing east is south');
  v = wishVelocity(0, -1, Math.PI / 2, 5.6); assert(near(v.x, 0, 1e-9) && near(v.y, 5.6), 'camera facing north, up runs north');
  v = wishVelocity(0, 1, 0.7, 5.6); assert(near(Math.hypot(v.x, v.y), 5.6) && near(angDiff(Math.atan2(v.y, v.x), 0.7), Math.PI, 1e-9) || near(Math.abs(angDiff(Math.atan2(v.y, v.x), 0.7)), Math.PI, 1e-9), 'down runs at the camera');
  v = wishVelocity(0.3, -0.4, 1.1, 5.6); assert(near(Math.hypot(v.x, v.y), 0.5 * 5.6), 'speed is the length of the drag');
  // straight left/right: the camera does not orbit; straight up: nothing to swing; up-left: swings left at ~ rate * sin(45deg); down: no swing
  const run = (sx, sy, secs) => {
    let yaw = 0.3, x = 0, y = 0, vx = 0, vy = 0, head = yaw, tot = 0;
    for (let k = 0; k < secs * HZ; k++) {
      const w = wishVelocity(sx, sy, yaw, 5.6), m = { vx, vy }; approach(m, w.x, w.y, 0.12, 24, DT); vx = m.vx; vy = m.vy; x += vx * DT; y += vy * DT;
      const sp = Math.hypot(vx, vy); if (sp > 0.6) head = Math.atan2(vy, vx);
      const y2 = camYawStep(yaw, sx, sy, sp / 5.6, DT); tot += Math.abs(y2 - yaw); yaw = y2;
    }
    return { yaw: yaw - 0.3, x, y, tot };
  };
  assert(Math.abs(run(-1, 0, 4).yaw) < 1e-6 && Math.abs(run(1, 0, 4).yaw) < 1e-6, 'straight left/right must not orbit the camera');
  assert(Math.abs(run(0, -1, 4).yaw) < 1e-6, 'straight up: no swing');
  assert(Math.abs(run(0, 1, 4).yaw) < 1e-6, 'straight down: no swing');
  const ul = run(-0.707, -0.707, 4), ur = run(0.707, -0.707, 4);
  assert(ul.yaw > 3.0 && ur.yaw < -3.0, `up-left/up-right curve opposite ways (${ul.yaw.toFixed(2)}, ${ur.yaw.toFixed(2)} rad in 4 s)`);
  assert(ul.tot / 4 <= 1.5 + 1e-9, 'camera swing never above 1.5 rad/s');
  // steerStick: a thumb a few degrees off straight up is straight up, a diagonal and straight left/right/down are exact, a flip is at once, and jitter is smoothed
  {
    const st = { on: false, a: 0 }, o = { x: 0, y: 0 }, ang = (x, y) => Math.atan2(x, -y) * 180 / Math.PI;
    steerStick(st, Math.sin(0.12), -Math.cos(0.12), DT, o); assert(Math.abs(o.x) < 0.01 && o.y < -0.99, '7 degrees off up is straight up');
    for (const [x, y, want] of [[0.707, -0.707, 45], [-0.707, -0.707, -45], [1, 0, 90], [-1, 0, -90], [0.707, 0.707, 135], [-0.707, 0.707, -135], [0.5, -0.866, 30]]) {
      const s2 = { on: false, a: 0 }; steerStick(s2, x, y, DT, o); const a = ang(o.x, o.y); assert(Math.abs(a - want) < 0.01, `direction ${want} is passed through untouched (${a})`); assert(Math.abs(Math.hypot(o.x, o.y) - Math.hypot(x, y)) < 1e-9, 'length untouched');
    }
    const s3 = { on: false, a: 0 }; steerStick(s3, 0, -1, DT, o); steerStick(s3, 0, 1, DT, o); assert(Math.abs(o.y - 1) < 1e-9, 'up to down is at once (no sweep through sideways)');
    steerStick(s3, 0, 0, DT, o); assert(o.x === 0 && o.y === 0, 'no push, no run');
    // a push that jumps +-6 degrees every step: the output's angle stays within 1 degree of the middle
    const s4 = { on: false, a: 0 }; let worst = 0; for (let k = 0; k < 240; k++) { const a = (k % 2 ? 1 : -1) * 6 * Math.PI / 180 + 40 * Math.PI / 180; steerStick(s4, Math.sin(a), -Math.cos(a), DT, o); if (k > 60) worst = Math.max(worst, Math.abs(ang(o.x, o.y) - 40)); }
    assert(worst < 1.2, `a +-6 degree shake at 120 Hz is smoothed to ${worst.toFixed(2)} degrees`);
  }
  console.log(`3. controls: up-left swings the camera ${(ul.yaw / 4).toFixed(2)} rad/s (max 1.5), up-right ${(ur.yaw / 4).toFixed(2)}, straight left/right/up/down 0.00`);
}

// ---------------------------------------------------------------- 4. random runs
const free = (x, y) => !walk.solid(x, y, BODY + 0.15);
function freeNear(x, y) {
  if (free(x, y)) return { x, y };
  for (let r = 0.5; r < 40; r += 0.5) for (let a = 0; a < 6.283; a += 0.35) { const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (free(px, py)) return { x: px, y: py }; }
  throw new Error('no free spot near ' + x + ',' + y);
}
const hw0 = (s) => route.hw(s);
const starts = {};
{ const p = route.at(14, -(hw0(14) + 2)); starts['route start'] = freeNear(p.x, p.y); }
{ const p = route.at(300, hw0(300) + 2.5); starts['far sidewalk'] = freeNear(p.x, p.y); }
{ // a side street: a cross road that meets the route, a good way down it
  let best = null, bs = 1e9;   // the road point nearest to 80 m from the route, on a street that meets it, past the first block
  for (const rd of W.roads) {
    if (!/residential|tertiary|secondary|service|unclassified/.test(rd.cls) || rd.h) continue;
    for (const [x, y] of rd.pts) { const dd = route.distTo(x, y), s = route.project(x, y).s; if (s > 150 && s < 900 && Math.abs(dd - 80) < bs) { bs = Math.abs(dd - 80); best = { x, y }; } }
  }
  starts['side street'] = freeNear(best.x, best.y);
}
starts['store front'] = freeNear(-3, 14);
{ // under the Connector: a spot where a deck is overhead (4-6 m above the ground) and open ground under it
  let best = null, bd = 1e9;
  for (const r of city.freeway.pieces) for (const q of r.p) {
    const u = deckTop(ground, q[0], q[1], q[3]) + r.lift - (ground(q[0], q[1]) + LEVEL.TERRAIN);
    if (u > 4.2 && u < 7 && !walk.solid(q[0], q[1], BODY + 0.3)) { const dd = route.distTo(q[0], q[1]); if (dd < bd) { bd = dd; best = { x: q[0], y: q[1] }; } }
  }
  starts['under the Connector'] = freeNear(best.x, best.y);
}
let totalSteps = 0, reverts = 0, contacts = 0, moved = 0, bruteChecks = 0;
const t1 = Date.now();
for (const [name, st] of Object.entries(starts)) {
  let bad = 0, far = 0, minD = 1e9;
  for (let run = 0; run < RUNS; run++) {
    const m = { x: st.x, y: st.y, vx: 0, vy: 0, kvx: 0, kvy: 0, good: { x: st.x, y: st.y } };
    let head = rng() * 6.283, change = 0, dist = 0;
    for (let k = 0; k < SECS * HZ; k++) {
      if (k >= change) { head = rng() < 0.15 ? head + (rng() - 0.5) * 0.5 : rng() * 6.283; change = k + HZ * (0.4 + rng() * 2.2); if (rng() < 0.1) { m.kvx += (rng() - 0.5) * 16; m.kvy += (rng() - 0.5) * 16; } }
      const stop = rng() < 0.0005, sp = stop ? 0 : 5.6 * (0.3 + 0.7 * (run % 3 === 0 ? 1 : rng()));
      approach(m, Math.cos(head) * sp, Math.sin(head) * sp, 0.12, 24, DT);
      const px = m.x, py = m.y;
      integrate(m, DT);
      const n = wallPass(walk, m);
      totalSteps++; if (n < 0) reverts++; else if (n > 0) contacts++;
      dist += Math.hypot(m.x - px, m.y - py);
      const dp = walk.depth(m.x, m.y, BODY), inside = walk.inFootprint(m.x, m.y);
      if (dp > 0.01 || inside) { bad++; fail(`${name} run ${run} t=${(k * DT).toFixed(2)}: depth ${dp.toFixed(3)} inside=${inside} at ${m.x.toFixed(2)}, ${m.y.toFixed(2)}`); break; }
      if (k % 40 === 0) {
        bruteChecks++;
        const bd = bruteDepth(m.x, m.y, BODY);
        if (bd > 0.01 || bruteInside(m.x, m.y)) { bad++; fail(`${name} run ${run} t=${(k * DT).toFixed(2)}: BRUTE depth ${bd.toFixed(3)} inside=${bruteInside(m.x, m.y)} at ${m.x.toFixed(2)}, ${m.y.toFixed(2)}`); break; }
        minD = Math.min(minD, BODY - bd);
        if (onSlab(m.x, m.y)) { bad++; fail(`${name} run ${run} t=${(k * DT).toFixed(2)}: ON A FREEWAY SLAB at ${m.x.toFixed(2)}, ${m.y.toFixed(2)}`); break; }
      }
    }
    moved += dist; far = Math.max(far, Math.hypot(m.x - st.x, m.y - st.y));
  }
  console.log(`4. ${name.padEnd(20)} ${RUNS} runs x ${SECS} s at ${HZ} Hz: ${bad ? bad + ' VIOLATIONS' : 'no violations'}; furthest ${far.toFixed(0)} m from the start`);
}
console.log(`   ${totalSteps} steps, ${contacts} with a wall contact, ${reverts} went back to the last clear spot, ${(moved / (5 * RUNS)).toFixed(0)} m run per run on average, ${bruteChecks} brute-force checks, ${((Date.now() - t1) / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------- 5. the freeway: where the walls are
{
  const fw = roam.freewayColliders(city.freeway.pieces, ground);
  console.log(`5. freeway: ${fw.segs.length / 4} wall segments and ${fw.circles.length / 3} pier circles from ${city.freeway.pieces.length} elevated roads`);
  // walking along the middle of every elevated road from either end must not reach a slab that is low enough to fall through
  let blocked = 0, reached = 0;
  for (const r of city.freeway.pieces) {
    if (r.p.length < 2) continue;
    for (const end of [0, r.p.length - 1]) {
      const q = r.p[end], q2 = r.p[end === 0 ? 1 : end - 1];
      const dx = q2[0] - q[0], dy = q2[1] - q[1], L = Math.hypot(dx, dy) || 1;
      const m = { x: q[0] - dx / L * 3, y: q[1] - dy / L * 3, vx: dx / L * 5.6, vy: dy / L * 5.6, kvx: 0, kvy: 0, good: null };
      if (walk.solid(m.x, m.y, BODY) || onSlab(m.x, m.y)) continue;   // (a start already inside another road's slab, where two elevated roads meet, is not a way in)
      m.good = { x: m.x, y: m.y };
      let got = false;
      for (let k = 0; k < 40 * HZ && !got; k++) { integrate(m, DT); wallPass(walk, m); if (onSlab(m.x, m.y)) got = true; }
      if (got) { reached++; let u = 0; for (const { A, B, hw, lift } of slabs) { const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1, t = ((m.x - A[0]) * dx + (m.y - A[1]) * dy) / L2; if (t > 0 && t < 1 && Math.hypot(m.x - A[0] - dx * t, m.y - A[1] - dy * t) < hw) u = upAt(A, lift, m.x, m.y) * (1 - t) + upAt(B, lift, m.x, m.y) * t; } fail(`walked onto a low freeway slab entering road ${r.id} at its ${end ? 'last' : 'first'} sample, ended ${u.toFixed(2)} m above the ground`); } else blocked++;
    }
  }
  console.log(`   walking in along the roadway from both ends of every elevated road: ${blocked} stopped, ${reached} got onto a low slab`);
}

// ---------------------------------------------------------------- 6. the bully runs your trail around corners
{
  let runs = 0, caught = 0, wallBad = 0, maxGap = 0, stuck = 0;
  const names = Object.keys(starts);
  for (let run = 0; run < 60; run++) {
    const st = starts[names[run % names.length]];
    const me = { x: st.x, y: st.y, vx: 0, vy: 0, kvx: 0, kvy: 0, good: { x: st.x, y: st.y } };
    const hp = freeNear(st.x - 6, st.y - 2);
    const him = { x: hp.x, y: hp.y, vx: 0, vy: 0, kvx: 0, kvy: 0, good: { x: hp.x, y: hp.y } };
    const trail = new Trail(); trail.push(him.x, him.y); trail.push(me.x, me.y);
    const ch = {}; let head = rng() * 6.283, change = 0, stoppedAt = -1, still = 0;
    for (let k = 0; k < 50 * HZ; k++) {
      const secs = k * DT, runnerStops = secs > 30;
      if (k >= change) { head = rng() < 0.3 ? head + (rng() - 0.5) * 0.8 : rng() * 6.283; change = k + HZ * (0.6 + rng() * 2.5); }
      approach(me, runnerStops ? 0 : Math.cos(head) * 5.6, runnerStops ? 0 : Math.sin(head) * 5.6, 0.12, 24, DT);
      integrate(me, DT); wallPass(walk, me); trail.push(me.x, me.y);
      chaseTarget(walk, trail, him, me, ch, DT);
      const dx = ch.tx - him.x, dy = ch.ty - him.y, dist = Math.hypot(dx, dy) || 1, gap = Math.hypot(me.x - him.x, me.y - him.y);
      const sp = ch.sees ? Math.min(5.3, Math.max(0, Math.hypot(me.vx, me.vy)) + Math.max(0, gap - 0.75) * 4) : 5.3;
      approach(him, dx / dist * sp, dy / dist * sp, 0.14, 20, DT);
      integrate(him, DT); wallPass(walk, him);
      if (walk.depth(him.x, him.y, BODY) > 0.01 || walk.inFootprint(him.x, him.y)) { wallBad++; fail(`bully in a wall, run ${run}`); break; }
      maxGap = Math.max(maxGap, gap);
      still = Math.hypot(him.vx, him.vy) < 0.3 && !ch.sees && gap > 3 ? still + DT : 0; if (still > 3) { stuck++; still = -1e9; }
      if (runnerStops && gap < 0.9) { caught++; break; }
    }
    runs++;
  }
  console.log(`6. bully: ${caught}/${runs} runs ended with him on top of a runner who stopped after 30 s (zig-zag runs from five starts, he follows the trail round corners); never in a wall: ${wallBad ? 'NO' : 'yes'}; stuck > 3 s without a line to you: ${stuck}; furthest apart ${maxGap.toFixed(0)} m`);
  if (caught < runs * 0.9) fail(`the bully caught only ${caught}/${runs}`);
}

// ---------------------------------------------------------------- 7. review fixes
{
  // 7a. behind the start and past the end of the route is off the street (the traffic and the crowd read s and d: they must not see a runner standing at s = 0)
  const p0 = route.at(0, 0), pL = route.at(route.length, 0), out = {};
  let offBad = 0, n = 0;
  for (const [p, sign] of [[p0, -1], [pL, 1]]) for (const dist of [5, 20, 80]) for (const d of [-8, 0, 8]) {
    const x = p.x + Math.cos(p.a) * sign * dist - Math.sin(p.a) * d, y = p.y + Math.sin(p.a) * sign * dist + Math.cos(p.a) * d;
    route.projectFine(x, y, out); n++;
    if (!(out.off > 0.5)) { offBad++; fail(`a point ${dist} m ${sign < 0 ? 'behind the start' : 'past the end'} (d ${d}) reads off = ${out.off.toFixed(3)} (should be > 0.5)`); }
  }
  // beside the route anywhere along it: off ~ 0
  let maxOff = 0; for (let s = 5; s < route.length - 5; s += 7.3) for (const d of [-9, -3, 0, 3, 9]) { const q = route.at(s, d); route.projectFine(q.x, q.y, out); maxOff = Math.max(maxOff, out.off); }
  if (maxOff > 0.05) fail(`beside the route, projectFine off is ${maxOff.toFixed(3)} m (should be ~0)`);
  const o1 = {}, r1 = route.projectFine(p0.x, p0.y, o1); if (r1 !== o1) fail('projectFine did not return the out object');
  console.log(`7a. off-street: ${n - offBad}/${n} points behind the start / past the end read off > 0.5 m; beside the route off <= ${maxOff.toFixed(4)} m`);

  // 7b. the trail: the ring overwriting crumbs the bully has not reached, a cut corner, and the scan cap
  {
    const tr = new Trail(100); for (let i = 0; i < 400; i++) tr.push(i * 0.6, 0);
    const him = { x: 399 * 0.6, y: 0 }, me = { x: 399 * 0.6, y: 0 }, st = {};
    tr.reached = 5;   // far older than anything the ring still holds
    chaseTarget(walk, tr, him, me, st, 1);
    if (tr.reached < tr.n - tr.cap) fail(`trail.reached ${tr.reached} is older than the ring (${tr.n - tr.cap})`);
    // he cut a corner: the next crumb is not within 0.9 m, a later one is
    const t2 = new Trail(800); for (let i = 0; i < 100; i++) t2.push(i * 0.6, 0);
    const h2 = { x: 40 * 0.6 + 0.2, y: 0.3 }, st2 = {}; t2.reached = 20;
    chaseTarget(walk, t2, h2, { x: 1e5, y: 1e5 }, st2, 1);
    if (t2.reached < 40) fail(`reached stayed at ${t2.reached} after he ran through crumb 40`);
    // a long trail with nothing in view must not test more than the cap
    let calls = 0; const fake = { clearLine: () => { calls++; return false; } }; const t3 = new Trail(800); for (let i = 0; i < 700; i++) t3.push(i * 0.6, 0);
    t3.aim(fake, 0, 0, 0.4, 2); if (calls > 60) fail(`aim tested ${calls} lines (cap 60)`);
    console.log(`7b. trail: reached stays inside the ring (${tr.reached} >= ${tr.n - tr.cap}), advances past a cut corner (${t2.reached}), aim tests at most ${calls} lines`);
  }

  // 7c. the edge of the map is inside what is drawn
  {
    const G = ground.grid, b = walk.bounds;
    const inside = b.x0 >= G.x0 + 9.99 && b.x1 <= G.x0 + G.nx * G.step - 9.99 && b.y0 >= G.y0 + 9.99 && b.y1 <= G.y0 + G.ny * G.step - 9.99;
    if (!inside) fail(`map edge ${JSON.stringify(b)} is not 10 m inside the drawn ground`);
    console.log(`7c. map edge x ${b.x0.toFixed(0)}..${b.x1.toFixed(0)}, y ${b.y0.toFixed(0)}..${b.y1.toFixed(0)}, drawn ground x ${G.x0.toFixed(0)}..${(G.x0 + G.nx * G.step).toFixed(0)}, y ${G.y0.toFixed(0)}..${(G.y0 + G.ny * G.step).toFixed(0)}`);
  }

  // 7d. ambientBoxes reuses its boxes and keeps the lane offset; route.at fills an out object
  {
    const { World } = await import(new URL('../public/drive/runner.js', import.meta.url).href);
    const ambient = [{ x: 10, y: 5, h: 0, lane: 1, type: 'sedan', vs: 3 }, { x: 500, y: 0, h: 0, lane: 0, type: 'bus' }, { x: 12, y: 0, h: 0, lane: 0, type: 'bus', deck: true }];
    const out = []; World.prototype.ambientBoxes.call({ ambient }, 10, 5, 14, out);
    const first = out[0]; World.prototype.ambientBoxes.call({ ambient }, 10, 5, 14, out);
    if (out.length !== 1 || out[0] !== first) fail('ambientBoxes did not reuse its box / filter by range and deck');
    if (Math.abs(out[0].y - 6) > 1e-9 || out[0].hl !== 2.3) fail(`ambientBoxes box wrong: ${JSON.stringify({ x: out[0].x, y: out[0].y, hl: out[0].hl })}`);
    const q = {}; const r = route.at(50, 2, q); if (r !== q || !(q.x === route.at(50, 2).x)) fail('route.at(out) wrong');
    console.log('7d. ambientBoxes: pooled, range and deck filtered, lane offset applied; route.at(s, d, out) fills out');
  }
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
