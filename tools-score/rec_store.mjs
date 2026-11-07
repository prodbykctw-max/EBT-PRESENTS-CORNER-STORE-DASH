// Record a store run with the new scoring, frame by frame at 60 fps with the game's own sound.
// The page's clock (requestAnimationFrame, performance.now, Date.now, setTimeout) runs on a frame clock this script
// advances 1/60 s per frame, so the game, GSAP and the end-screen timers all play at true speed in the video; the
// WebAudio is rendered offline on the same clock. The shopper is steered along the store's own findPath to each item
// (the arrival is a drive that left the bully 30 s behind, so he is still outside), then to the nearest register.
// Usage: node tools-score/rec_store.mjs <url to standalone.html> <outdir>   -> outdir/f0000.jpg.., audio.wav, info.json
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route('**/api/scores**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"scores":[]}' }));
await p.addInitScript(() => {
  let a = 0x2468ace1; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const base = Date.now(); let ft = 0; window.__ft = 0;
  const raf = [], timers = []; let tid = 1;
  performance.now = () => ft * 1000; Date.now = () => base + ft * 1000;
  window.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
  window.cancelAnimationFrame = () => {};
  const realST = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => { const id = tid++; timers.push({ id, at: ft + (ms || 0) / 1000, fn, args }); return id; };
  window.clearTimeout = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };
  window.__frame = () => {
    ft += 1 / 60; window.__ft = ft;
    for (let i = 0; i < timers.length;) { if (timers[i].at <= ft + 1e-9) { const t = timers.splice(i, 1)[0]; try { typeof t.fn === 'function' ? t.fn(...t.args) : 0; } catch (e) { console.error(e); } } else i++; }
    const cbs = raf.splice(0); for (const cb of cbs) { try { cb(ft * 1000); } catch (e) { console.error(e); } }
  };
  window.__realST = realST;
  class RecAC extends OfflineAudioContext { constructor() { super(2, 44100 * 120, 44100); window.__octx = this; } get currentTime() { return window.__ft; } get state() { return 'running'; } resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); } }
  window.AudioContext = window.webkitAudioContext = RecAC;
});
await p.goto(url);
// boot frames (unrecorded): the page's own loader and the title, all on the frame clock
for (let i = 0; i < 240 && !(await p.evaluate(() => !!(window.__csd && window.__csd.S))); i++) await p.evaluate(() => window.__frame());
await p.evaluate(() => { for (let i = 0; i < 60; i++) window.__frame(); });
await p.evaluate(() => { window.__csd.arrive({ bonus: 0, bully: { lead: 30, caughtUp: false } }); document.getElementById('btnStart').click(); });
const t0 = await p.evaluate(() => window.__ft);
// steer: findPath from the shopper to the target, aim at the second waypoint (or the target), unit vector
const steer = () => p.evaluate(() => {
  const c = window.__csd, S = c.S, pl = c.player;
  let tx, ty;
  if (S.nGot < c.items.length) { tx = S.curPos.x; ty = S.curPos.y; } else { tx = 476; ty = 408; }
  // items sit on the shelf: go for the nearest spot the shopper can stand on (boxFree), searched outward from the item
  if (!c.boxFree(tx, ty)) {
    let best = null;
    for (let r = 4; r <= 40 && !best; r += 4) for (let a = 0; a < 32; a++) { const x = tx + r * Math.cos(a * Math.PI / 16), y = ty + r * Math.sin(a * Math.PI / 16); if (c.boxFree(x, y)) { best = [x, y]; break; } }
    if (best) { tx = best[0]; ty = best[1]; }
  }
  let ax = tx, ay = ty;
  try {
    // findPath returns nav-cell indices; aim at the farthest of the next 12 cells in line of sight (like pathAim)
    const path = window.findPath(pl.x, pl.y, tx, ty);
    if (path && path.length > 1 && !window.los(pl.x, pl.y, tx, ty)) {
      const cell = (c) => [(c % window.GW) * window.GC + window.GC / 2, ((c / window.GW) | 0) * window.GC + window.GC / 2];
      let pick = cell(path[1]);
      for (let j = Math.min(path.length - 1, 12); j > 0; j--) { const q = cell(path[j]); if (window.los(pl.x, pl.y, q[0], q[1])) { pick = q; break; } }
      ax = pick[0]; ay = pick[1];
    }
  } catch (e) {}
  const dx = ax - pl.x, dy = ay - pl.y, m = Math.hypot(dx, dy);
  if (S.mode === 'play' && S.intro <= 0 && m > 1) c.setInput(dx / m, dy / m); else c.setInput(null);
  return { mode: S.mode, got: S.nGot, won: S.won, score: S.score };
});
const N_MAX = 60 * 45; let k = 0, endAt = -1, info = null;
for (; k < N_MAX; k++) {
  info = await steer();
  await p.evaluate(() => window.__frame());
  await p.screenshot({ path: `${out}/f${String(k).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 88 });
  if (info.mode !== 'play' && endAt < 0 && info.won) endAt = k;
  if (endAt >= 0 && k - endAt > 60 * 5.5) break;      // hold the end screen ~5 s (score count-up)
  if (info.mode === 'end' && !info.won && endAt < 0) { endAt = k; }
}
const frames = k + 1, len = frames / 60;
const wav = await p.evaluate(async ([t0, len]) => {
  const buf = await window.__octx.startRendering(), sr = buf.sampleRate, s0 = Math.round(t0 * sr), n = Math.round(len * sr), L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const ab = new ArrayBuffer(44 + n * 4), v = new DataView(ab), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[s0 + i] || 0)) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[s0 + i] || 0)) * 32767, true); }
  let bin = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(bin);
}, [t0, len]);
fs.writeFileSync(`${out}/audio.wav`, Buffer.from(wav, 'base64'));
const S = await p.evaluate(() => { const S = window.__csd.S; return { score: S.score, itemPts: S.itemPts, runSecs: S.runSecs, beatOut: S.beatOut, noCatch: S.noCatch, timeBonus: S.timeBonus, won: S.won, comboMax: S.comboMax, sub: document.getElementById('endSub').innerText }; });
fs.writeFileSync(`${out}/info.json`, JSON.stringify({ frames, S, errs }, null, 1));
console.log(JSON.stringify({ frames, S, errs: errs.slice(0, 5) }));
await b.close();
