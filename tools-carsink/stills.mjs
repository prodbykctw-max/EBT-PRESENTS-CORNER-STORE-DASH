// node _cs_stills2.mjs <port> <outdir> <tag>
import { chromium } from 'playwright-core';
import fs from 'fs';
const PORT = +process.argv[2], OUT = process.argv[3], TAG = process.argv[4];
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 500 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { let a = 1; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot&bot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1500000, polling: 2000 });
  const res = await page.evaluate(async (process_env) => {
    const d = window.__drive, w = d.world, T = d.three.THREE, CS = w.carSet; d.manual = true; d.freezeClock = true;
    const { autopilot } = await import('/drive/autopilot.js'); let clockMs = 0; const rep = autopilot(d, { manual: true, clock: () => clockMs });
    const out = { shots: {}, info: {} }; const m = new T.Matrix4(), v3 = new T.Vector3();
    const geoW = {}; for (const [role, K] of Object.entries(CS.keys)) { const g = w.meshes[K.lod[0]].geometry, p = g.attributes.position.array, ap = g.attributes.aProp.array; const wh = []; for (let i = 0; i < p.length / 3; i++) if (ap[i*2] === 3 && p[i*3+1] < 0.15) wh.push([p[i*3], p[i*3+1], p[i*3+2]]); geoW[role] = wh; }
    const insts = () => { const L = []; for (const role of ['sedanB', 'sedan']) for (const k of CS.keys[role].lod) { const im = w.meshes[k]; for (let i = 0; i < im.count; i++) { m.fromArray(im.instanceMatrix.array, i * 16); L.push({ role, m: m.clone() }); } } return L; };
    const pk = () => w.ents.filter((e) => e.parked && e.alive).map((e) => w.route.at(e.s, e.d));
    const deep = (inst) => { const e = inst.m.elements; let dp = 1e9; for (const [lx, ly, lz] of geoW[inst.role]) { v3.set(lx, ly, lz).applyMatrix4(inst.m); const s = w.surfAt(v3.x, -v3.z, e[13] + 1.2); if (s != null) dp = Math.min(dp, v3.y - s); } return +dp.toFixed(3); };
    const tilt = (inst) => Math.acos(Math.min(1, inst.m.elements[5])) * 57.3;
    const cams = (a, b, side, h) => { const ea = a.m.elements, o = new T.Vector3(ea[12], ea[13], ea[14]); const xa = new T.Vector3(ea[0], ea[1], ea[2]).normalize();
      let mid = o.clone(); if (b && Math.hypot(b.m.elements[12] - ea[12], b.m.elements[14] - ea[14]) < 14) { const eb = b.m.elements; mid.set((ea[12] + eb[12]) / 2, (ea[13] + eb[13]) / 2, (ea[14] + eb[14]) / 2); }
      return { pos: mid.clone().addScaledVector(xa, side).add(new T.Vector3(0, h, 0)), look: mid.clone().add(new T.Vector3(0, 0.45, 0)) }; };
    const shot = (name, A, B, side, h) => { d.camOverride = cams(A, B, side, h); for (let i = 0; i < 2; i++) d.tick(0.0005); out.shots[name] = d.snapshot(0.9);
      const post = insts(); out.info[name] = { A: { role: A.role, tilt: +tilt(A).toFixed(1), deep: deep(A) }, B: B ? { role: B.role, deep: deep(B) } : null }; };
    let got = { slope: false, flat: false, parkedSlope: false };
    for (let f = 0; f < 2400 && !got.slope; f++) {
      d.tick(1 / 40); clockMs += 25; if (f % 2 === 0) rep.tick();
      if (f < 150 || f % 6) continue;
      const P = pk(), isP = (i) => P.some((p) => Math.abs(p.x - i.m.elements[12]) < 0.6 && Math.abs(p.y + i.m.elements[14]) < 0.6);
      const cam = d.three.camera.position;
      const all = insts().filter((i) => Math.hypot(i.m.elements[12] - cam.x, i.m.elements[14] - cam.z) < (process_env.SUNK ? 600 : 150));
      const SUNK = process_env.SUNK; const B = all.filter((i) => i.role === 'sedanB' && !isP(i)), S = all.filter((i) => i.role === 'sedan');
      const near = (a) => S.filter((s) => { const x = a.m.elements, y = s.m.elements; const dd = Math.hypot(x[12] - y[12], x[14] - y[14]); return dd > 3 && dd < 30; }).sort((p, q) => 0)[0];
      if (SUNK) { if (!got.slope) { const c = (B.concat(S.filter((x) => !isP(x)))).filter((b) => deep(b) < -0.07).sort((a, b2) => (a.role === 'sedanB' ? 0 : 1) - (b2.role === 'sedanB' ? 0 : 1))[0]; if (c) { got.slope = true; out.info.slopeFrame = f; shot('sunk', c, near(c), 6, 1.0); } } continue; }
      if (!got.slope) { const c = (B.concat(process_env.BONLY ? [] : S.filter((x) => !isP(x)))).filter((b) => tilt(b) > (process_env.BONLY ? 2.5 : 5.0)).sort((a, b2) => (a.role === 'sedanB' ? 0 : 1) - (b2.role === 'sedanB' ? 0 : 1))[0]; if (c) { got.slope = true; out.info.slopeFrame = f; shot('slope', c, near(c), 6, 1.0); } }
      if (!got.flat) { const c = B.filter((b) => tilt(b) < 0.8 && near(b))[0]; if (c) { got.flat = true; out.info.flatFrame = f; shot('flat', c, near(c), 7.5, 1.2); } }
    }
    out.info.got = got; return out;
  }, { SUNK: !!process.env.SUNK, BONLY: !!process.env.BONLY });
  console.log(JSON.stringify(res.info));
  for (const [k, u] of Object.entries(res.shots)) fs.writeFileSync(`${OUT}/${TAG}_${k}.jpg`, Buffer.from(u.split(',')[1], 'base64'));
} finally { await browser.close(); }
