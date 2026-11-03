// a second drive in the same page (the store starts the drive again after BUSTED): are VEHICLE's sizes back to the defaults?   node vehicles.mjs <port>
import { chromium } from 'playwright-core';
const PORT = +process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [], reqs = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 200)); });
  page.on('request', (r) => { if (/\.cars|\/cars\.js/.test(r.url())) reqs.push(r.url().replace(/^.*\/drive\//, '')); });
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
  const snap = (tag) => page.evaluate(async (tag) => { const { VEHICLE } = await import('/drive/runner.js'); const w = window.__drive.world; return { tag, set: w.carSetName, sets: Object.keys(w.carSets), sedan: VEHICLE.sedan, suv: VEHICLE.suv, police: VEHICLE.police, robotaxi: VEHICLE.robotaxi }; }, tag);
  const out = [await snap('drive 1: BC default')];
  for (const [tag, q] of [['drive 2: ?cars=none', 'cars=none'], ['drive 3: BC again', ''], ['drive 4: ?look=comic', 'look=comic'], ['drive 5: ?cars=none', 'cars=none']]) {
    const before = reqs.length;
    await page.evaluate(async (q) => { const old = window.__drive; old.manual = true; history.replaceState(null, '', '/drive/index.html?qa&skipfoot' + (q ? '&' + q : '')); const m = await import('/drive/drive.js'); m.startDrive({ muted: true }); window.__old = old; }, q);
    await page.waitForFunction(() => window.__drive !== window.__old && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
    const s = await snap(tag); s.requestsDuringBoot = reqs.slice(before); out.push(s);
  }
  for (const o of out) console.log(JSON.stringify(o));
  console.log('LOGS', JSON.stringify(logs.filter((l) => !/AudioContext|KHR_parallel|429|open-meteo/.test(l))));
} finally { await browser.close(); }
