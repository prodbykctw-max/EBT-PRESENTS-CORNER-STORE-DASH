// do the near cars still cast their shadow when the proxies are shown only in the sun's shadow pass?   node shadows.mjs <port> <outdir>
//   s1 = as shipped (proxies hidden for the camera, shown around the shadow map)   s2 = proxies visible in both passes (the old way)
//   s3 = no proxies at all (the near cars cast nothing)   s4 = proxies on layer 2 with layer 2 enabled on the SUN'S shadow camera (the layer idea)
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const PORT = +process.argv[2], OUT = process.argv[3]; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 1; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  await ctx.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
  const res = await page.evaluate(async () => {
    const d = window.__drive, TH = d.three.THREE, w = d.world, scene = d.three.scene, r = d.three.renderer; d.manual = true; d.freezeClock = true;
    for (let i = 0; i < 90; i++) d.tick(1 / 60);
    const cs = w.carSet, B = (e) => e.type === 'sedan' && cs.pick('sedan', e.cid) === cs.keys.sedanB;
    const cars = w.ents.filter((e) => ['sedan', 'suv'].includes(e.type) && e.alive && e.parked);
    const e = cars.filter((x) => B(x) && x.s > d.car.s + 20 && x.s < d.car.s + 200)[0];
    const at = (s, dd, h) => { const p = d.route.at(s, dd); return new TH.Vector3(p.x, p.z + h, -p.y); };
    const sc = e.s - 9, dc = d.route.lane(sc, 0) * 0.5 + e.d * 0.5;
    d.camOverride = { pos: at(e.s - 2.5, dc, 7.5), look: at(e.s, e.d, 0.2) };   // looking down at the car: its shadow lies on the road beside it
    let sun = null; scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow) sun = o; });
    const cnt = { shadowDraws: 0, cameraDraws: 0 };
    for (const p of cs.proxies) { p.onBeforeShadow = () => { cnt.shadowDraws++; }; p.onBeforeRender = () => { cnt.cameraDraws++; }; }
    const shot = (tag) => { cnt.shadowDraws = 0; cnt.cameraDraws = 0; for (let i = 0; i < 3; i++) d.tick(0.0005); const u = d.snapshot(0.95); (out.counts ||= {})[tag] = { ...cnt }; return u; };
    const out = { info: { proxies: cs.proxies.length, visibleAfter: cs.proxies.filter((p) => p.visible).length, sun: !!sun } };
    out.s1 = shot('s1'); r.info.reset();
    cs.restoreShadow(); out.s2 = shot('s2');                                       // old way: proxies visible in both passes
    for (const p of cs.proxies) p.visible = false; out.s3 = shot('s3');             // no proxies: nothing from the near cars
    for (const p of cs.proxies) { p.visible = true; p.layers.set(2); } sun.shadow.camera.layers.enable(2); out.s4 = shot('s4');   // the layer idea
    out.info.s4 = 'proxies on layer 2, layer 2 enabled on the sun shadow camera';
    return out;
  });
  console.log(JSON.stringify(res.info)); console.log(JSON.stringify(res.counts));
  for (const k of ['s1', 's2', 's3', 's4']) writeFileSync(`${OUT}/${k}.jpg`, Buffer.from(res[k].split(',')[1], 'base64'));
} finally { await browser.close(); }
