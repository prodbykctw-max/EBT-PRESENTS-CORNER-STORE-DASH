// node carsink_measure.mjs <port> <outjson> [samples] [every]
import { chromium } from 'playwright-core';
import fs from 'fs';
const PORT = +process.argv[2], OUT = process.argv[3], SAMPLES = +(process.argv[4] || 40), EVERY = +(process.argv[5] || 40);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 1; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot&bot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1500000, polling: 2000 });
  const res = await page.evaluate(async ({ SAMPLES, EVERY }) => {
    const d = window.__drive, w = d.world, T = d.three.THREE; d.manual = true;
    const { autopilot } = await import('/drive/autopilot.js');
    let clockMs = 0; const rep = autopilot(d, { manual: true, clock: () => clockMs });
    const CS = w.carSet;
    // per role & LOD: wheel-bottom vertices, lowest body vertices (local, already scaled)
    const geo = {};
    for (const [role, K] of Object.entries(CS.keys)) {
      geo[role] = K.lod.map((k) => {
        const g = w.meshes[k].geometry, p = g.attributes.position.array, ap = g.attributes.aProp.array, n = p.length / 3;
        const wh = [], all = [];
        for (let i = 0; i < n; i++) { const y = p[i*3+1], part = ap[i*2]; if (part === 2) continue; all.push([y, i]); if (part === 3 && y < 0.15) wh.push(i); }
        all.sort((a, b) => a[0] - b[0]);
        const body = all.slice(0, 200).map((a) => a[1]);
        const pick = (ids) => ids.map((i) => [p[i*3], p[i*3+1], p[i*3+2]]);
        return { wheel: pick(wh), body: pick(body) };
      });
    }
    const lastY = {}; const stats = {}; const worst = []; const ids = {}, idsP = {}; const isParked0 = () => false; let frames = 0, samples = 0;
    const arr = {}; const add = (key, field, v) => { if (field==='wheelDeep') (arr[key] ||= []).push(v); const s = (stats[key] ||= { n: 0 }); const f = (s[field] ||= { min: 1e9, max: -1e9, sum: 0, n: 0 }); f.min = Math.min(f.min, v); f.max = Math.max(f.max, v); f.sum += v; f.n++; };
    const m = new T.Matrix4(), v3 = new T.Vector3();
    const sample = () => {
      const parked = w.ents.filter((e) => e.parked && e.alive).map((e) => w.route.at(e.s, e.d));
      const cand = []; for (const e of w.ents) if (e.alive && e.cid !== undefined) { const q = w.route.at(e.s, e.d); cand.push({ id: 'e' + e.cid, x: q.x, y: q.y, deck: false }); }
      for (const a of w.ambient) if (a.x !== undefined && a.cid !== undefined) { const ah = a.rh ?? a.h, x = (a.rx ?? a.x) - Math.sin(ah) * a.lane, y = (a.ry ?? a.y) + Math.cos(ah) * a.lane; cand.push({ id: 'a' + a.cid, x, y, deck: !!a.deck }); }
      for (const [role, K] of Object.entries(CS.keys)) for (let lodSrc = 0; lodSrc < 3; lodSrc++) {
        const im = w.meshes[K.lod[lodSrc]];
        for (let i = 0; i < im.count; i++) {
          m.fromArray(im.instanceMatrix.array, i * 16);
          const ox = m.elements[12], oy = m.elements[13], oz = m.elements[14];
          const who = cand.find((c) => Math.abs(c.x - ox) < 3 && Math.abs(c.y + oz) < 3); const isDeck = !!(who && who.deck); if (who) { (ids[role] ||= new Set()).add(who.id); if (isParked0(ox, oz)) (idsP[role] ||= new Set()).add(who.id); }
          const prevY = who ? lastY[who.id] : undefined; if (who) lastY[who.id] = oy; const dirTag = (who ? who.id[0] : '?') + (prevY === undefined ? '' : (oy > prevY + 0.05 ? 'up' : oy < prevY - 0.05 ? 'down' : 'lvl'));
          const isParked = parked.some((p) => Math.abs(p.x - ox) < 0.6 && Math.abs(p.y + oz) < 0.6);
          // pitch of the car: slope along its length
          const fwd = m.elements[2], up = m.elements[5];  // local z axis y component (pitch proxy), local y axis y comp
          const slope = Math.acos(Math.min(1, m.elements[5])) * 57.3;   // (local z axis tilt)
          for (let lod = 0; lod < 3; lod++) {
            const G = geo[role][lod];
            const hint = oy + 1.2;
            let wheelDeep = 1e9, wheelShallow = -1e9, bodyDeep = 1e9;
            // four wheels: group by sign of local x,z
            const per = {};
            for (const [lx, ly, lz] of G.wheel) {
              v3.set(lx, ly, lz).applyMatrix4(m);
              const s = w.surfAt(v3.x, -v3.z, hint); if (s === null || s === undefined) continue;
              const dy = v3.y - s, k = (lx > 0 ? 'R' : 'L') + (lz > 0 ? 'B' : 'F');
              per[k] = Math.min(per[k] ?? 1e9, dy);
            }
            for (const [lx, ly, lz] of G.body) {
              v3.set(lx, ly, lz).applyMatrix4(m);
              const s = w.surfAt(v3.x, -v3.z, hint); if (s === null || s === undefined) continue;
              bodyDeep = Math.min(bodyDeep, v3.y - s);
            }
            const vals = Object.values(per); if (!vals.length) continue;
            wheelDeep = Math.min(...vals); wheelShallow = Math.max(...vals);
            const grp = (isParked ? 'parked' : 'moving');
            for (const key of [`${role}|L${lod}`, `${role}|L${lod}|${grp}`, `${role}|L${lod}|${grp}|${dirTag}`, `${role}|L${lod}|${grp}|${slope > 2 ? 'steep' : 'flat'}`, `ALL|L${lod}`, ...(isDeck ? [`ALL|L${lod}|deck`] : []), ...(slope > 3 ? [`ALL|L${lod}|slope3`] : []), ...(slope > 3 && !isParked ? [`ALL|L${lod}|moving-slope3`] : [])]) { add(key, 'wheelDeep', wheelDeep); add(key, 'wheelHigh', wheelShallow); add(key, 'bodyDeep', bodyDeep); stats[key].n++; }
            if (lod === 0 && (wheelDeep < -0.015 || wheelDeep > 0.05)) worst.push({ role, lodSrc, parked: isParked, frame: frames, x: +ox.toFixed(1), y: +oy.toFixed(2), z: +oz.toFixed(1), wheelDeep: +wheelDeep.toFixed(3), bodyDeep: +bodyDeep.toFixed(3), slope: +slope.toFixed(1), per: Object.fromEntries(Object.entries(per).map(([k, vv]) => [k, +vv.toFixed(3)])) });
          }
        }
      }
    };
    
    while (samples < SAMPLES && frames < 20000 && !['parked', 'late', 'busted', 'done'].includes(d.state)) {
      d.tick(1 / 40); clockMs += 25; frames++; if (frames % 2 === 0) rep.tick();
      if (frames % EVERY === 0) { sample(); samples++; }
    }
    for (const s of Object.values(stats)) for (const f of Object.values(s)) if (f && f.n) f.mean = f.sum / f.n;
    worst.sort((a, b) => Math.abs(b.wheelDeep) - Math.abs(a.wheelDeep));
    const pct = {}; for (const [k,a] of Object.entries(arr)) { a.sort((x,y)=>x-y); const q=(f)=>a[Math.min(a.length-1,Math.floor(f*a.length))]; pct[k]={n:a.length,p1:q(0.01),p5:q(0.05),p50:q(0.5),p95:q(0.95),p99:q(0.99)}; }
    return { frames, samples, state: d.state, distinct: Object.fromEntries(Object.entries(ids).map(([k,v])=>[k,v.size])), pct, stats, worst: worst.slice(0, 40), nWorst: worst.length };
  }, { SAMPLES, EVERY });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  for (const [k,q] of Object.entries(res.pct).sort()) if (k.includes('|L0|')||k.startsWith('ALL|L0')) console.log(k.padEnd(20), JSON.stringify(Object.fromEntries(Object.entries(q).map(([a,b])=>[a,+b.toFixed(3)]))));
  console.log('distinct cars', JSON.stringify(res.distinct)); console.log('frames', res.frames, 'samples', res.samples, res.state);
  for (const [k, s] of Object.entries(res.stats).sort()) if (!k.includes('|L0|') && !k.includes('|L1|') && !k.includes('|L2|')) console.log(k.padEnd(18), 'n', s.n, 'wheelDeep', s.wheelDeep.min.toFixed(3), '..', s.wheelDeep.max.toFixed(3), 'wheelHigh max', s.wheelHigh.max.toFixed(3), 'bodyDeep min', s.bodyDeep.min.toFixed(3));
} finally { await browser.close(); }
