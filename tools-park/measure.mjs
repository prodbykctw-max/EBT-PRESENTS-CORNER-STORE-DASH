// How long does the end of the drive take, and what does the park report?
//   node tools-park/measure.mjs <port> <bot|hold> [seed]
// Steps the drive by hand (window.__drive.tick) on ?qa&skipfoot&bot: `bot` = the QA autopilot, `hold` = a scripted driver that holds GAS, stays in the
// travel lane, then steers into the parking lane 70 m before the spot and never brakes. Prints, in game time: from 95 m out to the drive reporting parked,
// the speed when it parked, timeLeft, the race result, cleanPark, hits, and (after the change) where the car entered the box.
import { chromium } from 'playwright-core';
const PORT = +process.argv[2], MODE = process.argv[3] || 'bot', SEED = +(process.argv[4] || 1);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((seed) => { let a = seed; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, SEED);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot&bot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  const res = await page.evaluate(async (MODE) => {
    const d = window.__drive; d.manual = true;
    let rep = null, clockMs = 0;
    if (MODE === 'bot') { const { autopilot } = await import('/drive/autopilot.js'); rep = autopilot(d, { manual: true, clock: () => clockMs }); }
    const DT = 1 / 60, out = { mode: MODE, spotS: d.spot.s, spotD: d.spot.d, hitsLog: [] };
    let frames = 0, t95 = null, v95 = null, last = d.state, tPark = null;
    while (frames < 30000 && !['parked', 'late', 'busted'].includes(d.state)) {
      if (MODE === 'hold') {
        d.keys.add('gas');
        const near = d.car.s > d.spot.s - 70;
        d.car.targetD = near ? d.spot.d : d.route.lane(d.car.s, 0);
      }
      d.tick(DT); clockMs += DT * 1000; frames++; if (rep && frames % 3 === 0) rep.tick();
      if (t95 === null && d.car.s >= d.spot.s - 95) { t95 = frames * DT; v95 = d.car.v; out.sAt95 = d.car.s; }
      if (d.state !== last) { last = d.state; out.stateChange = d.state; tPark = frames * DT; }
    }
    out.state = d.state; out.t95 = t95; out.v95 = v95; out.tEnd = tPark;
    out.secondsFrom95ToParked = tPark - t95;
    out.carAtPark = { s: d.car.s, d: d.car.d, v: d.car.v };
    out.timeLeft = d.time; out.result = { ...d.result }; out.parkEntry = d.parkEntry ? { ...d.parkEntry } : null;
    out.hits = d.result.hits; out.botErrors = rep ? rep.errors : null;
    return out;
  }, MODE);
  console.log(JSON.stringify(res)); console.log('LOGS', JSON.stringify(logs.filter((l) => !/AudioContext|KHR_parallel/.test(l))));
} finally { await browser.close(); }
