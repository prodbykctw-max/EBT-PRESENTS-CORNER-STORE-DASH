// comic-look pixel check: node comic.mjs <port> <out.jpg>   (same seed, same camera, frozen clock)
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const PORT = +process.argv[2], OUT = process.argv[3], Q = process.argv[4] || 'look=comic';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 1; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot&${Q}`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
  const url = await page.evaluate(() => {
    const d = window.__drive, TH = d.three.THREE; d.manual = true; d.freezeClock = true;
    for (let i = 0; i < 90; i++) d.tick(1 / 60);
    const at = (s, dd, h) => { const p = d.route.at(s, dd); return new TH.Vector3(p.x, p.z + h, -p.y); };
    const s0 = d.car.s + 204;
    d.camOverride = { pos: at(s0 - 4, d.route.lane(s0, 0), 3.0), look: at(s0 + 45, d.route.lane(s0 + 45, 0), 0.9) };
    for (let i = 0; i < 3; i++) d.tick(0.0005);
    return d.snapshot(0.95);
  });
  writeFileSync(OUT, Buffer.from(url.split(',')[1], 'base64'));
} finally { await browser.close(); }
