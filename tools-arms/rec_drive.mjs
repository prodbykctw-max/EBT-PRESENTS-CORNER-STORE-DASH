// Record the on-foot chase as a real 60 fps video with its own sound: the drive is stepped exactly 1/60 s per frame
// (__drive.manual + tick), each frame is the game's own render (snapshot), and the sound is the game's own WebAudio
// rendered offline on the same clock (AudioContext swapped for an OfflineAudioContext whose currentTime is the
// frame clock). Part 1: the chase camera on you; part 2: a camera beside the bully, following him.
// Usage: node tools-arms/rec_drive.mjs <drive url> <out dir>
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, out] = process.argv.slice(2);
const FPS = 60, P1 = +(process.env.P1 || 240), P2 = +(process.env.P2 || 240), LEN = (P1 + P2) / FPS + 1;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript((LEN) => {
  let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__ft = 0;
  class RecAC extends OfflineAudioContext {
    constructor() { super(2, Math.ceil(44100 * LEN), 44100); window.__octx = this; }
    get currentTime() { return window.__ft; }
    get state() { return 'running'; }
    resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
  }
  window.AudioContext = window.webkitAudioContext = RecAC;
}, LEN);
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
await p.waitForTimeout(3000);   // the loading screen's fade (real time) is over
await p.evaluate(() => { window.__drive.manual = true; });
const save = async (k, data) => fs.writeFileSync(`${out}/f${String(k).padStart(4, '0')}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
for (let k = 0; k < P1 + P2; k++) {
  const shot = await p.evaluate(([k, P1]) => {
    const d = window.__drive, T = d.three, f = d.foot;
    if (k === 20) d.keys.add('gas');
    d.tick(1 / 60); window.__ft = (k + 1) / 60;
    if (k >= P1) {   // beside the bully: 4.6 m to his side, chest height, looking at him
      const o = f.him.o, cam = T.camera, V = T.THREE.Vector3, pos = new V(); o.getWorldPosition(pos);
      const fwd = o.getWorldDirection(new V()).setY(0).normalize();   // the model faces its own +z
      const side = new V(-fwd.z, 0, fwd.x);
      cam.position.copy(pos).addScaledVector(side, 4.6).addScaledVector(fwd, 0.8); cam.position.y += 1.5;
      cam.lookAt(pos.x, pos.y + 0.9, pos.z); cam.updateMatrixWorld(true);
    }
    return d.snapshot(0.9);
  }, [k, P1]);
  await save(k, shot);
}
const wav = await p.evaluate(async (n) => {
  const buf = await window.__octx.startRendering(), sr = buf.sampleRate, len = Math.min(buf.length, Math.round(n / 60 * sr));
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const ab = new ArrayBuffer(44 + len * 4), v = new DataView(ab), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 4, true);
  let peak = 0;
  for (let i = 0; i < len; i++) { for (const [c, ch] of [[0, L], [1, R]]) { const s = Math.max(-1, Math.min(1, ch[i])); peak = Math.max(peak, Math.abs(s)); v.setInt16(44 + i * 4 + c * 2, s * 32767, true); } }
  let bin = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode(...u.subarray(i, i + 32768));
  return { b64: btoa(bin), peak };
}, P1 + P2);
fs.writeFileSync(`${out}/audio.wav`, Buffer.from(wav.b64, 'base64'));
console.log(JSON.stringify({ out, frames: P1 + P2, audioPeak: +wav.peak.toFixed(3), state: await p.evaluate(() => window.__drive.state), errs: errs.slice(0, 5) }));
await b.close();
