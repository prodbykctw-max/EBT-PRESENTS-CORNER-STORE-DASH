// On-foot camera clearance: put the runner at many spots near the start (several facings, including right against walls), let the camera settle, and report
// the camera's distance behind the runner, how far it sits to the side of the runner's line, and how many spots leave the camera inside something solid.
// Usage: node tools-footctl/camclear.mjs <drive url ?qa> <tag>
import { chromium } from 'playwright-core';
const [url, tag] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await p.route(/open-meteo/, (r) => r.abort());
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
const R = await p.evaluate(() => { const d = window.__drive, f = d.foot, M = f.me, T = d.three; d.manual = true; const o = { x: M.x, y: M.y }, rows = []; const fails = []; let inside = 0, maxStep = 0, prev = null, n = 0, minDist = 99, maxSide = 0;
  for (let r = 0; r <= 36; r += 4) for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283, x = o.x + r * Math.cos(a), y = o.y + r * Math.sin(a); if (f.solidAt(x, y)) continue;
    for (const yaw of [0, 1.57, 3.14, -1.57]) { f.camYaw = yaw; Object.assign(M, { x, y, vx: 0, vy: 0, kvx: 0, kvy: 0 }); M.good = { x, y }; f.him.pause = 99; f.stick = { x: 0, y: 0 };
      for (let i = 0; i < 180; i++) { f.him.pause = 99; d.tick(1 / 60); }
      const c = T.camera.position, cx = c.x, cy = -c.z, dx = cx - M.x, dy = cy - M.y, back = -(dx * Math.cos(yaw) + dy * Math.sin(yaw)), side = -dx * Math.sin(yaw) + dy * Math.cos(yaw);
      n++;
      // a failure: the camera (a point with 0.1 m of room round it) is inside something solid, or a prop circle (raw radius, no padding; not the runner's own neighbours, 1.2 m) or a wall crosses the line runner -> camera
      let bad = f.walk.depth(cx, cy, 0.1) > 1e-6 || f.walk.inFootprint(cx, cy), why = bad ? 'camera in solid depth.25=' + f.walk.depth(cx, cy, 0.1).toFixed(2) + ' nearestCircleGap=' + (() => { let g = 99; const Cc = f.walk.circles; for (let k = 0; k < f.walk.nCir; k++) g = Math.min(g, Math.hypot(Cc[k * 3] - cx, Cc[k * 3 + 1] - cy) - Cc[k * 3 + 2]); return g.toFixed(2); })() + ' camY=' + c.y.toFixed(1) + ' footprint=' + f.walk.inFootprint(cx, cy) + ' runnerFootprint=' + f.walk.inFootprint(M.x, M.y) : '', L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L; const C = f.walk.circles;
      for (let i = 0; i < f.walk.nCir && !bad; i++) { const ox = C[i * 3] - M.x, oy = C[i * 3 + 1] - M.y, sp = ox * ux + oy * uy, e2 = ox * ox + oy * oy - sp * sp, Rr = C[i * 3 + 2]; if (e2 < Rr * Rr) { const h = Math.sqrt(Rr * Rr - e2); if (sp - h > f.cam.skip && sp - h < L) { bad = true; why = 'circle f=' + sp.toFixed(1) + ' R=' + Rr.toFixed(2); } } }
      if (!bad && f.walk.rayHit(M.x, M.y, ux, uy, L) < L) { bad = true; why = 'wall t=' + f.walk.rayHit(M.x, M.y, ux, uy, L).toFixed(1); }
      if (bad) { inside++; if (fails.length < 8) fails.push(why + ' camDist=' + L.toFixed(1)); } minDist = Math.min(minDist, Math.hypot(dx, dy)); maxSide = Math.max(maxSide, Math.abs(side)); } }
  return { spots: n, cameraBlocked: inside, minCameraDistFromRunner_m: +minDist.toFixed(2), maxSideOffset_m: +maxSide.toFixed(2), fails }; });
console.log(JSON.stringify({ tag, ...R })); await b.close();
