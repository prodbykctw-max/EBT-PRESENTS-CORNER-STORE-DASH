// node tools-bridge/shots.mjs "http://localhost:5173/drive/index.html?qa&skipfoot&look=real" <tag> [out dir] — skipfoot boot; clearance + piers + camera clipping measurements; stills (chase under the Connector with/without the cutaway, street level)
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, tag] = process.argv.slice(2);
const OUT = (process.argv[4] || 'tools-bridge/out') + '/'; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678, n = 0; Math.random = () => { n++; a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; window.__rn = () => n; });
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.three, null, { timeout: 1200000 });
const save = async (name) => { const s = await p.evaluate(() => window.__drive.snapshot(0.9)); fs.writeFileSync(OUT + tag + '_' + name + '.jpg', Buffer.from(s.split(',')[1], 'base64')); };
const res = await p.evaluate(async () => {
  const d = window.__drive; d.manual = true; const T = d.three, THREE = T.THREE; const out = {};
  for (let i = 0; i < 400 && d.state !== 'driving'; i++) d.tick(1 / 60);
  out.state = d.state;
  const fwg = d.city.freeway.group, route = d.route, g = route.ground;
  // meshes: structure (soffit, fascia), caps (instanced), deck, columns
  const kids = fwg.children, deck = kids.find((k) => k.name === 'freeway_deck'), structure = kids.find((k) => k.name === 'freeway_structure');
  const inst = kids.filter((k) => k.isInstancedMesh); const columns = inst[0], caps = inst[1];
  fwg.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(); ray.layers.enableAll(); const up = new THREE.Vector3(0, 1, 0), dn = new THREE.Vector3(0, -1, 0);
  const upHit = (x, y, z, objs, far = 40) => { ray.set(new THREE.Vector3(x, z, -y), up); ray.far = far; const h = ray.intersectObjects(objs, false); return h.length ? h[0].distance : null; };
  // clearance over the route (soffit and bent caps): 1 m steps, 5 lateral positions
  let minRoute = 1e9, minRouteAt = null; const rows = [];
  for (let s = 1000; s <= 1100; s += 1) for (const dd of [-4, -2, 0, 2, 4]) {
    const q = route.at(s, dd), roadZ = g(q.x, q.y) + 0.17; const h = upHit(q.x, q.y, roadZ + 0.2, [structure, caps]);
    if (h !== null) { const c = h + 0.2; if (c < minRoute) { minRoute = c; minRouteAt = [s, dd]; } }
  }
  out.routeMinClear = +minRoute.toFixed(2); out.routeMinAt = minRouteAt;
  // columns: positions from the instance matrices; on a road surface?
  const cols = []; const m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (let i = 0; i < columns.count; i++) { columns.getMatrixAt(i, m); v.setFromMatrixPosition(m); cols.push([v.x, -v.z]); }
  out.columns = cols.length;
  const roadMeshes = [d.city.streets.roadsMesh, d.city.streets.routeMesh, d.city.streets.junctions].filter(Boolean);
  let onRoad = 0; const onList = [];
  for (const [x, y] of cols) {
    let hit = false;
    for (const [dx, dy] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) { ray.set(new THREE.Vector3(x + dx, 200, -(y + dy)), dn); ray.far = 400; const hs = ray.intersectObjects(roadMeshes, false); if (hs.length && hs[0].point.y > g(x + dx, y + dy) + 0.05) hit = true; }
    if (hit) { onRoad++; onList.push([+x.toFixed(0), +y.toFixed(0)]); }
  }
  out.columnsOnRoadMesh = onRoad; out.onList = onList.slice(0, 40);
  // drive through under the Connector on the real car: camera / car vs the slab, every frame
  d.car.s = 1010; d.car.v = 14; d.keys.add('gas');
  let minCam = 1e9, minCar = 1e9, camAt = null, inSlab = 0, frames = 0;
  const cam = T.camera;
  for (let i = 0; i < 900 && d.car.s < 1100; i++) {
    d.tick(1 / 60); if (d.car.s < 1015) continue; frames++;
    const cx = cam.position.x, cz = cam.position.z, cy = cam.position.y;
    const hc = upHit(cx, -cz, cy, [structure, caps], 30); if (hc !== null) { if (hc < minCam) { minCam = hc; camAt = [+d.car.s.toFixed(1), +cy.toFixed(2)]; } }
    const r = T.carRig.position; const hr = upHit(r.x, -r.z, r.y + 1.5, [structure, caps], 30); if (hr !== null && hr < minCar) minCar = hr;
    // inside the slab: a ray from far above down onto the deck top, camera between top and soffit
    ray.set(new THREE.Vector3(cx, cy + 20, cz), dn); ray.far = 40; const th = ray.intersectObjects([deck], false);
    if (th.length) { const topY = th[0].point.y; if (cy < topY && cy > topY - 1.4) inSlab++; }
  }
  out.cam = { frames, camToSoffit: +minCam.toFixed(2), at: camAt, framesCameraInSlab: inSlab, carRoofToSoffit: +minCar.toFixed(2) };
  return out;
});
console.log(tag, JSON.stringify(res));
// stills: chase camera at s = 1048, 1056 under the Connector, with and without the cutaway
await p.evaluate(() => { const d = window.__drive; d.keys.delete('gas'); d.car.v = 0; });
for (const s of [1046, 1058]) {
  await p.evaluate((s) => { const d = window.__drive; d.car.s = s; d.car.v = 13; d.car.d = d.car.targetD = 0; for (let i = 0; i < 90; i++) { d.car.s = s; d.car.v = 13; d.tick(1 / 60); } }, s);
  await save('chase' + s);
  const cutR = await p.evaluate(async () => { const d = window.__drive; const M = await import('/drive/roads.js'); const old = M.CUT.uCutR.value; M.CUT.uCutR.value = 0.001; return old; });
  await p.evaluate((s) => { const d = window.__drive; const cut = d.__cut; for (let i = 0; i < 2; i++) { d.car.s = s; d.car.v = 13; } }, s);
  // with the cutaway disabled for this frame: drive.js rewrites uCutR every frame, so render one frame by hand
  await p.evaluate(async (s) => { const d = window.__drive; const M = await import('/drive/roads.js'); const T = d.three; M.CUT.uCutPos.value.set(0, -999, 0); }, s);
  await save('chase' + s + '_nocut');
  await p.evaluate((s) => { const d = window.__drive; d.car.s = s; d.car.v = 13; d.tick(1 / 60); }, s);
}
// street level: free camera from the sidewalk looking at the bents
await p.setViewportSize({ width: 844, height: 390 }); await p.evaluate(() => window.dispatchEvent(new Event('resize')));
await p.evaluate(() => { const d = window.__drive; d.car.s = 1100; d.car.v = 0; d.tick(1 / 60); });
for (const [name, cx, cy, lx, ly] of [['street_west', -150, 6, -60, 14], ['street_east', -20, 8, -85, 12]]) {
  await p.evaluate(([cx, cy, lx, ly]) => { const d = window.__drive, T = d.three, g = d.route.ground; d.camOverride = { pos: new T.THREE.Vector3(cx, g(cx, cy) + 2.0, -cy), look: new T.THREE.Vector3(lx, g(lx, ly) + 4.5, -ly) }; d.tick(1 / 60); d.tick(1 / 60); }, [cx, cy, lx, ly]);
  await save(name);
}
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await b.close();
