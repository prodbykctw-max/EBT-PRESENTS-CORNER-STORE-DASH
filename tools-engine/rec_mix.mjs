// Record a 15 s drive at 60 fps (stepped exactly 1/60 s) with the game's own whole soundscape (WebAudio rendered offline on the
// frame clock): idle, GAS and cruise, coasting, two quick gas taps, your HORN, two lane changes (and a token if one is in reach).
// Writes <out>/f0000.jpg.. (game camera), audio.wav (the 15 s, 16-bit stereo), trace.json (per frame: s, v, d, pedal, tokens, what the
// audio played) and inputs.json. Run on the "before" build first; pass its inputs.json as the 3rd argument to replay exactly the same
// inputs on the "after" build (the trace then shows whether the two runs stayed identical).
// The bed's 5 s timer (distant horns) is driven by the frame clock so a run does not depend on how fast the machine is.
//   node tools-engine/rec_mix.mjs <drive url ?qa&skipfoot> <out dir> [inputs.json to replay]
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, out, replay] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const LEN_S = 15, N = LEN_S * 60;
const GAS = [[0.8, 4.8], [6.5, 6.9], [7.6, 8.0], [8.6, 15]], HORN_AT = 10.0, LANES = [[11.5, 'ArrowLeft'], [13.3, 'ArrowRight']];
const gasAt = (t) => GAS.some(([a, b]) => t >= a && t < b);
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => {
  let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__ft = 0; window.__timers = [];
  class RecAC extends OfflineAudioContext { constructor() { super(2, 44100 * 80, 44100); window.__octx = this; } get currentTime() { return window.__ft; } get state() { return 'running'; } resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); } }
  window.AudioContext = window.webkitAudioContext = RecAC;
  const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...r) => { if (ms === 5000) { const t = { fn, next: 5 }; window.__timers.push(t); return -window.__timers.length; } return si(fn, ms, ...r); };
  window.clearInterval = (id) => { if (typeof id === 'number' && id < 0) { window.__timers[-id - 1].dead = true; return; } ci(id); };
  window.__tickTimers = () => { for (const t of window.__timers) while (!t.dead && window.__ft >= t.next) { t.next += 5; t.fn(); } };
});
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.car, null, { timeout: 900000 });
await p.waitForTimeout(1500);
const t0 = await p.evaluate(async () => {
  const d = window.__drive; d.manual = true; let k = 0;
  while (d.state !== 'driving' && k < 600) { d.tick(1 / 60); window.__ft += 1 / 60; window.__tickTimers(); k++; }
  for (let i = 0; i < 30; i++) { d.tick(1 / 60); window.__ft += 1 / 60; window.__tickTimers(); }
  window.__log = []; window.__frame = 0;
  for (const m of ['horn', 'honkAt', 'skid', 'crash', 'token', 'chime', 'air', 'bell', 'siren', 'farHorn']) { const f = d.audio[m]?.bind(d.audio); if (f) d.audio[m] = (...a) => { window.__log.push({ k: window.__frame, m, a }); return f(...a); }; }
  return window.__ft;
});
const inputs = replay ? JSON.parse(fs.readFileSync(replay)) : [], trace = [];
for (let k = 0; k < N; k++) {
  const t = k / 60;
  let step;
  if (replay) step = inputs[k];
  else {
    const ev = [];
    if (Math.abs(t - HORN_AT) < 1e-6 || (k === Math.round(HORN_AT * 60))) ev.push(['down', 'Space']);
    if (k === Math.round((HORN_AT + 0.15) * 60)) ev.push(['up', 'Space']);
    for (const [at, code] of LANES) if (k === Math.round(at * 60)) ev.push(['down', code], ['up', code]);
    step = { gas: gasAt(t), ev, steer: null };
  }
  const r = await p.evaluate(([step, k, auto]) => {
    const d = window.__drive; window.__frame = k;
    if (step.gas) d.keys.add('gas'); else d.keys.delete('gas');
    const ev = step.ev.slice();
    if (auto) {   // token steering (recorded run only): in the open stretch after the taps, aim for the next token ahead that is in the other lane
      const lanes = [d.route.lane(d.car.s, 0), d.route.lane(d.car.s, 1)], near = (x) => Math.abs(x - lanes[0]) <= Math.abs(x - lanes[1]) ? 0 : 1;
      window.__cool = (window.__cool || 0) - 1;
      const tk = d.world.tokens.find((q) => q.alive && q.s - d.car.s > 8 && q.s - d.car.s < 40);
      if (tk && window.__cool <= 0 && step.gas && near(tk.d) !== near(d.car.targetD)) { const code = near(tk.d) > near(d.car.targetD) ? 'ArrowLeft' : 'ArrowRight'; ev.push(['down', code], ['up', code]); window.__cool = 150; step.steer = code; }
    }
    for (const [ty, code] of ev) window.dispatchEvent(new KeyboardEvent(ty === 'down' ? 'keydown' : 'keyup', { code, bubbles: true }));
    d.tick(1 / 60); window.__ft += 1 / 60; window.__tickTimers();
    return { img: d.snapshot(0.9), ev, steer: step.steer, s: d.car.s, v: d.car.v, dd: d.car.d, pedal: d.audio.pedal, tokens: d.result.tokens, state: d.state };
  }, [step, k, !replay && t > 8.6 && !LANES.some(([at]) => Math.abs(t - at) < 1.5) && Math.abs(t - HORN_AT) > 0.5]);
  if (!replay) { step.ev = r.ev; inputs.push(step); }
  fs.writeFileSync(`${out}/f${String(k).padStart(4, '0')}.jpg`, Buffer.from(r.img.split(',')[1], 'base64'));
  delete r.img; trace.push(r);
  if (k % 120 === 0) console.log('frame', k, JSON.stringify(r));
}
const log = await p.evaluate(() => window.__log);
fs.writeFileSync(`${out}/trace.json`, JSON.stringify({ trace, log, t0 }));
if (!replay) fs.writeFileSync(`${out}/inputs.json`, JSON.stringify(inputs));
const wav = await p.evaluate(async ([t0, len]) => {
  const buf = await window.__octx.startRendering(), sr = buf.sampleRate, s0 = Math.round(t0 * sr), n = Math.round(len * sr), L = buf.getChannelData(0), R = buf.getChannelData(1);
  const ab = new ArrayBuffer(44 + n * 4), v = new DataView(ab), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[s0 + i] || 0)) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[s0 + i] || 0)) * 32767, true); }
  let bin = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(bin);
}, [t0, LEN_S]);
fs.writeFileSync(`${out}/audio.wav`, Buffer.from(wav, 'base64'));
console.log(JSON.stringify({ out, frames: N, t0: +t0.toFixed(2), tokens: trace.at(-1).tokens, state: trace.at(-1).state, vEnd: trace.at(-1).v, audioCalls: log.map((l) => `${(l.k / 60).toFixed(1)}s ${l.m}`), errs: errs.slice(0, 5) }));
await b.close();
