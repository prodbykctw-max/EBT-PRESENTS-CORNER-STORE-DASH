// A frame strip of one lane change at speed (every 0.1 s of game time): the car in the right lane at 20 m/s moves to the left lane.
//   node tools-steer/strip.mjs <port> <before|after> <outdir>
// before = the old one-lane-per-press steering (one ArrowLeft press); after = hold ArrowLeft until the car is about a metre from the
// left lane's centre, then let go (the nose straightens by itself). Writes <outdir>/<mode>_NN.jpg and <outdir>/<mode>.json (per-frame d / yaw / steer).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const PORT = +process.argv[2], MODE = process.argv[3], OUT = process.argv[4];
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  const frames = [], log = [];
  await page.evaluate(async () => {
    const d = window.__drive; d.manual = true; d.freezeClock = true;
    const DT = 1 / 60, car = d.car, route = d.route;
    for (let i = 0; i < 400 && d.state !== 'driving'; i++) d.tick(DT);
    let s0 = null;
    for (let s = 60; s < route.length - 400 && s0 === null; s += 5) {
      let ok = true; const a0 = route.at(s).a;
      for (let k = 0; k <= 250 && ok; k += 10) { const a = route.at(s + k).a; if (Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0))) > 0.02 || route.parkD(s + k, -1) === null || route.parkD(s + k, 1) === null) ok = false; }
      if (ok) s0 = s;
    }
    for (const e of d.world.ents) if (Math.abs(e.s - s0) < 400) e.alive = false;
    Object.assign(car, { s: s0, d: route.lane(s0, 0), targetD: route.lane(s0, 0), v: 20, invuln: 1e9, steer: 0, yaw: 0, slide: 0, ay: 0, dv: 0 });
    d.keys.clear(); d.keys.add('gas');
    for (let i = 0; i < 90; i++) { car.v = 20; car.s = s0 + 0 * i; d.tick(DT); car.s = s0; }   // the camera settles behind the car
    car.v = 20; car.s = s0; car.d = route.lane(s0, 0);
    window.__strip = { DT, s0, left: route.lane(s0, 1) };
  });
  const N = 20;   // frames, 0.1 s apart
  for (let f = 0; f < N; f++) {
    const info = await page.evaluate(({ f, MODE }) => {
      const d = window.__drive, car = d.car, { DT, left } = window.__strip;
      const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
      let inp = 0;
      for (let i = 0; i < 6; i++) {   // 0.1 s of game time
        const t = (f * 6 + i) * DT;
        if (MODE === 'before') { if (f === 1 && i === 0) { key('ArrowLeft', true); key('ArrowLeft', false); } }
        else { if (f >= 1 && !window.__strip.released && car.d < left - 1.3) { if (!d.keys.has('left')) key('ArrowLeft', true); inp = 1; } else if (d.keys.has('left')) { key('ArrowLeft', false); window.__strip.released = true; } }
        car.v = 20; d.tick(DT);
      }
      const row = { t: +((f + 1) * 0.1).toFixed(1), d: +car.d.toFixed(2), yaw: +(car.yaw || 0).toFixed(3), steer: +(car.steer || 0).toFixed(2), holding: d.keys.has('left') ? 1 : 0, shot: d.snapshot(0.85) };
      if (f === 4) {   // t = 0.5 s: the same moment seen from in front of the car (three-quarter and head-on), to see the front wheels and the lean
        const { camera, carRig, THREE } = d.three, keep = camera.position.clone(), keepQ = camera.quaternion.clone();
        const look = carRig.localToWorld(new THREE.Vector3(0, 0.7, -1.2));
        for (const [name, off] of [['front34', [-3.6, 1.3, -6.2]], ['headon', [0, 1.2, -8.5]]]) { camera.position.copy(carRig.localToWorld(new THREE.Vector3(...off))); camera.lookAt(look); camera.updateMatrixWorld(true); row[name] = d.snapshot(0.88); }
        camera.position.copy(keep); camera.quaternion.copy(keepQ);
      }
      return row;
    }, { f, MODE });
    const { shot, front34, headon, ...rest } = info;
    if (front34) { fs.writeFileSync(`${OUT}/${MODE}_front34.jpg`, Buffer.from(front34.split(',')[1], 'base64')); fs.writeFileSync(`${OUT}/${MODE}_headon.jpg`, Buffer.from(headon.split(',')[1], 'base64')); }
    fs.writeFileSync(`${OUT}/${MODE}_${String(f).padStart(2, '0')}.jpg`, Buffer.from(shot.split(',')[1], 'base64'));
    log.push(rest);
  }
  fs.writeFileSync(`${OUT}/${MODE}.json`, JSON.stringify(log));
  console.log(MODE, JSON.stringify(log.map((r) => [r.t, r.d, r.yaw, r.steer])));
  console.log('errors', JSON.stringify(errs.filter((l) => !/AudioContext|KHR_parallel/.test(l))));
} finally { await browser.close(); }
