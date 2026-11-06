// landscape overflow + on-foot vs driving widths + clearance
const R = (sel, up) => p.evaluate(({ sel, up }) => { let e = document.querySelector(sel); if (e && up) e = e.closest(up); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), x: Math.round(r.left) }; }, { sel, up });
const out = {};
await L.ticks(p, 90); await p.waitForTimeout(1500);
await p.addStyleTag({ content: '.drive-root.real .drive-rbar > *, .drive-root.real .drive-row2 > * { opacity: 1 !important; transform: none !important; }' });
await L.ticks(p, 6);
out.foot = { speed: await R('.drive-speed', '.rb-cell'), store: await R('.drive-dist', '.rb-cell'), race: await R('.drive-race') };
await p.evaluate(() => { const F = window.__drive.foot; F.me.s = F.doorS; F.me.d = F.doorD; F.me.ps = F.me.s; F.me.pd = F.me.d; });
await L.ticks(p, 150);
await p.evaluate(() => { const D = window.__drive; D.ui.setHint(''); D.race.s = D.car.s - 3; D.car.v = 11.2; });
out.drive = { speed: await R('.drive-speed', '.rb-cell'), store: await R('.drive-dist', '.rb-cell'), race: await R('.drive-race') };
const ov = () => p.evaluate(() => { const bad = []; for (const e of document.querySelectorAll('.drive-rhud .rb-cell, .drive-rhud .rb-cell b, .drive-rhud .rb-cell span, .drive-race, .drive-race .gap')) { if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) bad.push((e.className || e.tagName) + ':' + e.scrollWidth + '>' + e.clientWidth + ':' + e.textContent.slice(0, 14)); } const b = document.querySelector('.drive-speed'), c = b.closest('.rb-cell'), cs = c.getBoundingClientRect(), bs = b.getBoundingClientRect(); const st = document.querySelector('.drive-dist'), sc = st.closest('.rb-cell').getBoundingClientRect(), ss = st.getBoundingClientRect(); const kids = [...document.querySelectorAll('.drive-rhud .rb-cell')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }); return { speedText: b.textContent, speedTextW: Math.round(bs.width), speedCellW: Math.round(cs.width), storeText: st.textContent, storeTextW: Math.round(ss.width), storeCellW: Math.round(sc.width), overflowing: bad, rhudW: Math.round(document.querySelector('.drive-rhud').getBoundingClientRect().width), rhudB: Math.round(document.querySelector('.drive-rhud').getBoundingClientRect().bottom), vh: innerHeight }; });
out.land = {};
for (const [w, h] of [[568, 320], [640, 360], [667, 375], [844, 390], [390, 844]]) {
  await p.setViewportSize({ width: w, height: h }); await L.ticks(p, 8);
  await p.evaluate(() => { const D = window.__drive; D.car.v = 11.2; D.car.s = 1010; });
  await L.ticks(p, 4);
  out.land[w + 'x' + h] = await ov();
  if (w === 390) await L.shot(p, 'out/branch_final_390.png');
  if (w === 568 || w === 844) await L.shot(p, `out/branch_land_${w}.png`);
}
await p.setViewportSize({ width: 390, height: 844 }); await L.ticks(p, 8);
// clearance on the Luckie St climb at 20 m/s
out.climb = await p.evaluate(() => { const D = window.__drive, c = D.car, cam = D.three.camera.position; c.s = 5; c.d = c.targetD = D.route.lane(5, 0); D.keys.clear(); let min = 1e9, at = 0, maxStep = 0, last = null; for (let i = 0; i < 520; i++) { c.v = 20; D.tick(1 / 60); if (i > 90) { const cl = cam.y - D.route.ground(cam.x, -cam.z); if (cl < min) { min = cl; at = c.s; } if (last !== null) maxStep = Math.max(maxStep, Math.abs(cam.y - last)); last = cam.y; } } return { minClearance: +min.toFixed(2), atS: Math.round(at), endS: Math.round(c.s), maxCamYStepPerTick: +maxStep.toFixed(3) }; });
return out;
