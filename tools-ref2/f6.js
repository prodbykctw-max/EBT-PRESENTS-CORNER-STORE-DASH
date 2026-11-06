const R = (sel, up) => p.evaluate(({ sel, up }) => { let e = document.querySelector(sel); if (e && up) e = e.closest(up); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; }, { sel, up });
await L.ticks(p, 90); await p.waitForTimeout(2000);
await p.evaluate(() => { const F = window.__drive.foot; F.me.s = F.doorS; F.me.d = F.doorD; F.me.ps = F.me.s; F.me.pd = F.me.d; });
await L.ticks(p, 150);
await p.evaluate(() => { const D = window.__drive; D.ui.setHint(''); D.race.s = D.car.s - 3; }); await L.ticks(p, 12);
await p.addStyleTag({ content: '.drive-root.real .drive-rbar > *, .drive-root.real .drive-row2 > * { opacity: 1 !important; transform: none !important; }' });
const out = { state: await p.evaluate(() => window.__drive.state), gapText: await p.evaluate(() => document.querySelector('.drive-race .gap').textContent) };
for (const [w, h] of [[390, 844], [375, 812], [370, 800], [360, 780], [320, 568]]) {
  await p.setViewportSize({ width: w, height: h }); await L.ticks(p, 6);
  const m = { race: await R('.drive-race'), track: await R('.drive-race .track'), gap: await R('.drive-race .gap'), ebt: await R('.drive-tokens', '.rb-cell'), speed: await R('.drive-speed', '.rb-cell'), store: await R('.drive-dist', '.rb-cell'), light: await R('.drive-light'), rhud: await R('.drive-rhud') };
  m.inline = m.race.y < m.ebt.b; m.gapSpillsLeft = m.inline ? m.gap.x < m.ebt.r + 4 : false; m.gapOverStoreFlag = m.gap.r > m.track.r - 40;
  out[w] = m;
  if (w === 390 || w === 320 || w === 360) await L.shot(p, `out/branch_tail2_${w}.png`);
}
await p.setViewportSize({ width: 390, height: 844 }); await L.ticks(p, 6);
out.jitter = await p.evaluate(async () => { const D = window.__drive, c = D.car, w = new Set(); await 0; for (const [v, s] of [[0, 100], [5, 990], [9.9, 1010], [10, 1100], [20, 400], [26, 20]]) { c.v = v; c.s = s; D.tick(1 / 60); const q = (x) => Math.round(document.querySelector(x).closest('.rb-cell').getBoundingClientRect().width); w.add(q('.drive-speed') + '/' + q('.drive-dist') + '/' + Math.round(document.querySelector('.drive-race .track').getBoundingClientRect().width)); } return [...w]; });
return out;
