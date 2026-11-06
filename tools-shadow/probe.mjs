// node tools-shadow/probe.mjs <port>: how far is the drawn pavement above/below a person's foot height m.z (down-ray against the scene)?
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.route(/open-meteo\.com/, (r) => r.abort());
await page.addInitScript(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
await page.goto(`http://localhost:${process.argv[2]}/drive/index.html?qa&skipfoot`);
await page.waitForFunction(() => window.__drive && window.__drive.world, null, { timeout: 1500000, polling: 2000 });
const r = await page.evaluate(() => {
  const d = window.__drive, T = d.three, THREE = T.THREE, cr = d.world.crowd; d.manual = true; d.freezeClock = true;
  for (let i = 0; i < 400 && d.state !== 'driving'; i++) d.tick(1 / 60);
  d.car.s = 420; d.car.v = 0; for (let i = 0; i < 90; i++) d.tick(1 / 60);
  const blob = T.scene.getObjectByName('crowd_contact'), carPos = T.carRig.position, cam = T.camera;
  const vis = cr.people.filter((m) => m.on && m.x !== undefined); const hd = (m) => Math.hypot(m.x - carPos.x, -m.y - carPos.z);
  let best = null, bn = -1;
  for (const m of vis) { const dd = hd(m); if (dd < 8 || dd > 40) continue; let n = 0; for (const o of vis) if (Math.hypot(o.x - m.x, o.y - m.y) < 3.5) n++; if (n > bn) { bn = n; best = m; } }
  const near = vis.filter((o) => Math.hypot(o.x - best.x, o.y - best.y) < 3.5);
  const cx = near.reduce((a, o) => a + o.x, 0) / near.length, cz = near.reduce((a, o) => a - o.y, 0) / near.length, cy = near.reduce((a, o) => a + o.z, 0) / near.length;
  const dir = new THREE.Vector3(cx - carPos.x, 0, cz - carPos.z).normalize(), D = 3.75;
  d.camOverride = { pos: new THREE.Vector3(cx - dir.x * D, cy + 1.7, cz - dir.z * D), look: new THREE.Vector3(cx, cy + 0.35, cz) };
  const out = {};
  for (const [name, f] of [['base', () => {}], ['lift15', () => { blob.position.y = 0.15; }], ['notest', () => { blob.position.y = 0; blob.material.depthTest = false; blob.material.needsUpdate = true; }]]) {
    f(); for (let i = 0; i < 2; i++) d.tick(1 / 60); out[name] = d.snapshot(0.9);
  }
  return out;
});
import fs from 'node:fs'; for (const [k, v] of Object.entries(r)) fs.writeFileSync(new URL(`./out/probe_${k}.jpg`, import.meta.url).pathname, Buffer.from(v.split(',')[1], 'base64')); console.log('ok'); await browser.close();
