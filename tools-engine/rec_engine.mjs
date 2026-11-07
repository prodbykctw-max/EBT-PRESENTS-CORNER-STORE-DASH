// Record a short drive with a scripted foot on the gas (60 fps, stepped exactly 1/60 s) and the game's own sound
// (WebAudio rendered offline on the frame clock). Writes <out>/f0000.jpg.. (game camera), gas.json (gas on/off per
// frame) and audio.wav (the recorded part only). Usage: node tools-engine/rec_engine.mjs <drive url ?qa&skipfoot> <out>
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
// gas: [from s, to s] while held
const GAS = [[0.6, 3.6], [6.2, 6.6], [7.4, 7.8]], LEN_S = 9, N = LEN_S * 60;
const gasAt = (t) => GAS.some(([a, b]) => t >= a && t < b);
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => {
  let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__ft = 0;
  class RecAC extends OfflineAudioContext { constructor() { super(2, 44100 * 40, 44100); window.__octx = this; } get currentTime() { return window.__ft; } get state() { return 'running'; } resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); } }
  window.AudioContext = window.webkitAudioContext = RecAC;
});
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.car, null, { timeout: 900000 });
await p.waitForTimeout(1500);
// the countdown, unrecorded (the audio clock runs on), then wait for the sounds to have loaded
const t0 = await p.evaluate(async () => { const d = window.__drive; d.manual = true; let k = 0; while (d.state !== 'driving' && k < 600) { d.tick(1 / 60); window.__ft += 1 / 60; k++; } for (let i = 0; i < 30; i++) { d.tick(1 / 60); window.__ft += 1 / 60; } return window.__ft; });
const gas = [];
for (let k = 0; k < N; k++) {
  const g = gasAt(k / 60); gas.push(g);
  const img = await p.evaluate((g) => { const d = window.__drive; if (g) d.keys.add('gas'); else d.keys.delete('gas'); d.tick(1 / 60); window.__ft += 1 / 60; return d.snapshot(0.9); }, g);
  fs.writeFileSync(`${out}/f${String(k).padStart(4, '0')}.jpg`, Buffer.from(img.split(',')[1], 'base64'));
}
fs.writeFileSync(`${out}/gas.json`, JSON.stringify(gas));
const wav = await p.evaluate(async ([t0, len]) => {
  const buf = await window.__octx.startRendering(), sr = buf.sampleRate, s0 = Math.round(t0 * sr), n = Math.round(len * sr), L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const ab = new ArrayBuffer(44 + n * 4), v = new DataView(ab), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[s0 + i] || 0)) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[s0 + i] || 0)) * 32767, true); }
  let bin = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(bin);
}, [t0, LEN_S]);
fs.writeFileSync(`${out}/audio.wav`, Buffer.from(wav, 'base64'));
console.log(JSON.stringify({ out, frames: N, t0: +t0.toFixed(2), state: await p.evaluate(() => window.__drive.state), v: await p.evaluate(() => window.__drive.car.v), errs: errs.slice(0, 5) }));
await b.close();
