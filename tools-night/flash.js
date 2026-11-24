// node flash.js <base> <out> <query>: 60 frames, 0.05 s of game time apart (3 s at 20 fps), nobody steering (no bot): the camera holds still
const { chromium } = require('playwright'); const fs = require('fs');
const [base, out, q] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await p.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); });
  await p.route(/open-meteo/, (r) => r.abort());
  await p.goto(`${base}/drive/index.html?${q}`);
  await p.waitForFunction(() => window.__drive && window.__drive.tick, null, { timeout: 900000 });
  for (let i = 0; i < 60; i++) {
    const url = await p.evaluate(() => { const d = window.__drive; d.manual = true; for (let k = 0; k < 3; k++) d.tick(1 / 60); d.snapshot(0.5); return d.three.renderer.domElement.toDataURL('image/png'); });
    fs.writeFileSync(`${out}/f${String(i).padStart(2, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  await b.close();
})();
