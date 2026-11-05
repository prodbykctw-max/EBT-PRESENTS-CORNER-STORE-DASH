await p.setViewportSize({ width: 390, height: 844 });
const out = [];
await p.evaluate(() => { const D = window.__drive, c = D.car; c.s = 120; c.d = c.targetD = D.route.lane(120, 0); c.v = 0; D.keys.clear(); });
for (let k = 0; k < 8; k++) { await L.ticks(p, 30); const m = await L.measure(p); const e = await p.evaluate(() => { const D = window.__drive, cam = D.three.camera, r = D.three.carRig; return { camY: +cam.position.y.toFixed(2), rigY: +r.position.y.toFixed(2), pitch: +r.rotation.x.toFixed(3), carS: +D.car.s.toFixed(2), v: +D.car.v.toFixed(2), grd: +(D.route.ground(cam.position.x, -cam.position.z)).toFixed(2) }; }); out.push({ t: (k + 1) * 30, y0: +m.y0.toFixed(3), y1: +m.y1.toFixed(3), horizon: +m.horizon.toFixed(3), gap: +m.gap.toFixed(2), ...e }); }
return out;
