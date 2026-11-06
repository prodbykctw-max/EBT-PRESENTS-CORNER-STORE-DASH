const out = [];
for (const y of [0.78, 0.76]) { await p.evaluate((y) => { window.__drive.camR.yCar = y; }, y);
  for (const v of [0, 20]) for (const s of [182, 600]) {
    await p.evaluate(({ s, v }) => { const D = window.__drive, c = D.car; c.s = s; c.d = c.targetD = D.route.lane(s, 0); c.v = v; D.keys.clear(); }, { s, v });
    for (let i = 0; i < 90; i++) await p.evaluate((v) => { window.__drive.car.v = v; window.__drive.tick(1 / 60); }, v);
    const m = await L.measure(p); out.push([y, v, s, +m.x0.toFixed(2), +m.x1.toFixed(2), +m.y0.toFixed(2), +m.y1.toFixed(2), +m.gap.toFixed(2), +m.horizon.toFixed(2)]); } }
return out;
