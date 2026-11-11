// How the on-foot drag feels, in numbers (and every direction proved from the first frame). Usage: node tools-footctl/sens.mjs <drive url ?qa> <tag>
// Real touch events on fixed 1/60 s ticks (the bully is held back; the runner is put back on the start between tests).
// Prints JSON: speed at drag lengths, time to 90% speed, heading change for a 5 px wobble at full push, camera yaw rate, the direction matrix + wall check.
import { chromium } from 'playwright-core';
const [url, tag] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
await p.evaluate(() => { const d = window.__drive; d.manual = true; const m = d.foot.me; window.__s0 = { x: m.x, y: m.y, yaw: d.foot.camYaw };
  { // an open spot (nothing solid within 9 m on any side) near the start, so a test run is not stopped by a pole 4 m ahead
    const f = d.foot; let best = null;
    for (let r = 0; r <= 40 && !best; r += 2) for (let k = 0; k < 16 && !best; k++) { const a = k / 16 * Math.PI * 2, x = m.x + r * Math.cos(a), y = m.y + r * Math.sin(a);
      if (f.solidAt(x, y)) continue; let ok = true; for (let j = 0; j < 16; j++) { const b = j / 16 * Math.PI * 2; if (!f.clearLine(x, y, x + 9 * Math.cos(b), y + 9 * Math.sin(b))) { ok = false; break; } } if (ok) best = { x, y }; }
    if (best) { window.__s0.x = best.x; window.__s0.y = best.y; } window.__open = !!best; } { const h = d.foot.him; window.__h0 = { x: h.x, y: h.y }; } window.__bad = 0; d.world.crowd.people.length = 0;  /* (the walkers move about; a stranger in the way would be measured as a slow start) */ window.__first = null; });
let down = null;
const touch = (type, x, y) => p.evaluate(([type, x, y]) => {
  const target = (window.__tt && type !== 'touchStart') ? window.__tt : document.elementFromPoint(x, y); if (type === 'touchStart') window.__tt = target;
  const t = new Touch({ identifier: 1, target, clientX: x, clientY: y }), end = type === 'touchEnd';
  target.dispatchEvent(new TouchEvent(type.toLowerCase(), { bubbles: true, cancelable: true, touches: end ? [] : [t], targetTouches: end ? [] : [t], changedTouches: [t] }));
}, [type, x, y]);
// n ticks; returns the runner's state and counts any tick where the runner stands inside something solid
const tick = (n) => p.evaluate((n) => { const d = window.__drive, f = d.foot, M = f.me; for (let i = 0; i < n; i++) { f.him.pause = 99; for (const q of d.world.crowd.people) if (Math.abs(q.s - M.s) < 40) q.s += 5000; d.tick(1 / 60); if (f.solidAt(M.x, M.y)) window.__bad++; }
  return { vx: M.vx, vy: M.vy, v: Math.hypot(M.vx, M.vy), x: M.x, y: M.y, yaw: f.camYaw, st: d.state, bad: window.__bad }; }, n);
