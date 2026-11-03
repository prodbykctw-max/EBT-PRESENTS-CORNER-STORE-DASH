// the full game page: /standalone.html -> TAP TO START -> START DRIVE -> the drive; does BASE resolve cars/bc.cars from the store page?
//   node standalone.mjs <port> [query]
import { chromium } from 'playwright-core';
const PORT = +process.argv[2], Q = process.argv[3] ?? 'qa&skipfoot';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [], reqs = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 300)); });
  page.on('response', (r) => { if (/\.cars|\/cars\.js/.test(r.url())) reqs.push(r.status() + ' ' + r.url()); });
  await page.goto(`http://127.0.0.1:${PORT}/standalone.html?${Q}`);
  await page.click('#btnTitle'); await page.waitForSelector('#btnDrive', { state: 'visible' }); await page.click('#btnDrive');
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
  const r = await page.evaluate(() => { const w = window.__drive.world; return { set: w.carSetName, sets: Object.keys(w.carSets), meshes: Object.keys(w.meshes).filter((k) => /@BC/.test(k)).length, sedanB: w.ents.filter((e) => e.type === 'sedan' && w.carSet.pick('sedan', e.cid) === w.carSet.keys.sedanB).length, sedans: w.ents.filter((e) => e.type === 'sedan').length }; });
  console.log(JSON.stringify(r)); console.log('CARS RESPONSES', JSON.stringify(reqs)); console.log('LOGS', JSON.stringify(logs.filter((l) => !/AudioContext|KHR_parallel|429/.test(l))));
} finally { await browser.close(); }
