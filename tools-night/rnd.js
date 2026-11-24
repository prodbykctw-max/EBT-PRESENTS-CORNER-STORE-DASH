// node rnd.js <base> <out.json>: record the call site of every Math.random draw until the drive is ready (frozen clock, seeded random)
const { chromium } = require('playwright'); const fs = require('fs');
const [base, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await p.addInitScript(() => { let s = 12345; window.__rlog = []; const R = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    Math.random = function () { const st = (new Error().stack || '').split('\n')[2] || ''; window.__rlog.push(st.replace(/https?:\/\/[^/]+/, '').replace(/:\d+\)?$/, '').trim()); return R(); };
    performance.now = () => 5000; Date.now = () => 1764000000000; const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); });
  await p.route(/open-meteo/, (r) => r.abort());
  await p.goto(`${base}/drive/index.html?qa&bot&time=13:00&date=2026-11-24`);
  await p.waitForFunction(() => window.__drive && window.__drive.tick, null, { timeout: 900000 });
  const log = await p.evaluate(() => window.__rlog);
  // run-length compress
  const rl = []; for (const x of log) { if (rl.length && rl[rl.length - 1][0] === x) rl[rl.length - 1][1]++; else rl.push([x, 1]); }
  fs.writeFileSync(out, JSON.stringify(rl)); console.log(log.length, rl.length); await b.close();
})();
