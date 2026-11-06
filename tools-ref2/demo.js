const port = 5731;
const out = [];
for (const demo of ['auburn','arrive']) {
  await p.goto(`http://localhost:${port}/drive/index.html?qa&demo=${demo}&rs=1`, { timeout: 900000, waitUntil: 'commit' });
  await p.waitForFunction(() => window.__drive && window.__drive.comic, null, { timeout: 2400000, polling: 500 });
  await p.waitForFunction(() => !document.querySelector('.drive-loading'), null, { timeout: 2400000, polling: 500 });
  await p.waitForTimeout(5000);
  const info = await p.evaluate(() => { const d = window.__drive; return { s: d.car.s, v: d.car.v, state: d.state, cam: d.three.camera.position.toArray().map(x=>+x.toFixed(2)), guide: !!d.guide }; });
  await p.screenshot({ path: `/home/claude/wt-ref2/tools-ref2/out/demo_${demo}.png`, timeout: 600000 });
  out.push([demo, info]);
}
return out;
