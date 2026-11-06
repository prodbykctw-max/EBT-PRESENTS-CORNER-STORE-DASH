await p.evaluate(() => { const F = window.__drive.foot; F.me.s = F.doorS; F.me.d = F.doorD; F.me.ps = F.me.s; F.me.pd = F.me.d; });
await L.ticks(p, 30);
const st = await p.evaluate(() => { const D = window.__drive; const t = (s) => document.querySelector(s)?.textContent; return { state: D.state, pos: t('.drive-pos'), cp: t('.drive-cp'), carS: D.car.s, spotS: D.spot.s, race: !!D.race, guide: D.guide.lines.visible }; });
await L.ticks(p, 120);
const out = [];
for (const v of [0, 20]) for (const s of [120, 182, 600, Math.round(st.spotS - 30)]) {
  await L.place(p, { s, v, settle: 90 });
  const m = await L.measure(p); out.push({ v, s, ...Object.fromEntries(Object.entries(m).map(([k, x]) => [k, typeof x === 'number' ? +x.toFixed(3) : x])) });
}
return { st, out };
