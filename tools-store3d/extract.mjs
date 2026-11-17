// node tools-store3d/extract.mjs [outfile]
// Boots the LIVE store (public/standalone.html) headless, reads the collision mask through window.__csd and writes
// public/store3d/layout.json: board size, the 4 px mask (floor / solid, from fieldAt), the actor collider (boxFree),
// ITEMS, PADS, DOOR, spawns, fixtures (connected solid blobs of the mask), and the camera mapping constants.
// It serves public/ itself on a free port and is killed by PID. Wrap it: flock /tmp/claude-browser.lock node tools-store3d/extract.mjs
import fs from 'fs'; import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core'; import { assemble } from './layout-lib.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(ROOT, 'public/store3d/layout.json');
const PORT = 5600 + Math.floor(Math.random() * 300);
const srv = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await p.route(/open-meteo/, (r) => r.abort());
  const { extractLayout } = await import('./extract-lib.mjs'); const layout = await extractLayout(p, ROOT, `http://localhost:${PORT}`);
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(layout));
  console.log('wrote', out, 'blobs', layout.blobs.length, 'bytes', fs.statSync(out).size, JSON.stringify(layout.probe));
} finally { await b.close(); srv.kill(); }
