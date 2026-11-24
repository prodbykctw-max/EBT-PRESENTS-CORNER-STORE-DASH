// flock /tmp/claude-browser.lock node tools-store3d/lightpreview.mjs <outDir> <query> [query...]
// The preview page (/store3d/index.html) at phone size, one PNG per query (e.g. "storelight=night&px=330&py=330"), with the draw stats.
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
const ROOT = process.env.ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const port = 5600 + Math.floor(Math.random() * 300), srv = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const [i, q] of process.argv.slice(3).entries()) {
    const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 }); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 400)); });
    await p.goto(`http://localhost:${port}/store3d/index.html?loop=0&mobile=1&${q}`);
    await p.waitForFunction(() => window.__s3dReady || window.__s3dError, null, { timeout: 600000 });
    if (process.env.JS) await p.evaluate(process.env.JS);
    const st = await p.evaluate(() => { const r = window.__renderOnce(0.016); window.__renderOnce(0.016); return { stats: window.__s3d.stats(), look: window.__s3d.lightName, err: window.__s3dError }; });
    const f = path.join(out, `p${i}.png`); await p.screenshot({ path: f }); console.log(f, q, JSON.stringify(st), errs.join(' | ').slice(0, 1500)); await p.close();
  }
} finally { await b.close(); srv.kill(); }
