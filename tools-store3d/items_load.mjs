// flock /tmp/claude-browser.lock node tools-store3d/items_load.mjs
// The scanned pickups' loading, proved in a headless phone:
//  1. the game with ?store=3d: the 3D store reaches 'ready', items/items.glb was fetched and every pickup in ITEM_MODELS took its model;
//     a store run starts in 3D with no page errors
//  2. the game without ?store=3d: nothing under /store3d/ is requested (title -> store how-to-play -> START RUN)
//  3. the preview with items.glb refused: the store still reaches ready and every pickup keeps its procedural shape
import path from 'path'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5600 + Math.floor(Math.random() * 300), srv = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = {};
async function page() {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); p.errs = []; p.reqs = [];
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') p.errs.push('error: ' + m.text().slice(0, 300)); });
  p.on('request', (r) => { const u = r.url(); if (u.includes('/store3d/')) p.reqs.push(u.split(`:${PORT}`)[1]); });
  await p.route(/open-meteo|\/api\/scores/, (r) => /\/api\/scores/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"scores":[]}' }) : r.abort());
  return p;
}
async function game(q) {
  const p = await page();
  await p.goto(`http://localhost:${PORT}/standalone.html?nodrive${q}`);
  await p.waitForFunction(() => window.__csd && window.__csd.S && window.__csd.S.mode === 'title' && document.getElementById('ovTitle').classList.contains('on'), null, { timeout: 300000 });
  await p.waitForTimeout(3500);
  for (let i = 0; i < 60; i++) { await p.evaluate(() => document.getElementById('btnTitle').click()); if (await p.evaluate(() => window.__csd.S.mode === 'how')) break; await p.waitForTimeout(1000); }
  return p;
}
try {
  { // 1
    const p = await game('&store=3d');
    await p.waitForFunction(() => { const s = window.__csd.store3d; return s.state === 'ready' || s.state === 'failed'; }, null, { timeout: 900000 });
    const st = await p.evaluate(() => { const s = window.__csd.store3d; return { state: s.state, err: s.err, itemModels: s.st && s.st.itemModels, tops: s.st && Object.fromEntries(s.st.items.map((g) => [g.userData.id, +g.userData.top.toFixed(3)])) }; });
    await p.waitForTimeout(800);
    await p.evaluate(() => document.getElementById('btnStart').click());
    await p.waitForFunction(() => window.__csd.S.mode === 'play' || window.__csd.S.mode === 'run' || window.__csd.store3d.use, null, { timeout: 120000 }).catch(() => {});
    await p.waitForTimeout(4000);
    R.with3d = { ...st, use3d: await p.evaluate(() => window.__csd.store3d.use), mode: await p.evaluate(() => window.__csd.S.mode), requests: p.reqs.filter((u) => /\.(glb|json|js)/.test(u)), errs: p.errs };
    await p.close();
  }
  { // 2
    const p = await game('');
    await p.waitForTimeout(800); await p.evaluate(() => document.getElementById('btnStart').click()); await p.waitForTimeout(4000);
    R.without3d = { mode: await p.evaluate(() => window.__csd.S.mode), store3dRequests: p.reqs, errs: p.errs };
    await p.close();
  }
  { // 3
    const p = await page(); await p.route(/\/store3d\/items\/items\.glb/, (r) => r.abort());
    await p.goto(`http://localhost:${PORT}/store3d/index.html?loop=0&items=all`);
    await p.waitForFunction(() => window.__s3dReady || window.__s3dError, null, { timeout: 600000 });
    R.glbRefused = await p.evaluate(() => { const s = window.__s3d; return { ready: !!window.__s3dReady, error: window.__s3dError || null, itemModels: s.itemModels, shapes: Object.fromEntries(s.items.map((g) => [g.userData.id, g.userData.inner.children.map((m) => m.isMesh && m.material === s.mats.paint ? 'procedural' : 'model')])) }; });
    R.glbRefused.errs = p.errs.filter((e) => !/items\.glb|Failed to load resource/.test(e)); R.glbRefused.allErrs = p.errs;
    await p.close();
  }
} finally { await b.close(); srv.kill(); }
console.log(JSON.stringify(R, null, 1));
