// boot probe: node probe.mjs <port> "<query>" <out.jpg>
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
const [port, query = 'qa&skipfoot', out = 'probe.jpg'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.addInitScript(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
const t0 = Date.now();
await page.goto(`http://localhost:${port}/drive/index.html?${query}`);
await page.waitForFunction(() => window.__drive && window.__drive.world, null, { timeout: 600000 });
console.log('booted in', (Date.now() - t0) / 1000, 's');
const info = await page.evaluate(() => { const d = window.__drive; return { state: d.state, car: { s: d.car.s, d: d.car.d }, route: d.route.length, people: d.world.crowd.people.length, tris: d.three.renderer.info.render.triangles, calls: d.three.renderer.info.render.calls }; });
console.log(JSON.stringify(info));
const url = await page.evaluate(() => { const d = window.__drive; d.manual = true; d.tick(1/60); return d.snapshot(0.9); });
(await import('node:fs')).writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
