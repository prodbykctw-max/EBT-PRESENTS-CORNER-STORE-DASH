// the ?qa wheel check (integrity.js) with the BC fleet:  node scan.mjs <port> [query]
import { chromium } from 'playwright-core';
const PORT = +process.argv[2], Q = process.argv[3] ?? 'qa&skipfoot';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?${Q}`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
  const r = await page.evaluate(async () => {
    const d = window.__drive; d.manual = true; for (let i = 0; i < 90; i++) d.tick(1 / 60);
    const out = {};
    for (const s of [4, 150, 400, 700]) {   // a few places along the route: the cars near the player are the ones drawn
      d.car.s = s; for (let i = 0; i < 4; i++) d.tick(0.0005);
      const w = d.world, drawn = Object.fromEntries(Object.entries(w.meshes).filter(([k, m]) => m.count && /^(sedan|suv|police|robotaxi)/.test(k)).map(([k, m]) => [k, m.count]));
      const rep = (await import('/drive/integrity.js')).scanWorld(d);
      out[s] = { drawn, wheels: rep.summary.wheels, firstFails: rep.worst.wheels.slice(0, 4) };
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
} finally { await browser.close(); }
