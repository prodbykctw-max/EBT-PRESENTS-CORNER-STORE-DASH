// Response of the drive's steering, on a fixed 1/60 s clock (window.__drive.tick), on a straight, cleared stretch with the speed held.
//   node tools-steer/steer.mjs <port> <outfile.json>
// Scenarios at 10 and 25 m/s: hold RIGHT 0.5 s then release; hold LEFT 1.5 s (runs into the road edge); a quick tap of RIGHT (one frame down, a real
// keydown/keyup); a slalom (LEFT/RIGHT 0.6 s each x 4); and the "stop anywhere" check (hold RIGHT until d = -2.0, release: where it settles).
// Logs per frame: t, held input, steering value, yaw, side speed, d. Prints the summary: peak yaw, peak side speed, d moved, release -> straight.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const PORT = +process.argv[2], OUT = process.argv[3];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  const res = await page.evaluate(async () => {
    const d = window.__drive; d.manual = true; d.freezeClock = true;
    const DT = 1 / 60, car = d.car, route = d.route;
    for (let i = 0; i < 400 && d.state !== 'driving'; i++) d.tick(DT);
    // a straight stretch with a parking lane on both sides, 250 m long
    let s0 = null;
    for (let s = 60; s < route.length - 400 && s0 === null; s += 5) {
      let ok = true; const a0 = route.at(s).a;
      for (let k = 0; k <= 250 && ok; k += 10) { const a = route.at(s + k).a; if (Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0))) > 0.02 || route.parkD(s + k, -1) === null || route.parkD(s + k, 1) === null) ok = false; }
      if (ok) s0 = s;
    }
    const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    const reset = (V) => {
      for (const e of d.world.ents) if (Math.abs(e.s - s0) < 400) e.alive = false;
      Object.assign(car, { s: s0, d: route.lane(s0, 0), targetD: route.lane(s0, 0), v: V, dv: 0, steer: 0, yaw: 0, slide: 0, ay: 0, scrape: 0, invuln: 1e9 });
      d.keys.clear(); d.keys.add('gas');
      for (let i = 0; i < 20; i++) { car.v = V; car.s = s0; d.tick(DT); }
      car.v = V; car.s = s0; car.d = route.lane(s0, 0); car.dv = 0; car.yaw = 0; car.steer = 0; car.slide = 0; car.ay = 0;
    };
    const run = (V, secs, inputAt) => {   // inputAt(t) -> -1 (right) | 0 | 1 (left), or a function (t, i) that drives key events itself
      reset(V); const log = [];
      for (let i = 0; i < Math.round(secs * 60); i++) {
        const t = i * DT, want = inputAt(t, i);
        if (typeof want === 'number') { if (want > 0) { d.keys.add('left'); d.keys.delete('right'); } else if (want < 0) { d.keys.add('right'); d.keys.delete('left'); } else { d.keys.delete('left'); d.keys.delete('right'); } }
        car.v = V; d.tick(DT);
        log.push([+t.toFixed(3), d.keys.has('left') ? 1 : d.keys.has('right') ? -1 : 0, +car.steer.toFixed(3), +car.yaw.toFixed(4), +car.dv.toFixed(3), +car.d.toFixed(3), +car.slide.toFixed(4), +car.ay.toFixed(2), +route.hw(car.s).toFixed(2)]);
      }
      d.keys.delete('left'); d.keys.delete('right');
      return log;
    };
    const out = { s0, lane0: route.lane(s0, 0), travel: route.travel(s0), hw: route.hw(s0), runs: {} };
    for (const V of [10, 25]) {
      out.runs['right0.5_' + V] = run(V, 2.5, (t) => (t < 0.5 ? -1 : 0));
      out.runs['left1.5_' + V] = run(V, 3.5, (t) => (t < 1.5 ? 1 : 0));
      out.runs['edgeL3.5_' + V] = run(V, 5, (t) => (t < 3.5 ? 1 : 0));
      out.runs['edgeR3.5_' + V] = run(V, 5, (t) => (t < 3.5 ? -1 : 0));
      out.runs['tap_' + V] = run(V, 2.0, (t, i) => { if (i === 6) key('ArrowRight', true); if (i === 7) key('ArrowRight', false); return null; });
      out.runs['slalom_' + V] = run(V, 6, (t) => { const k = Math.floor(t / 0.6); return k < 8 ? (k % 2 ? 1 : -1) : 0; });
      out.runs['stop_' + V] = (() => { reset(V); const log = []; let rel = null;
        for (let i = 0; i < 300; i++) { const t = i * DT; if (rel === null && car.d <= -2.0) rel = t; if (rel === null) d.keys.add('right'); else d.keys.delete('right'); car.v = V; d.tick(DT); log.push([+t.toFixed(3), rel === null ? -1 : 0, +car.steer.toFixed(3), +car.yaw.toFixed(4), +car.dv.toFixed(3), +car.d.toFixed(3), +car.slide.toFixed(4), +car.ay.toFixed(2), +route.hw(car.s).toFixed(2)]); }
        d.keys.delete('right'); return log; })();
    }
    out.roadHalf = route.hw(s0);
    return out;
  });
  fs.writeFileSync(OUT, JSON.stringify(res));
  const f = (x, n = 2) => (x === null ? '-' : x.toFixed(n));
  console.log('straight stretch s0', res.s0, 'lane0 d', res.lane0.toFixed(2), 'travel', res.travel.toFixed(2), 'hw', res.hw.toFixed(2));
  console.log('run                 peakSteer peakYaw peakSide(m/s) dMoved(m) d_final  release->straight(s)  steerOut->0.02(s)');
  for (const [k, L] of Object.entries(res.runs)) {
    const d0 = L[0][5]; let lastIn = -1; L.forEach((r, i) => { if (r[1] !== 0) lastIn = i; });
    const peak = (c) => L.reduce((m, r) => Math.max(m, Math.abs(r[c])), 0);
    let straight = null; for (let i = lastIn + 1; i < L.length; i++) if (Math.abs(L[i][3]) < 0.02) { straight = L[i][0] - L[lastIn][0]; break; }
    console.log(k.padEnd(18), f(peak(2), 2).padStart(9), f(peak(3), 3).padStart(8), f(peak(4)).padStart(13), f(L[L.length - 1][5] - d0).padStart(10), f(L[L.length - 1][5]).padStart(8), (lastIn >= 0 ? f(straight, 2) : '-').padStart(20));
  }
  let worst = -9; for (const L of Object.values(res.runs)) for (const r of L) worst = Math.max(worst, Math.abs(r[5]) - (r[8] - 0.98));
  console.log('closest the car centre came to the road edge (|d| - (hw - halfW)); must be <= 0:', worst.toFixed(3));
  console.log('errors', JSON.stringify(errs.filter((l) => !/AudioContext|KHR_parallel/.test(l))));
} finally { await browser.close(); }
