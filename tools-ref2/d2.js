await L.ticks(p, 1800);
const hud = await p.evaluate(() => { const D = window.__drive; const t = (s) => document.querySelector(s)?.textContent; return { state: D.state, time: t('.drive-time'), low: document.querySelector('.drive-time').classList.contains('low'), cp: t('.drive-cp'), pos: t('.drive-pos'), posHot: document.querySelector('.drive-pos').closest('.rb-cell').classList.contains('hot'), hits: D.result.hits }; });
await L.shot(p, 'out/d2_low.png', { x: 0, y: 0, width: 390, height: 200 });
return hud;
