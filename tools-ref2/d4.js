await L.ticks(p, 70);
return await p.evaluate(() => { const D = window.__drive, G = D.guide; return { state: D.state, lines: G.lines.visible, chev: G.chev.visible, time: document.querySelector('.drive-time').textContent, cp: document.querySelector('.drive-cp').textContent }; });
