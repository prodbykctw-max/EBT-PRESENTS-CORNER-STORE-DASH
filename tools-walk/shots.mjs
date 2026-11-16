// Same-camera stills for before/after: node tools-walk/shots.mjs <port> <outdir> <tag> [scenes=fly,foot,store,drive]
//   fly   : /drive/index.html?qa&fly  -> flyover frames, then on foot (opening) and street-level / overhead cameras at the corner store
//   drive : /drive/index.html?qa&skipfoot -> the chase camera mid-route and the arrival shot
// Every camera is placed in route space (s along, d across, h up) so the base and the branch see the same place.
import { chromium } from 'playwright-core'; import fs from 'fs';
const [PORT, OUT, TAG, SCENES = 'fly,foot,store,drive'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const seeded = () => { let a = 0x12345678; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const save = (name, url) => fs.writeFileSync(`${OUT}/${TAG}_${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
const want = new Set(SCENES.split(','));
const open = async (qs, w = 960, h = 540) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seeded); await ctx.route(/open-meteo/, (r) => r.abort());
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?${qs}`);
  await page.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  return { page, errs };
};
// a camera at route coords looking at route coords: [s, d, h] -> [s, d, h]
const lookShot = (page, name, from, to, fov = 60) => page.evaluate(([from, to, fov]) => {
  const d = window.__drive, T = d.three, p = d.route.at(from[0], from[1]), q = d.route.at(to[0], to[1]);
  const cam = T.camera; cam.near = 0.3; cam.fov = fov; cam.updateProjectionMatrix();
  cam.position.set(p.x, p.z + from[2], -p.y); cam.lookAt(q.x, q.z + to[2], -q.y); cam.updateMatrixWorld(true);
  return d.snapshot(0.9);
}, [from, to, fov]).then((u) => save(name, u));
const st = (page) => page.evaluate(() => { const d = window.__drive; return { spotS: d.spot.s, spotD: d.spot.d, hw: d.route.hw(d.spot.s), len: d.route.length }; });
if (want.has('fly') || want.has('foot') || want.has('store')) {
  const { page, errs } = await open('qa&fly');
  await page.evaluate(() => { window.__drive.manual = true; });
  if (want.has('fly')) {
    for (const t of [0.5, 1.6, 2.8, 3.9]) {
      const u = await page.evaluate((t) => { const d = window.__drive; while (d.fly && d.fly.t < t) d.tick(1 / 30); return d.snapshot(0.9); }, t); save(`fly_${t}`, u);
    }
  }
  await page.evaluate(() => { const d = window.__drive; d.endFly(); for (let i = 0; i < 90; i++) d.tick(1 / 30); });
  if (want.has('foot')) save('foot_open', await page.evaluate(() => window.__drive.snapshot(0.9)));
  if (want.has('store')) {
    const S = await st(page); const s = S.spotS, hw = S.hw;
    // street level on the walk in front of the store, looking along it; across the road at the store front; overhead oblique
    await lookShot(page, 'store_street', [s - 18, -(hw + 1.4), 1.7], [s + 8, -(hw + 1.4), 1.2], 70);
    await lookShot(page, 'store_across', [s + 2, hw - 1.2, 1.7], [s + 2, -(hw + 2), 1.8], 62);
    await lookShot(page, 'store_over', [s - 14, 1, 24], [s + 2, -(hw + 1), 0], 55);
    await lookShot(page, 'store_over_far', [s - 40, 6, 52], [s - 10, -(hw + 1), 0], 50);
  }
  console.log(JSON.stringify({ scene: 'fly', errs: errs.slice(0, 4) }));
  await page.context().close();
}
if (want.has('drive')) {
  const { page, errs } = await open('qa&skipfoot');
  await page.evaluate(() => { window.__drive.manual = true; });
  const S = await st(page);
  for (const [name, at] of [['chase_mid', 520], ['chase_pre', S.spotS - 90]]) {
    const u = await page.evaluate((at) => { const d = window.__drive; Object.assign(d.car, { s: at, v: 14, d: d.route.lane(at, 0), targetD: d.route.lane(at, 0) }); d.keys.add('gas'); for (let i = 0; i < 40; i++) d.tick(1 / 30); return d.snapshot(0.9); }, at); save(name, u);
  }
  const u = await page.evaluate(() => { const d = window.__drive; d.keys.clear(); Object.assign(d.car, { s: d.spot.s - 1.5, d: d.spot.d, targetD: d.spot.d, v: 0 }); for (let i = 0; i < 60; i++) d.tick(1 / 30); return d.snapshot(0.9); }); save('arrive', u);
  console.log(JSON.stringify({ scene: 'drive', errs: errs.slice(0, 4), S }));
  await page.context().close();
}
await browser.close();
