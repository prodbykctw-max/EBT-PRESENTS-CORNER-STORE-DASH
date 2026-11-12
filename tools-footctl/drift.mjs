// "The runner pulls to the right": a thumb dropped at a point, dragged straight up and held (real TouchEvents on a phone-size viewport), 10 s on 1/60 s ticks.
// Reports, per second, the camera yaw, the heading of the velocity, and the lateral metres from the line the run started on (+ = right of the camera at the start),
// for a hold from the first frame, one after the camera has been swung right, and one after it was swung left. Also: where the ring is vs the finger, the pointer+touch pair.
// Usage: node tools-footctl/drift.mjs <drive url ?qa> <tag>
import { chromium } from 'playwright-core';
const [url, tag] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
await p.evaluate(() => { const d = window.__drive; d.manual = true; const m = d.foot.me; window.__s0 = { x: m.x, y: m.y, yaw: d.foot.camYaw }; window.__ev = []; });
const touch = (type, x, y) => p.evaluate(([type, x, y]) => {
  const target = (window.__tt && type !== 'touchStart') ? window.__tt : document.elementFromPoint(x, y); if (type === 'touchStart') window.__tt = target;
  const t = new Touch({ identifier: 1, target, clientX: x, clientY: y }), end = type === 'touchEnd';
  target.dispatchEvent(new TouchEvent(type.toLowerCase(), { bubbles: true, cancelable: true, touches: end ? [] : [t], targetTouches: end ? [] : [t], changedTouches: [t] }));
}, [type, x, y]);
const D = 180 / Math.PI, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const tick = (n) => p.evaluate((n) => { const d = window.__drive, f = d.foot, M = f.me; for (let i = 0; i < n; i++) { f.him.pause = 99; d.tick(1 / 60); } const T = d.three, v = new T.THREE.Vector3(); f.me.o.getWorldPosition(v); v.y += 0.9; v.project(T.camera); return { x: M.x, y: M.y, vx: M.vx, vy: M.vy, yaw: f.camYaw, sx: Math.round((v.x + 1) / 2 * innerWidth), sy: Math.round((1 - v.y) / 2 * innerHeight) }; }, n);
const X = 195, Y = 600, R = { tag };
import fs from 'fs'; const OUT = process.argv[4]; if (OUT) fs.mkdirSync(OUT, { recursive: true });
// where the ring is vs where the finger landed
await touch('touchStart', X, Y); R.ring = await p.evaluate(() => { const s = window.__drive.foot.drag; return { ax: s.ax, ay: s.ay, cx: s.cx, cy: s.cy }; });
// the pointer + touch pair a phone sends: a pointerdown (touch) must not start a second stick or move this one
R.pair = await p.evaluate(([X, Y]) => { const root = document.querySelector('.drive-root') || document.body, s = window.__drive.foot.drag; const before = [s.ax, s.ay];
  root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: X + 30, clientY: Y, button: 0 }));
  root.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', pointerId: 7, clientX: X + 30, clientY: Y - 40 }));
  const s2 = window.__drive.foot.drag; return { before, after: [s2.ax, s2.ay], moved: s2.cx !== X || s2.cy !== Y }; }, [X, Y]);
await touch('touchEnd', X, Y); await tick(30);
async function hold(label, setup) {
  const o = await p.evaluate(() => { const f = window.__drive.foot, M = f.me; return { x: M.x, y: M.y, yaw: f.camYaw }; });
  if (setup) await setup();
  const s = await p.evaluate(() => { const f = window.__drive.foot, M = f.me; return { x: M.x, y: M.y, yaw: f.camYaw }; });
  await touch('touchStart', X, Y); await touch('touchMove', X, Y - 40);
  const rows = []; let first = null;
  for (let sec = 1; sec <= 10; sec++) { const r = await tick(60); if (OUT && label === 'A_fromFirstFrame' && (sec === 1 || sec === 3 || sec === 5)) { const sh = await p.evaluate(() => window.__drive.snapshot(0.9)); fs.writeFileSync(`${OUT}/${tag}_straight_${sec}s.jpg`, Buffer.from(sh.split(',')[1], 'base64')); }
    const sp = Math.hypot(r.vx, r.vy);
    const dx = r.x - s.x, dy = r.y - s.y, fwd = dx * Math.cos(s.yaw) + dy * Math.sin(s.yaw), lat = dx * Math.sin(s.yaw) - dy * Math.cos(s.yaw);   // lat + = right of the line
    rows.push({ t: sec, speed: +sp.toFixed(2), headingVsStart_deg: +(wrap(Math.atan2(r.vy, r.vx) - s.yaw) * D).toFixed(2), camYawDelta_deg: +(wrap(r.yaw - s.yaw) * D).toFixed(2), along_m: +fwd.toFixed(1), lateral_m: +lat.toFixed(2), screenX: r.sx, screenY: r.sy }); }
  await touch('touchEnd', X, Y); await tick(60);
  R[label] = rows;
}
await hold('A_fromFirstFrame');
await hold('B_afterCameraSwungRight', async () => { await touch('touchStart', X, Y); await touch('touchMove', X + 40, Y - 40); await tick(90); await touch('touchEnd', X, Y); await tick(60); });
await hold('C_afterCameraSwungLeft', async () => { await touch('touchStart', X, Y); await touch('touchMove', X - 40, Y - 40); await tick(180); await touch('touchEnd', X, Y); await tick(60); });
console.log(JSON.stringify(R)); await b.close();
