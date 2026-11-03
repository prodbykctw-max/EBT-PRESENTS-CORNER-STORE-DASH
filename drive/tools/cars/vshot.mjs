// node vshot.mjs <port> <file.cars rel to /drive/> <outprefix> <json list of views>
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const [PORT, FILE, PFX, VIEWS, ROLE] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await page.goto(`http://127.0.0.1:${PORT}/drive/_viewer.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  console.log('roles', await page.evaluate((f) => window.load(f), `http://127.0.0.1:${PORT}/drive/${FILE}`));
  const views = JSON.parse(VIEWS);
  for (let i = 0; i < views.length; i++) {
    const r = await page.evaluate((v) => window.view(v), { role: ROLE || 'sedan', ...views[i] });
    writeFileSync(`${PFX}-${i}.jpg`, Buffer.from(r.url.split(',')[1], 'base64')); console.log(i, r.tris, r.calls);
  }
} finally { await browser.close(); }
