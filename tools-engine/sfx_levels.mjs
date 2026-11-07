// Loudness of every sound in the drive's own mix. Renders audio.js (DriveAudio, unmodified, through its own
// master compressor) offline on a frame clock with seeded Math.random, and writes <out>/levels.wav (float32 stereo),
// <out>/slots.json (what plays when) for tools-engine/sfx_levels.py.
//   node tools-engine/sfx_levels.mjs <base url of a served public/ dir, e.g. http://localhost:5301> <out dir>
// No game is booted: DriveAudio only needs its own sample files, and the inputs the game feeds it (speed, pedal, slip)
// are scripted below to what drive.js produces (pedal = max(0.2, 0.3 + accel/9) on the gas, so 0.3 when cruising).
// Part 1 "solo": the engine, the bed and every effect each on their own (engine / bed through a gate), for the numbers.
// Part 2 "mix": the engine cruising on the gas + the bed underneath, and every sound once on top, for the ear (the sampler clip).
// Part 3 "worst": everything at once, for the master peak.
import { chromium } from 'playwright-core';
import fs from 'fs';
const [base, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') errs.push(m.text()); });
await p.addInitScript(() => {
  let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__ft = 0;
  class RecAC extends OfflineAudioContext { constructor() { super(2, 44100 * 240, 44100); window.__octx = this; } get currentTime() { return window.__ft; } get state() { return 'running'; } resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); } }
  window.AudioContext = window.webkitAudioContext = RecAC;
});
await p.goto(base + '/standalone.html', { waitUntil: 'commit' });
const res = await p.evaluate(async () => {
  const { DriveAudio } = await import('/drive/audio.js');
  const a = new DriveAudio(); a.unlock(); await a.ready;
  const ctx = a.ctx, slots = [];
  // gates on the engine and bed buses so each can be heard alone
  const gate = (bus) => { bus.disconnect(); const g = ctx.createGain(); bus.connect(g); g.connect(a.out); return g; };
  const eg = gate(a.bus.engine), bg = gate(a.bus.bed);
  const gates = (e, bd) => { eg.gain.setValueAtTime(e, window.__ft); bg.gain.setValueAtTime(bd, window.__ft); };
  // a far horn on its own, through a copy of the bed bus (the bed's own gain after its fade-in, 0.1) so the rumble is not in the reading
  const hb = ctx.createGain(); hb.gain.value = 0.1; hb.connect(a.out);
  const far = (g) => { const orig = a.bus.bed; a.bus.bed = hb; try { a.farHorn ? a.farHorn(g) : a.play('hornFar', { gain: g, bus: hb }); } finally { a.bus.bed = orig; } };   // main (before) has no farHorn(): its timer plays it at this gain
  let v = 0, pedal = 0, slip = 0;
  const frame = () => { a.update(v, pedal, slip, 1 / 60); window.__ft += 1 / 60; };
  const run = (s, f) => { const n = Math.round(s * 60); for (let i = 0; i < n; i++) { if (f) f(i / n); frame(); } };
  const slot = (name, part, dur, f) => { const t0 = window.__ft; if (f) f(); run(dur); slots.push({ name, part, t0, t1: window.__ft }); };
  // ---- part 1: solo
  gates(1, 0); run(7);                                   // warm up (idle), the bed's own fade-in is not heard (gate 0)
  slot('engine idle', 'solo', 2.5);
  run(6, (u) => { v = 25 * u; pedal = 0.8; });            // pulling away
  slots.push({ name: 'engine pulling away', part: 'solo', t0: window.__ft - 4, t1: window.__ft });
  slot('engine cruise on GAS', 'solo', 7, () => { v = 25; pedal = 0.3; });
  run(5, (u) => { v = 25 - 7 * u; pedal = 0; });          // coasting
  slots.push({ name: 'engine coasting', part: 'solo', t0: window.__ft - 3, t1: window.__ft });
  pedal = 0; v = 0; run(3);
  gates(0, 1); run(3);
  slot('city rumble (bed)', 'solo', 5);
  gates(0, 0); run(1);
  slot('far horn, loudest (gain 0.25)', 'solo', 4, () => far(0.25));
  slot('far horn, quietest (gain 0.12)', 'solo', 4, () => far(0.12));
  gates(0, 0); run(1);
  const once = (name, part, dur, fn) => slot(name, part, dur, fn);
  once('your horn', 'solo', 3, () => a.horn());
  once('honk at you, full (g=1)', 'solo', 3, () => a.honkAt(1));
  once('honk at you, typical (g=0.45)', 'solo', 3, () => a.honkAt(0.45));
  once('skid screech (g=1)', 'solo', 3, () => a.skid(1));
  slot('tyre squeal, full slip', 'solo', 3, () => { slip = 1; }); slip = 0; run(1.5);
  once('crash, full power', 'solo', 4, () => a.crash(1));
  once('crash 0.35 (shoved)', 'solo', 3, () => a.crash(0.35));
  once('crash 0.2 (bump)', 'solo', 3, () => a.crash(0.2));
  once('crash 0.15 (bump)', 'solo', 3, () => a.crash(0.15));
  once('token pickup', 'solo', 3, () => a.token());
  once('win chord (chime)', 'solo', 3, () => a.chime());
  once('near-miss whoosh', 'solo', 3, () => a.air());
  once('streetcar bell', 'solo', 3.5, () => a.bell(0.55));
  slot('police siren (busted)', 'solo', 9, () => a.siren()); a.sirenOn?.stop(); a.sirenOn = null; run(3);
  // ---- part 2: mix (engine cruising on the gas, bed under it, every sound once on top)
  gates(1, 1); v = 25; pedal = 0.3; run(8);
  const mix = (name, dur, fn) => slot(name, 'mix', dur, fn);
  mix('engine cruising on GAS (reference)', 4);
  mix('city rumble + far horns under the engine', 3);
  mix('your HORN', 3, () => a.horn());
  mix('another car HONKS at you', 3, () => a.honkAt(0.45));
  mix('...and skids', 3, () => { a.honkAt(0.45); a.skid(0.45); });
  mix('TYRES squeal (lane change)', 3, () => { slip = 1; }); slip = 0; run(1.5);
  mix('small BUMP (0.2)', 3, () => a.crash(0.2));
  mix('SHOVED (0.35)', 3, () => a.crash(0.35));
  mix('big CRASH', 4, () => a.crash(1));
  mix('TOKEN pickup', 3, () => a.token());
  mix('near-miss WHOOSH', 3, () => a.air());
  mix('streetcar BELL', 3.5, () => a.bell(0.55));
  mix('WIN chord (parked)', 3, () => a.chime());
  mix('POLICE SIREN (busted)', 9, () => a.siren()); a.sirenOn?.stop(); a.sirenOn = null; run(3);
  // ---- part 3: the loudest case, everything at once with the engine flat out
  v = 30; pedal = 1; run(3);
  slot('WORST CASE: everything at once', 'worst', 6, () => { a.siren(); a.crash(1); a.horn(); a.honkAt(1); a.skid(1); a.air(); a.bell(0.55); a.token(); a.chime(); far(0.25); slip = 1; });
  const total = window.__ft + 1;
  const buf = await window.__octx.startRendering(), sr = buf.sampleRate, n = Math.round(total * sr);
  const L = buf.getChannelData(0).slice(0, n), R = buf.getChannelData(1).slice(0, n);
  const ab = new ArrayBuffer(44 + n * 8), dv = new DataView(ab), w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 8, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 3, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 8, true); dv.setUint16(32, 8, true); dv.setUint16(34, 32, true); w(36, 'data'); dv.setUint32(40, n * 8, true);
  for (let i = 0; i < n; i++) { dv.setFloat32(44 + i * 8, L[i], true); dv.setFloat32(48 + i * 8, R[i], true); }
  let bin = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode(...u.subarray(i, i + 32768));
  return { slots, wav: btoa(bin) };
});
fs.writeFileSync(`${out}/levels.wav`, Buffer.from(res.wav, 'base64'));
fs.writeFileSync(`${out}/slots.json`, JSON.stringify(res.slots, null, 1));
console.log(JSON.stringify({ out, slots: res.slots.length, errs: errs.slice(0, 5) }));
await b.close();
