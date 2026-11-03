// node tools-people/far.mjs <port> : the far-LOD shot for cur / A / B (one browser, three pages one after the other).
// Looks from the chase camera down the street through a narrow lens (people more than 30 m away use the cheap model).
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const port = process.argv[2];
const OUT = new URL('./out/shots/', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [label, query] of [['cur', 'qa&skipfoot'], ['A', 'qa&skipfoot&people=A'], ['B', 'qa&skipfoot&people=B']]) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
  await page.route(/\/drive\/crowd\.js/, async (route) => {
    const r = await route.fetch(); let b = await r.text(); const a = 'Object.assign(this, { route, ground, surfAt, visible, camera });';
    if (b.includes(a)) b = b.replace(a, a + ' { let s = 777; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }');
    await route.fulfill({ response: r, body: b });
  });
  await page.goto(`http://localhost:${port}/drive/index.html?${query}`);
  await page.waitForFunction(() => window.__drive && window.__drive.world, null, { timeout: 900000 });
  const r = await page.evaluate(() => {
    const d = window.__drive, T = d.three, THREE = T.THREE, cam = T.camera, cr = d.world.crowd;
    d.manual = true; d.freezeClock = true;
    for (let i = 0; i < 40; i++) d.tick(1 / 60);
    const cp = cam.position.clone(), car = T.carRig.position.clone();
    const dir = new THREE.Vector3(car.x - cp.x, 0, car.z - cp.z).normalize();
    d.camOverride = { pos: cp.clone().add(new THREE.Vector3(0, 1.2, 0)), look: cp.clone().addScaledVector(dir, 60).add(new THREE.Vector3(0, 1.2, 0)) };
    const f0 = cam.fov; cam.fov = 15; cam.updateProjectionMatrix();
    d.tick(1 / 60); d.tick(1 / 60);
    const url = d.snapshot(0.92);
    const alt = cr.alt; const lodCounts = alt ? alt.lods.map((l) => l.mesh.count) : null;
    return { url, lodCounts };
  });
  fs.writeFileSync(`${OUT}${label}_far.jpg`, Buffer.from(r.url.split(',')[1], 'base64'));
  console.log(label, 'instances near/far', JSON.stringify(r.lodCounts));
  await page.close();
}
await browser.close();
