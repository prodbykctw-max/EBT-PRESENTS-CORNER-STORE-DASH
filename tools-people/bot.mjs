// node tools-people/bot.mjs <port> : /drive/index.html?qa&bot with the mix (default) and with ?people=none; stepped at 1/30 s, no drawing between steps.
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
const port = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const port2 = process.argv[3];
for (const [pt, q] of [[port, 'qa&bot&skipfoot'], [port, 'qa&bot&skipfoot&people=none'], [port2, 'qa&bot&skipfoot'], [port, 'qa&bot'], [port2, 'qa&bot']]) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const logs = [], bad = [], reqs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().replace(/\?.*/, '')); });
  page.on('request', (r) => { if (/people-/.test(r.url())) reqs.push(r.url().split('/').pop()); });
  await page.addInitScript(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
  await page.goto(`http://localhost:${pt}/drive/index.html?${q}`);
  await page.waitForFunction(() => window.__drive && window.__drive.world, null, { timeout: 900000 });
  const t0 = Date.now();
  const r = await page.evaluate(() => {   // stepped at 1/30 s (the page's own frames would be minutes on software GL)
    const d = window.__drive; d.manual = true; let n = 0;
    for (; n < 8000; n++) { d.tick(1 / 30); if (['parked', 'late', 'busted', 'done'].includes(d.state) && n > 30) break; }
    return { state: d.state, steps: n, s: d.car.s, spotS: d.spot.s, hits: window.__botReport?.hits?.length, crowd: d.world.crowd.alt ? d.world.crowd.alt.lods.map((l) => l.mesh.name + ':' + l.mesh.count) : 'old' };
  });
  r.seconds = (Date.now() - t0) / 1000;
  console.log(pt === port2 ? 'MAIN' : 'branch', q, JSON.stringify(r), 'files:', reqs.join(','), 'http>=400:', JSON.stringify(bad), 'console errors:', JSON.stringify(logs.filter((l) => /^(error|PAGEERROR)/.test(l))));
  await page.close();
}
await browser.close();
