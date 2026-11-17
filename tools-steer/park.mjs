// Does parking still trigger with analog steering, and does missing the box trigger nothing?
//   node tools-steer/park.mjs <port> <runs>      runs: comma list, in order, of  miss | 8g | 20g | 4c  (a parked page cannot be driven again, so a parking run is the last one per page load).
// (?qa&skipfoot, no bot: a scripted PLAYER holds GAS and ◀ ▶ through key events, stepped by hand at 1/60 s)
// The street from 160 m before the spot to the spot is cleared of traffic (so the test is about the steering and the box, not about dodging).
// Runs: 8g = 8 m/s on the gas, 20g = 20 m/s on the gas, 4c = 4 m/s coasting, each steering into the curb lane with a hold-and-release feedback driver; miss = drives the travel lane past the box: must NOT park.
import { chromium } from 'playwright-core';
const PORT = +process.argv[2], RUNS = (process.argv[3] || 'miss,8g').split(',');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  const res = await page.evaluate(async (RUNS) => {
    const d = window.__drive; d.manual = true; d.freezeClock = true;
    const DT = 1 / 60, car = d.car, route = d.route, spot = d.spot, key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    for (let i = 0; i < 400 && d.state !== 'driving'; i++) d.tick(DT);
    const out = { spot: { s: +spot.s.toFixed(1), d: +spot.d.toFixed(2) }, runs: [] };
    const run = (name, V, gas, park) => {
      for (const e of d.world.ents) if (e.s > spot.s - 200 && e.s < spot.s + 20) e.alive = false;
      Object.assign(car, { s: spot.s - 160, d: route.lane(spot.s - 160, 0), targetD: route.lane(spot.s - 160, 0), v: V, dv: 0, steer: 0, yaw: 0, slide: 0, ay: 0, invuln: 1e9 });
      d.keys.clear(); for (const c of ['ArrowLeft', 'ArrowRight']) key(c, false);
      if (gas) d.keys.add('gas');
      let held = 0, frames = 0, maxYaw = 0, dAtSpot = null;
      for (; frames < 60 * 40 && d.state === 'driving' && car.s < spot.s + 12; frames++) {
        if (park) {   // a driver: aim for the curb lane's middle once 90 m out, hold the key while the car is still too far off, let go when it will get there by itself
          const near = car.s > spot.s - 90, want = near ? spot.d : route.lane(car.s, 0), pred = car.d + car.dv * 0.6;
          const dir = !near ? 0 : pred > want + 0.25 ? -1 : pred < want - 0.25 ? 1 : 0;
          key('ArrowRight', dir < 0); key('ArrowLeft', dir > 0);
        }
        d.tick(DT); maxYaw = Math.max(maxYaw, Math.abs(car.yaw)); if (dAtSpot === null && car.s >= spot.s) dAtSpot = car.d;
      }
      key('ArrowRight', false); key('ArrowLeft', false);
      out.runs.push({ name, state: d.state, frames, parkEntry: { s: +(d.parkEntry.s ?? 0).toFixed(2), d: +(d.parkEntry.d ?? 0).toFixed(2), v: +(d.parkEntry.v ?? 0).toFixed(1) }, cleanPark: d.result.cleanPark, hits: d.result.hits, maxYaw: +maxYaw.toFixed(3), carNow: { s: +car.s.toFixed(1), d: +car.d.toFixed(2), v: +car.v.toFixed(1) } });
    };
    const spec = { miss: ['miss: travel lane past the box, no steering', 12, true, false], '8g': ['8 m/s on the gas, steer into the curb lane', 8, true, true], '20g': ['20 m/s on the gas, steer into the curb lane', 20, true, true], '4c': ['4 m/s coasting, steer into the curb lane', 4, false, true] };
    for (const r of RUNS) run(...spec[r]);
    return out;
  }, RUNS);
  console.log(JSON.stringify(res.spot)); for (const r of res.runs) console.log(JSON.stringify(r));
  console.log('errors', JSON.stringify(errs.filter((l) => !/AudioContext|KHR_parallel/.test(l))));
} finally { await browser.close(); }
