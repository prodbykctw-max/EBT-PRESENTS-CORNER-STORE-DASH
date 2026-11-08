// Node-only model of the on-foot steering loop (no browser): a thumb that holds some angle off straight up, with jitter, run through the SAME roam.js maths
// and drive.js's constants (MOVE, TURN, FOOT.run, STICK). Reports how much the path weaves and how much the camera yaw wobbles.
//   node tools-roam/steer.sim.mjs
import * as roam from '../public/drive/roam.js';
const { wishVelocity, camYawStep, steerStick, approach, integrate, angDiff } = roam;
const DT = 1 / 120, RUN = 6.4, STICK = { dead: 6, full: 22 }, TURN = 16, MOVE = { up: [0.12, 24], down: [0.08, 34] };
const stickK = (m) => { const t = Math.min(1, Math.max(0, (m - STICK.dead) / (STICK.full - STICK.dead))); return t * (2 - t); };
function rngMaker(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
/** a thumb: offDeg off straight up (+ = right), pushing `push` px, wobble `jit` px std (low-passed, ~6 Hz) on both axes; returns { x, y } like footVec */
function thumb(offDeg, push, jit, r) {
  let jx = 0, jy = 0; const a = 1 - Math.exp(-DT * 2 * Math.PI * 6);
  return (t) => {
    jx += (gauss(r) * jit * 2.2 - jx) * a; jy += (gauss(r) * jit * 2.2 - jy) * a;   // (scaled so the std after the filter is about jit)
    const o = offDeg * Math.PI / 180, dx = Math.sin(o) * push + jx, dy = -Math.cos(o) * push + jy, m = Math.hypot(dx, dy);
    if (m <= STICK.dead) return { x: 0, y: 0 };
    const k = stickK(m); return { x: dx / m * k, y: dy / m * k };
  };
}
export function run(ctrl, { offDeg = 0, push = 30, jit = 0, secs = 10, seed = 1, releaseAt = null, turnDegAfter = null } = {}) {
  const r = rngMaker(seed), th = thumb(offDeg, push, jit, r), me = { x: 0, y: 0, vx: 0, vy: 0, kvx: 0, kvy: 0, heading: Math.PI / 2 };
  const st = ctrl.init ? ctrl.init(Math.PI / 2) : { camYaw: Math.PI / 2 };
  const rec = [];
  for (let i = 0; i < secs / DT; i++) {
    const t = i * DT; let fv = th(t);
    if (releaseAt !== null && t >= releaseAt) fv = { x: 0, y: -1 };   // let go of the turn: straight up
    const wish = wishVelocity(...ctrl.stick(st, fv, DT), st.camYaw, RUN, {});
    const mv = Math.hypot(wish.x, wish.y) > Math.hypot(me.vx, me.vy) ? MOVE.up : MOVE.down;
    approach(me, wish.x, wish.y, mv[0], mv[1], DT, me.heading);
    const sp = Math.hypot(me.vx, me.vy); if (sp > 0.6) me.heading += Math.max(-TURN * DT, Math.min(TURN * DT, angDiff(Math.atan2(me.vy, me.vx), me.heading)));
    ctrl.cam(st, me, fv, DT);
    integrate(me, DT);
    rec.push({ t, x: me.x, y: me.y, heading: me.heading, yaw: st.camYaw, sp });
  }
  return rec;
}
const deg = (r) => r * 180 / Math.PI;
/** weave: the path's lateral wobble about its own best smooth arc (a 2 s moving average of the heading is the trend; weave = how far the path strays from the path that trend would make) */
export function stats(rec) {
  const n = rec.length, W = 240;   // 2 s
  const unwrap = []; let prev = rec[0].heading, acc = 0; for (const q of rec) { acc += angDiff(q.heading, prev); prev = q.heading; unwrap.push(rec[0].heading + acc); }
  const yawU = []; prev = rec[0].yaw; acc = 0; for (const q of rec) { acc += angDiff(q.yaw, prev); prev = q.yaw; yawU.push(rec[0].yaw + acc); }
  const smooth = (a) => a.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - W); j <= Math.min(a.length - 1, i + W); j++) { s += a[j]; c++; } return s / c; });
  const hs = smooth(unwrap), ys = smooth(yawU);
  const from = 360, to = n - 360;   // ignore the first / last 3 s of the 2 s window
  let hw = 0, yw = 0, c = 0, hmax = 0, ymax = 0; for (let i = from; i < to; i++) { const a = unwrap[i] - hs[i], b = yawU[i] - ys[i]; hw += a * a; yw += b * b; c++; hmax = Math.max(hmax, Math.abs(a)); ymax = Math.max(ymax, Math.abs(b)); }
  // path lateral weave: integrate the smoothed heading to a trend path and measure the distance between it and the real path (both started together after the first 3 s)
  let tx = rec[from].x, ty = rec[from].y, wmax = 0, ws = 0, k = 0;
  for (let i = from + 1; i < to; i++) { tx += Math.cos(hs[i]) * rec[i].sp * DT; ty += Math.sin(hs[i]) * rec[i].sp * DT; const d = Math.hypot(rec[i].x - tx, rec[i].y - ty); }
  // simpler and robust: lateral deviation from the chord of each 3 s window
  const win = 360; let devMax = 0;
  for (let i = from; i + win < to; i += 60) { const a = rec[i], b = rec[i + win], L = Math.hypot(b.x - a.x, b.y - a.y) || 1; for (let j = i; j <= i + win; j++) { const d = ((rec[j].x - a.x) * (b.y - a.y) - (rec[j].y - a.y) * (b.x - a.x)) / L; devMax = Math.max(devMax, Math.abs(d)); } }
  // heading-rate sign changes (how many times the turn direction flips in the window): a serpentine flips often, a curve not at all
  let flips = 0, last = 0; for (let i = from + 1; i < to; i++) { const d = hs[i] - hs[i - 1], rate = unwrap[i] - unwrap[i - 1]; const s = Math.sign(smooth([rate])[0]); }
  const rateS = smooth(unwrap.map((v, i) => (i ? (v - unwrap[i - 1]) / DT : 0)).map((v) => v)); // heading rate smoothed over 4 s? use short window below
  const sh = (a, w) => a.map((_, i) => { let s = 0, cc = 0; for (let j = Math.max(0, i - w); j <= Math.min(a.length - 1, i + w); j++) { s += a[j]; cc++; } return s / cc; });
  const hr = sh(unwrap.map((v, i) => (i ? (v - unwrap[i - 1]) / DT : 0)), 30);   // 0.5 s window
  for (let i = from; i < to; i++) { const s = Math.abs(hr[i]) < 0.05 ? 0 : Math.sign(hr[i]); if (s && last && s !== last) flips++; if (s) last = s; }
  return { headingWobbleRmsDeg: deg(Math.sqrt(hw / c)), headingWobbleMaxDeg: deg(hmax), camYawWobbleRmsDeg: deg(Math.sqrt(yw / c)), camYawWobbleMaxDeg: deg(ymax), pathWeaveMaxM: devMax, turnFlips: flips,
    yawRateMeanDegS: deg((yawU[to] - yawU[from]) / ((to - from) * DT)), endHeadingDeg: deg(unwrap[n - 1]), endYawDeg: deg(yawU[n - 1]) };
}

