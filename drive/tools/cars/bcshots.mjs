// the BC fleet (the realistic look's default): same-camera shots CURRENT vs BC, a B + C pair, and a far-to-near motion check.
//   node bcshots.mjs <port> <outdir> [urlQuery]      (the page is opened with NO ?cars, so this also proves the default loads BC)
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const PORT = +process.argv[2], OUT = process.argv[3], Q = process.argv[4] ?? '';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 1; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 300)); });
  page.on('requestfailed', (r) => logs.push('REQFAILED ' + r.url()));
  const reqs = []; page.on('request', (r) => { if (/\.cars|\/cars\.js/.test(r.url())) reqs.push(r.url()); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot${Q ? '&' + Q : ''}`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
  console.log('boot s', (Date.now() - t0) / 1000, 'cars requests', JSON.stringify(reqs));
  const res = await page.evaluate(async () => {
    const d = window.__drive, T = d.three, TH = T.THREE, w = d.world, r = T.renderer; r.info.autoReset = false;
    d.manual = true; d.freezeClock = true;
    for (let i = 0; i < 90; i++) d.tick(1 / 60);
    const out = { info: { set: w.carSetName, sets: Object.keys(w.carSets) }, shots: {}, stats: {}, motion: {} };
    const CS = w.carSet; if (!CS) return out;
    const isCar = (e) => ['sedan', 'suv', 'police', 'robotaxi'].includes(e.type);
    const isB = (e) => e.type === 'sedan' && CS.pick('sedan', e.cid) === CS.keys.sedanB;
    const cars = w.ents.filter((e) => isCar(e) && e.alive);
    const sedans = cars.filter((e) => e.type === 'sedan');
    out.info.sedans = sedans.length; out.info.sedanB = sedans.filter(isB).length;
    const base = d.car.s; let best = null;
    for (let s0 = base + 20; s0 < base + 400; s0 += 10) {
      const n = cars.filter((e) => e.s > s0 && e.s < s0 + 70).length, mv = cars.filter((e) => e.s > s0 && e.s < s0 + 70 && !e.parked && e.v).length;
      const score = n + mv * 2; if (!best || score > best.score) best = { s0, n, mv, score };
    }
    const at = (s, dd, h) => { const p = d.route.at(s, dd); return new TH.Vector3(p.x, p.z + h, -p.y); };
    const free = (e) => !cars.some((o) => o !== e && Math.abs(o.d - e.d) < 1.6 && Math.abs(o.s - e.s) < 10);
    const camFor = (e, front = false, dist = 7.5, h = 1.9) => { const sc = front ? e.s + dist : e.s - dist; const dc = d.route.lane(sc, 0) * 0.5 + e.d * 0.5; return { pos: at(sc, dc, h), look: at(e.s, e.d, 0.8) }; };
    const setNames = ['CURRENT', 'BC'];
    const shoot = (ck, cam) => {
      d.camOverride = { pos: cam.pos, look: cam.look };
      for (const sn of setNames) {
        w.setCarSet(sn === 'CURRENT' ? null : sn);
        for (let i = 0; i < 3; i++) d.tick(0.0005);
        r.info.reset(); const url = d.snapshot(0.88);
        out.shots[`${ck}__${sn}`] = url; out.stats[`${ck}__${sn}`] = { calls: r.info.render.calls, tris: r.info.render.triangles,
          drawn: Object.fromEntries(Object.entries(w.meshes).filter(([k, m]) => m.count && /^(sedan|suv|police|robotaxi)/.test(k)).map(([k, m]) => [k, m.count])) };
      }
      w.setCarSet('BC');
    };
    // 1. a street with parked cars + traffic
    shoot('street', { pos: at(best.s0 - 4, d.route.lane(best.s0, 0), 3.0), look: at(best.s0 + 45, d.route.lane(best.s0 + 45, 0), 0.9) });
    // targets: found up front (cars behind the player are recycled once it jumps ahead), then visited in order of s
    const behindFree = (e) => !cars.some((o) => o !== e && Math.abs(o.d - e.d) < 1.8 && o.s < e.s && o.s > e.s - 11);
    const aheadFree = (e) => !cars.some((o) => o !== e && Math.abs(o.d - e.d) < 1.8 && o.s > e.s && o.s < e.s + 11);
    const near = (filt, lo = 12, hi = 500) => cars.filter((e) => filt(e) && e.s > base + lo && e.s < base + hi).sort((a, b) => a.s - b.s)[0];
    const pC = near((e) => e.type === 'sedan' && e.parked && behindFree(e) && !isB(e), 14, 220), pB = near((e) => e.type === 'sedan' && e.parked && behindFree(e) && isB(e), 14, 220);
    const su = near((e) => e.type === 'suv' && e.parked && behindFree(e), 14, 220);
    out.info.pC = pC && { s: pC.s - base, cid: pC.cid, aheadFree: aheadFree(pC) }; out.info.pB = pB && { s: pB.s - base, cid: pB.cid, aheadFree: aheadFree(pB) };
    if (pC) { shoot('close_parked_C', camFor(pC)); if (aheadFree(pC)) shoot('front_parked_C', camFor(pC, true)); }
    const pCfar = !pC && near((e) => e.type === 'sedan' && e.parked && behindFree(e) && !isB(e), 230, 700);   // none near the start: one further on (the player is moved to it)
    if (pB) { shoot('close_parked_B', camFor(pB)); if (aheadFree(pB)) shoot('front_parked_B', camFor(pB, true)); }
    if (su) shoot('close_suv', camFor(su));
    const jobs = [];
    // a B and a C sedan near each other, in one frame (nothing between the camera and them)
    const ss = sedans.filter((e) => e.s > base + 20 && e.s < base + 700).sort((a, b) => a.s - b.s);
    for (let i = 0; i + 1 < ss.length; i++) {
      const a = ss[i], b = ss[i + 1];
      if (isB(a) !== isB(b) && Math.abs(b.s - a.s) > 5.5 && Math.abs(b.s - a.s) < 11 && Math.abs(a.d - b.d) < 3.5 && behindFree(a)) {
        jobs.push({ s: a.s, fn: () => {
          d.car.s = Math.max(4, a.s - 35); for (let k = 0; k < 4; k++) d.tick(0.0005);
          const mid = { s: (a.s + b.s) / 2, d: (a.d + b.d) / 2 }, sc = a.s - 8, dc = d.route.lane(sc, 0) * 0.45 + a.d * 0.55;
          out.info.pair = [a, b].map((e) => ({ s: e.s, d: e.d, B: isB(e), parked: !!e.parked, v: e.v }));
          shoot('pair_BC', { pos: at(sc, dc, 1.9), look: at(mid.s, mid.d, 0.7) });
        } }); break;
      }
    }
    for (const ty of ['police', 'robotaxi']) {
      const e = w.ents.filter((x) => x.type === ty && x.alive && behindFree(x)).sort((a, b) => Math.abs(a.s - base - 150) - Math.abs(b.s - base - 150))[0]; if (!e) continue;
      jobs.push({ s: e.s, fn: () => {
        d.car.s = Math.max(4, e.s - 35); for (let k = 0; k < 4; k++) d.tick(0.0005);
        out.info[ty] = { s: e.s, parked: !!e.parked, v: e.v };
        shoot('close_' + ty, camFor(e)); shoot('front_' + ty, camFor(e, true));
      } });
    }
    // motion: the camera comes from far to near a parked B car and a parked C car; which mesh (body + level) draws each sedan, every step
    const families = {}, seen = {};   // cid -> Set of body families ever drawn
    const keyAt = (px, pz) => {
      for (const [k, m] of Object.entries(w.meshes)) {
        const mm = /^(sedan|sedanB)@BC([012])$/.exec(k); if (!mm || !m.count) continue;
        const a = m.instanceMatrix.array;
        for (let i = 0; i < m.count; i++) if (Math.abs(a[i * 16 + 12] - px) < 0.2 && Math.abs(a[i * 16 + 14] - pz) < 0.2) return { fam: mm[1], lod: +mm[2] };
      }
      return null;
    };
    const run = (e, tag) => {
      const seq = []; const dists = [110, 90, 72, 58, 46, 36, 28, 22, 17, 13, 10, 7];
      for (const D of dists) {
        const sc = e.s - D, dc = d.route.lane(sc, 0) * 0.5 + e.d * 0.5;
        d.car.s = Math.max(4, sc - 6);
        d.camOverride = { pos: at(sc, dc, 1.9), look: at(e.s, e.d, 0.8) };
        for (let i = 0; i < 4; i++) d.tick(0.0005);
        const url = d.snapshot(0.8);
        const p = d.route.at(e.s, e.d), k = keyAt(p.x, -p.y);
        seq.push({ D, key: k && `${k.fam}${k.lod}` });
        out.shots[`motion_${tag}_${String(D).padStart(3, '0')}`] = url;
        for (const o of sedans) { const q = d.route.at(o.s, o.d), kk = keyAt(q.x, -q.y); if (kk) { (families[o.cid] ||= new Set()).add(kk.fam); seen[o.cid] = (seen[o.cid] || 0) + 1; } }
      }
      return seq;
    };
    const mB = near((e) => e.type === 'sedan' && e.parked && isB(e), 130, 260), mC = near((e) => e.type === 'sedan' && e.parked && !isB(e), 130, 260);
    out.info.motionCars = { B: mB && mB.s - base, C: mC && mC.s - base };
    if (mB) jobs.push({ s: mB.s, fn: () => { out.motion.B = run(mB, 'B'); } });
    if (mC) jobs.push({ s: mC.s, fn: () => { out.motion.C = run(mC, 'C'); } });
    if (pCfar) { out.info.pCfar = pCfar.s - base; jobs.push({ s: pCfar.s, fn: () => { d.car.s = pCfar.s - 35; for (let k = 0; k < 4; k++) d.tick(0.0005); shoot('close_parked_C', camFor(pCfar)); } }); }
    jobs.sort((x, y) => x.s - y.s); for (const j of jobs) j.fn();
    out.motion.cidsSeen = Object.keys(seen).length; out.motion.cidsWithTwoBodies = Object.entries(families).filter(([c, s]) => s.size > 1).map(([c]) => +c);
    out.motion.expectB = Object.entries(families).filter(([c, s]) => s.has('sedanB') !== isB(sedans.find((o) => o.cid === +c))).map(([c]) => +c);
    return out;
  });
  console.log(JSON.stringify(res.info)); console.log(JSON.stringify(res.motion)); console.log(JSON.stringify(res.stats));
  console.log('LOGS', JSON.stringify(logs.filter((l) => !/AudioContext|KHR_parallel|429/.test(l))));
  for (const [k, u] of Object.entries(res.shots)) writeFileSync(`${OUT}/${k}.jpg`, Buffer.from(u.split(',')[1], 'base64'));
  writeFileSync(`${OUT}/stats.json`, JSON.stringify({ info: res.info, stats: res.stats, motion: res.motion, logs, reqs }, null, 1));
} finally { await browser.close(); }
