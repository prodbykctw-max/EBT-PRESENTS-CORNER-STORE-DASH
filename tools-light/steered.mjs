// node tools-light/steered.mjs <url ?qa&skipfoot&time=21:00> <outdir>: the car steered mid-turn (LEFT held, as tools-steer/steer.mjs), a chase frame at night and the same pose relit to pink dusk,
// plus the headlight spot's aim against the car's drawn heading (they must agree: the spot is a child of the car rig). Wrap in flock /tmp/claude-browser.lock.
import fs from 'fs'; import { chromium } from 'playwright-core';
import { atlantaInstant } from '../public/drive/daylight.js';
const [url, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 480, height: 854 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/open-meteo/, (r) => r.abort());
await p.goto(url); await p.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
const save = (n, s) => fs.writeFileSync(`${out}/${n}.jpg`, Buffer.from(s.split(',')[1], 'base64'));
const r = await p.evaluate(() => {
  const d = window.__drive; d.manual = true; d.freezeClock = true; const DT = 1 / 60, car = d.car, route = d.route;
  for (let i = 0; i < 400 && d.state !== 'driving'; i++) d.tick(DT);
  const s0 = d.spot.s - 90; for (const e of d.world.ents) if (Math.abs(e.s - s0) < 200) e.alive = false;
  Object.assign(car, { s: s0, d: route.lane(s0, 0), targetD: route.lane(s0, 0), v: 14, dv: 0, steer: 0, yaw: 0, slide: 0, ay: 0, scrape: 0, invuln: 1e9 });
  d.keys.clear(); d.keys.add('gas'); for (let i = 0; i < 20; i++) { car.v = 14; d.tick(DT); }
  d.keys.add('left'); let peak = 0; for (let i = 0; i < 24; i++) { car.v = 14; d.tick(DT); peak = Math.max(peak, Math.abs(car.yaw)); }
  const T = d.three.THREE, rig = d.three.carRig, L = d.three.scene.getObjectByName('car_headlights');
  rig.updateMatrixWorld(true); const a = L.getWorldPosition(new T.Vector3()), t = L.target.getWorldPosition(new T.Vector3()), aim = t.sub(a).setY(0).normalize();
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(rig.getWorldQuaternion(new T.Quaternion())).setY(0).normalize();
  return { yaw: car.yaw, peak, held: [...d.keys], aimVsHeadingDeg: Math.acos(Math.min(1, Math.abs(aim.dot(fwd)))) * 180 / Math.PI, spot: L.intensity };
});
console.log('steered', JSON.stringify(r));
const shot = async (n, time) => { await p.evaluate((w) => { const d = window.__drive; d.relight(w, { code: 0, cloud: 10, rain: 0 }); d.keys.add('left'); d.tick(0.0001); }, atlantaInstant(2026, 11, 16, ...time)); save(n, await p.evaluate(() => window.__drive.snapshot(0.92))); };
await shot('night', [21, 0]); await shot('dusk', [17, 47]);
console.log('errs', JSON.stringify(errs)); await b.close();
