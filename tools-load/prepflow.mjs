// The prepared start in the full game, flow by flow (software WebGL, so slow): node tools-load/prepflow.mjs <url of the game page> <flow> [--wait-prepared 1]
// flows: skip (START DRIVE -> flyover plays -> SKIP DRIVE -> store how-to-play -> START RUN -> main menu -> a second drive, built fresh), restart (pause -> RESTART: a fresh build straight to the chase),
//        busted (BUSTED -> Drive again), early (START DRIVE tapped through the title at once: the prepare begins on the tap), lost (the prepared drive's GL context is lost before the tap: the tap builds the old way),
//        reduced (reduced motion: same prepare, instant start)
import { chromium } from 'playwright-core';
const A = process.argv.slice(2); const url = A[0], flow = A[1] || 'skip';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP api.open-meteo.com 127.0.0.1:9'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, reducedMotion: flow === 'reduced' ? 'reduce' : 'no-preference' });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/open-meteo|ERR_FAILED|ERR_CONNECTION|429|GPU stall|WebGL|swiftshader/i.test(m.text())) errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
await p.addInitScript(() => {
  window.__drives = []; let drv; Object.defineProperty(window, '__drive', { configurable: true, get: () => drv, set: (v) => { drv = v; if (v) window.__drives.push({ at: performance.now(), fly: !!v.fly, state: v.state }); } });
  window.__ac = []; const AC = window.AudioContext; if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ac.push(this); } };
  window.__glc = []; const gc = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...r) { const c = gc.call(this, t, ...r); if (c && /webgl/.test(t)) window.__glc.push(c); return c; };
});
const log = { flow, steps: [] }; const step = (k, v) => { log.steps.push([k, v]); };
const T = 1500000;
await p.goto(url);
await p.waitForFunction(() => document.getElementById('btnTitle'), null, { timeout: 180000 });
const click = (id) => p.evaluate((i) => document.getElementById(i).click(), id);
const nDrives = () => p.evaluate(() => window.__drives.length);
const waitDrive = (n) => p.waitForFunction((n) => window.__drives.length >= n && window.__drive && window.__drive.foot, n, { timeout: T });
const shown = () => p.evaluate(() => { const o = (id) => document.getElementById(id).classList.contains('on'); const r = document.querySelector('.drive-root'); return { ovTitle: o('ovTitle'), ovDriveHow: o('ovDriveHow'), ovHow: o('ovHow'), mode: window.__csd?.S.mode, driveRoot: !!r, driveVisible: !!r && getComputedStyle(r.parentElement).visibility !== 'hidden', loader: !!document.querySelector('.drive-loading'), glLive: window.__glc.filter((g) => { try { return !g.isContextLost(); } catch { return false; } }).length, ac: window.__ac.filter((c) => c.state !== 'closed').length }; });
if (flow === 'early' || flow === 'direct') {   // (direct: the same click-through, for ?noprepare; the skip steps then follow)
  await click('btnTitle'); await p.waitForTimeout(flow === 'direct' ? 600 : 150); await click('btnDrive'); }
else {
  await p.waitForFunction(() => performance.getEntriesByName('drive:prepared').length, null, { timeout: T, polling: 300 });
  step('prepared, screens', await shown());
  if (flow === 'lost') { const r = await p.evaluate(() => { const c = document.querySelector('.drive-root canvas'); const gl = c && (c.getContext('webgl2') || c.getContext('webgl')); const x = gl && gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return !!x; }); step('context lost', r); await p.waitForTimeout(1000); }
  await click('btnTitle'); await p.waitForTimeout(600); step('how-to-play', await shown());
  await click('btnDrive');
}
await waitDrive(1); await p.waitForTimeout(800);
step('drive 1 up', { ...(await shown()), drives: await p.evaluate(() => window.__drives), fly: await p.evaluate(() => window.__drive.fly), state: await p.evaluate(() => window.__drive.state) });
const pauseRestart = async () => { await p.evaluate(() => { const d = window.__drive; d.manual = true; }); await p.evaluate(() => document.querySelector('[data-pause]').click()); await p.evaluate(() => document.querySelector('[data-restart]').click()); };
if (flow === 'restart') {
  await pauseRestart(); await waitDrive(2); await p.waitForTimeout(800);
  step('after RESTART', { drives: await p.evaluate(() => window.__drives), fly: await p.evaluate(() => window.__drive.fly), state: await p.evaluate(() => window.__drive.state), roots: await p.evaluate(() => document.querySelectorAll('.drive-root').length), ...(await shown()) });
} else if (flow === 'busted') {
  await p.evaluate(() => { const d = window.__drive; d.manual = true; d.endFly && d.endFly(); d.result.busted = true; d.ui.showBusted(); });
  await p.evaluate(() => document.querySelector('.drive-busted button').click()); await waitDrive(2); await p.waitForTimeout(800);
  step('after BUSTED', { drives: await p.evaluate(() => window.__drives), fly: await p.evaluate(() => window.__drive.fly), state: await p.evaluate(() => window.__drive.state), roots: await p.evaluate(() => document.querySelectorAll('.drive-root').length) });
} else {   // skip (and the rest): leave the drive, go to the store, then a second drive
  await p.evaluate(() => { window.__drive.manual = true; });
  await p.evaluate(() => document.querySelector('[data-skip]').click());
  await p.waitForFunction(() => document.getElementById('ovHow').classList.contains('on'), null, { timeout: T }); await p.waitForTimeout(500);
  step('after SKIP DRIVE', { ...(await shown()), roots: await p.evaluate(() => document.querySelectorAll('.drive-root').length), mounts: await p.evaluate(() => [...document.body.children].map((e) => e.tagName + '#' + e.id + '.' + e.className + '[' + e.children.length + ']' + (e.getAttribute('style') || '').slice(0, 30)).filter((x) => !/^(SCRIPT|CANVAS|LINK)/.test(x))) });
  await click('btnStart'); await p.waitForTimeout(800); step('store run', await p.evaluate(() => window.__csd.S.mode));
  await p.evaluate(() => { goMenu(); }); await p.waitForTimeout(500); await click('btnTitle'); await p.waitForTimeout(500); await click('btnDrive');
  await waitDrive(2); await p.waitForTimeout(800);
  step('second drive', { drives: await p.evaluate(() => window.__drives), fly: await p.evaluate(() => window.__drive.fly), state: await p.evaluate(() => window.__drive.state), roots: await p.evaluate(() => document.querySelectorAll('.drive-root').length), ...(await shown()) });
}
log.errs = errs;
console.log(JSON.stringify(log));
await b.close();
