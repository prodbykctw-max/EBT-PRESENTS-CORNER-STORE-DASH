// flock /tmp/claude-browser.lock node tools-store3d/ingame.mjs <outDir> [mainRoot]
// The 3D store wired into the game (?store=3d), proved in a headless phone (390 x 844, dpr 2, software WebGL):
//  1. shots: the painted store (no switch) and the 3D store at the sheet's three positions (A top, B mid with PAY on, C bottom), and,
//     with [mainRoot] (a checkout of main), the same painted shots from main: they must match pixel for pixel.
//  2. run: one scripted run (all 7 items, caught once + CONTINUE, pay at a register) on the painted board and in 3D, with the same
//     seeded Math.random; the score parts and the leaderboard payload must be equal. Also: START RUN timing, the build's longest task,
//     frame time, how many shared Math.random draws happened before START (must be equal: the 3D build may not draw from it).
//  3. align: 3D floor points (feet, the item ring) projected vs the 2D layers' mapping (screen = board * scale + (VX, VY)).
//  4. lunge: the wind-up cue frame by frame (crops + their brightness).
// Writes <outDir>/ingame.json and PNG/JPG frames. The game's own loop is held still (its rAF timestamp frozen) and moved only by
// window.__csd.step, so both runs are the same frame for frame.
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || '.'), MAIN = process.argv[3] ? path.resolve(process.argv[3]) : null; fs.mkdirSync(out, { recursive: true });
const ONLY = (process.env.ONLY || 'shots,run,align,lunge').split(',');
const serve = (root) => { const port = 5600 + Math.floor(Math.random() * 300), p = spawn('node', [path.join(root, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' }); return { port, p }; };
const S1 = serve(ROOT), S2 = MAIN ? serve(MAIN) : null;
await new Promise((r) => setTimeout(r, 1200));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const R = {};
const INIT = () => {
  // a seeded shared Math.random (counted), a frozen rAF clock for the game loop, and a long-task log
  let s = 20261117; const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; window.__rndN++; if (window.__rndS.length < 60) window.__rndS.push((new Error().stack || '').split('\n').slice(2, 7).map((l) => l.trim().replace(/https?:\/\/[^/]+/, '')).join(' < ')); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__rndN = 0; window.__rndS = []; Math.random = rnd;
  const raf = window.requestAnimationFrame.bind(window); window.__freezeTs = null;
  window.requestAnimationFrame = (cb) => raf((ts) => cb(window.__freezeTs == null ? ts : window.__freezeTs));
  window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
};
async function open(port, q) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); p.errs = [];
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  await p.route(/open-meteo|\/api\/scores/, (r) => /\/api\/scores/.test(r.request().url()) && r.request().method() === 'POST' ? (p.posted = JSON.parse(r.request().postData()), r.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true,"rank":1}' })) : /\/api\/scores/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"scores":[]}' }) : r.abort());
  await p.addInitScript(INIT);
  await p.goto(`http://localhost:${port}/standalone.html?nodrive${q}`);
  await p.waitForFunction(() => window.__csd && window.__csd.S && window.__csd.S.mode === 'title' && document.getElementById('ovTitle').classList.contains('on'), null, { timeout: 300000 });
  await p.waitForTimeout(3500);   // the title assembly (GSAP, real time) is over
  for (let i = 0; i < 60; i++) {   // (a tap while the title still assembles only skips it: tap again)
    await p.evaluate(() => document.getElementById('btnTitle').click());
    if (await p.evaluate(() => window.__csd.S.mode === 'how')) break; await p.waitForTimeout(1000);
  }
  await p.waitForFunction(() => window.__csd.S.mode === 'how', null, { timeout: 10000 });
  return p;
}
async function ready3d(p) {
  const t0 = Date.now();
  await p.waitForFunction(() => { const s = window.__csd.store3d; return s.state === 'ready' || s.state === 'failed' || !/store=3d/.test(location.search); }, null, { timeout: 900000 });
  return p.evaluate((w) => { const s = window.__csd.store3d; return { state: s.state, err: s.err, ms: s.ms, waitedMs: w, rndBeforeStart: window.__rndN, rndStacks: window.__rndS.slice(0, 12), timings: s.st ? s.st.timings : null, longTasks: window.__long.slice() }; }, Date.now() - t0);
}
async function startRun(p) {
  await p.waitForTimeout(800);
  return p.evaluate(async () => {
    window.__freezeTs = performance.now();
    const rnd0 = window.__rndN, t0 = performance.now(); document.getElementById('btnStart').click(); const t1 = performance.now();
    await new Promise((r) => requestAnimationFrame(() => r())); const t2 = performance.now();
    await new Promise((r) => requestAnimationFrame(() => r()));
    const s3 = window.__csd.store3d; if (s3 && s3.use && s3.st) { const gl = s3.st.renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }   // the first 3D frame finished
    const t3 = performance.now(); if (s3) s3.hold = true;   // from here only __csd.step draws the 3D (software GL can't keep up with every frame)
    const c = window.__csd, H = 1 / 120; let n = 0; while (c.S.intro > 0 && n++ < 400) c.step(H, 12); c.freeze(true);
    return { clickHandlerMs: +(t1 - t0).toFixed(1), toFirstFrameMs: +(t2 - t0).toFixed(1), firstFrameDrawnMs: +(t3 - t0).toFixed(1), use3d: c.store3d ? c.store3d.use : false, rndAtStart: rnd0 };
  });
}
const settle = (p) => p.evaluate(() => { if (window.gsap) window.gsap.globalTimeline.getChildren(true, true, false).forEach((t) => t.progress(1)); });   // every running tween to its end (real-time fades)
const shoot = async (p, file, quiet = true) => { if (quiet) { await settle(p); await p.waitForFunction(() => [...document.querySelectorAll('.ov')].every((o) => getComputedStyle(o).display === 'none'), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(1500); } await p.screenshot({ path: file, type: file.endsWith('.jpg') ? 'jpeg' : 'png', ...(file.endsWith('.jpg') ? { quality: 90 } : {}), timeout: 120000 }); };
const POS = { A: { px: 330, py: 330, bx: 560, by: 360 }, B: { px: 430, py: 610, bx: 330, by: 760, pay: 1 }, C: { px: 300, py: 1318, bx: 470, by: 1180 } };
async function place(p, s) {
  return p.evaluate((s) => {
    const c = window.__csd, H = 1 / 120; c.tp(s.px, s.py); const bl = c.bully; bl.x = s.bx; bl.y = s.by; bl.ox = s.bx; bl.oy = s.by;
    if (s.pay) { c.S.nGot = c.items.length; c.items.forEach((i) => { c.S.got[i.id] = 1; }); }
    c.step(H, 30); c.player.ox = c.player.x; c.player.oy = c.player.y; c.step(H, 0);
    return { player: [c.player.x, c.player.y], bully: [bl.x, bl.y] };
  }, s);
}

try {
  // ---------------------------------------------------------------- 1. shots
  if (ONLY.includes('shots')) {
    R.shots = {};
    for (const [mode, port, q] of [['painted', S1.port, ''], ['3d', S1.port, '&store=3d'], ...(S2 ? [['main', S2.port, '']] : [])]) {
      const p = await open(port, q); const r3 = q ? await ready3d(p) : null; const st = await startRun(p); R.shots[mode] = { ready: r3, start: st, at: {} };
      for (const [k, s] of Object.entries(POS)) { R.shots[mode].at[k] = await place(p, s); await shoot(p, path.join(out, `${k}_${mode}.png`)); }
      R.shots[mode].errs = p.errs; await p.close();
    }
    if (S2) {   // pixel for pixel: the painted store on this branch vs main
      const { createRequire } = await import('module'); R.shots.identical = {};
      for (const k of Object.keys(POS)) { const a = fs.readFileSync(path.join(out, `${k}_painted.png`)), m = fs.readFileSync(path.join(out, `${k}_main.png`)); R.shots.identical[k] = a.equals(m) ? 'byte-identical PNG' : 'DIFFERENT (decode and compare: compose_ingame.py)'; }
    }
  }
  // ---------------------------------------------------------------- 2. run
  if (ONLY.includes('run')) {
    R.run = {};
    for (const [mode, q] of [['painted', ''], ['3d', '&store=3d']]) {
      const p = await open(S1.port, q); const r3 = q ? await ready3d(p) : null; const st = await startRun(p);
      const a = await p.evaluate(async (mode) => {
        const c = window.__csd, S = c.S, H = 1 / 120, log = [];
        const frame = () => { const t = performance.now(); c.step(H, 1); const s3 = c.store3d; if (s3.st && s3.use) { const gl = s3.st.renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); } return performance.now() - t; };
        const ft = []; for (let i = 0; i < 24; i++) ft.push(frame()); ft.sort((x, y) => x - y);
        const grab = async (n) => { for (let i = 0; i < S.order.length && S.nGot < n; i++) { const p = S.curPos; c.tp(p.x, p.y); let k = 0; const g = S.nGot; while (S.nGot === g && k++ < 240) c.step(H, 1); c.step(H, 120); log.push([S.nGot, S.score, +S.runT.toFixed(3)]); } };
        await grab(3);
        // caught once: he's let loose right next to you
        c.freeze(false); const bl = c.bully; bl.x = c.player.x + 12; bl.y = c.player.y; bl.ox = bl.x; bl.oy = bl.y; let k = 0; while (S.mode === 'play' && k++ < 120) c.step(H, 1);
        const caughtAt = { mode: S.mode, k };
        return { ft: { medianMs: +ft[12].toFixed(1), p90Ms: +ft[21].toFixed(1) }, log, caughtAt };
      }, mode);
      await shoot(p, path.join(out, `caught_${mode}.png`), false);
      await p.waitForFunction(() => document.getElementById('ovEnd').classList.contains('on') && document.getElementById('btnContinue').style.display !== 'none', null, { timeout: 60000 });
      await p.waitForTimeout(900);
      const b2 = await p.evaluate(async () => {
        const c = window.__csd, S = c.S, H = 1 / 120, log = [];
        document.getElementById('btnContinue').click(); c.freeze(true); c.step(H, 60);
        for (let i = 0; i < 12 && S.nGot < c.items.length; i++) { const p = S.curPos; c.tp(p.x, p.y); let k = 0; const g = S.nGot; while (S.nGot === g && k++ < 240) c.step(H, 1); c.step(H, 120); log.push([S.nGot, S.score, +S.runT.toFixed(3)]); }
        c.tp(476, 408); let n = 0; while (!S.won && n++ < 240) c.step(H, 1);
        return { log, mode: S.mode };
      });
      await p.waitForTimeout(1200); await settle(p); await p.waitForTimeout(600); await shoot(p, path.join(out, `win_${mode}.png`), false);   // the win: the victory screen up over the store
      await p.waitForFunction(() => document.getElementById('btnSubmit') && document.getElementById('ovEnd').classList.contains('on'), null, { timeout: 120000 }).catch(() => {});
      const parts = await p.evaluate(() => { const S = window.__csd.S; return { score: S.score, itemPts: S.itemPts, comboMax: S.comboMax, timeBonus: S.timeBonus, runSecs: S.runSecs, beatOut: S.beatOut, noCatch: S.noCatch, continues: S.continues, won: S.won, nGot: S.nGot, order: S.order.slice() }; });
      await p.evaluate(() => document.getElementById('btnSubmit').click()); await p.waitForTimeout(800);
      R.run[mode] = { ready: r3, start: st, frame: a.ft, before: a.log, caught: a.caughtAt, after: b2, parts, payload: p.posted || null, errs: p.errs };
      await p.close();
    }
    const strip = (x) => JSON.stringify({ ...x, name: undefined });
    R.run.equal = { parts: JSON.stringify(R.run.painted.parts) === JSON.stringify(R.run['3d'].parts), payload: strip(R.run.painted.payload) === strip(R.run['3d'].payload), rndBeforeStart: R.run.painted.start.rndAtStart === R.run['3d'].start.rndAtStart };
  }
  // ---------------------------------------------------------------- 3. align (3D floor vs the 2D mapping)
  if (ONLY.includes('align')) {
    const p = await open(S1.port, '&store=3d'); await ready3d(p); await startRun(p);
    R.align = await p.evaluate(() => {
      const c = window.__csd, H = 1 / 120, st = c.store3d.st, rows = []; let max = 0;
      for (const [x, y] of [[415, 1380], [330, 330], [430, 610], [700, 900], [120, 1180], [300, 1318], [612, 280], [476, 408]]) {
        c.tp(x, y); c.player.ox = c.player.x; c.player.oy = c.player.y; c.step(H, 0); c.step(H, 0);
        const v = st.centre, sc = v.scale, P = c.player, it = c.S.curPos, three = st.actors.player.g.position;
        const two = (bx, by) => [v.tx + bx * sc, v.ty + by * sc];
        const e1 = (() => { const a = st.project(P.x / 48, 0, P.y / 48), b = two(P.x, P.y); return Math.hypot(a[0] - b[0], a[1] - b[1]); })();
        const e2 = (() => { const a = st.project(three.x, 0, three.z), b = two(P.x, P.y); return Math.hypot(a[0] - b[0], a[1] - b[1]); })();
        const ig = st.items.find((g) => g.visible), e3 = ig ? (() => { const a = st.project(ig.position.x, 0, ig.position.z), b = two(it.x, it.y); return Math.hypot(a[0] - b[0], a[1] - b[1]); })() : null;
        const head = st.project(three.x, 1.70, three.z), feet = st.project(three.x, 0, three.z), sprTop = two(P.x, P.y - 80);
        const row = { at: [P.x, P.y], view: [+v.tx.toFixed(2), +v.ty.toFixed(2), +sc.toFixed(3)], floorPx: +e1.toFixed(3), feetPx: +e2.toFixed(3), ringPx: e3 == null ? null : +e3.toFixed(3), headTopVsSpriteTopPx: +(head[1] - sprTop[1]).toFixed(2), personHeightPx: +(feet[1] - head[1]).toFixed(1) };
        max = Math.max(max, e1, e2, e3 || 0); rows.push(row);
      }
      return { maxFloorPx: +max.toFixed(3), rows };
    });
    await p.close();
  }
  // ---------------------------------------------------------------- 4. the lunge cue, frame by frame
  if (ONLY.includes('lunge')) {
    const p = await open(S1.port, '&store=3d'); await ready3d(p); await startRun(p);
    const L = await p.evaluate(() => {
      const c = window.__csd, S = c.S, H = 1 / 120, st = c.store3d.st, cv = st.canvas, frames = [];
      c.tp(330, 640); c.freeze(false); S.active = true; const bl = c.bully; bl.x = 330; bl.y = 520; bl.ox = 330; bl.oy = 520; bl.vx = 0; bl.vy = 0; c.step(H, 2);
      bl.lunge = { phase: 'wind', t: 0.46 }; bl.lungeCD = 9;
      const crop = document.createElement('canvas'); crop.width = 220; crop.height = 160; const g = crop.getContext('2d', { willReadFrequently: true });
      for (let f = 0; f < 48; f++) {
        if (f > 0) c.step(H, 2); else c.step(H, 0);
        const v = st.centre, pr = st.renderer.getPixelRatio(), x = (v.tx + bl.x * v.scale) * pr, y = (v.ty + (bl.y - 30) * v.scale) * pr;
        g.drawImage(cv, x - 110, y - 80, 220, 160, 0, 0, 220, 160);
        const d = g.getImageData(0, 0, 220, 160).data; let lum = 0, red = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; if (d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90) red++; n++; }
        frames.push({ t: +(f / 60).toFixed(3), phase: bl.lunge ? bl.lunge.phase : 'none', ringAlpha: +(c.store3d.lk * 0.7).toFixed(3), meanLum: +(lum / n).toFixed(2), redPx: red, png: f % 3 === 0 ? crop.toDataURL('image/png') : null, mode: S.mode });
        if (S.mode !== 'play') break;
      }
      return frames;
    });
    L.forEach((f, i) => { if (f.png) { fs.writeFileSync(path.join(out, `lunge_${String(i).padStart(2, '0')}.png`), Buffer.from(f.png.split(',')[1], 'base64')); } delete f.png; });
    let maxStep = 0; for (let i = 1; i < L.length; i++) maxStep = Math.max(maxStep, Math.abs(L[i].meanLum - L[i - 1].meanLum));
    R.lunge = { frames: L, maxFrameToFrameLumChange: +maxStep.toFixed(2), lumRange: [Math.min(...L.map((f) => f.meanLum)), Math.max(...L.map((f) => f.meanLum))] };
    await p.close();
  }
} catch (e) { R.error = String(e && e.stack || e); }
finally { await b.close(); S1.p.kill(); if (S2) S2.p.kill(); }
fs.writeFileSync(path.join(out, 'ingame.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, (k, v) => (k === 'longTasks' ? (v || []).filter((x) => x[1] > 50).slice(0, 12) : v), 1).slice(0, 12000));
