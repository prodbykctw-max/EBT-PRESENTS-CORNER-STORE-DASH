// The on-foot opening hands over to the real steering: you step up to the driver's door (as a player does, no bot), the car sits in the parking lane
// and swings out into the travel lane by itself (pullOut) with GAS held, then ◀ ▶ are yours.   node tools-steer/getin.mjs <port>
// Logs the car every 0.25 s for 7 s after getting in (s, d, nose yaw, steering), when the pull-out ended, anything it hit (car.invuln > 0), then a
// ◀ press during the pull-out (it must hand the wheel to the player at once).
import { chromium } from 'playwright-core';
const PORT = +process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 5; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  const res = await page.evaluate(async () => {
    const d = window.__drive; d.manual = true; d.freezeClock = true; const DT = 1 / 60, car = d.car, route = d.route, f = d.foot, key = (c, dn) => dispatchEvent(new KeyboardEvent(dn ? 'keydown' : 'keyup', { code: c }));
    const out = { start: { state: d.state, carS: +car.s.toFixed(1), carD: +car.d.toFixed(2), lane0: +route.lane(car.s, 0).toFixed(2) }, log: [] };
    // put the runner at the door and let the game's own getIn happen
    f.me.x = f.door.x + 0.4; f.me.y = f.door.y; f.me.px = f.me.x; f.me.py = f.me.y;
    let n = 0; while (d.state === 'onfoot' && n++ < 600) d.tick(DT);
    out.gotIn = { state: d.state, frames: n }; d.keys.add('gas');
    let inv = 0, endedAt = null; const d0 = car.d;
    for (let i = 0; i < 7 * 60; i++) { d.tick(DT); if (car.invuln > 0 && car.invuln < 1e8) inv++; if (endedAt === null && Math.abs(car.d - route.lane(car.s, 0)) < 0.35) endedAt = +(i * DT).toFixed(2);
      if (i % 15 === 0) out.log.push([+(i * DT).toFixed(2), +car.s.toFixed(1), +car.d.toFixed(2), +car.v.toFixed(1), +car.yaw.toFixed(3), +car.steer.toFixed(2)]); }
    out.pulledOutAt = endedAt; out.framesWithHitInvuln = inv; out.d0 = +d0.toFixed(2); out.finalD = +car.d.toFixed(2); out.finalYaw = +car.yaw.toFixed(4);
    return out;
  });
  console.log(JSON.stringify(res.start), JSON.stringify(res.gotIn), 'pulledOutAt(s)', res.pulledOutAt, 'hit frames', res.framesWithHitInvuln, 'd', res.d0, '->', res.finalD, 'yaw', res.finalYaw);
  console.log('t, s, d, v, yaw, steer'); for (const r of res.log) console.log(JSON.stringify(r));
  console.log('errors', JSON.stringify(errs.filter((l) => !/AudioContext|KHR_parallel/.test(l))));
} finally { await browser.close(); }
