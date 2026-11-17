// Is a straight drive with no steering the same picture as before? (origin/main vs this branch)
//   node tools-steer/same.mjs <port> <comic|real> <out.jpg>
// ?qa&skipfoot, seeded Math.random, stepped by hand at 1/60 s: the countdown, then 6 s on the gas with no steering, then one frame saved.
// (Compare the two ports' pictures with tools-steer/same_diff.py.) With no ◀ ▶ the front wheels, the lean and the nose must be exactly as they were.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const PORT = +process.argv[2], LOOK = process.argv[3], OUT = process.argv[4];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 11; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot${LOOK === 'comic' ? '&look=comic' : ''}`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  const r = await page.evaluate(() => {
    const d = window.__drive; d.manual = true; d.freezeClock = true; const DT = 1 / 60;
    for (let i = 0; i < 400 && d.state !== 'driving'; i++) d.tick(DT);
    d.keys.add('gas'); for (let i = 0; i < 360; i++) d.tick(DT);
    return { look: document.querySelector('.drive-root').classList.contains('real') ? 'real' : 'comic', s: +d.car.s.toFixed(2), d: +d.car.d.toFixed(3), v: +d.car.v.toFixed(2), shot: d.snapshot(0.95) };
  });
  fs.writeFileSync(OUT, Buffer.from(r.shot.split(',')[1], 'base64'));
  console.log(PORT, JSON.stringify({ ...r, shot: undefined }), 'errors', JSON.stringify(errs.filter((l) => !/AudioContext|KHR_parallel/.test(l))));
} finally { await browser.close(); }
