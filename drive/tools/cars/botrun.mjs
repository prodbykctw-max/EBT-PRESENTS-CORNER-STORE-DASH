// does the autopilot still finish the drive?  node botrun.mjs <port> [query]   (default: ?qa&skipfoot&bot, i.e. the BC fleet)
import { chromium } from 'playwright-core';
const PORT = +process.argv[2], Q = process.argv[3] ?? 'qa&skipfoot&bot';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [], reqs = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 1; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });   // the same seed every run: BC and the old cars meet the same world
  if (process.env.NORAF) await ctx.addInitScript(() => { window.requestAnimationFrame = () => 0; });   // no live frames: the world stays exactly as built until the test steps it (NORAF=1)
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 300)); });
  page.on('request', (r) => { if (/\.cars/.test(r.url())) reqs.push(r.url()); });
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?${Q}`);   // (?bot also stands the player's own steering aside)
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
  const res = await page.evaluate(async () => {
    const d = window.__drive, w = d.world; d.manual = true;
    const { autopilot } = await import('/drive/autopilot.js');   // (the page's own timer-driven bot never fires while the test steps the game itself)
    let clockMs = 0; const rep = autopilot(d, { manual: true, clock: () => clockMs });
    const out = { set: w.carSetName, spot: d.spot, start: { state: d.state, s: d.car.s } };
    let frames = 0, last = d.state; out.states = [d.state];
    while (frames < 12000 && !['parked', 'late', 'busted', 'done'].includes(d.state)) {
      d.tick(1 / 40); clockMs += 25; frames++; if (frames % 2 === 0) rep.tick();
      if (d.state !== last) { last = d.state; out.states.push(d.state + '@' + frames); }
    }
    out.bot = { hitList: rep.hits.slice(0, 6), popOutList: rep.popOut.slice(0, 4), hits: rep.hits.length, errors: rep.errors, stalls: rep.stalls, offroad: rep.offroad, brakes: rep.brakes, teleports: rep.teleports.length, popIn: rep.popIn.length, popOut: rep.popOut.length };
    out.frames = frames; out.state = d.state; out.carS = d.car.s; out.carD = d.car.d; out.timeLeft = d.time;
    out.sedanB = w.ents.filter((e) => e.type === 'sedan' && w.carSet && w.carSet.pick('sedan', e.cid) === w.carSet.keys.sedanB).length;
    return out;
  });
  console.log(JSON.stringify(res)); console.log('CARS REQUESTS', JSON.stringify(reqs)); console.log('LOGS', JSON.stringify(logs.filter((l) => !/AudioContext|KHR_parallel|429/.test(l))));
} finally { await browser.close(); }
