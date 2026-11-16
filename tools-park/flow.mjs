// The whole game flow through the new parking: node tools-park/flow.mjs <port> [query]   (default query: noprepare&qa&bot)
// title -> TAP TO START -> the drive's how-to-play -> START DRIVE -> the drive (QA bot, stepped by hand) -> parked -> the store's how-to-play (the drive's result
// reaches the store: it reads the bonus, the clean park and the race) -> START RUN, then S.driveBonus / S.bullyIn say what the store took from the result.
// Without `noprepare` this is the prepared start (the drive built behind the title, START DRIVE only reveals it).
import { chromium } from 'playwright-core';
const PORT = +process.argv[2], Q = process.argv[3] ?? 'noprepare&qa&bot';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { let a = 7; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const page = await ctx.newPage(); const logs = [];
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
  const vis = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && !e.hidden; }, id);
  await page.goto(`http://127.0.0.1:${PORT}/standalone.html?${Q}`);
  await page.waitForFunction(() => window.__csd && document.getElementById('btnTitle'), null, { timeout: 600000, polling: 1000 });
  await page.waitForTimeout(6000);   // the title assembles (~2.3 s) and settles
  const steps = [];
  await page.evaluate(() => document.getElementById('btnTitle').click()); steps.push('title tapped');
  await page.waitForFunction(() => { const e = document.getElementById('btnDrive'); return e && getComputedStyle(e).visibility !== 'hidden' && e.offsetParent; }, null, { timeout: 60000 });
  steps.push('drive how-to-play shown: ' + await vis('ovDriveHow'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('btnDrive').click()); steps.push('START DRIVE tapped');
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  const res = await page.evaluate(async () => {
    const d = window.__drive; d.manual = true;
    const { autopilot } = await import('/drive/autopilot.js'); let clockMs = 0; const rep = autopilot(d, { manual: true, clock: () => clockMs });
    const states = [d.state]; let frames = 0, last = d.state;
    let after = 0;   // once it is parked the arrival shot runs 4.2 s of game time, then the drive fades out in real time (so stop stepping just after finish())
    while (frames < 40000) {
      d.tick(1 / 40); clockMs += 25; frames++; if (frames % 2 === 0) rep.tick();
      if (d.state !== last) { last = d.state; states.push(d.state + '@' + frames); }
      if (['parked', 'late', 'busted'].includes(d.state) && ++after >= 172) break;   // 172 x 1/40 s = 4.3 s > 4.2
    }
    return { states, frames, result: { ...d.result }, parkEntry: { ...d.parkEntry }, timeLeft: d.time, hits: rep.hits.length, errors: rep.errors };
  });
  steps.push('drive ended in the page: ' + JSON.stringify({ states: res.states, frames: res.frames }));
  await page.waitForFunction(() => window.__csd.S.mode === 'how', null, { timeout: 120000, polling: 500 });
  const how = { ovHow: await vis('ovHow'), driveRoots: await page.evaluate(() => document.querySelectorAll('.drive-root').length) };
  await page.evaluate(() => document.getElementById('btnStart').click());
  await page.waitForTimeout(1500);
  const store = await page.evaluate(() => { const S = window.__csd.S; return { mode: S.mode, driveBonus: S.driveBonus, bullyIn: S.bullyIn, bullyTail: S.bullyTail, bullyOutside: S.bullyOutside, drive: S.drive && { parked: S.drive.parked, cleanPark: S.drive.cleanPark, bonus: S.drive.bonus, timeLeft: S.drive.timeLeft, bully: S.drive.bully } }; });
  console.log(JSON.stringify({ query: Q, steps, driveResult: res.result, parkEntry: res.parkEntry, timeLeft: res.timeLeft, botHits: res.hits, botErrors: res.errors, how, store }, null, 1));
  console.log('LOGS', JSON.stringify(logs.filter((l) => !/AudioContext|KHR_parallel|open-meteo|ERR_FAILED/.test(l))));
} finally { await browser.close(); }
