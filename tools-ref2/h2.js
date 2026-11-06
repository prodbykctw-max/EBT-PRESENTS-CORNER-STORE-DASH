const out = { v: {} };
await L.ticks(p, 90); await p.waitForTimeout(1500);
await p.addStyleTag({ content: '.drive-root.real .drive-rbar > *, .drive-root.real .drive-row2 > * { opacity: 1 !important; transform: none !important; }' });
await L.ticks(p, 6);
await p.evaluate(() => { const F = window.__drive.foot; F.me.s = F.doorS; F.me.d = F.doorD; F.me.ps = F.me.s; F.me.pd = F.me.d; });
await L.ticks(p, 150);
await p.evaluate(() => { const D = window.__drive; D.ui.setHint(''); D.race.s = D.car.s - 3; });
const hold = (s, v, n) => p.evaluate(({ s, v, n }) => { const D = window.__drive, c = D.car; c.s = s; c.d = c.targetD = D.route.lane(s, 0); D.keys.clear(); for (let i = 0; i < n; i++) { c.v = v; D.tick(1 / 60); } }, { s, v, n });
const probe = () => p.evaluate(() => {
  const rc = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
  const hud = [...document.querySelectorAll('.drive-rhud .rb-cell, .drive-race')].map((e) => ({ n: e.querySelector('b')?.className || e.className, ...rc(e) }));
  const btn = [...document.querySelectorAll('.horn, .brake, .gas, .drive-pausebtn, .drive-skip, .drive-steerpad .dp')].map((e) => ({ n: e.className.replace(/\s+/g, '.').slice(0, 24), ...rc(e) }));
  const hit = []; for (const h of hud) for (const b of btn) if (h.l < b.r && h.r > b.l && h.t < b.b && h.b > b.t) hit.push(h.n + ' x ' + b.n);
  const bad = []; for (const e of document.querySelectorAll('.drive-rhud .rb-cell, .drive-rhud .rb-cell b, .drive-rhud .rb-cell span, .drive-race, .drive-race .gap')) if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) bad.push((e.className || e.tagName) + ':' + e.scrollWidth + '>' + e.clientWidth + ':' + e.textContent.slice(0, 12));
  const rh = rc(document.querySelector('.drive-rhud'));
  return { hit, bad, rhud: rh, hudBox: hud.map((h) => [h.n, h.l, h.t, h.r, h.b].join(',')).slice(0, 8), btn: btn.filter((b) => /horn|pause|skip/.test(b.n)).map((b) => [b.n, b.l, b.t, b.r, b.b].join(',')) };
});
for (const [w, h] of [[568, 320], [640, 360], [667, 375], [844, 390], [390, 844], [320, 568]]) {
  await p.setViewportSize({ width: w, height: h }); await L.ticks(p, 8);
  await hold(600, 12, 130);
  const k = w + 'x' + h; out.v[k] = await probe(); const m = await L.measure(p); out.v[k].car = { x0: +m.x0.toFixed(3), x1: +m.x1.toFixed(3), y0: +m.y0.toFixed(3), y1: +m.y1.toFixed(3), gap: +m.gap.toFixed(2), camH: +m.camH.toFixed(2), fov: m.fov };
  await L.shot(p, `out/branch_land2_${w}x${h}.png`);
}
return out;
