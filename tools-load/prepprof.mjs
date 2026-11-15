// CPU profile (main thread JS) of the background prepare, by phase (the drive:* marks), top self-time functions.
//   flock /tmp/claude-browser.lock node tools-load/prepprof.mjs <url of /standalone.html> [cpu throttle rate]
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--host-resolver-rules=MAP api.open-meteo.com 127.0.0.1:9'] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
const cdp = await p.context().newCDPSession(p);
if (process.argv[3]) await cdp.send('Emulation.setCPUThrottlingRate', { rate: +process.argv[3] });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
await p.goto(process.argv[2]);
await p.waitForFunction(() => performance.getEntriesByName('drive:prepared').length, null, { timeout: 1800000, polling: 500 });
const now = await p.evaluate(() => performance.now());
const { profile } = await cdp.send('Profiler.stop');
const marks = await p.evaluate(() => performance.getEntriesByType('mark').filter((m) => m.name.startsWith('drive:')).map((m) => [m.name.slice(6), m.startTime]));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
let t = profile.startTime; const samples = []; profile.samples.forEach((id, i) => { t += profile.timeDeltas[i]; samples.push([t / 1000, id]); });
const shift = now - samples[samples.length - 1][0];
const bounds = marks.sort((a, c) => a[1] - c[1]);
const phase = (ms) => { let name = 'before ' + bounds[0][0]; for (const [n, m] of bounds) if (ms >= m) name = n; return name; };
const agg = {}, per = {};
for (const [ms, id] of samples) { const n = byId.get(id), f = n.callFrame; if (f.functionName === '(idle)' || f.functionName === '(program)') continue; const ph = phase(ms + shift), key = ph + ' | ' + (f.functionName || '(anon)') + ' ' + f.url.split('/').pop() + ':' + f.lineNumber; agg[key] = (agg[key] || 0) + 0.5; per[ph] = (per[ph] || 0) + 0.5; }
console.log(JSON.stringify({ perPhaseMs: per, top: Object.entries(agg).sort((a, c) => c[1] - a[1]).slice(0, 60) }, null, 1));
await b.close();
