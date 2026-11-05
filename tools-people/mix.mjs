// node tools-people/mix.mjs <port> "<query>" <label> : the mix proof. No seeding trick beyond a fixed Math.random seed in the page, so the
// crowd layout compared between runs is the layout a plain run gets. Writes tools-people/out/mix/<label>_<shot>.jpg and <label>.json.
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const [port, query, label] = process.argv.slice(2);
const OUT = new URL('./out/mix/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
const logs = [], reqs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
page.on('request', (r) => { const u = r.url(); if (/people-|people-real/.test(u)) reqs.push(u.replace(/^https?:\/\/[^/]+/, '')); });
await page.addInitScript(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
const t0 = Date.now();
await page.goto(`http://localhost:${port}/drive/index.html?${query}`);
await page.waitForFunction(() => window.__drive && window.__drive.world, null, { timeout: 900000 });
const boot = (Date.now() - t0) / 1000;
const res = await page.evaluate(() => {
  const d = window.__drive, T = d.three, THREE = T.THREE, cam = T.camera, R = T.renderer, cr = d.world.crowd;
  d.manual = true; d.freezeClock = true;
  const shots = {}, out = {};
  const tick = (n) => { for (let i = 0; i < n; i++) d.tick(1 / 60); };
  const stat = () => { R.info.autoReset = false; R.info.reset(); d.snapshot(0.5); const r = { calls: R.info.render.calls, triangles: R.info.render.triangles }; R.info.autoReset = true; return r; };
  tick(40);
  out.people = cr.people.length; out.on = cr.people.filter((m) => m.on).length;
  out.fingerprint = cr.people.slice(0, 40).map((m) => [m.x, m.y, m.phase].map((v) => Math.round((v || 0) * 100) / 100).join(',')).join(';');
  out.meshes = d.three.scene.children.filter((o) => o.isInstancedMesh && /^crowd/.test(o.name)).map((o) => o.name);
  d.snapshot(0.5); out.chase = stat(); shots.chase = d.snapshot(0.92);
  const carPos = T.carRig.position.clone();
  const vis = cr.people.map((m, i) => (m.i = i, m)).filter((m) => m.on && m.x !== undefined);
  const hd = (m) => Math.hypot(m.x - carPos.x, -m.y - carPos.z);
  let best = null, bn = -1;
  for (const m of vis) { const dd = hd(m); if (dd < 7 || dd > 32) continue; let n = 0; for (const o of vis) if (Math.hypot(o.x - m.x, o.y - m.y) < 5) n++; if (n > bn) { bn = n; best = m; } }
  out.clusterSize = bn;
  const near = vis.filter((o) => Math.hypot(o.x - best.x, o.y - best.y) < 5);
  const cx = near.reduce((a, o) => a + o.x, 0) / near.length, cz = near.reduce((a, o) => a - o.y, 0) / near.length, cy = near.reduce((a, o) => a + o.z, 0) / near.length;
  const dir = new THREE.Vector3(cx - carPos.x, 0, cz - carPos.z).normalize();
  const D = 2.55 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const place = (pos, look) => { d.camOverride = { pos, look }; };
  place(new THREE.Vector3(cx - dir.x * D, cy + 1.45, cz - dir.z * D), new THREE.Vector3(cx, cy + 0.95, cz));
  tick(2); shots.crowd = d.snapshot(0.92); out.crowd = stat();
  // an even-index person and an odd-index person standing closest together (the same two people in every run: indices, not kinds)
  let pair = null, pd = 1e9;
  for (const a of vis) for (const b of vis) { if (a.i % 2 || !(b.i % 2)) continue; const dd = Math.hypot(a.x - b.x, a.y - b.y), h = hd(a); if (dd < pd && dd > 0.4 && h > 7 && h < 32 && !a.phone && !b.phone) { pd = dd; pair = [a, b]; } }
  out.pair = pair && { i: [pair[0].i, pair[1].i], dist: pd };
  if (pair) {
    const px = (pair[0].x + pair[1].x) / 2, pz = -(pair[0].y + pair[1].y) / 2, py = (pair[0].z + pair[1].z) / 2;
    const dr = new THREE.Vector3(px - carPos.x, 0, pz - carPos.z).normalize();
    place(new THREE.Vector3(px - dr.x * D * 0.8, py + 1.3, pz - dr.z * D * 0.8), new THREE.Vector3(px, py + 0.95, pz));
    tick(2); shots.pair = d.snapshot(0.92);
  }
  // nobody changes body: over 90 frames (walkers cross the near/far limit and the shadow box), every drawn instance belongs to the person at that spot
  const alt = cr.alt;
  if (alt) {
    d.camOverride = null; let bad = 0, checked = 0; const seen = new Map(); let swaps = 0;
    for (let f = 0; f < 90; f++) {
      d.tick(1 / 60);
      alt.lods.forEach((l, k) => {
        const a = l.mesh.instanceMatrix.array;
        for (let i = 0; i < l.mesh.count; i++) {
          const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
          let bi = -1, bd = 1e9;
          for (let n = 0; n < cr.people.length; n++) { const m = cr.people[n]; if (!m.on) continue; const dd = Math.abs(m.x - x) + Math.abs(m.z - y) + Math.abs(-m.y - z); if (dd < bd) { bd = dd; bi = n; } }
          checked++;
          if (bd > 0.3 || alt.vi[bi] !== l.vx) bad++;
          const prev = seen.get(bi); if (prev !== undefined && prev !== l.vx) swaps++; seen.set(bi, l.vx);
        }
      });
    }
    out.motion = { frames: 90, instancesChecked: checked, mismatches: bad, bodySwaps: swaps, distinctPeople: seen.size, kinds: alt.vs.map((v) => v.name), shareOfB: alt.vi.filter((x) => x === 1).length / alt.vi.length };
  }
  out.mixHint = cr.alt ? alt.vs.length : 0;
  return { out, shots };
});
for (const [k, v] of Object.entries(res.shots)) fs.writeFileSync(`${OUT}${label}_${k}.jpg`, Buffer.from(v.split(',')[1], 'base64'));
res.out.boot = boot; res.out.requests = reqs; res.out.console = logs;
fs.writeFileSync(`${OUT}${label}.json`, JSON.stringify(res.out, null, 1));
console.log(JSON.stringify({ ...res.out, fingerprint: res.out.fingerprint.slice(0, 50) }, null, 1));
await browser.close();
