// fixes session, skipfoot, clock frozen: drive shots, V6 info, climb clearance, hud before/after, hint, time text
const which = '@WHICH@', BR = which === 'branch';
const hold = (s, v, n = 90, d) => p.evaluate(({ s, v, n, d }) => { const D = window.__drive, c = D.car; c.s = s; c.d = c.targetD = d ?? D.route.lane(s, 0); D.keys.clear(); for (let i = 0; i < n; i++) { c.v = v; D.tick(1 / 60); } }, { s, v, n, d });
const info = () => p.evaluate(() => { const R = window.__drive.three.renderer, D = window.__drive, c = D.comic; D.city.cull(D.three.camera, D.three.scene.fog); R.info.autoReset = false; R.info.reset(); c.render(); const r = [R.info.render.calls, R.info.render.triangles]; R.info.autoReset = true; return { calls: r[0], tris: r[1], s: Math.round(D.car.s) }; });
const S = (name, clip) => L.shot(p, `out/${which}_${name}.png`, clip);
const out = {};
await p.waitForTimeout(1000);
await hold(600, 12); out.s600 = await info(); out.cam600 = await L.measure(p); await S('drive_390b');
if (BR) {
  out.hintDriving = await p.evaluate(() => { const D = window.__drive; D.ui.setHint('TAP LEFT OR RIGHT TO CHANGE LANE'); const h = document.querySelector('.drive-hint'), r = h.getBoundingClientRect(); return { rootClass: document.querySelector('.drive-root').className, top: Math.round(r.top), h: Math.round(r.height), vh: innerHeight }; });
  await S('hint_driving_390');
  await p.evaluate(() => window.__drive.ui.setHint(''));
  // HUD look: no blur (now) against the old 6 px blur at .72
  const clip = { x: 0, y: 0, width: 390, height: 150 };
  await S('hud_new', clip);
  const st = await p.addStyleTag({ content: '.drive-root.real .rb-cell, .drive-root.real .drive-race { background: rgba(10,12,16,.72) !important; -webkit-backdrop-filter: blur(6px) !important; backdrop-filter: blur(6px) !important; }' });
  await S('hud_old', clip);
  await p.evaluate((el) => 0, null); await p.evaluate(() => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('blur(6px) !important')) s.remove(); }); });
  // 320 x 568 drive
  await p.setViewportSize({ width: 320, height: 568 }); await L.ticks(p, 5);
  await hold(600, 12); out.cam600_320 = await L.measure(p); await S('drive_320');
  await p.setViewportSize({ width: 390, height: 844 }); await L.ticks(p, 5);
  // time text at 59.996 s
  out.timeTxt = await p.evaluate(() => { const D = window.__drive; const r = []; return 'see below'; });
}
// climb clearance at 20 m/s (Luckie St)
out.climb = await p.evaluate(() => { const D = window.__drive, c = D.car, cam = D.three.camera.position; c.s = 5; c.d = c.targetD = D.route.lane(5, 0); D.keys.clear(); let min = 1e9, at = 0, gap = [], mn = 0; for (let i = 0; i < 520; i++) { c.v = 20; D.tick(1 / 60); if (i > 90) { const cl = cam.y - D.route.ground(cam.x, -cam.z); if (cl < min) { min = cl; at = c.s; } } } return { minClearance: +min.toFixed(2), atS: Math.round(at), endS: Math.round(c.s) }; });
return out;
