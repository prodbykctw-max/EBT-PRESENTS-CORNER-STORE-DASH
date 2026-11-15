// CPU profile of the drive's startup (main thread JS), grouped by the drive:* marks. Network unthrottled, local server.
//   flock /tmp/claude-browser.lock node tools-load/prof.mjs <url of /standalone.html>
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP api.open-meteo.com 127.0.0.1:9'] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
const cdp = await p.context().newCDPSession(p);
await p.addInitScript(() => { let drv; Object.defineProperty(window, '__drive', { configurable: true, get: () => drv, set: (v) => { drv = v; window.__fr = performance.now(); } }); });
await p.goto(process.argv[2]);
await p.waitForFunction(() => document.getElementById('btnTitle'), null, { timeout: 120000 });
await p.waitForTimeout(3000);
await p.evaluate(() => document.getElementById('btnTitle').click()); await p.waitForTimeout(500);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
await p.evaluate(() => document.getElementById('btnDrive').click());
await p.waitForFunction(() => window.__fr, null, { timeout: 900000 });
const { profile } = await cdp.send('Profiler.stop');
const marks = await p.evaluate(() => performance.getEntriesByType('mark').filter((m) => m.name.startsWith('drive:')).map((m) => [m.name, m.startTime]));
// profile times are in microseconds on the same monotonic clock as performance.now() (timeOrigin-relative offset applied below)
const byId = new Map(profile.nodes.map((n) => [n.id, n])); const t0 = profile.startTime / 1000;
const origin = await p.evaluate(() => performance.timeOrigin); // ms epoch; profile.startTime is monotonic us: align by first mark
let t = profile.startTime; const samples = []; profile.samples.forEach((id, i) => { t += profile.timeDeltas[i]; samples.push([t / 1000, id]); });
// align: the last sample ~ the page's __fr moment
const fr = await p.evaluate(() => window.__fr); const shift = fr - samples[samples.length - 1][0];
const bounds = marks.map(([n, ms]) => [n, ms]).sort((a, c) => a[1] - c[1]);
const phase = (ms) => { let name = 'before ' + bounds[0][0]; for (const [n, m] of bounds) if (ms >= m) name = 'after ' + n; return name; };
const agg = {};
for (const [ms, id] of samples) { const n = byId.get(id), f = n.callFrame, key = phase(ms + shift) + ' | ' + (f.functionName || '(anon)') + ' ' + f.url.split('/').pop() + ':' + f.lineNumber; agg[key] = (agg[key] || 0) + 0.5; }
const perPhase = {}; for (const [k, v] of Object.entries(agg)) { const ph = k.split(' | ')[0]; perPhase[ph] = (perPhase[ph] || 0) + v; }
console.log(JSON.stringify({ marks: bounds.map(([n, m]) => [n, Math.round(m)]), perPhase, top: Object.entries(agg).sort((a, c) => c[1] - a[1]).slice(0, 40) }, null, 1));
await b.close();
