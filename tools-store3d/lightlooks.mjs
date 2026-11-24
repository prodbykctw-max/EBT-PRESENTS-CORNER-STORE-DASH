// flock /tmp/claude-browser.lock node tools-store3d/lightlooks.mjs <outDir> [mainRoot]
// The store's lighting looks (STORE_LIGHT / ?storelight= in public/store3d/store3d.js), proved in the real game page in a headless phone
// (390 x 780, dpr 2, pointer: coarse, software WebGL). LOOKS=now,dusk,night,blackout (default all four), ONLY=shots,run,flash.
//  shots: the same three moments in every look (A: by the dairy aisle at the top, the bully in view; B: mid-store by the checkouts, PAY on;
//         C: at the front doors), HUD included, as <look>_<A|B|C>.png; plus each frame with the player hidden and with the bully hidden
//         (the difference is exactly the person, for the readability numbers: compose_lightlooks.py), the 3D draw calls and triangles, and
//         with [mainRoot] (a checkout of main) the same 'now' frames from main, twice (main, main2: what two loads of the same code differ
//         by), to be compared pixel for pixel. LOOKS may name main / main2 to run them on their own.
//  run:   one scripted run per look (7 items, caught once + CONTINUE, pay) with the same seeded Math.random; score parts and payload.
//  flash: FLASH=now,blackout (default LOOKS' last look), ~3 s of frames at 30 fps with the player running about: flash_<look>/f###.png.
// Writes <outDir>/lightlooks.json.
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || '.'), MAIN = process.argv[3] ? path.resolve(process.argv[3]) : null; fs.mkdirSync(out, { recursive: true });
const ONLY = (process.env.ONLY || 'shots,run,flash').split(','), LOOKS = (process.env.LOOKS || 'now,dusk,night,blackout').split(',');
const CHROME = process.env.CHROME || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
const serve = (root) => { const port = 5600 + Math.floor(Math.random() * 300), p = spawn('node', [path.join(root, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' }); return { port, p }; };
const S1 = serve(ROOT), S2 = MAIN ? serve(MAIN) : null;
await new Promise((r) => setTimeout(r, 1200));
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const jfile = path.join(out, 'lightlooks.json'), R = fs.existsSync(jfile) ? JSON.parse(fs.readFileSync(jfile, 'utf8')) : {};
const save = () => fs.writeFileSync(jfile, JSON.stringify(R, null, 1));
const INIT = () => {
  // a seeded shared Math.random, a frozen rAF clock for the game loop, and the phone's coarse pointer
  let s = 20261117; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; window.__rndN = (window.__rndN || 0) + 1; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const raf = window.requestAnimationFrame.bind(window); window.__freezeTs = null;
  window.requestAnimationFrame = (cb) => raf((ts) => cb(window.__freezeTs == null ? ts : window.__freezeTs));
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } } : mm(q));
};
async function open(port, q) {
  const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }); p.errs = [];
  p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') p.errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  await p.route(/open-meteo|\/api\/scores/, (r) => /\/api\/scores/.test(r.request().url()) && r.request().method() === 'POST' ? (p.posted = JSON.parse(r.request().postData()), r.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true,"rank":1}' })) : /\/api\/scores/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"scores":[]}' }) : r.abort());
  await p.addInitScript(INIT);
  await p.goto(`http://localhost:${port}/standalone.html?nodrive&store=3d${q}`);
  await p.waitForFunction(() => window.__csd && window.__csd.S && window.__csd.S.mode === 'title' && document.getElementById('ovTitle').classList.contains('on'), null, { timeout: 300000 });
  await p.waitForTimeout(3500);
  for (let i = 0; i < 60; i++) { await p.evaluate(() => document.getElementById('btnTitle').click()); if (await p.evaluate(() => window.__csd.S.mode === 'how')) break; await p.waitForTimeout(1000); }
  await p.waitForFunction(() => window.__csd.S.mode === 'how', null, { timeout: 10000 });
  await p.waitForFunction(() => { const s = window.__csd.store3d; return s.state === 'ready' || s.state === 'failed'; }, null, { timeout: 900000 });
  const st = await p.evaluate(() => { const s = window.__csd.store3d; return { state: s.state, err: s.err, look: s.st ? s.st.lightName || '(no switch)' : null, rndBeforeStart: window.__rndN, mobile: s.st ? s.st.mobile : null }; });
  await p.waitForTimeout(800);
  await p.evaluate(async () => {
    window.__freezeTs = performance.now(); document.getElementById('btnStart').click();
    await new Promise((r) => requestAnimationFrame(() => r())); await new Promise((r) => requestAnimationFrame(() => r()));
    const s3 = window.__csd.store3d; if (s3) s3.hold = true;
    const c = window.__csd, H = 1 / 120; let n = 0; while (c.S.intro > 0 && n++ < 400) c.step(H, 12); c.freeze(true);
  });
  st.use3d = await p.evaluate(() => window.__csd.store3d.use);
  return { p, st };
}
const settle = (p) => p.evaluate(() => { if (window.gsap) window.gsap.globalTimeline.getChildren(true, true, false).forEach((t) => t.progress(1)); });
const shoot = async (p, file) => { await settle(p); await p.waitForFunction(() => [...document.querySelectorAll('.ov')].every((o) => getComputedStyle(o).display === 'none'), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(1200); await p.screenshot({ path: file, type: 'png', timeout: 120000 }); };
const POS = { A: { px: 330, py: 330, bx: 560, by: 360 }, B: { px: 430, py: 610, bx: 330, by: 760, pay: 1 }, C: { px: 415, py: 1560, bx: 560, by: 1450 } };
async function place(p, s) {
  return p.evaluate((s) => {
    const c = window.__csd, H = 1 / 120; c.tp(s.px, s.py); const bl = c.bully; bl.x = s.bx; bl.y = s.by; bl.ox = s.bx; bl.oy = s.by;
    if (s.pay) { c.S.nGot = c.items.length; c.items.forEach((i) => { c.S.got[i.id] = 1; }); }
    c.step(H, 30); c.player.ox = c.player.x; c.player.oy = c.player.y; c.step(H, 120);   // (120 steps: the eased pools and pads have settled)
    const st = c.store3d.st, pp = st.actors.player.g.position, bp = st.actors.bully.g.position, it = st.items.find((g) => g.visible), sc = st.centre.scale * 48;
    return { t: c.S.t, player: [c.player.x, c.player.y], bully: [bl.x, bl.y], feet: { player: st.project(pp.x, 0, pp.z), bully: st.project(bp.x, 0, bp.z) }, head: { player: st.project(pp.x, 1.75, pp.z), bully: st.project(bp.x, 1.9, bp.z) }, item: it ? { id: it.userData.id, at: st.project(it.position.x, 0, it.position.z) } : null, pxPerM: sc, stats: st.stats(), view: st.view };
  }, s);
}
const hideShot = (p, who, file) => p.evaluate((who) => { const c = window.__csd, st = c.store3d.st; st.hideActor(who); st.render(0, false, c.S.t); }, who).then(() => p.waitForTimeout(500)).then(() => p.screenshot({ path: file, type: 'png' })).then(() => p.evaluate(() => window.__csd.step(1 / 120, 0)));

try {
  if (ONLY.includes('shots')) {
    R.shots = R.shots || {};
    // (LOOKS may name main / main2: the 'now' frames from the [mainRoot] checkout, twice, to show what two loads of the SAME code differ by)
    const sets = LOOKS.map((L) => (/^main/.test(L) ? [L, S2.port, ''] : [L, S1.port, `&storelight=${L}`])); if (S2 && !process.env.LOOKS) sets.push(['main', S2.port, ''], ['main2', S2.port, '']);
    for (const [look, port, q] of sets) {
      const { p, st } = await open(port, q); R.shots[look] = { start: st, at: {} };
      for (const [k, s] of Object.entries(POS)) {
        const a = R.shots[look].at[k] = await place(p, s); await shoot(p, path.join(out, `${look}_${k}.png`));
        // (motion off for the hidden frames and their pair: the item's bob must not count as "the person")
        await p.evaluate(() => { const c = window.__csd, st = c.store3d.st; st.render(0, false, c.S.t); }); await p.waitForTimeout(500); await p.screenshot({ path: path.join(out, `${look}_${k}_still.png`), type: 'png' });
        await hideShot(p, 'player', path.join(out, `${look}_${k}_noP.png`)); await hideShot(p, 'bully', path.join(out, `${look}_${k}_noB.png`));
        a.statsAfter = await p.evaluate(() => window.__csd.store3d.st.stats());
      }
      R.shots[look].errs = p.errs; await p.close(); save();
    }
  }
  if (ONLY.includes('run')) {
    R.run = R.run || {};
    const sets = LOOKS.map((L) => (/^main/.test(L) ? [L, S2.port, ''] : [L, S1.port, `&storelight=${L}`])); if (S2 && !process.env.LOOKS) sets.push(['main', S2.port, '']);
    for (const [look, port, q] of sets) {
      const { p, st } = await open(port, q);
      await p.evaluate(async () => {
        const c = window.__csd, S = c.S, H = 1 / 120;
        for (let i = 0; i < S.order.length && S.nGot < 3; i++) { const q = S.curPos; c.tp(q.x, q.y); let k = 0; const g = S.nGot; while (S.nGot === g && k++ < 240) c.step(H, 1); c.step(H, 120); }
        c.freeze(false); const bl = c.bully; bl.x = c.player.x + 12; bl.y = c.player.y; bl.ox = bl.x; bl.oy = bl.y; let k = 0; while (S.mode === 'play' && k++ < 120) c.step(H, 1);
      });
      await p.waitForFunction(() => document.getElementById('ovEnd').classList.contains('on') && document.getElementById('btnContinue').style.display !== 'none', null, { timeout: 60000 });
      await p.waitForTimeout(900);
      await p.evaluate(async () => {
        const c = window.__csd, S = c.S, H = 1 / 120;
        document.getElementById('btnContinue').click(); c.freeze(true); c.step(H, 60);
        for (let i = 0; i < 12 && S.nGot < c.items.length; i++) { const q = S.curPos; c.tp(q.x, q.y); let k = 0; const g = S.nGot; while (S.nGot === g && k++ < 240) c.step(H, 1); c.step(H, 120); }
        c.tp(476, 408); let n = 0; while (!S.won && n++ < 240) c.step(H, 1);
      });
      await p.waitForTimeout(1200); await settle(p);
      await p.waitForFunction(() => document.getElementById('btnSubmit') && document.getElementById('ovEnd').classList.contains('on'), null, { timeout: 120000 }).catch(() => {});
      const parts = await p.evaluate(() => { const S = window.__csd.S; return { score: S.score, itemPts: S.itemPts, comboMax: S.comboMax, timeBonus: S.timeBonus, runSecs: S.runSecs, beatOut: S.beatOut, noCatch: S.noCatch, continues: S.continues, won: S.won, nGot: S.nGot, order: S.order.slice() }; });
      await p.evaluate(() => document.getElementById('btnSubmit').click()); await p.waitForTimeout(800);
      R.run[look] = { start: st, parts, payload: p.posted || null, errs: p.errs }; await p.close(); save();
    }
  }
  if (ONLY.includes('flash')) {
    // FLASH=now,blackout (default: LOOKS' last look): the same 3 s in each, so a look's own light can be told apart from the picture scrolling
    for (const look of (process.env.FLASH || LOOKS[LOOKS.length - 1]).split(',')) {
      const { p, st } = await open(S1.port, `&storelight=${look}`), dir = path.join(out, 'flash_' + look); fs.mkdirSync(dir, { recursive: true });
      await place(p, { px: 330, py: 330, bx: 640, by: 560 });
      const N = 90, moves = [[1, 0], [1, 0.3], [0, 1], [-1, 0.2], [-1, -0.4], [0, -1]];
      for (let i = 0; i < N; i++) {
        // 4 steps of 1/120 s = one 30 fps frame; the 3D canvas alone is read back in the same task it was drawn in (g###: no HUD, no bubbles)
        const g = await p.evaluate((v) => { const c = window.__csd; c.setInput(v[0], v[1]); c.step(1 / 120, 4); return c.store3d.st.canvas.toDataURL('image/png'); }, moves[Math.floor(i / 15) % moves.length]);
        fs.writeFileSync(path.join(dir, `g${String(i).padStart(3, '0')}.png`), Buffer.from(g.split(',')[1], 'base64'));
        await p.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.png`), type: 'png' });
      }
      R['flash_' + look] = { look, frames: N, fps: 30, start: st, errs: p.errs, player: await p.evaluate(() => [window.__csd.player.x, window.__csd.player.y]) }; await p.close(); save();
    }
  }
} finally { save(); await b.close(); S1.p.kill(); if (S2) S2.p.kill(); }
console.log(JSON.stringify(R, (k, v) => (k === 'order' ? undefined : v)).slice(0, 3000));
