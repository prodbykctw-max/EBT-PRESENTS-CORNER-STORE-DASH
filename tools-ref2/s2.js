const which = '@WHICH@', BR = which === 'branch';
await L.ticks(p, 90);
await p.evaluate(() => { const F = window.__drive.foot; F.me.s = F.doorS; F.me.d = F.doorD; F.me.ps = F.me.s; F.me.pd = F.me.d; window.__drive.freezeClock = true; });
await L.ticks(p, 200);
const spotS = await p.evaluate(() => window.__drive.spot.s);
const hold = (s, v, n = 90) => p.evaluate(({ s, v, n }) => { const D = window.__drive, c = D.car; c.s = s; c.d = c.targetD = D.route.lane(s, 0); D.keys.clear(); for (let i = 0; i < n; i++) { c.v = v; D.tick(1 / 60); } }, { s, v, n });
const out = { cam: [] };
for (const v of [0, 20]) for (const s of [120, 182, 600, Math.round(spotS - 30)]) { await hold(s, v); const m = await L.measure(p); out.cam.push({ v, s, x0: +m.x0.toFixed(3), x1: +m.x1.toFixed(3), y0: +m.y0.toFixed(3), y1: +m.y1.toFixed(3), gap: +m.gap.toFixed(2), horizon: +m.horizon.toFixed(3) }); }
await hold(500, 20, 300);
out.gap20 = await p.evaluate(() => { const D = window.__drive, c = D.car, { camera, carRig } = D.three, g = []; for (let i = 0; i < 120; i++) { c.v = 20; D.tick(1 / 60); if (i % 6 === 0) g.push(+Math.hypot(camera.position.x - carRig.position.x, camera.position.z - carRig.position.z).toFixed(3)); } return { min: Math.min(...g), max: Math.max(...g) }; });
await p.waitForTimeout(3000);
await hold(600, 12); await L.shot(p, `out/${which}_drive_desktop.png`);
if (BR) {
  await hold(300, 0, 30);
  out.busted = await p.evaluate(() => { const D = window.__drive, c = D.car; const before = D.guide.lines.visible; D.world.add('police', { s: c.s + 5, d: c.d, v: 0, cruise: 0, dir: 1, color: 0xffffff }); let n = 0; while (D.state === 'driving' && n < 300) { c.v = 10; D.tick(1 / 60); n++; } for (let i = 0; i < 10; i++) D.tick(1 / 60); return { before, state: D.state, n, lines: D.guide.lines.visible, chev: D.guide.chev.visible }; });
}
return out;