// ---- controllers ----
export const OLD = {   // origin/main: the camera yaw chases the runner's HEADING
  init: (a) => ({ camYaw: a }),
  stick: (st, fv) => [fv.x, fv.y],
  cam: (st, me, fv, dt) => { st.camYaw = oldCamYawStep(st.camYaw, me.heading, fv.x, fv.y, Math.hypot(me.vx, me.vy) / RUN, dt); },
};
// origin/main's camYawStep, kept here verbatim for the before/after numbers
function oldCamYawStep(yaw, heading, sx, sy, speedFrac, dt) {
  const fwd = Math.max(0, -sy), delta = angDiff(heading, yaw);
  const rate = 1.5 * Math.min(1, fwd) * Math.min(1, Math.max(0, speedFrac)) * Math.min(1, Math.abs(delta) / 0.4);
  return yaw + Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
}
export const NEW = {   // this branch: steerStick (eased angle + cone) and a camera that follows the cleaned-up stick
  init: (a) => ({ camYaw: a, ss: { on: false, a: 0 }, f: { x: 0, y: 0 } }),
  stick: (st, fv, dt) => { steerStick(st.ss, fv.x, fv.y, dt, st.f); return [st.f.x, st.f.y]; },
  cam: (st, me, fv, dt) => { st.camYaw = camYawStep(st.camYaw, st.f.x, st.f.y, Math.hypot(me.vx, me.vy) / RUN, dt); },
};
const cases = [['straight', 0, 0], ['5deg', 5, 2], ['7deg + jitter', 7, 2.5], ['10deg + jitter', 10, 3], ['0deg + jitter', 0, 3]];
export function report(name, ctrl) {
  console.log('== ' + name);
  for (const [lab, off, jit] of cases) {
    const rows = [1, 2, 3, 4, 5].map((s) => stats(run(ctrl, { offDeg: off, jit, seed: s })));
    const avg = (k) => rows.reduce((a, b) => a + b[k], 0) / rows.length, mx = (k) => Math.max(...rows.map((r) => r[k]));
    console.log(`${lab.padEnd(16)} camYaw wobble rms ${avg('camYawWobbleRmsDeg').toFixed(2)} deg (max ${mx('camYawWobbleMaxDeg').toFixed(1)})  heading wobble rms ${avg('headingWobbleRmsDeg').toFixed(2)} (max ${mx('headingWobbleMaxDeg').toFixed(1)})  path weave max ${mx('pathWeaveMaxM').toFixed(2)} m  turn flips ${avg('turnFlips').toFixed(1)}  mean yaw rate ${avg('yawRateMeanDegS').toFixed(1)} deg/s`);
  }
}
if (process.argv[1].endsWith('steer.sim.mjs')) { report('origin/main model', OLD); report('this branch', NEW); }

