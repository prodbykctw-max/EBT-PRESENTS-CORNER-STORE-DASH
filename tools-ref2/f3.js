// ?look=comic gating: old HUD, old camera
const which = '@WHICH@';
const hold = (s, v, n = 90, d) => p.evaluate(({ s, v, n, d }) => { const D = window.__drive, c = D.car; c.s = s; c.d = c.targetD = d ?? D.route.lane(s, 0); D.keys.clear(); for (let i = 0; i < n; i++) { c.v = v; D.tick(1 / 60); } }, { s, v, n, d });
await p.waitForTimeout(3000);
await hold(600, 12);
const out = await p.evaluate(() => { const root = document.querySelector('.drive-root'); return { rootClass: root.className, rhud: !!document.querySelector('.drive-rhud'), boxes: document.querySelectorAll('.drive-box').length, timeTxt: document.querySelector('.drive-time').textContent, guide: !!window.__drive.guide, cam: window.__drive.three.camera.position.toArray().map((x) => +x.toFixed(3)) }; });
out.m = await L.measure(p);
await L.shot(p, `out/${which}_comic_390.png`);
return out;
