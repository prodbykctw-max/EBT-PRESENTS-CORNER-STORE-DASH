import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
export let which = "x";
export const PORT = { branch: 5731, main: 5732 };
export async function open({ which = 'branch', q = '?qa&skipfoot', w = 390, h = 844, touch = true, live = false } = {}) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, userAgent: touch ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mobile/15E148 Safari/604.1)' : 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141 Safari/537.36' });
  await ctx.addInitScript(() => {
    let a = +(new URLSearchParams(location.search).get('rs') || 12345); Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const real = performance.now.bind(performance); let virt = null;
    window.__vt = { start() { virt = real(); }, add(ms) { if (virt !== null) virt += ms; } };
    performance.now = () => (virt === null ? real() : virt);
  });
  const p = await ctx.newPage();
  await p.route('**/*', (r) => (r.request().url().startsWith('http://localhost') ? r.continue() : r.abort()));
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
  await load(p, which, q, live);
  return { b, p, ctx };
}
export const ticks = (p, n, dt = 1 / 60) => p.evaluate(({ n, dt }) => { for (let i = 0; i < n; i++) window.__drive.tick(dt); }, { n, dt });
/** put the car at s (lane d, speed v) and settle */
export async function place(p, { s, d, v = 0, settle = 90, gas = v > 0 }) {
  await p.evaluate(({ s, d, v, gas }) => { const D = window.__drive, c = D.car; c.s = s; c.d = d ?? D.route.lane(s, 0); c.targetD = c.d; c.v = v; D.keys.clear(); if (gas) D.keys.add('gas'); }, { s, d, v, gas });
  await ticks(p, settle);
}
/** car screen box (fractions of the viewport) and camera gap */
export const measure = (p) => p.evaluate(() => {
  const D = window.__drive, { camera, carRig, THREE } = D.three; camera.updateMatrixWorld(); camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  carRig.updateMatrixWorld(true); const inv = carRig.matrixWorld.clone().invert();
  const box = new THREE.Box3(); carRig.traverse((o) => { if (o.isMesh && o.visible && o.geometry) { o.geometry.boundingBox || o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld.clone().premultiply(inv))); } });
  let x0 = 9, x1 = -9, y0 = 9, y1 = -9, behind = false;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const w = new THREE.Vector3(x, y, z).applyMatrix4(carRig.matrixWorld); const v = w.clone().project(camera); const cv = w.clone().applyMatrix4(camera.matrixWorldInverse); if (cv.z > 0) behind = true;
    const fx = (v.x + 1) / 2, fy = (1 - v.y) / 2; x0 = Math.min(x0, fx); x1 = Math.max(x1, fx); y0 = Math.min(y0, fy); y1 = Math.max(y1, fy);
  }
  const cp = camera.position, rp = carRig.position, gap = Math.hypot(cp.x - rp.x, cp.z - rp.z);
  // where the horizon is (a point far ahead at camera height)
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
  const hz = new THREE.Vector3(cp.x + dir.x * 5000, cp.y, cp.z + dir.z * 5000).project(camera);
  return { x0, x1, y0, y1, behind, gap, camH: cp.y - rp.y, horizon: (1 - hz.y) / 2, s: D.car.s, v: D.car.v, fov: camera.fov };
});
/** draw the frozen world once on the live canvas, then stop the loop, so a page screenshot has the canvas and the HUD */
export async function shot(p, path, clip) {
  await p.evaluate(async () => {
    const D = window.__drive; D.city.cull(D.three.camera, D.three.scene.fog); D.pause = true; D.manual = false;
    await new Promise((ok) => { const r = D.comic.render.bind(D.comic); let n = 0; D.comic.render = function () { r(); if (++n >= 2) { D.comic.render = r; D.manual = true; D.pause = false; setTimeout(ok, 50); } }; });
  });
  await p.screenshot({ path, timeout: 300000, ...(clip ? { clip } : {}) });
}

export async function load(p, which, q, live) {
  await p.goto(`http://localhost:${PORT[which]}/drive/index.html${q}`);
  await p.waitForFunction(() => window.__drive && window.__drive.comic, null, { timeout: 1200000, polling: 500 });
  // loader off, entrance done, then hand the loop to the test
  await p.waitForFunction(() => !document.querySelector('.drive-loading'), null, { timeout: 2400000, polling: 500 });
  await p.waitForTimeout(1500);
  if (!live) await p.evaluate(() => {
    const d = window.__drive; d.manual = true; window.__vt.start();
    const t0 = d.tick; d.tick = (dt) => { window.__vt.add(dt * 1000); t0(dt); };
  });
}
