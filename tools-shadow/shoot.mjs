// node tools-shadow/shoot.mjs <port> "<query>" <label> <mode: drive|foot|check> [desktop]
// Phone-emulated (390x844, pointer: coarse) unless "desktop". Same seed, same camera, same weather (the open-meteo fetch is blocked, so
// weather.js falls back to its fixed CLEAR sky; the sun/fog/exposure it ends up with are recorded so before and after can be compared).
// modes: drive = shot 1 (close sidewalk group) + shot 3 (driving view mid-route) + draw calls; foot = shot 2 (on-foot start); check = counts only.
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const [port, query, label, mode, desk] = process.argv.slice(2);
const OUT = new URL('./out/', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const phone = !desk;
const ctx = await browser.newContext(phone
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
  : { viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [], reqs = [];
page.on('request', (r) => { if (/contact\.js/.test(r.url())) reqs.push(r.url()); });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.route(/open-meteo\.com/, (r) => r.abort());
await page.addInitScript(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
// test-only: reseed + count Math.random from the start of the Crowd constructor, and record the stream position right after the crowd is built
await page.route(/\/drive\/crowd\.js/, async (route) => {
  const r = await route.fetch(); let b = await r.text();
  const a = 'Object.assign(this, { route, ground, surfAt, visible, camera });';
  if (b.includes(a)) b = b.replace(a, a + ' { let s = 777; window.__rc = 0; Math.random = () => { window.__rc++; s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }');
  await route.fulfill({ response: r, body: b });
});
await page.route(/\/drive\/drive\.js/, async (route) => {
  const r = await route.fetch(); let b = await r.text();
  const a = 'crowd.shadowBox = world.shadowBox;';
  if (b.includes(a)) b = b.replace(a, a + ' window.__rcAfter = [window.__rc, Math.random()]; window.__fp0 = [crowd.people.length, crowd.people.slice(0, 40).map((m) => [m.s, m.d, m.phase].map((v) => Math.round((v || 0) * 1e4) / 1e4).join(",")).join("|")];');
  await route.fulfill({ response: r, body: b });
});
const t0 = Date.now();
await page.goto(`http://localhost:${port}/drive/index.html?${query}`);
await page.waitForFunction(() => window.__drive && window.__drive.world, null, { timeout: 1500000, polling: 2000 });
const boot = (Date.now() - t0) / 1000;
const save = (name, url) => fs.writeFileSync(`${OUT}${label}_${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
const res = await page.evaluate(async (mode) => {
  const d = window.__drive, T = d.three, THREE = T.THREE, cam = T.camera, R = T.renderer, cr = d.world.crowd;
  d.manual = true; d.freezeClock = true;
  const shots = {}, out = {};
  const tick = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) d.tick(dt); };
  const stat = () => { R.info.autoReset = false; R.info.reset(); d.snapshot(0.5); const r = { calls: R.info.render.calls, triangles: R.info.render.triangles }; R.info.autoReset = true; return r; };
  out.coarse = matchMedia('(pointer: coarse)').matches; out.rc = window.__rcAfter;
  out.people = cr.people.length; out.alt = !!cr.alt;
  out.fp0 = window.__fp0;
  // lighting / weather record
  const lights = []; T.scene.traverse((o) => { if (o.isLight) lights.push([o.type, +o.intensity.toFixed(4), o.color.getHexString()]); });
  out.light = { lights, fog: T.scene.fog && [T.scene.fog.color.getHexString(), T.scene.fog.near, T.scene.fog.far], exposure: R.toneMappingExposure, bg: T.scene.background?.isColor ? T.scene.background.getHexString() : typeof T.scene.background };
  let nObj = 0; T.scene.traverse(() => nObj++); out.sceneObjects = nObj; out.memory = { ...R.info.memory };
  const blob = T.scene.getObjectByName('crowd_contact'); out.blobMesh = !!blob;
  tick(40);
  out.state = d.state; out.blobCount = blob ? blob.count : null; out.on = cr.people.filter((m) => m.on).length;
  if (mode === 'check') { d.snapshot(0.5); out.blobCount = blob ? blob.count : null; out.stat = stat(); shots.check = d.snapshot(0.9); return { out, shots }; }
  if (mode === 'foot') { tick(30); out.blobCount = blob ? blob.count : null; out.stat = stat(); shots.foot = d.snapshot(0.92); return { out, shots }; }
  // drive: let the countdown run out, then put the car mid-route
  for (let i = 0; i < 400 && d.state !== 'driving'; i++) d.tick(1 / 60);
  d.car.s = 420; d.car.v = 0; tick(90);
  out.state2 = d.state; d.snapshot(0.5); out.driveStat = stat(); out.driveBlobs = blob ? blob.count : null; out.driveOn = cr.people.filter((m) => m.on).length; shots.drive = d.snapshot(0.92);
  // close sidewalk group: the cluster of people nearest the car, camera low on the road side, people ~1/3 of the frame height
  const carPos = T.carRig.position.clone();
  const vis = cr.people.filter((m) => m.on && m.x !== undefined);
  const hd = (m) => Math.hypot(m.x - carPos.x, -m.y - carPos.z);
  let best = null, bn = -1;
  for (const m of vis) { const dd = hd(m); if (dd < 8 || dd > 40) continue; let n = 0; for (const o of vis) if (Math.hypot(o.x - m.x, o.y - m.y) < 3.5) n++; if (n > bn) { bn = n; best = m; } }
  out.cluster = bn;
  const near = vis.filter((o) => Math.hypot(o.x - best.x, o.y - best.y) < 3.5);
  const cx = near.reduce((a, o) => a + o.x, 0) / near.length, cz = near.reduce((a, o) => a - o.y, 0) / near.length, cy = near.reduce((a, o) => a + o.z, 0) / near.length;
  const dir = new THREE.Vector3(cx - carPos.x, 0, cz - carPos.z).normalize();
  const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const D = (1.75 * 3 / 2) / tanH;   // people (1.75 m) fill a third of the frame height
  d.camOverride = { pos: new THREE.Vector3(cx - dir.x * D, cy + 1.7, cz - dir.z * D), look: new THREE.Vector3(cx, cy + 0.35, cz) };
  tick(2); out.closeD = D; out.closeStat = stat(); out.closeBlobs = blob ? blob.count : null; shots.close = d.snapshot(0.92);
  d.camOverride = null;
  return { out, shots };
}, mode);
for (const [k, v] of Object.entries(res.shots)) save(k, v);
res.out.contactRequests = reqs.length; res.out.boot = boot; res.out.console = logs.slice(0, 20);
fs.writeFileSync(`${OUT}${label}_${mode}.json`, JSON.stringify(res.out, null, 1));
console.log(JSON.stringify({ ...res.out, fp0: undefined }));
await browser.close();