const reset = () => p.evaluate(() => { const f = window.__drive.foot, M = f.me, s = window.__s0; Object.assign(M, { x: s.x, y: s.y, vx: 0, vy: 0, kvx: 0, kvy: 0, stun: 0 }); M.good = { x: s.x, y: s.y }; window.__drive.foot.camYaw = s.yaw; { const h = window.__drive.foot.him, h0 = window.__h0; Object.assign(h, { x: h0.x - 40 * Math.cos(s.yaw), y: h0.y - 40 * Math.sin(s.yaw), vx: 0, vy: 0, kvx: 0, kvy: 0 }); h.good = { x: h.x, y: h.y }; } });
const X = 195, Y = 600, ang = (v) => Math.atan2(v.vy, v.vx), D = 180 / Math.PI, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const R = { tag, errs, openSpot: await p.evaluate(() => window.__open) }; await reset();
// ---- first frame: touch down on the very first tick, drag up, it must run ----
await touch('touchStart', X, Y); await touch('touchMove', X, Y - 50); let r = await tick(1); R.firstFrame = { v: +r.v.toFixed(3) }; r = await tick(30);
R.firstFrame.v_after_0_5s = +r.v.toFixed(2); await touch('touchEnd', X, Y); await tick(60); await reset();
// ---- speed at each drag length (steady, 1.5 s) ----
R.speed = {};
for (const L of [4, 6, 8, 10, 15, 20, 22, 25, 30, 35, 40, 45, 50, 55, 60, 70]) {
  await reset(); await touch('touchStart', X, Y); await touch('touchMove', X, Y - L); r = await tick(60); R.speed[L] = +r.v.toFixed(2); await touch('touchEnd', X, Y); await tick(40);
}
// ---- time to 90% / 99% of the speed a full push gives, and time to stop ----
await reset(); await touch('touchStart', X, Y); await touch('touchMove', X, Y - 70); const vfull = (await tick(120)).v; await touch('touchEnd', X, Y); await tick(60); await reset();
await touch('touchStart', X, Y); await touch('touchMove', X, Y - 70); let t90 = null, t99 = null;
for (let i = 1; i <= 120; i++) { r = await tick(1); if (t90 === null && r.v >= 0.9 * vfull) t90 = i / 60; if (t99 === null && r.v >= 0.99 * vfull) t99 = i / 60; }
R.fullSpeed = +vfull.toFixed(2); R.t90 = t90; R.t99 = t99; await touch('touchEnd', X, Y); await tick(90); await reset();
// ---- a 5 px sideways wobble at full push (fingertip 5 px right of where it was, then back) ----
// raw stick angle comes from the finger; the heading of the velocity after 0.05 s and 0.5 s; camera yaw rate during the wobble
R.wobble = {};
for (const [name, dx] of [['5px right', 5], ['5px left', -5]]) {
  await reset(); await touch('touchStart', X, Y); await touch('touchMove', X, Y - 70); await tick(120);
  const a0 = ang(await tick(1)), yaw0 = (await tick(1)).yaw;
  await touch('touchMove', X + dx, Y - 70); const r1 = await tick(3), a1 = ang(r1); const r2 = await tick(27), a2 = ang(r2); const r3 = await tick(30);
  R.wobble[name] = { head_50ms_deg: +(wrap(a1 - a0) * D).toFixed(2), head_0_5s_deg: +(wrap(a2 - a0) * D).toFixed(2), yawRate_rad_s: +((r3.yaw - yaw0) / (63 / 60)).toFixed(3) };
  await touch('touchEnd', X, Y); await tick(60);
}
// camera yaw rate at the diagonal, full push, steady
await reset(); await touch('touchStart', X, Y); await touch('touchMove', X + 70, Y - 70); await tick(90); const y1 = (await tick(1)).yaw, y2 = (await tick(60)).yaw; R.camYawRateDiagonal_rad_s = +((y2 - y1) / (60 / 60)).toFixed(3);
await touch('touchEnd', X, Y); await tick(60);
// ---- the direction matrix: every direction, small and large, from rest; velocity direction relative to the camera (0 = away, +90 = screen-left) ----
R.matrix = [];
const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], upLeft: [-1, -1], upRight: [1, -1], downLeft: [-1, 1], downRight: [1, 1] };
for (const [name, [ux, uy]] of Object.entries(dirs)) for (const L of [10, 50]) {
  await reset(); const n = Math.hypot(ux, uy); await touch('touchStart', X, Y); await touch('touchMove', X + ux / n * L, Y + uy / n * L);
  const r = await tick(60), rel = wrap(ang(r) - r.yaw) * D;
  R.matrix.push({ dir: name, px: L, speed: +r.v.toFixed(2), relDeg: r.v < 0.05 ? null : +rel.toFixed(0), bad: r.bad });
  await touch('touchEnd', X, Y); const rs = await tick(60); R.matrix.at(-1).stopV = +rs.v.toFixed(2);
}
// hold 6 s each way (runs into things: nothing solid may be entered), tap, no input
let bad0 = (await tick(0)).bad;
for (const [name, [ux, uy]] of Object.entries(dirs)) { await reset(); await touch('touchStart', X, Y); await touch('touchMove', X + ux * 40, Y + uy * 40); const r = await tick(360); R['hold6s_' + name] = { moved_m: +Math.hypot(r.x - (await p.evaluate(() => window.__s0.x)), r.y - (await p.evaluate(() => window.__s0.y))).toFixed(1), bad: r.bad - bad0 }; bad0 = r.bad; await touch('touchEnd', X, Y); await tick(30); }
await reset(); await touch('touchStart', X, Y); await touch('touchEnd', X, Y); r = await tick(60); R.tap = { v: +r.v.toFixed(3) };
await reset(); r = await tick(60); R.noInput = { v: +r.v.toFixed(3) };
await reset(); await touch('touchStart', X, Y); await touch('touchMove', X, Y - 3); r = await tick(60); R.insideDeadZone3px = { v: +r.v.toFixed(3) }; await touch('touchEnd', X, Y);
R.wallViolations = (await tick(0)).bad;
console.log(JSON.stringify(R, null, 1));
await b.close();
