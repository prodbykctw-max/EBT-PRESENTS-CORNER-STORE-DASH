// Drive the on-foot run with real touch drags (CDP touch events, phone emulation), on fixed 1/60 s ticks, and report
// how you move: speed along the street (v), across it (d), the chosen line, whether the ring shows, and the pedals.
// Usage: node tools-footctl/drag.mjs <drive url>
import { chromium } from 'playwright-core';
const [url] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
await p.waitForTimeout(1500);
await p.evaluate(() => { window.__drive.manual = true; });
// Touches are dispatched in the page to the element under the finger, the way the browser delivers them (headless
// Chrome here stalls its animation frames, and it holds real touchmove events back until a frame is drawn, which a
// phone does 60 times a second)
let down = null;
const touch = (type, pts) => p.evaluate(([type, pts, prev]) => {
  const [x, y] = pts[0] || prev; const target = (window.__tt && type !== 'touchStart') ? window.__tt : document.elementFromPoint(x, y);
  if (type === 'touchStart') window.__tt = target;
  const t = new Touch({ identifier: 1, target, clientX: x, clientY: y });
  const ev = new TouchEvent(type.toLowerCase(), { bubbles: true, cancelable: true, touches: type === 'touchEnd' ? [] : [t], targetTouches: type === 'touchEnd' ? [] : [t], changedTouches: [t] });
  target.dispatchEvent(ev);
}, [type, pts, down]).then(() => { if (pts[0]) down = pts[0]; });
const tick = (n) => p.evaluate((n) => { const d = window.__drive; for (let i = 0; i < n; i++) d.tick(1 / 60); const f = d.foot, ring = document.querySelector('.drive-stick'); const pads = [...document.querySelectorAll('.drive-pad')].map((e) => getComputedStyle(e).display);
  const M = f.me; return { st: d.state, s: +M.s.toFixed(2), d: +M.d.toFixed(2), v: +M.v.toFixed(2), blk: M.blocked ? 1 : 0, stun: +(M.stun||0).toFixed(2), hitT: +(M.hitT||0).toFixed(2), tg: M.tg === undefined ? null : +M.tg.toFixed(2), L1: M.L1 === undefined ? null : +M.L1.toFixed(2), dv: +(M.dv||0).toFixed(2), him: +f.him.s.toFixed(2), side: f.side === null ? null : +f.side.toFixed(2), ring: ring ? ring.classList.contains('on') : 'none', pads }; }, n);
const log = (label, r) => console.log(label.padEnd(34), JSON.stringify(r));
log('start', await tick(1));
const X = 200, Y = 600;
await touch('touchStart', [[X, Y]]); log('thumb down (no drag)', await tick(20));
await touch('touchMove', [[X, Y - 4]]); log('drag up 4 px (dead zone)', await tick(30));
await touch('touchMove', [[X, Y - 12]]); log('drag up 12 px (part speed)', await tick(60));
await touch('touchMove', [[X, Y - 40]]); log('drag up 40 px (full)', await tick(90));
await touch('touchMove', [[X - 40, Y - 40]]); log('drag up-left', await tick(60));
await touch('touchMove', [[X + 40, Y - 40]]); log('drag up-right', await tick(60));
await touch('touchMove', [[X + 40, Y]]); log('drag right only', await tick(60));
await touch('touchMove', [[X, Y + 40]]); log('drag down (back up)', await tick(60));
await touch('touchEnd', []); log('thumb up', await tick(40));
// keyboard, like the store's arrows
await p.keyboard.down('ArrowUp'); log('ArrowUp held', await tick(60));
await p.keyboard.down('ArrowLeft'); log('ArrowUp+Left held', await tick(40));
await p.keyboard.up('ArrowLeft'); await p.keyboard.up('ArrowUp'); log('keys up', await tick(40));
// run to the car with a held drag, then check the pedals come back and nothing is stuck
await touch('touchStart', [[X, Y]]); await touch('touchMove', [[X, Y - 40]]);
let r; for (let i = 0; i < 40; i++) { r = await tick(30); if (r.st !== 'onfoot') break; }
log('held up to the car', r);
const keys = await p.evaluate(() => [...window.__drive.keys]);
log('in the car: keys held by the game', keys);
await touch('touchEnd', []); log('thumb up in the car', await tick(30));
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await b.close();
