// Network + phase timing of the drive's load, in the full game (/standalone.html), on a throttled link.
//   flock /tmp/claude-browser.lock node tools-load/net.mjs <base url> <tag> [--down 9 --up 1.5 --rtt 80] [--title 4 --how 3] [--second] [--stop bar|frame]
// Flow: open the page, sit on the title (--title s), tap TAP TO START, sit on the drive how-to-play (--how s), tap START DRIVE (t0),
// then record every request (URL, wire bytes, content-encoding, start/end relative to t0) until the loader bar reaches 70% (all downloads
// done) and, with --stop frame, until the first drive frame (window.__drive). --second repeats the whole thing in the same context (warm cache).
// Output: JSON on stdout (requests, totals, marks); a table on stderr.
import { chromium } from 'playwright-core';
const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : A[i + 1]; };
const base = A[0], tag = A[1] || 'run';
const down = +arg('down', 9), up = +arg('up', 1.5), rtt = +arg('rtt', 80), titleS = +arg('title', 4), howS = +arg('how', 3), stop = arg('stop', 'bar');
const noThrottle = A.includes('--nothrottle');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP api.open-meteo.com 127.0.0.1:9'] });   // (no page.route: Playwright turns the HTTP cache off while a route is set; the weather call just fails fast like an offline phone)
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
async function visit(label) {
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  if (!noThrottle) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: rtt, downloadThroughput: down * 1e6 / 8, uploadThroughput: up * 1e6 / 8 });
  const reqs = new Map(); let t0 = null, tw0 = null;
  cdp.on('Network.requestWillBeSent', (e) => { if (!reqs.has(e.requestId)) reqs.set(e.requestId, { url: e.request.url, start: e.timestamp, wall: e.wallTime, type: e.type, initiator: e.initiator?.type }); });
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.enc = e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'] || ''; r.cache = e.response.fromDiskCache ? 'disk' : e.response.fromPrefetchCache ? 'prefetch' : ''; r.cc = e.response.headers['cache-control'] || ''; r.ct = e.response.headers['content-type'] || ''; r.resp = e.timestamp; } });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.wire = e.encodedDataLength; } });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.end = e.timestamp; r.failed = e.errorText; } });
  await p.addInitScript(() => {
    window.__t = {}; const m = (k) => { if (!(k in window.__t)) window.__t[k] = performance.now(); };
    window.__mark = m;
    // the loader bar: 5% when the drive starts its loader, 70% once every download has arrived, 100% at the first frame
    const mo = new MutationObserver(() => { const i = document.querySelector('.drive-loading i'); if (!i) return; const w = parseFloat(i.style.width); if (w >= 5) m('bar5'); if (w >= 70) m('bar70'); if (w >= 100) m('bar100'); });
    document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { subtree: true, attributes: true, childList: true, attributeFilter: ['style'] }));
    let drv; Object.defineProperty(window, '__drive', { configurable: true, get: () => drv, set: (v) => { drv = v; if (v) m('frame'); } });
  });
  const tNav = Date.now();
  await p.goto(base, { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('btnTitle'), null, { timeout: 120000 });
  await p.waitForTimeout(titleS * 1000);
  await p.evaluate(() => document.getElementById('btnTitle').click());
  await p.waitForTimeout(howS * 1000);
  const tapWall = Date.now() / 1000;
  const wall0 = await p.evaluate(() => { const t = performance.now(); document.getElementById('btnDrive').click(); window.__t.tap = t; return t; });
  const tapPerf = wall0;
  const waitFor = stop === 'frame' ? () => window.__t.frame : () => window.__t.bar70;
  await p.waitForFunction(waitFor, null, { timeout: 1800000 });
  const t = await p.evaluate(() => ({ ...window.__t, marks: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('drive:')).map((m) => [m.name, +m.startTime.toFixed(0)]), longs: 0 }));
  const first = [...reqs.values()].filter((r) => r.start).sort((a, c) => a.start - c.start);
  await p.close();
  return { label, reqs: first, t, tapPerf, tapWall };
}
const results = [];
results.push(await visit('first'));
if (A.includes('--second')) results.push(await visit('second'));
await b.close();
const out = [];
for (const v of results) {
  // anchor: the page's perf clock vs the CDP clock. The last request's end time vs the page's bar70 time are close but not equal, so use the
  // requests the tap starts: tapRel = request.start - firstPostTap.start is NOT available, instead use wall deltas from the page's own PerformanceResourceTiming.
  out.push(v);
}
console.log(JSON.stringify({ tag, down, up, rtt, titleS, howS, stop, results: out.map((v) => ({ label: v.label, t: v.t, tapWall: v.tapWall, tapPerf: v.tapPerf, reqs: v.reqs.map((r) => ({ url: r.url.replace(/^https?:\/\/[^/]+/, ''), type: r.type, status: r.status, enc: r.enc, cache: r.cache, cc: r.cc, ct: r.ct, start: +(r.wall - v.tapWall).toFixed(3), resp: r.resp && +(r.resp - r.start).toFixed(3), end: r.end && +(r.wall - v.tapWall + r.end - r.start).toFixed(3), wire: r.wire, failed: r.failed })) })) }));
