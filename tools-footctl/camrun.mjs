// A straight run (real touch, drag straight up and held, from the first frame) with the on-foot camera watched every 1/60 s tick: the biggest step the camera takes in one frame, its distance to
// the runner, how many ticks a prop circle (raw radius) or wall stood between camera and runner, and stills at 1 / 3 / 5 s. Usage: node tools-footctl/camrun.mjs <drive url ?qa> <tag> <out dir>
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, tag, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage(); await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
await p.evaluate(() => { window.__drive.manual = true; });
const touch = (type, x, y) => p.evaluate(([type, x, y]) => { const target = (window.__tt && type !== 'touchStart') ? window.__tt : document.elementFromPoint(x, y); if (type === 'touchStart') window.__tt = target;
  const t = new Touch({ identifier: 1, target, clientX: x, clientY: y }), end = type === 'touchEnd';
  target.dispatchEvent(new TouchEvent(type.toLowerCase(), { bubbles: true, cancelable: true, touches: end ? [] : [t], targetTouches: end ? [] : [t], changedTouches: [t] })); }, [type, x, y]);
await touch('touchStart', 195, 600); await touch('touchMove', 195, 560);
const shots = [];
const R = await p.evaluate(() => { const d = window.__drive, f = d.foot, M = f.me, c = d.three.camera, C = f.walk.circles; let prev = null, maxStep = 0, blocked = 0, minDist = 99, maxDist = 0, maxSide = 0; const rows = [], at = {};
  for (let i = 1; i <= 600; i++) { f.him.pause = 99; d.tick(1 / 60);
    const cx = c.position.x, cy = -c.position.z, cz = c.position.y; if (prev) maxStep = Math.max(maxStep, Math.hypot(cx - prev.x, cy - prev.y, cz - prev.z)); prev = { x: cx, y: cy, z: cz };
    const dx = cx - M.x, dy = cy - M.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L; minDist = Math.min(minDist, L); maxDist = Math.max(maxDist, L);
    let bad = f.walk.depth(cx, cy, 0.1) > 1e-6 || f.walk.inFootprint(cx, cy); for (let k = 0; k < f.walk.nCir && !bad; k++) { const ox = C[k * 3] - M.x, oy = C[k * 3 + 1] - M.y, sp = ox * ux + oy * uy, e2 = ox * ox + oy * oy - sp * sp, Rr = C[k * 3 + 2]; if (e2 < Rr * Rr) { const h = Math.sqrt(Rr * Rr - e2); if (sp - h > f.cam.skip && sp - h < L) bad = true; } }
    if (!bad && f.walk.rayHit(M.x, M.y, ux, uy, L) < L) bad = true; if (bad) blocked++;
    const fx = Math.cos(f.camYaw), fy = Math.sin(f.camYaw); maxSide = Math.max(maxSide, Math.abs(-dx * fy + dy * fx));
    if (i % 60 === 0) rows.push({ t: i / 60, camDist: +L.toFixed(2), v: +Math.hypot(M.vx, M.vy).toFixed(2), blockedSoFar: blocked }); if (i === 60 || i === 180 || i === 300) at[i / 60] = d.snapshot(0.9); }
  return { maxCameraStepPerFrame_m: +maxStep.toFixed(3), minDistToRunner_m: +minDist.toFixed(2), maxDistToRunner_m: +maxDist.toFixed(2), maxSideOffset_m: +maxSide.toFixed(2), ticksBlocked: blocked, rows, at }; });
for (const [k, v] of Object.entries(R.at)) fs.writeFileSync(`${out}/${tag}_run_${k}s.jpg`, Buffer.from(v.split(',')[1], 'base64')); delete R.at;
console.log(JSON.stringify({ tag, ...R })); await b.close();
