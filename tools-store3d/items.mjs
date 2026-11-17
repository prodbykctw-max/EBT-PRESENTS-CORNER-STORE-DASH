// flock /tmp/claude-browser.lock node tools-store3d/items.mjs <outDir> [tag]
// Renders each of the seven pickups in the 3D store preview (public/store3d/index.html?items=<ID>) from the game's own overhead
// camera on a 390 x 844 phone (dpr 2), with the player standing beside it (no bully), and saves a crop around the item:
// <outDir>/<tag>_<ID>.png. Prints per item: draw calls, triangles, the item's own triangle count, and the frame with every item shown.
// S3D_ROOT=<checkout> serves another checkout (a before/after).
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
const ROOT = process.env.S3D_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || '.'), tag = process.argv[3] || 'shot'; fs.mkdirSync(out, { recursive: true });
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/store3d/layout.json'), 'utf8'));
const PORT = 5600 + Math.floor(Math.random() * 300), srv = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const res = {};
try {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }), errs = [], reqs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  p.on('request', (r) => { if (r.url().includes('/store3d/items/')) reqs.push(r.url().split('/store3d/')[1]); });
  for (const it of layout.items) {
    const q = `items=${encodeURIComponent(it.id)}&px=${it.x + 110}&py=${it.y + 40}&bully=0&face=L`;
    await p.goto(`http://localhost:${PORT}/store3d/index.html?loop=0&${q}`);
    await p.waitForFunction(() => window.__s3dReady || window.__s3dError, null, { timeout: 600000 });
    const r = await p.evaluate((id) => {
      if (window.__s3dError) return { error: window.__s3dError };
      const s = window.__s3d, g = s.items.find((q) => q.userData.id === id);
      let itemTris = 0, itemMeshes = 0; g.userData.inner.traverse((o) => { if (o.isMesh) { itemMeshes++; const gi = o.geometry; itemTris += (gi.index ? gi.index.count : gi.attributes.position.count) / 3; } });
      s.render(0, false); s.render(0, false); const st = s.stats();   // (the first frame also draws the static shadow map)
      const top = g.userData.top + 0.32, c = s.project(g.position.x, top * 0.5, g.position.z), lab = s.project(g.position.x, s.itemTop(id, 0, false), g.position.z);
      const url = s.canvas.toDataURL('image/png');
      // the same frame with every pickup shown (the worst case: the game only ever shows one)
      s.setItems('all'); s.render(0, false); const all = s.stats(); s.setItems(id);
      return { st, all: { calls: all.calls, triangles: all.triangles }, itemTris, itemMeshes, top: +g.userData.top.toFixed(3), c, lab, url };
    }, it.id);
    if (r.url) { fs.writeFileSync(path.join(out, `${tag}_${it.id.replace(/\W+/g, '_')}_full.png`), Buffer.from(r.url.split(',')[1], 'base64')); delete r.url; }
    res[it.id] = r;
  }
  res._errs = errs; res._itemRequests = [...new Set(reqs)];
} finally { await b.close(); srv.kill(); }
fs.writeFileSync(path.join(out, `${tag}_stats.json`), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