// ---- curve radius and release overshoot ----
export function curveAndRelease(name, ctrl) {
  for (const off of [-45, -30, -20]) {
    const rec = run(ctrl, { offDeg: off, secs: 10 }), R = [];
    for (let i = 600; i + 60 < rec.length; i += 60) {   // radius from the turn of the heading over 0.5 s (after 5 s)
      const dh = Math.abs(angDiff(rec[i + 60].heading, rec[i].heading)), ds = Math.hypot(rec[i + 60].x - rec[i].x, rec[i + 60].y - rec[i].y);
      if (dh > 1e-4) R.push(ds / dh);
    }
    const mean = R.reduce((a, b) => a + b, 0) / R.length, sd = Math.sqrt(R.reduce((a, b) => a + (b - mean) ** 2, 0) / R.length);
    console.log(`${name} steady ${off} deg (no jitter): radius ${mean.toFixed(2)} m, sd ${sd.toFixed(3)} m (${(100 * sd / mean).toFixed(1)}%)`);
  }
  for (const off of [-45, -30]) {
    const rec = run(ctrl, { offDeg: off, secs: 9, releaseAt: 4 }), i0 = 4 * 120, hEnd = rec[rec.length - 1].heading, dir = Math.sign(angDiff(hEnd, rec[i0].heading));
    let over = 0; for (let i = i0; i < rec.length; i++) over = Math.max(over, dir * angDiff(rec[i].heading, hEnd));
    let settle = rec.length; for (let i = rec.length - 1; i >= i0; i--) { if (Math.abs(angDiff(rec[i].heading, hEnd)) > 0.02) { settle = i; break; } }
    console.log(`${name} release from ${off} deg: turned ${(Math.abs(angDiff(hEnd, rec[i0].heading)) * 180 / Math.PI).toFixed(1)} deg after release, overshoot ${(over * 180 / Math.PI).toFixed(2)} deg, heading settled ${((settle - i0) / 120).toFixed(2)} s after release`);
  }
}
if (process.argv[1].endsWith('steer.sim.mjs')) { curveAndRelease('OLD', OLD); curveAndRelease('NEW', NEW); }
