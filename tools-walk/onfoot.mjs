// On-foot play-through with the thumb stick on the wide sidewalks: node tools-walk/onfoot.mjs <port> [query=qa]
// Drags the stick in 8 directions (long holds, so you hit the facade, the curb and the trees), records where you stand (world x, y) every few ticks, then checks in node:
// never inside a building footprint (W.buildings after the set-back, hero row by its front line), and not stuck (the position moved in every push that had room).
import { chromium } from 'playwright-core'; import fs from 'fs';
import { loadCityNode } from '../tools-roam/node-world.mjs';
const PORT = +process.argv[2], Q = process.argv[3] || 'qa';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => { let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/open-meteo/, (r) => r.abort());
await p.goto(`http://127.0.0.1:${PORT}/drive/index.html?${Q}`);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
await p.evaluate(() => { window.__drive.manual = true; });
let down = null;
const touch = (type, pts) => p.evaluate(([type, pts, prev]) => {
  const [x, y] = pts[0] || prev; const target = (window.__tt && type !== 'touchStart') ? window.__tt : document.elementFromPoint(x, y);
  if (type === 'touchStart') window.__tt = target;
  const t = new Touch({ identifier: 1, target, clientX: x, clientY: y });
  const ev = new TouchEvent(type.toLowerCase(), { bubbles: true, cancelable: true, touches: type === 'touchEnd' ? [] : [t], targetTouches: type === 'touchEnd' ? [] : [t], changedTouches: [t] });
  target.dispatchEvent(ev);
}, [type, pts, down]).then(() => { if (pts[0]) down = pts[0]; });
const pos = (n) => p.evaluate((n) => { const d = window.__drive, T = d.three, v = new T.THREE.Vector3(), out = []; for (let i = 0; i < n; i++) { d.tick(1 / 60); if (d.state !== 'onfoot') break; if (i % 6 === 5) { d.foot.me.o.getWorldPosition(v); out.push([+v.x.toFixed(2), +(-v.z).toFixed(2)]); } } return { st: d.state, out }; }, n);
const X = 200, Y = 600, R = 40, path = [], runs = [];
await touch('touchStart', [[X, Y]]);
for (let rep = 0; rep < 2; rep++) for (let k = 0; k < 8; k++) {
  const a = k * Math.PI / 4; await touch('touchMove', [[X + R * Math.sin(a), Y - R * Math.cos(a)]]);
  const r = await pos(150); runs.push({ dir: k, st: r.st, n: r.out.length, moved: r.out.length ? Math.hypot(r.out.at(-1)[0] - r.out[0][0], r.out.at(-1)[1] - r.out[0][1]) : 0, end: r.out.at(-1) }); path.push(...r.out);
  if (r.st !== 'onfoot') break;
}
await touch('touchEnd', []); await b.close();
const N = await loadCityNode(); const { W } = N;
const inPoly = (x, y, q) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const [xi, yi] = q[i], [xj, yj] = q[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
let inside = 0; const hits = [];
for (const [x, y] of path) for (const bd of W.buildings) { if (bd.canopy || bd.minH > 2.5) continue; if (inPoly(x, y, bd.pts)) { inside++; hits.push([x, y, bd.id]); break; } }
const xs = path.map((q) => q[0]), ys = path.map((q) => q[1]);
console.log(JSON.stringify({ port: PORT, samples: path.length, insideBuildings: inside, hits: hits.slice(0, 5), x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)], heroFront: N.heroMove && N.heroMove.front, runs, errs: errs.slice(0, 3) }));
