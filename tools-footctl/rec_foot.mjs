// Record the on-foot run driven by a scripted thumb, 60 fps stepped exactly 1/60 s, with the game's own sound (WebAudio
// rendered offline on the frame clock). Saves the game camera's frames + per-frame ring/thumb state (ui.json) +
// audio.wav. Usage: node tools-footctl/rec_foot.mjs <drive url> <out dir>
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const FPS = 60, CX = 195, CY = 660;
// the thumb: [time s, dx, dy] (relative to where it went down), null = lifted
const PATH = [[0, null], [0.5, 0, 0], [0.65, 0, -40], [3.0, 0, -40], [3.15, -40, -40], [4.2, -40, -40], [4.35, 40, -40], [5.4, 40, -40], [5.55, 0, -40], [6.3, 0, -40], [6.3, null], [7.2, null]];
const N = Math.round(7.2 * FPS);
const thumbAt = (t) => { for (let i = PATH.length - 1; i >= 0; i--) if (t >= PATH[i][0]) { const a = PATH[i], b = PATH[i + 1]; if (a[1] === null || !b || b[1] === null) return a[1] === null ? null : [a[1], a[2]]; const k = (t - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; } return null; };
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript((LEN) => {
  let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__ft = 0;
  class RecAC extends OfflineAudioContext { constructor() { super(2, Math.ceil(44100 * LEN), 44100); window.__octx = this; } get currentTime() { return window.__ft; } get state() { return 'running'; } resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); } }
  window.AudioContext = window.webkitAudioContext = RecAC;
}, 8.5);
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.foot, null, { timeout: 900000 });
await p.waitForTimeout(1500); await p.evaluate(() => { window.__drive.manual = true; });
const ui = []; let down = false;
for (let k = 0; k < N; k++) {
  const t = k / FPS, th = thumbAt(t);
  const r = await p.evaluate(([k, th, down, CX, CY]) => {
    const fire = (type, x, y) => { const target = window.__tt && type !== 'touchstart' ? window.__tt : document.elementFromPoint(x, y); if (type === 'touchstart') window.__tt = target; const tt = new Touch({ identifier: 1, target, clientX: x, clientY: y }); target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [tt], changedTouches: [tt] })); };
    if (th && !down) fire('touchstart', CX, CY);
    if (th) fire('touchmove', CX + th[0], CY + th[1]);
    if (!th && down) fire('touchend', window.__lx || CX, window.__ly || CY);
    if (th) { window.__lx = CX + th[0]; window.__ly = CY + th[1]; }
    const d = window.__drive; d.tick(1 / 60); window.__ft = (k + 1) / 60;
    const g = d.foot.drag, st = document.querySelector('.drive-stick');
    return { img: d.snapshot(0.9), state: d.state, ring: st.classList.contains('on') && g ? { ax: g.ax, ay: g.ay, cx: g.cx, cy: g.cy } : null, thumb: th ? [CX + th[0], CY + th[1]] : null, v: d.foot.me.v, pads: getComputedStyle(document.querySelector('.drive-pad')).display };
  }, [k, th, down, CX, CY]);
  down = !!th;
  fs.writeFileSync(`${out}/f${String(k).padStart(4, '0')}.jpg`, Buffer.from(r.img.split(',')[1], 'base64')); delete r.img; ui.push(r);
}
fs.writeFileSync(`${out}/ui.json`, JSON.stringify(ui));
const wav = await p.evaluate(async (n) => {
  const buf = await window.__octx.startRendering(), sr = buf.sampleRate, len = Math.min(buf.length, Math.round(n / 60 * sr)), L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const ab = new ArrayBuffer(44 + len * 4), v = new DataView(ab), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 4, true);
  for (let i = 0; i < len; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  let bin = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(bin);
}, N);
fs.writeFileSync(`${out}/audio.wav`, Buffer.from(wav, 'base64'));
console.log(JSON.stringify({ frames: N, errs: errs.slice(0, 5), states: [...new Set(ui.map((u) => u.state))], pads: [...new Set(ui.map((u) => u.pads))], maxV: Math.max(...ui.map((u) => u.v)).toFixed(2) }));
await b.close();
