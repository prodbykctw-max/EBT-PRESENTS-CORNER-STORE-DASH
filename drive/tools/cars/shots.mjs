// same-camera in-game shots: current vs each car set.  node shots.mjs <port> <outdir> [sets=A,B,C]
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const PORT = +process.argv[2], OUT = process.argv[3], SETS = (process.argv[4] || 'A,B,C').split(',');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 1; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const page = await ctx.newPage(); page.on('pageerror', (e) => console.log('PAGEERROR', e.message)); page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/KHR_parallel|429/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 240)); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot&cars=${SETS.join(',')}`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 900000, polling: 2000 });
  console.log('boot s', (Date.now() - t0) / 1000);
  const res = await page.evaluate(async ({ SETS }) => {
    const d = window.__drive, T = d.three, TH = T.THREE, w = d.world, r = T.renderer; r.info.autoReset = false;
    d.manual = true; d.freezeClock = true;
    for (let i = 0; i < 90; i++) d.tick(1 / 60);
    const isCar = (e) => ['sedan', 'suv', 'police', 'robotaxi'].includes(e.type);
    const cars = w.ents.filter((e) => isCar(e) && e.alive);
    // cameras: (1) a street with parked cars + traffic: the stretch of 70 m with the most parked cars ahead of the player; (2) close-up of one parked car; (3) a police car close-up; (4) robotaxi
    const base = d.car.s; let best = null;
    for (let s0 = base + 20; s0 < base + 400; s0 += 10) {
      const n = cars.filter((e) => e.s > s0 && e.s < s0 + 70).length, mv = cars.filter((e) => e.s > s0 && e.s < s0 + 70 && !e.parked && e.v).length;
      const score = n + mv * 2; if (!best || score > best.score) best = { s0, n, mv, score };
    }
    const cams = {};
    const at = (s, dd, h) => { const p = d.route.at(s, dd); return new TH.Vector3(p.x, p.z + h, -p.y); };
    cams.street = { pos: at(best.s0 - 4, d.route.lane(best.s0, 0), 3.0), look: at(best.s0 + 45, d.route.lane(best.s0 + 45, 0), 0.9) };
    const near = (type, filt) => cars.filter((e) => e.type === type && filt(e) && e.s > base + 12).sort((a, b) => a.s - b.s)[0];
    // behind-left of the car, the way the player sees traffic (view 'rear'), and from ahead of it ('front'), 7 m away, at eye height
    const close = (e, key, front = false) => {
      if (!e) return; const sc = front ? e.s + 7.5 : e.s - 7.5; const dc = d.route.lane(sc, 0) * 0.5 + e.d * 0.5;
      cams[key] = { pos: at(sc, dc, 1.9), look: at(e.s, e.d, 0.8) };
    };
    const free = (e) => !cars.some((o) => o !== e && Math.abs(o.d - e.d) < 1.6 && Math.abs(o.s - e.s) < 10);
    const pk = near('sedan', (e) => e.parked && free(e) && e.s > base + 14 && e.s < base + 120) || near('suv', (e) => e.parked);
    close(pk, 'close_parked'); close(pk, 'front_parked', true);
    const su = near('suv', (e) => e.parked && free(e)); close(su, 'close_suv');
    const later = ['police', 'robotaxi'];   // (their cameras are made after the player is moved next to one: see below)
    const out = { info: { best, pk: pk && { s: pk.s - base, d: pk.d, parked: pk.parked }, counts: {} }, shots: {}, stats: {} };
    for (const e of cars) { const k = e.type + (e.parked ? '_parked' : '_moving'); out.info.counts[k] = (out.info.counts[k] || 0) + 1; }
    const shoot = (ck, cam) => {
      d.camOverride = { pos: cam.pos, look: cam.look };
      for (const sn of setNames) {
        w.setCarSet(sn === 'CURRENT' ? null : sn);
        for (let i = 0; i < 3; i++) d.tick(0.0005);
        r.info.reset(); const url = d.snapshot(0.88);
        out.shots[`${ck}__${sn}`] = url; out.stats[`${ck}__${sn}`] = { calls: r.info.render.calls, tris: r.info.render.triangles };
        out.stats[`${ck}__${sn}`].drawn = Object.fromEntries(Object.entries(w.meshes).filter(([k, m]) => m.count && /^(sedan|suv|police|robotaxi)/.test(k)).map(([k, m]) => [k, m.count]));
      }
    };
    const setNames = ['CURRENT', ...SETS];
    for (const [ck, cam] of Object.entries(cams)) shoot(ck, cam);
    // police / robotaxi: wherever the nearest one is, put the player 35 m behind it (QA only) so it is in the draw window, then shoot it from behind and from ahead
    for (const ty of later) {
      const e = w.ents.filter((x) => x.type === ty && x.alive && free(x)).sort((a, b) => Math.abs(a.s - base - 150) - Math.abs(b.s - base - 150))[0]; if (!e) continue;
      d.car.s = Math.max(4, e.s - 35); for (let i = 0; i < 4; i++) d.tick(0.0005);
      const mkc = (front) => { const sc = front ? e.s + 7.5 : e.s - 7.5; const dc = d.route.lane(sc, 0) * 0.5 + e.d * 0.5; return { pos: at(sc, dc, 1.9), look: at(e.s, e.d, 0.8) }; };
      out.info[ty] = { s: e.s, parked: e.parked, v: e.v };
      shoot('close_' + ty, mkc(false)); shoot('front_' + ty, mkc(true));
    }
    return out;
  }, { SETS });
  console.log(JSON.stringify(res.info)); console.log(JSON.stringify(res.stats));
  for (const [k, u] of Object.entries(res.shots)) writeFileSync(`${OUT}/${k}.jpg`, Buffer.from(u.split(',')[1], 'base64'));
  writeFileSync(`${OUT}/stats.json`, JSON.stringify({ info: res.info, stats: res.stats }, null, 1));
} finally { await browser.close(); }
