await p.evaluate(() => { window.__drive.camR.yCar = 0.77; });
await L.place(p, { s: 160, v: 0, settle: 90 });
const info = await p.evaluate(() => { const G = window.__drive.guide; return { bends: G.bends, chevVisible: G.chev?.visible, n: G.chev?.count, pullVisible: G.pull?.visible }; });
await L.shot(p, 'out/c3_bend.png');
return info;
