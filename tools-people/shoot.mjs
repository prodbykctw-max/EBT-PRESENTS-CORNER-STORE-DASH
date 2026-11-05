// node tools-people/shoot.mjs <port> "<query>" <label>
// Boots the drive with the given query (seeded Math.random), then takes the same five shots from the same camera and writes
// tools-people/out/shots/<label>_<shot>.jpg plus <label>.json (people count, placement fingerprint, draw calls, triangles, console).
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const [port, query, label] = process.argv.slice(2);
const OUT = new URL('./out/shots/', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.addInitScript(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
// test-only: reseed Math.random at the start of the Crowd constructor so the population is the same however the other loaders interleave
let patched = 0;
await page.route(/\/drive\/crowd\.js/, async (route) => {
  const r = await route.fetch(); let b = await r.text();
  const a = 'Object.assign(this, { route, ground, surfAt, visible, camera });';
  if (b.includes(a)) { patched++; b = b.replace(a, a + ' { let s = 777; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }'); }
  await route.fulfill({ response: r, body: b });
});
const t0 = Date.now();
await page.goto(`http://localhost:${port}/drive/index.html?${query}`);
await page.waitForFunction(() => window.__drive && window.__drive.world, null, { timeout: 900000 });
const boot = (Date.now() - t0) / 1000;
const save = (name, url) => fs.writeFileSync(`${OUT}${label}_${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
const res = await page.evaluate(async () => {
  const d = window.__drive, T = d.three, THREE = T.THREE, cam = T.camera, R = T.renderer, cr = d.world.crowd;
  d.manual = true; d.freezeClock = true;
  const shots = {}, out = {};
  const tick = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) d.tick(dt); };
  const stat = () => { R.info.autoReset = false; R.info.reset(); d.snapshot(0.5); const r = { calls: R.info.render.calls, triangles: R.info.render.triangles }; R.info.autoReset = true; return r; };
  tick(40);
  out.people = cr.people.length; out.on = cr.people.filter((m) => m.on).length;
  out.fingerprint = cr.people.slice(0, 40).map((m) => [m.x, m.y, m.phase].map((v) => Math.round((v || 0) * 100) / 100).join(',')).join(';');
  out.fov = cam.fov; out.aspect = cam.aspect;
  // 1. the normal chase view
  d.snapshot(0.5); out.chase = stat(); shots.chase = d.snapshot(0.92);
  const P = d.car.s !== undefined ? cam.position.clone() : cam.position.clone();   // (camera = chase camera now)
  const carPos = T.carRig.position.clone();
  // 2. the best cluster of people within 5..30 m of the car
  const vis = cr.people.filter((m) => m.on && m.x !== undefined);
  const hd = (m) => Math.hypot(m.x - carPos.x, -m.y - carPos.z);
  let best = null, bn = -1;
  for (const m of vis) { const dd = hd(m); if (dd < 7 || dd > 32) continue; let n = 0; for (const o of vis) if (Math.hypot(o.x - m.x, o.y - m.y) < 5) n++; if (n > bn) { bn = n; best = m; } }
  out.clusterSize = bn;
  const near = vis.filter((o) => Math.hypot(o.x - best.x, o.y - best.y) < 5);
  const cx = near.reduce((a, o) => a + o.x, 0) / near.length, cz = near.reduce((a, o) => a - o.y, 0) / near.length, cy = near.reduce((a, o) => a + o.z, 0) / near.length;
  const dir = new THREE.Vector3(cx - carPos.x, 0, cz - carPos.z).normalize();
  const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const place = (pos, look) => { d.camOverride = { pos, look }; };
  const D = 2.55 / tanH;
  place(new THREE.Vector3(cx - dir.x * D, cy + 1.45, cz - dir.z * D), new THREE.Vector3(cx, cy + 0.95, cz));
  tick(2); shots.crowd = d.snapshot(0.92); out.crowd = stat();
  // 3. one walking person, side-on, two phases of the stride
  const walkers = vis.filter((m) => m.sp > 0.8 && !m.phone && hd(m) > 6 && hd(m) < 30 && Math.hypot(m.x - best.x, m.y - best.y) < 12);
  const hero = (walkers[0] || best);
  out.hero = { sp: hero.sp, phone: !!hero.phone };
  const p0 = new THREE.Vector3(hero.x, hero.z, -hero.y); tick(6); const p1 = new THREE.Vector3(hero.x, hero.z, -hero.y);
  let hv = p1.clone().sub(p0); hv.y = 0; if (hv.length() < 1e-5) hv.set(Math.cos(hero.yaw), 0, -Math.sin(hero.yaw)); hv.normalize();
  const side = new THREE.Vector3(-hv.z, 0, hv.x); if (side.dot(new THREE.Vector3(carPos.x - hero.x, 0, carPos.z + hero.y)) < 0) side.negate();
  const follow = () => { const c = new THREE.Vector3(hero.x, hero.z, -hero.y); place(c.clone().addScaledVector(side, D * 0.92).add(new THREE.Vector3(0, 0.9, 0)), c.clone().add(new THREE.Vector3(0, 0.85, 0))); };
  const frames = [];
  for (let i = 0; i < 30; i++) { follow(); d.tick(1 / 60); }
  follow(); d.tick(1 / 60); shots.walkA = d.snapshot(0.92);
  for (let i = 0; i < 17; i++) { follow(); d.tick(1 / 60); }
  follow(); d.tick(1 / 60); shots.walkB = d.snapshot(0.92);
  // 4. far view: the same cluster from 50 m, a narrow lens (people beyond 30 m use the cheap model)
  cam.fov = 17; cam.updateProjectionMatrix();
  const FD = 52; place(new THREE.Vector3(cx - dir.x * FD, cy + 4.5, cz - dir.z * FD), new THREE.Vector3(cx, cy + 1.0, cz));
  tick(2); shots.far = d.snapshot(0.92);
  d.camOverride = null; cam.fov = out.fov; cam.updateProjectionMatrix();
  return { out, shots };
});
for (const [k, v] of Object.entries(res.shots)) save(k, v);
res.out.boot = boot; res.out.crowdSeedPatched = patched; res.out.console = logs.slice(0, 40);
fs.writeFileSync(`${OUT}${label}.json`, JSON.stringify(res.out, null, 1));
console.log(JSON.stringify({ boot, ...res.out, fingerprint: res.out.fingerprint.slice(0, 60) }, null, 1));
await browser.close();
