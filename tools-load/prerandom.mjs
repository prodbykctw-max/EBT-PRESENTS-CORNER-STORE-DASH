// Is the drive's own Math.random sequence the same when it is prepared in the background as when it is built on the tap (and as on another server's code)?
// Math.random is replaced by three seeded streams picked by who calls: the drive's code (and three.js made by it), audio.js, and everything else (the title screen, the page). The seeds are fixed, so the
// drive's stream is the same whatever the others draw or whenever they draw it: the state at the first frame (camera, the traffic, the crowd, you and the bully) must then be identical, and so must the
// number of draws per drive file and their order. Also: nothing but the drive should draw while it is being prepared, and the audio stream must stay untouched until START.
//   flock /tmp/claude-browser.lock node tools-load/prerandom.mjs <url of /standalone.html> <tag> [--wait-prepared 1]
import { chromium } from 'playwright-core';
const A = process.argv.slice(2); const arg = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : A[i + 1]; };
const url = A[0], tag = A[1] || 'run', waitPrep = arg('wait-prepared', '0') === '1';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP api.open-meteo.com 127.0.0.1:9'] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.addInitScript(() => {
  const mk = (seed) => { let a = seed | 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const S = { drive: mk(0x1234567), audio: mk(0x7654321), other: mk(0x2468ace) };
  const C = { drive: 0, audio: 0, other: 0 }, byFile = {}, seq = [], otherFiles = {}; let seqHash = 0;
  window.__rnd = { C, byFile, otherFiles, seq, hash: () => seqHash };
  Math.random = () => {
    const st = new Error().stack || '';
    const lines = st.split('\n').slice(2);
    const first = (lines.find((l) => !/three\.module|three\.core|\(<anonymous>\)/.test(l)) || lines[0] || '');
    const isAudio = /audio\.js/.test(st), isDrive = /\/drive\//.test(st) && !isAudio;
    const k = isAudio ? 'audio' : isDrive ? 'drive' : 'other';
    C[k]++;
    const f0 = (first.match(/([\w.-]+\.(?:js|html)(?::\d+)?)/) || ['?'])[1]; const f = /runner\.js|crowd\.js|birds\.js|traffic\.js/.test(f0) ? f0 : f0.replace(/:.*/, '');
    if (k === 'drive') { byFile[f] = (byFile[f] || 0) + 1; if (seq.length === 0 || seq[seq.length - 1][0] !== f) seq.push([f, 1]); else seq[seq.length - 1][1]++; }
    else if (k === 'other') otherFiles[f] = (otherFiles[f] || 0) + 1;
    return S[k]();
  };
  window.__ac = []; const AC = window.AudioContext; if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ac.push(this); } };
  window.__gl = 0; const dc = WebGL2RenderingContext.prototype.drawElements; WebGL2RenderingContext.prototype.drawElements = function (...a) { window.__gl++; return dc.apply(this, a); };
  const da = WebGL2RenderingContext.prototype.drawArrays; WebGL2RenderingContext.prototype.drawArrays = function (...a) { window.__gl++; return da.apply(this, a); };
  window.__raf = 0; const rq = window.requestAnimationFrame; window.requestAnimationFrame = (f) => rq((t) => { const s = new Error().stack || ''; f(t); });
  let drv; Object.defineProperty(window, '__drive', { configurable: true, get: () => drv, set: (v) => { drv = v; if (v && !window.__first) { const d = v, T = d.three, c = T.camera, q = c.quaternion, f = d.foot;
    window.__first = { rn: { ...C }, byFile: { ...window.__rnd.byFile }, seq: window.__rnd.seq.map((x) => [...x]), state: d.state, time: d.time, cam: [c.position.x, c.position.y, c.position.z, q.x, q.y, q.z, q.w].map((x) => +x.toFixed(5)), me: [f.me.x, f.me.y, f.me.heading].map((x) => +x.toFixed(5)), him: [f.him.x, f.him.y].map((x) => +x.toFixed(5)), car: [d.car.s, d.car.d].map((x) => +x.toFixed(4)),
      ents: d.world.ents.filter((e) => e.alive).map((e) => [e.type, +e.s.toFixed(2), +e.d.toFixed(2)]).slice(0, 80), nEnts: d.world.ents.filter((e) => e.alive).length, ppl: d.world.crowd.people.slice(0, 60).map((x) => [+x.s.toFixed(3), +x.d.toFixed(3)]), nppl: d.world.crowd.people.length }; } } });
});
await p.goto(url);
await p.waitForFunction(() => document.getElementById('btnTitle'), null, { timeout: 120000 });
let pre = null;
if (waitPrep) {
  await p.waitForFunction(() => performance.getEntriesByName('drive:prepared').length, null, { timeout: 1200000, polling: 300 });
  await p.waitForTimeout(500);
  // frozen: nothing drawn, no sound, no loop, in 4 s
  const g0 = await p.evaluate(() => window.__gl); await p.waitForTimeout(4000);
  pre = await p.evaluate((g0) => ({ glDrawsWhileFrozen: window.__gl - g0, audioContexts: window.__ac.length, rnd: { ...window.__rnd.C }, otherFiles: { ...window.__rnd.otherFiles }, hasDrive: !!window.__drive }), g0);
} else await p.waitForTimeout(500);
await p.evaluate(() => document.getElementById('btnTitle').click()); await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('btnDrive').click());
await p.waitForFunction(() => window.__first, null, { timeout: 1200000 });
await p.waitForTimeout(300);
const out = await p.evaluate(() => ({ first: window.__first, byFile: window.__first.byFile, seq: window.__first.seq, otherFiles: window.__rnd.otherFiles, audioContexts: window.__ac.length }));
console.log(JSON.stringify({ tag, pre, ...out, errs }));
await b.close();
