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
  const r = d.route, all = cr.people.map((m) => { const p = r.at(m.s, m.g.side * m.d), gz = cr.ground(p.x, p.y), z = Math.max(cr.footAt(p.x, p.y, gz + 1.2) ?? -Infinity, gz + 0.0);
    let mn = 0, mxx = 0; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, h = cr.footAt(p.x + 0.6 * Math.cos(a), p.y + 0.6 * Math.sin(a), z + 1.2); const dz = h === null ? 0 : h - z; mn = Math.min(mn, dz); mxx = Math.max(mxx, dz); } return [m, mxx > 0.03 ? 0 : mn]; }).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const out = { diffs: all.slice(0, 10).map(([m, v]) => [Math.round(m.s), +v.toFixed(3)]), over4: all.filter(([, v]) => Math.abs(v) > 0.04).length, total: all.length };
  const cand = all.filter(([, v]) => v < -0.08 && v > -0.3).sort((a, b) => Math.abs(Math.abs(a[1]) - 0.15) - Math.abs(Math.abs(b[1]) - 0.15)); out.pick = [cand[0][0].s, cand[0][1], cand.length]; const m0 = cand[0][0]; d.car.s = m0.s - 14; d.car.v = 0; for (let i = 0; i < 90; i++) d.tick(1 / 60);
  const blob = T.scene.getObjectByName('crowd_contact'), carPos = T.carRig.position;
  out.on = m0.on; out.blobs = blob.count;
  const dir = new THREE.Vector3(m0.x - carPos.x, 0, -m0.y - carPos.z).normalize();
  for (const D of [3.0, 7]) {
    d.camOverride = { pos: new THREE.Vector3(m0.x - dir.x * D, m0.z + 1.7, -m0.y - dir.z * D), look: new THREE.Vector3(m0.x, m0.z + 0.3, -m0.y) };
    for (let i = 0; i < 2; i++) d.tick(1 / 60); out['curb' + (D === 3 ? '3.75' : '9')] = d.snapshot(0.92);
  }
  return out;
});
import fs from 'node:fs'; console.log(JSON.stringify({ diffs: r.diffs, over4: r.over4, total: r.total, on: r.on, pick: r.pick, blobs: r.blobs })); for (const [k, v] of Object.entries(r).filter(([k]) => k.startsWith('curb'))) fs.writeFileSync(new URL(`./out/probe_${k}.jpg`, import.meta.url).pathname, Buffer.from(v.split(',')[1], 'base64')); console.log('ok'); await browser.close();
