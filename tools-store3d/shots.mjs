// flock /tmp/claude-browser.lock node tools-store3d/shots.mjs <outDir> [name=query ...]
// Renders the 3D store preview (public/store3d/index.html) at the given positions on a 390 x 844 phone (dpr 2), saves each frame
// (<outDir>/<name>_3d.jpg, read straight off the canvas right after the render) and prints draw calls, triangles and frame times.
// Default positions: the three of the comparison sheet (A top / B mid, PAY on / C bottom), the same as the painted shots.
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
const ROOT = process.env.S3D_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // S3D_ROOT: serve another checkout (a before/after)
const out = path.resolve(process.argv[2] || '.'); fs.mkdirSync(out, { recursive: true });
const DEF = { A: 'px=330&py=330&bx=560&by=360&items=MILK', B: 'px=430&py=610&bx=330&by=760&pay=1', C: 'px=300&py=1318&bx=470&by=1180&items=APPLE' };
const jobs = process.argv.slice(3).length ? Object.fromEntries(process.argv.slice(3).map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; })) : DEF;
const PORT = 5600 + Math.floor(Math.random() * 300), srv = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const res = {};
try {
  for (const [name, q] of Object.entries(jobs)) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }), errs = [];
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
    const t0 = Date.now();
    await p.goto(`http://localhost:${PORT}/store3d/index.html?loop=0&${q}`);
    await p.waitForFunction(() => window.__s3dReady || window.__s3dError, null, { timeout: 600000 });
    const r = await p.evaluate(() => {
      if (window.__s3dError) return { error: window.__s3dError };
      // frame time: render, then read one pixel back, which waits for the GPU (software GL here) to finish the frame
      const t = [], gl = window.__s3d.renderer.getContext(), px = new Uint8Array(4); let st, url;
      for (let i = 0; i < 8; i++) { const a = performance.now(); st = window.__renderOnce(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t.push(+(performance.now() - a).toFixed(1)); if (i === 7) url = window.__s3d.canvas.toDataURL('image/jpeg', 0.92); }
      const steady = t.slice(2).sort((x, y) => x - y);
      return { st, t, medianMs: steady[Math.floor(steady.length / 2)], url, init: window.__s3dInitMs };
    });
    if (r.url) { fs.writeFileSync(path.join(out, name + '_3d.jpg'), Buffer.from(r.url.split(',')[1], 'base64')); delete r.url; }
    res[name] = { ...r, loadMs: Date.now() - t0, errs };
    await p.close();
  }
} finally { await b.close(); srv.kill(); }
console.log(JSON.stringify(res, null, 1));
