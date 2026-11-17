// A browser session for the store-3D work: ONE Chromium (software WebGL) behind ONE flock, taking jobs from a folder until it has been idle for a while.
//   flock /tmp/claude-browser.lock node tools-store3d/session.mjs <jobsDir> [idleSeconds=420] [maxMinutes=26]
// A job is <jobsDir>/<name>.json; its result is <jobsDir>/<name>.result.json (the job file is removed when it is done).
//   { kind: 'extract' }                                   -> writes public/store3d/layout.json from the live game (what tools-store3d/extract.mjs does)
//   { kind: 's3d', query: 'px=..&py=..', dpr: 2, out: 'x.png', vw: 390, vh: 844, frames: 4 }   -> renders /store3d/index.html, saves the canvas, returns stats + frame times
//   { kind: 'live', shots: [{ out, px, py, bx, by, pay }], dpr: 2 }                            -> the live painted store at those positions (through window.__csd)
//   { kind: 'eval', url, js, vw, vh, dpr }                                                     -> evaluate js in a page, return its value
import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process'; import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jobs = path.resolve(process.argv[2]), idle = +(process.argv[3] || 420) * 1000, maxMs = +(process.argv[4] || 26) * 60000;
fs.mkdirSync(jobs, { recursive: true });
const PORT = 5600 + Math.floor(Math.random() * 300), srv = spawn('node', [path.join(ROOT, 'scripts/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const t00 = Date.now(); let lastJob = Date.now();
fs.writeFileSync(path.join(jobs, 'session.alive'), String(process.pid));
const newPage = async (vw = 390, vh = 844, dpr = 2) => { const p = await b.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true }); p.errs = []; p.on('pageerror', (e) => p.errs.push('pageerror: ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.errs.push(m.type() + ': ' + m.text().slice(0, 240)); }); await p.route(/open-meteo/, (r) => r.abort()); return p; };
async function run(job) {
  if (job.kind === 'extract') {
    const { extractLayout } = await import('./extract-lib.mjs'); const p = await newPage(390, 844, 1);
    const L = await extractLayout(p, ROOT, `http://localhost:${PORT}`); const out = path.join(ROOT, 'public/store3d/layout.json');
    fs.writeFileSync(out, JSON.stringify(L)); const r = { wrote: out, blobs: L.blobs.length, probe: L.probe, errs: p.errs }; await p.close(); return r;
  }
  if (job.kind === 's3d') {
    const p = await newPage(job.vw || 390, job.vh || 844, job.dpr || 2);
    await p.goto(`http://localhost:${PORT}/store3d/index.html?loop=0&${job.query || ''}`);
    await p.waitForFunction(() => window.__s3dReady, null, { timeout: 600000 });
    const res = await p.evaluate(async (n) => { const t = []; let st; for (let i = 0; i < n; i++) { const a = performance.now(); st = window.__renderOnce(0.016); const gl = window.__s3d.renderer.getContext(); gl.finish(); t.push(performance.now() - a); } return { st, t }; }, job.frames || 4);
    if (job.out) { fs.mkdirSync(path.dirname(job.out), { recursive: true }); await p.screenshot({ path: job.out, type: job.out.endsWith('.jpg') ? 'jpeg' : 'png', quality: 92 }); }
    if (job.js) res.js = await p.evaluate(job.js);
    res.errs = p.errs; await p.close(); return res;
  }
  if (job.kind === 'live') {
    const p = await newPage(job.vw || 390, job.vh || 844, job.dpr || 2);
    await p.goto(`http://localhost:${PORT}/standalone.html?nodrive`);
    await p.waitForFunction(() => window.__csd && window.__csd.S && window.__csd.S.mode === 'title', null, { timeout: 300000 });
    await p.evaluate(async () => { const c = window.__csd, H = 1 / 120; c.arrive({ bonus: 0, bully: { lead: 25, caughtUp: false } }); document.getElementById('btnStart').click(); let n = 0; while (c.S.intro > 0 && n++ < 400) c.step(H, 12); c.freeze(true); c.step(H, 240); });
    const out = [];
    for (const s of job.shots) {
      const info = await p.evaluate((s) => { const c = window.__csd, H = 1 / 120; const r = c.tp(s.px, s.py); const bl = c.bully; if (s.bx != null) { bl.x = s.bx; bl.y = s.by; } if (s.pay) { c.S.nGot = c.items.length; c.items.forEach((i) => { c.S.got[i.id] = true; }); } c.step(H, 30); return { snapped: r, bully: [bl.x, bl.y], mode: c.S.mode }; }, s);
      await p.waitForTimeout(400); await p.screenshot({ path: s.out, type: 'png' }); out.push({ out: s.out, ...info });
    }
    const r = { shots: out, errs: p.errs }; await p.close(); return r;
  }
  if (job.kind === 'eval') {
    const p = await newPage(job.vw || 390, job.vh || 844, job.dpr || 1); await p.goto(job.url.startsWith('http') ? job.url : `http://localhost:${PORT}${job.url}`);
    if (job.wait) await p.waitForFunction(job.wait, null, { timeout: 600000 });
    const v = await p.evaluate(job.js); if (job.out) await p.screenshot({ path: job.out }); const r = { v, errs: p.errs }; await p.close(); return r;
  }
  throw new Error('unknown job ' + job.kind);
}
try {
  for (;;) {
    const list = fs.readdirSync(jobs).filter((f) => f.endsWith('.json') && !f.endsWith('.result.json')).sort();
    if (list.length) {
      for (const f of list) {
        const jf = path.join(jobs, f); let job; try { job = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch { continue; } fs.unlinkSync(jf);
        const t0 = Date.now(); let res; try { res = await run(job); } catch (e) { res = { error: String(e && e.stack || e) }; }
        res.ms = Date.now() - t0; fs.writeFileSync(path.join(jobs, f.replace(/\.json$/, '.result.json')), JSON.stringify(res, null, 1)); lastJob = Date.now();
      }
    } else await new Promise((r) => setTimeout(r, 700));
    if (Date.now() - lastJob > idle || Date.now() - t00 > maxMs || fs.existsSync(path.join(jobs, 'STOP'))) break;
  }
} finally { fs.rmSync(path.join(jobs, 'session.alive'), { force: true }); await b.close(); srv.kill(); }
