const out = {};
await L.place(p, { s: 1060, v: 8, settle: 30 });
const g = () => p.evaluate(() => { const D = window.__drive, G = D.guide; const t = (s) => document.querySelector(s)?.textContent; return { state: D.state, s: +D.car.s.toFixed(1), lines: G.lines.visible, chev: G.chev.visible, cp: t('.drive-cp'), pos: t('.drive-pos'), time: t('.drive-time'), hint: t('.drive-hint') }; });
out.near = await g();
await p.evaluate(() => { const D = window.__drive, c = D.car; c.s = D.spot.s - 40; c.d = c.targetD = D.spot.d; c.v = 6; D.keys.clear(); });
await L.ticks(p, 20);
out.a40 = await g();
// let the car roll to the spot (brake held: it stops at the spot by itself)
for (let i = 0; i < 400 && (await p.evaluate(() => window.__drive.state)) === 'driving'; i += 10) await L.ticks(p, 10);
out.parked = await g();
await L.ticks(p, 30);
out.parked2 = await g();
return out;
