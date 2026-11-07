// Sideways and backing up on foot with the bully held far back: how fast you cross, how far you slide after the thumb
// lifts, whether you turn and run (animation) when moving straight across. Same in-page touches as drag.mjs.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/open-meteo/, (r) => r.abort());
await p.goto(process.argv[2]);
await p.waitForFunction(() => window.__drive && window.__drive.foot, null, { timeout: 900000 });
await p.waitForTimeout(1500);
await p.evaluate(() => { window.__drive.manual = true; });
let down = null;
const touch = (type, pts) => p.evaluate(([type, pts, prev]) => {
  const [x, y] = pts[0] || prev; const target = (window.__tt && type !== 'touchStart') ? window.__tt : document.elementFromPoint(x, y);
  if (type === 'touchStart') window.__tt = target;
  const t = new Touch({ identifier: 1, target, clientX: x, clientY: y });
  target.dispatchEvent(new TouchEvent(type.toLowerCase(), { bubbles: true, cancelable: true, touches: type === 'touchEnd' ? [] : [t], changedTouches: [t] }));
}, [type, pts, down]).then(() => { if (pts[0]) down = pts[0]; });
const tick = (n) => p.evaluate((n) => { const d = window.__drive, f = d.foot, M = f.me; for (let i = 0; i < n; i++) { f.him.s = Math.min(f.him.s, M.s - 25); d.tick(1 / 60); }
  const yawOff = Math.atan2(Math.sin(M.yaw - d.route.at(M.s).a), Math.cos(M.yaw - d.route.at(M.s).a)) * 180 / Math.PI;
  return { s: +M.s.toFixed(2), d: +M.d.toFixed(3), v: +M.v.toFixed(2), dv: +(M.dv || 0).toFixed(2), yawOff: Math.round(yawOff), runW: +M.act.run.getEffectiveWeight().toFixed(2), standW: +M.act.stand.getEffectiveWeight().toFixed(2), stun: +(M.stun||0).toFixed(2) }; }, n);
const log = (l, r) => console.log(l.padEnd(30), JSON.stringify(r));
// run up to open sidewalk first (s ~ 22, between the trees at 18 and 32)
await touch('touchStart', [[200, 600]]); await touch('touchMove', [[200, 560]]); log('run up', await tick(70));
await touch('touchMove', [[200, 600]]); log('stop (thumb back to centre)', await tick(30));
const X = 200, Y = 600;
await touch('touchMove', [[X - 40, Y]]); log('left only 0.25s', await tick(15)); log('left only 0.5s', await tick(15));
await touch('touchEnd', []); const a = await tick(1); log('thumb up', a); const z = await tick(60); log('1 s later', z);
console.log('slide after release (m):', Math.abs(z.d - a.d).toFixed(3));
await touch('touchStart', [[X, Y]]); await touch('touchMove', [[X + 40, Y]]); log('right only 0.5s', await tick(30));
await touch('touchEnd', []); const a2 = await tick(1); const z2 = await tick(60); console.log('slide after release (m):', Math.abs(z2.d - a2.d).toFixed(3));
await touch('touchStart', [[X, Y]]); await touch('touchMove', [[X, Y + 40]]); log('down (back up) 1s', await tick(60));
await touch('touchEnd', []); log('released', await tick(30));
console.log('errors', JSON.stringify(errs));
await b.close();
