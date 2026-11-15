// Tap -> first drive frame, in the full game (/standalone.html), plus what the title feels while the drive is prepared in the background.
//   flock /tmp/claude-browser.lock node tools-load/prebuild.mjs <base url> <tag> --case a|b|c [--phone 1] [--cpu 4] [--stills dir]
// Cases: a = tap TAP TO START after 8 s on the title, START DRIVE after 7 s more (15 s in all); b = tap both as fast as possible (the
// title's intro skipped, START DRIVE at once); c = START DRIVE mid-prepare (title 3 s, how-to-play 1 s).
// --phone 1: 9 Mbps down / 1.5 up / 80 ms RTT (like the owner's phone link) and CPU throttle --cpu (default 4) through CDP.
// Prints one JSON line: tap time, when the drive was on screen (drive:shown if the drive marks it, else the loader leaving), the drive: marks relative to the
// tap, long tasks (>50 ms) while the prepare ran and in all, the longest, the worst rAF gap on the title, and the JS heap.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : A[i + 1]; };
const base = A[0], tag = A[1] || 'run', cs = arg('case', 'a'), phone = arg('phone', '0') === '1', cpu = +arg('cpu', 4), stills = arg('stills', '');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--host-resolver-rules=MAP api.open-meteo.com 127.0.0.1:9'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED|ERR_CONNECTION/.test(m.text())) errs.push(m.text().slice(0, 200)); });
const cdp = await ctx.newCDPSession(p);
if (phone) {
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
}
await p.addInitScript(() => {
  window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([+e.startTime.toFixed(0), +e.duration.toFixed(0)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  window.__gaps = []; let prev = 0; const tick = (t) => { if (prev && t - prev > 34) window.__gaps.push([+prev.toFixed(0), +(t - prev).toFixed(0)]); prev = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  window.__t = {};
  const mo = new MutationObserver(() => {
    const l = document.querySelector('.drive-loading'); if (window.__t.tap && !('loaderGone' in window.__t) && window.__drive && !l) window.__t.loaderGone = performance.now();
  });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { subtree: true, childList: true }));
});
await p.goto(base, { waitUntil: 'load' });
await p.waitForFunction(() => document.getElementById('btnTitle'), null, { timeout: 180000 });
const click = (id) => p.evaluate((i) => { const t = performance.now(); document.getElementById(i).click(); return t; }, id);
let tap, titleDone;
if (cs === 'a') {
  await p.waitForTimeout(8000); await click('btnTitle'); await p.waitForTimeout(7000);
} else if (cs === 'd') {   // tap after the prepare is done (software WebGL: it takes longer than 15 s)
  await p.waitForFunction(() => performance.getEntriesByName('drive:prepared').length, null, { timeout: 900000, polling: 200 });
  await p.waitForTimeout(1500); await click('btnTitle'); await p.waitForTimeout(2500);
} else if (cs === 'b') {
  await p.waitForTimeout(150); await click('btnTitle'); await p.waitForTimeout(120);
} else {
  await p.waitForTimeout(3000); await click('btnTitle'); await p.waitForTimeout(1000);
}
if (stills) await p.screenshot({ path: `${stills}/${tag}-how.png` });
// the stills of the title while the drive prepares are taken by the caller via --stills at the title (case a only)
tap = await p.evaluate(() => { const t = performance.now(); window.__t.tap = t; document.getElementById('btnDrive').click(); return t; });
await p.waitForFunction(() => window.__t.loaderGone || (performance.getEntriesByName('drive:shown').length), null, { timeout: 3000000, polling: 100 });
await p.waitForTimeout(600);
if (stills) await p.screenshot({ path: `${stills}/${tag}-first-frame.png` });
const out = await p.evaluate((tap) => {
  const m = Object.fromEntries(performance.getEntriesByType('mark').filter((x) => x.name.startsWith('drive:')).map((x) => [x.name.slice(6), +x.startTime.toFixed(0)]));
  const shown = m.shown ?? window.__t.loaderGone;
  const prepStart = m['prepare-start'] ?? null, prepEnd = m['prepared'] ?? null;
  const lt = window.__lt, inWin = (a, z) => lt.filter(([s, d]) => s + d > a && s < z);
  const win = prepStart != null ? inWin(prepStart, Math.min(prepEnd ?? tap, tap)) : [];
  const gaps = window.__gaps, gwin = prepStart != null ? gaps.filter(([s]) => s > prepStart && s < Math.min(prepEnd ?? tap, tap)) : [];
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  return { tap: +tap.toFixed(0), tapToShown: shown != null ? +(shown - tap).toFixed(0) : null, shownKind: m.shown != null ? 'drive:shown' : 'loader-gone', marksRelTap: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v - Math.round(tap)])), prepStart, prepEnd,
    prepareMs: prepStart != null && prepEnd != null ? prepEnd - prepStart : null,
    longTasksDuringPrepare: { n: win.length, over50: win.filter(([, d]) => d > 50).length, longest: win.reduce((a, [, d]) => Math.max(a, d), 0), list: win.map(([s, d]) => [s - prepStart, d]).slice(0, 60) },
    longTasksAll: { n: lt.length, longest: lt.reduce((a, [, d]) => Math.max(a, d), 0) },
    rafGapsDuringPrepare: { n: gwin.length, worst: gwin.reduce((a, [, d]) => Math.max(a, d), 0) },
    heapMB: mem, tTapRel: undefined };
}, tap);
out.tag = tag; out.case = cs; out.phone = phone; out.cpu = phone ? cpu : 1; out.errs = errs.slice(0, 5);
console.log(JSON.stringify(out));
await b.close();
