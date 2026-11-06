await L.ticks(p, 90);
const info = await p.evaluate(() => { const D = window.__drive; const t = (s) => document.querySelector(s)?.textContent; return { state: D.state, pos: t('.drive-pos'), time: t('.drive-time'), cp: t('.drive-cp'), dist: t('.drive-dist'), lbl: document.querySelector('.drive-dist')?.previousElementSibling?.textContent, speed: t('.drive-speed'), tok: t('.drive-tokens'), gap: t('.drive-race .gap'), real: document.querySelector('.drive-root').classList.contains('real'), guide: D.guide?.lines.visible, chev: D.guide?.chev?.visible };});
await L.shot(p, 'out/branch_foot_390.png');
return info;
