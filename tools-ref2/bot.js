// live bot run: waits until the end overlay shows; returns the report
await p.evaluate(() => { const d = window.__drive; d.three.renderer.setPixelRatio(0.35); d.comic.resize(); });
const t0 = Date.now(); let st;
for (;;) {
  await p.waitForTimeout(10000);
  st = await p.evaluate(() => ({ disp: document.getElementById('done')?.style.display, state: window.__drive?.state, time: window.__drive?.time, s: window.__drive?.car.s }));
  if (st.disp === 'grid' || (Date.now() - t0) > 3300000) break;
}
const rep = await p.evaluate(() => { try { return JSON.parse(document.getElementById('dr').textContent); } catch (e) { return { err: String(e), raw: document.getElementById('dr')?.textContent?.slice(0, 500) }; } });
return { st, wall: (Date.now() - t0) / 1000, rep };
