// Animals QA. node qa.mjs <url> <tag> [stills]   (run under: flock /tmp/claude-browser.lock)
// Boots the drive (seeded Math.random, counted), reports the count at the first on-foot frame, whether the animals loaded, page errors and the cost of a tick;
// with `stills`, places a dog and pigeon flocks in front of the on-foot camera and writes snapshots to tools-animals/out/.
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, tag, mode] = process.argv.slice(2);
const OUT = process.env.OUT || 'tools-animals/out'; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const phone = (process.env.PHONE || '') === '1';
const p = await b.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true } : { viewport: { width: 960, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push('PAGE ' + e.message)); p.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !/open-meteo|ERR_FAILED|GPU stall|ReadPixels/.test(t)) errs.push(m.type() + ' ' + t.slice(0, 200)); });
await p.route(/open-meteo/, (r) => r.abort());
// ANIMALS=fail: the animals data never arrives; ANIMALS=late: it arrives after 12 s (the drive waits 8 s, then starts with the old animals)
if (process.env.ANIMALS === 'fail') await p.route(/animals\/animals\.bin/, (r) => r.abort());
if (process.env.ANIMALS === 'late') await p.route(/animals\/animals\.bin/, (r) => setTimeout(() => r.continue().catch(() => {}), 12000));
const asked = []; p.on('request', (r) => { if (/\/animals(\/|\.js)/.test(r.url())) asked.push(r.url().split('/').slice(-2).join('/')); });
// freeze the live loop the moment the drive publishes its test hook (before the loader has faded and any game time has run): the counts below then depend on nothing but the code
await p.addInitScript(() => { let _d; Object.defineProperty(window, '__drive', { configurable: true, get() { return _d; }, set(v) { _d = v; if (v && typeof v === 'object') v.manual = true; } }); });
await p.addInitScript(() => { let a = 0x12345678, n = 0; Math.random = () => { n++; a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; window.__rn = () => n; });
const t0 = Date.now();
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 1500000 });
const boot = await p.evaluate(() => { const d = window.__drive; d.manual = true; const w = d.world; return { rn: window.__rn(), state: d.state, animals: !!w.animals, dogs: w.ents.filter((e) => e.type === 'dog').length, birds: w.birds.flocks.length, bootS: 0 }; });
boot.bootS = Math.round((Date.now() - t0) / 1000);
console.log('BOOT', tag, JSON.stringify(boot), 'animals files requested:', JSON.stringify([...new Set(asked)]));
if (mode === 'rn') { // the count a few ticks later too (it varies a little between runs; compare several runs)
  const r = await p.evaluate(() => { const d = window.__drive; const out = []; for (let i = 0; i < 6; i++) { d.tick(1 / 60); out.push(window.__rn()); } return out; });
  console.log('RN', tag, JSON.stringify(r), 'errs', JSON.stringify(errs.slice(0, 4))); await b.close(); process.exit(0);
}
// the cost of a tick (physics + the draw of the frame; swiftshader, so GPU-heavy things are exaggerated)
const bench = () => p.evaluate(async () => { const d = window.__drive; const ts = []; for (let i = 0; i < 40; i++) { const a = performance.now(); d.tick(1 / 60); ts.push(performance.now() - a); } ts.sort((x, y) => x - y); return { med: +ts[20].toFixed(1), p90: +ts[36].toFixed(1) }; });
const warm = await bench(); console.log('TICK (warm)', tag, JSON.stringify(warm));
if (mode === 'bench') {   // the same scene on every build: a walking dog and a pigeon flock in front of the on-foot camera, then the cost of a tick, three times
  await p.evaluate(() => {
    const d = window.__drive, w = d.world, T = d.three, cam = T.camera, me = d.foot.me, B = w.birds;
    const e = w.ents.filter((x) => x.type === 'dog')[0]; e.s = Math.min(w.route.length - 20, Math.max(20, me.s + 8)); e.side = 1; e.d = e.side * (w.route.hw(e.s) + e.off); e.walk = 1.3; e.pause = -1; e.crossing = 0; e.bolt = 0; e.crossed = true;
    const e2 = w.ents.filter((x) => x.type === 'dog')[1]; e2.s = e.s + 6; e2.side = 1; e2.d = e2.side * (w.route.hw(e2.s) + e2.off); e2.walk = -1.2; e2.pause = -1; e2.crossed = true;
    const fw = new T.THREE.Vector3(); cam.getWorldDirection(fw); fw.y = 0; fw.normalize();
    const fl = B.flocks.filter((x) => x.ground && x.sp.mesh === 0).slice(0, 3);
    fl.forEach((f, i) => { f.x = cam.position.x + fw.x * (8 + i * 6); f.y = -(cam.position.z + fw.z * (8 + i * 6)); f.s = d.car.s + 400 + i; f.z = B.groundAt(f.x, f.y); for (const b of f.birds) b.gz = B.groundAt(f.x + b.ox, f.y + b.oy); });
    for (let i = 0; i < 90; i++) d.tick(1 / 60);
  });
  const rs = []; for (let k = 0; k < 3; k++) rs.push(await bench());
  // the cost of DRAWING the frame (tick() draws nothing): comic.render() then a read-back to wait for the GPU (swiftshader = the CPU rasteriser, so absolute numbers are only for comparing builds)
  const rd = await p.evaluate(() => { const d = window.__drive, gl = d.three.renderer.getContext(), px = new Uint8Array(4), ts = []; for (let i = 0; i < 9; i++) { d.tick(1 / 60); const a = performance.now(); d.comic.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - a); } ts.sort((x, y) => x - y); return { med: +ts[4].toFixed(0), min: +ts[0].toFixed(0), max: +ts[8].toFixed(0) }; });
  console.log('RENDER', tag, JSON.stringify(rd));
  const cnt = await p.evaluate(() => { const T = window.__drive.three, o = {}; T.scene.traverse((m) => { if (m.isInstancedMesh && m.count) o[m.name || m.uuid.slice(0, 6)] = m.count; }); return o; });
  const info = await p.evaluate(() => { const r = window.__drive.three.renderer.info; return { calls: r.render.calls, tris: r.render.triangles }; });
  console.log('BENCH', tag, JSON.stringify(rs), 'draw', JSON.stringify(info), 'instanced', JSON.stringify(Object.fromEntries(Object.entries(cnt).filter(([k]) => /dog|pigeon|bird|crow|animals/.test(k)))));
}
if (mode === 'stills') {
  // put things in front of the on-foot camera: a walking dog beside a pigeon flock
  const info = await p.evaluate(() => {
    const d = window.__drive, w = d.world, T = d.three, cam = T.camera, me = d.foot.me;
    const dir = new T.THREE.Vector3(); cam.getWorldDirection(dir);
    const dogs = w.ents.filter((e) => e.type === 'dog'); const e = dogs[0];
    // route position nearest the runner, so the dog is in the drawn window and in front of the camera
    e.s = Math.min(w.route.length - 20, Math.max(20, me.s + 8)); e.side = 1; e.d = e.side * (w.route.hw(e.s) + e.off); e.walk = 1.3; e.pause = -1; e.crossing = 0; e.bolt = 0; e.crossed = true;
    for (let i = 0; i < 120; i++) d.tick(1 / 60);   // let the dog walk (gait eases in)
    const p0 = w.route.at(e.s, e.d); return { dog: { s: e.s, d: e.d, gw: e.gw, gp: e.gp, color: e.color }, camPos: cam.position.toArray(), meS: me.s, p0: [p0.x, p0.y, p0.z, p0.a] };
  });
  console.log('STILL-SETUP', JSON.stringify(info));
  const shot = async (name, camPos, target, fov) => {
    await p.evaluate(([cp, tg, fov]) => { const d = window.__drive, cam = d.three.camera; cam.position.set(...cp); cam.lookAt(...tg); if (fov) { cam.fov = fov; } cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); }, [camPos, target, fov]);
    const u = await p.evaluate(() => window.__drive.snapshot(0.9)); fs.writeFileSync(`${OUT}/${tag}_${name}.jpg`, Buffer.from(u.split(',')[1], 'base64'));
  };
  // dog stills: position of the dog now
  const dogNow = () => p.evaluate(() => { const d = window.__drive, w = d.world, e = w.ents.find((x) => x.type === 'dog'); const q = w.route.at(e.s, e.d); const g = w.footAt ? w.footAt(q.x, q.y, q.z + 1.2) : null; return { x: q.x, y: g ?? q.z, z: -q.y, a: q.a, hd: e.hd, gw: e.gw, gp: e.gp, s: e.s }; });
  for (let k = 0; k < 3; k++) {
    await p.evaluate(() => { const d = window.__drive; for (let i = 0; i < 9; i++) d.tick(1 / 60); });
    const g = await dogNow();
    // side view: the camera on the road side of the dog, perpendicular to the route (scene x = x, z = -y; the route heading a is in x-y)
    const nx = Math.sin(g.a), nz = Math.cos(g.a);   // perpendicular in the scene plane
    await shot('dog' + k, [g.x - nx * 3.2, g.y + 1.0, g.z - nz * 3.2 * -1], [g.x, g.y + 0.6, g.z], 38);
  }
  // a crossing dog
  await p.evaluate(() => { const d = window.__drive, e = d.world.ents.find((x) => x.type === 'dog'); e.crossing = -e.side; e.crossed = true; e.pause = -1; for (let i = 0; i < 70; i++) d.tick(1 / 60); });
  { const g = await dogNow(); const nx = Math.sin(g.a), nz = Math.cos(g.a); await shot('dogcross', [g.x - nx * 4, g.y + 1.1, g.z + nz * 4], [g.x, g.y + 0.6, g.z], 38); console.log('CROSS', JSON.stringify(g)); }
  // pigeons: the flock nearest the runner, moved to 7 m in front of the camera on the ground
  const fl = await p.evaluate(() => {
    const d = window.__drive, w = d.world, B = w.birds, cam = d.three.camera, me = d.foot.me;
    const f = B.flocks.find((x) => x.ground && x.sp && x.sp.mesh === 0) || B.flocks.find((x) => x.ground);
    const fw = new d.three.THREE.Vector3(); cam.getWorldDirection(fw); fw.y = 0; fw.normalize();
    // where the (first) ground flock is: put it 8 m ahead of the camera
    f.x = cam.position.x + fw.x * 8; f.y = -(cam.position.z + fw.z * 8); f.s = d.car.s + 400;   // (far down the route so it does not lift off yet)
    f.z = B.groundAt(f.x, f.y); for (const b of f.birds) { b.gz = B.groundAt(f.x + b.ox, f.y + b.oy); }
    f.sp = f.sp; for (let i = 0; i < 20; i++) d.tick(1 / 60);
    return { n: f.birds.length, species: f.sp.mesh, x: f.x, y: f.y, z: f.z, camY: cam.position.y };
  });
  console.log('FLOCK', JSON.stringify(fl));
  { const u = await p.evaluate(() => window.__drive.snapshot(0.9)); fs.writeFileSync(`${OUT}/${tag}_view.jpg`, Buffer.from(u.split(',')[1], 'base64')); }   // the on-foot camera as the player sees it, dog and flock in front
  { const camP = await p.evaluate(() => window.__drive.three.camera.position.toArray()); const fx = fl.x, fz = -fl.y;
    await shot('pigeons', [fx + (camP[0] - fx) * 0.35, fl.z + 0.9, fz + (camP[2] - fz) * 0.35], [fx, fl.z + 0.15, fz], 34); }
  // lift off: nudge the flock's s next to the car, tick, snapshot a few frames in
  for (const [nm, nt] of [['lift1', 14], ['lift2', 14], ['lift3', 40]]) {
    if (nm === 'lift1') await p.evaluate(() => { const d = window.__drive, f = d.world.birds.flocks.find((x) => x.ground && Math.abs(x.s - d.car.s) > 300); f.s = d.car.s + 6; });
    await p.evaluate((n) => { const d = window.__drive; for (let i = 0; i < n; i++) d.tick(1 / 60); }, nt);
    const st = await p.evaluate(() => { const f = window.__drive.world.birds.flocks.find((x) => x.lifted); return f ? { t: f.t, n: f.birds.length, b0: [f.birds[0].x, f.birds[0].y, f.birds[0].z] } : null; });
    if (st) { const cp = await p.evaluate(() => window.__drive.three.camera.position.toArray()); const c = st.b0, bx = c[0], by = c[2], bz = -c[1];
      const dx = cp[0] - bx, dz = cp[2] - bz, L = Math.hypot(dx, dz) || 1;   // 3.5 m from the first bird, on the side the camera is on
      await shot(nm, [bx + dx / L * 3.5, by + 0.6, bz + dz / L * 3.5], [bx, by, bz], 40); console.log('LIFT', nm, JSON.stringify(st)); }
  }
}
console.log('DONE', tag, 'errs', JSON.stringify(errs.slice(0, 6)));
await b.close();
