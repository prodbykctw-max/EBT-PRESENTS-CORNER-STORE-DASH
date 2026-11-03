// the switches around the BC default.  node modes.mjs <port> <none|fail|comic|bc>
//   none  ?cars=none   -> the props.glb cars, no .cars request
//   fail  the .cars request is aborted -> the drive still starts with the props.glb cars, one warning
//   comic ?look=comic  -> no .cars request, no car set built
//   bc    no ?cars     -> the BC fleet
import { chromium } from 'playwright-core';
const PORT = +process.argv[2], MODE = process.argv[3];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [], reqs = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 1; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  if (process.env.NORAF) await ctx.addInitScript(() => { window.requestAnimationFrame = () => 0; });   // no live frames: the world stays exactly as built until the test steps it (NORAF=1)
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 300)); });
  page.on('request', (r) => { if (/\.cars/.test(r.url())) reqs.push(r.url()); });
  if (MODE === 'fail') await page.route('**/*.cars', (r) => r.abort());
  const q = { none: 'cars=none', fail: '', comic: 'look=comic', bc: '' }[MODE];
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot${q ? '&' + q : ''}`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
  const r = await page.evaluate(() => {
    const d = window.__drive, w = d.world; d.manual = true;
    const fp = () => { let h = 0; for (const e of w.ents) { const str = e.type + ':' + e.s.toFixed(1) + ':' + e.d.toFixed(1); for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0; } return h + '/' + w.ents.length + '/' + w.ambient.length; };
    const fp0 = fp(); for (let i = 0; i < 60; i++) d.tick(1 / 40);
    const dump = w.ents.map((e) => [e.type, +e.s.toFixed(2), +e.d.toFixed(2), !!e.parked, e.v]);
    return { dump, fp0, fp1: fp(), state: d.state, set: w.carSetName, sets: Object.keys(w.carSets), carMeshes: Object.keys(w.meshes).filter((k) => /@/.test(k)).length, drawn: Object.fromEntries(Object.entries(w.meshes).filter(([k, m]) => m.count && /^(sedan|suv|police|robotaxi)/.test(k)).map(([k, m]) => [k, m.count])), look: document.querySelector('canvas') ? 'canvas' : 'none' };
  });
  if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, JSON.stringify(r.dump)); delete r.dump;
  console.log(MODE, JSON.stringify(r)); console.log('CARS REQUESTS', JSON.stringify(reqs)); console.log('LOGS', JSON.stringify(logs.filter((l) => !/AudioContext|KHR_parallel|429/.test(l))));
} finally { await browser.close(); }
