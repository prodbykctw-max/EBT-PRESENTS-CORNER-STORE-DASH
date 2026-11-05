return await p.evaluate(() => { const D = window.__drive, G = D.guide, lane = (s) => D.route.lane(s, 0); const out = {};
  for (const s0 of [300, 600, 1000]) { const t0 = Date.now(); const N = 3000; for (let i = 0; i < N; i++) G.update(true, s0 + (i % 50) * 0.3, lane(s0), lane); out['s' + s0] = +((Date.now() - t0) / N).toFixed(4); }
  const R = D.three.renderer; return { msPerUpdate: out, verts: G.lines.geometry.attributes.position.count }; });
