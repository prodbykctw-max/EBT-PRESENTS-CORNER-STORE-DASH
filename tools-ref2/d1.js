const out = {};
await L.place(p, { s: 600, v: 0, settle: 60 });
const lineD = () => p.evaluate(() => { const D = window.__drive, G = D.guide, N = 47, i = 30, k = 0; const v = (k * N + i) * 2; const x = G.pos[v * 3], z = G.pos[v * 3 + 2]; const pr = D.route.project(x, -z); return { sampleS: +pr.s.toFixed(1), d: +pr.d.toFixed(2), carD: +D.car.d.toFixed(2), targetD: +D.car.targetD.toFixed(2), vis: G.lines.visible }; });
out.before = await lineD();
await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' })));
await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' })));
await L.ticks(p, 6);
out.after6 = await lineD();
await L.ticks(p, 60);
out.after66 = await lineD();
// HUD in the last seconds
out.hud = await p.evaluate(() => { const t = (s) => document.querySelector(s)?.textContent; return { time: t('.drive-time'), low: document.querySelector('.drive-time').classList.contains('low'), cp: t('.drive-cp'), pos: t('.drive-pos') }; });
return out;
