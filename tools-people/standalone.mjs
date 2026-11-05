// node tools-people/standalone.mjs <port> : /standalone.html -> TAP TO START -> START DRIVE: does the drive it loads draw the mix?
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
const port = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const logs = [], reqs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
page.on('request', (r) => { if (/people-/.test(r.url())) reqs.push(r.url().split('/').pop()); });
await page.goto(`http://localhost:${port}/standalone.html`);
await page.waitForSelector('#btnTitle', { timeout: 120000 });
await page.click('#btnTitle');
await page.waitForSelector('#btnDrive', { state: 'visible', timeout: 60000 });
await page.click('#btnDrive');
await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.world.crowd, null, { timeout: 900000 });
const r = await page.evaluate(() => { const c = window.__drive.world.crowd; return { kinds: c.alt ? c.alt.vs.map((v) => v.name) : 'old', meshes: c.alt ? c.alt.lods.map((l) => l.mesh.name) : null }; });
console.log(JSON.stringify(r), 'files:', reqs.join(','), 'console errors:', JSON.stringify(logs.filter((l) => /^(error|PAGEERROR)/.test(l))));
await browser.close();
