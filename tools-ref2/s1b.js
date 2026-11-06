// get in the car, freeze the clock, camera sweep (V2) at 3 viewports
await p.evaluate(() => { const F = window.__drive.foot; F.me.s = F.doorS; F.me.d = F.doorD; F.me.ps = F.me.s; F.me.pd = F.me.d; window.__drive.freezeClock = true; });
await L.ticks(p, 200);
const spotS = await p.evaluate(() => window.__drive.spot.s);
const hold = (s, v, n = 90) => p.evaluate(({ s, v, n }) => { const D = window.__drive, c = D.car; c.s = s; c.d = c.targetD = D.route.lane(s, 0); D.keys.clear(); for (let i = 0; i < n; i++) { c.v = v; D.tick(1 / 60); } }, { s, v, n });
const out = {};
for (const [name, w, h] of [['390x844', 390, 844], ['320x568', 320, 568], ['844x390', 844, 390]]) {
  await p.setViewportSize({ width: w, height: h });
  out[name] = [];
  for (const v of [0, 20]) for (const s of [120, 182, 600, Math.round(spotS - 30)]) {
    await hold(s, v);
    const m = await L.measure(p); out[name].push({ v, s, x0: +m.x0.toFixed(3), x1: +m.x1.toFixed(3), y0: +m.y0.toFixed(3), y1: +m.y1.toFixed(3), gap: +m.gap.toFixed(2), horizon: +m.horizon.toFixed(3), behind: m.behind });
  }
}
// camera gap over 2 s at 20 m/s
await p.setViewportSize({ width: 390, height: 844 });
await hold(500, 20, 60);
out.gap20 = await p.evaluate(() => { const D = window.__drive, c = D.car, { camera, carRig } = D.three, g = []; for (let i = 0; i < 120; i++) { c.v = 20; D.tick(1 / 60); if (i % 6 === 0) g.push(+Math.hypot(camera.position.x - carRig.position.x, camera.position.z - carRig.position.z).toFixed(3)); } return { min: Math.min(...g), max: Math.max(...g), g }; });
return out;
