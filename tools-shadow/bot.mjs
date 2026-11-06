// node tools-shadow/bot.mjs <port> : ?qa&bot, manual + freezeClock, tick(1/60), __botReport.tick() every 3 ticks; phone-emulated
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
const port = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage(); const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
await page.route(/open-meteo\.com/, (r) => r.abort());
await page.addInitScript(() => { let s = 1; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
await page.goto(`http://localhost:${port}/drive/index.html?qa&bot`);
await page.waitForFunction(() => window.__drive && window.__drive.world && window.__botReport, null, { timeout: 1500000, polling: 2000 });
const res = await page.evaluate(() => {
  const d = window.__drive; d.manual = true; d.freezeClock = true;
  let n = 0, last = d.state; const st = [last];
  while (n < 20000 && !['parked', 'late', 'busted', 'done'].includes(d.state)) { d.tick(1 / 60); n++; if (n % 3 === 0) window.__botReport.tick(); if (d.state !== last) { last = d.state; st.push(d.state + '@' + n); } }
  const r = window.__botReport;
  return { ticks: n, state: d.state, s: d.car.s, errors: r.errors.length, errs: r.errors.slice(0, 3), hits: r.hits.length, teleports: r.teleports.length, states: st, blob: d.three.scene.getObjectByName('crowd_contact')?.count };
});
console.log(JSON.stringify({ ...res, logs: logs.filter((l) => !/ERR_FAILED/.test(l)) })); await browser.close();
