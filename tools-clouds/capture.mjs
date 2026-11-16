// Proof for the drifting title clouds. Loads the title on a phone (iPhone 13 size, DSF 2) and at 1280x720, freezes the scene's clock
// (TitleScene._seek) and grabs the canvas pixels at 0, 2, 4, 8 and 16 s after it settles, with the clouds on and (for the control) off.
// usage: node capture.mjs <outdir> [port]
import { chromium } from 'playwright-core';
import fs from 'fs';
const out = process.argv[2], port = process.argv[3] || 5489;
fs.mkdirSync(out, { recursive: true });
const TS = [0, 2, 4, 8, 16], T0 = 2.6;      // T0: the scene is settled (SETTLED 1.75 + 0.8)
const cfgs = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desk: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } };
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, c] of Object.entries(cfgs)) {
  const ctx = await br.newContext({ ...c, userAgent: 'Mozilla/5.0 (Linux; generic test client)' }); const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://localhost:${port}/standalone.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.TitleScene && TitleScene._art, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => { const cv = document.getElementById('titleScene'); return { w: cv.width, h: cv.height, art: TitleScene._art }; });
  console.log(name, info);
  for (const mode of ['on', 'off']) for (const dt of TS) {
    const data = await page.evaluate(({ t, mode }) => { TitleScene._seek(t); TitleScene._sign('orig', true); TitleScene._clouds(mode === 'on'); return document.getElementById('titleScene').toDataURL('image/png'); }, { t: T0 + dt, mode });
    fs.writeFileSync(`${out}/${name}_${mode}_${String(dt).padStart(2, '0')}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  await ctx.close();
}
await br.close();
