// shots for the sheets + V3 + V6 (clock frozen). Runs after s1b (in the car, clock frozen).
const which = '@WHICH@', BR = which === 'branch';
const hold = (s, v, n = 90, d) => p.evaluate(({ s, v, n, d }) => { const D = window.__drive, c = D.car; c.s = s; c.d = c.targetD = d ?? D.route.lane(s, 0); D.keys.clear(); for (let i = 0; i < n; i++) { c.v = v; D.tick(1 / 60); } }, { s, v, n, d });
const spotS = await p.evaluate(() => window.__drive.spot.s);
const out = { info: {} };
const info = () => p.evaluate(() => { const R = window.__drive.three.renderer, D = window.__drive, c = D.comic; D.city.cull(D.three.camera, D.three.scene.fog); R.info.autoReset = false; R.info.reset(); c.render(); const r = [R.info.render.calls, R.info.render.triangles]; R.info.autoReset = true; return { calls: r[0], tris: r[1], s: Math.round(D.car.s) }; });
const S = (name) => L.shot(p, `out/${which}_${name}.png`);
await hold(600, 12); out.info.s600 = await info(); await S('drive_390');
await hold(182, 12); out.info.s182 = await info(); await S('bend_390');
await hold(spotS - 30, 6, 60); out.info.near = await info(); await S('near_390');
for (const s of [1050, 1056, 1063]) { await hold(s, 8, 60); await S('over_' + s); }
await hold(700, 12, 60); await S('trees_700');
if (BR) {
  await hold(150, 12, 60); await S('v3_150');
  await hold(spotS - 60, 8, 60); await S('v3_spot60');
  await hold(spotS - 20, 4, 60); await S('v3_spot20');
  for (const h of [2.6, 3.3]) { await p.evaluate((h) => { window.__drive.camR.h = h; }, h); await hold(600, 12, 90); out.info['h' + h] = await L.measure(p); await S('h' + h); }
  await p.evaluate(() => { window.__drive.camR.h = 2.8; });
  await p.evaluate(() => { window.__drive.guide.cfg.pullin = true; });
  await hold(spotS - 48, 6, 60); await S('pullin');
  await hold(spotS - 36, 4, 60); await S('pullin2');
  await p.evaluate(() => { window.__drive.guide.cfg.pullin = false; });
  // V6: guide update time over 600 ticks
  out.guide = await p.evaluate(() => { const D = window.__drive, G = D.guide, c = D.car; c.s = 400; c.d = c.targetD = D.route.lane(400, 0); const m0 = G.ms, u0 = G.updates; for (let i = 0; i < 600; i++) { c.v = 12; D.tick(1 / 60); } return { updates: G.updates - u0, msPerUpdate: +((G.ms - m0) / (G.updates - u0)).toFixed(3) }; });
  // last ten seconds (clock runs from here, then freezes again)
  await hold(300, 0, 10);
  out.low = await p.evaluate(() => { const D = window.__drive; D.freezeClock = false; let n = 0; while (D.time > 9.2 && n < 6000 && D.state === 'driving') { D.tick(1 / 60); n++; } D.freezeClock = true; D.tick(1 / 60); return { n, time: D.time, state: D.state, txt: document.querySelector('.drive-time').textContent, low: document.querySelector('.drive-time').classList.contains('low') }; });
  await S('low10');
}
// parked: the car rolls up to the space and stops there
await p.evaluate((s) => { const D = window.__drive, c = D.car; c.s = s - 25; c.d = c.targetD = D.spot.d; c.v = 5; D.keys.clear(); D.keys.add('gas'); }, spotS);
for (let i = 0; i < 90 && (await p.evaluate(() => window.__drive.state)) === 'driving'; i++) await L.ticks(p, 10);
out.parkedState = await p.evaluate(() => { const D = window.__drive; const t = (s) => document.querySelector(s)?.textContent; return { state: D.state, s: D.car.s, spot: D.spot.s, cp: t('.drive-cp'), pos: t('.drive-pos'), lines: D.guide?.lines.visible, chev: D.guide?.chev?.visible }; });
await L.ticks(p, 100);
await S('parked_390');
return out;
