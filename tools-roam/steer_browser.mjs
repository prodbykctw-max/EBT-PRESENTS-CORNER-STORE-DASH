// In-browser check of the on-foot steering: a straight run (snapshot at 5 s), the weave of a thumb 7 degrees off up with jitter for 10 s (heading, camYaw, path), and every
// direction from the first frame. Run it against any worktree's server:  node tools-roam/steer_browser.mjs <port> <label> [outDir]
import { chromium } from 'playwright-core';
import fs from 'fs';
const port = process.argv[2] || 5411, label = process.argv[3] || 'run', out = process.argv[4] || '/tmp/claude-0/-home-claude/e2e83a67-c174-5b6b-8bbe-da1ab9df0c73/scratchpad/steer';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/open-meteo/, (r) => r.abort());
await p.goto(`http://localhost:${port}/drive/index.html?qa`);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.state === 'onfoot', null, { timeout: 1500000 });
const res = await p.evaluate(async () => {
  const d = window.__drive, f = d.foot, deg = (r) => r * 180 / Math.PI, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a)); d.manual = true;
  const home = { x: f.me.x, y: f.me.y }, shots = {};
  const reset = () => { const m = f.me; Object.assign(m, { x: home.x, y: home.y, gx: home.x, gy: home.y, px: home.x, py: home.y, vx: 0, vy: 0, kvx: 0, kvy: 0, good: { x: home.x, y: home.y } }); f.stick = { x: 0, y: 0 }; for (let i = 0; i < 6; i++) d.tick(1 / 60); };
  const out = { dirs: [] };
  // 1. straight up for 5 s, snapshot
  f.stick = { x: 0, y: -1 }; const y0 = f.camYaw; for (let i = 0; i < 300; i++) d.tick(1 / 60);
  out.straight = { camYawDrift: deg(wrap(f.camYaw - y0)), moved: Math.hypot(f.me.x - home.x, f.me.y - home.y) }; shots.straight = d.snapshot(0.85);
  // 2. weave: a thumb 7 degrees right of up with jitter (seeded), 10 s, sampled each tick
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }, g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  for (const [lab, off, jit] of [['7deg+jitter', 7, 2.5], ['0deg+jitter', 0, 3]]) {
    reset(); let jx = 0, jy = 0; const rec = [], a = 1 - Math.exp(-(1 / 60) * 2 * Math.PI * 6), push = 30;
    for (let i = 0; i < 600; i++) {
      jx += (g() * jit * 2.2 - jx) * a; jy += (g() * jit * 2.2 - jy) * a; const o = off * Math.PI / 180, dx = Math.sin(o) * push + jx, dy = -Math.cos(o) * push + jy, m = Math.hypot(dx, dy), t = Math.min(1, Math.max(0, (m - 6) / 16)), k = t * (2 - t);
      f.stick = { x: dx / m * k, y: dy / m * k }; d.tick(1 / 60);
      rec.push({ x: f.me.x, y: f.me.y, h: f.me.heading, y2: f.camYaw });
    }
    const un = (key) => { let acc = 0, pv = rec[0][key], r = []; for (const q of rec) { acc += wrap(q[key] - pv); pv = q[key]; r.push(acc); } return r; };
    const sm = (a, w) => a.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - w); j <= Math.min(a.length - 1, i + w); j++) { s += a[j]; c++; } return s / c; });
    const hu = un('h'), yu = un('y2'), hs = sm(hu, 60), ys = sm(yu, 60); let hw = 0, yw = 0, c = 0, hm = 0, ym = 0;
    for (let i = 180; i < rec.length - 180; i++) { const A = hu[i] - hs[i], B = yu[i] - ys[i]; hw += A * A; yw += B * B; c++; hm = Math.max(hm, Math.abs(A)); ym = Math.max(ym, Math.abs(B)); }
    out[lab] = { camYawRmsDeg: deg(Math.sqrt(yw / c)), camYawMaxDeg: deg(ym), headingRmsDeg: deg(Math.sqrt(hw / c)), headingMaxDeg: deg(hm), camYawTotalTurnDeg: deg(yu[yu.length - 1]), headingTotalTurnDeg: deg(hu[hu.length - 1]), travelled: Math.hypot(rec[rec.length - 1].x - home.x, rec[rec.length - 1].y - home.y) };
  }
  // 3. every direction from the first frame: speed direction after 0.1 s against where the stick says (relative to the camera), distance in 1.2 s
  const dirs = { up: [0, -1, 0], down: [0, 1, 180], left: [-1, 0, 90], right: [1, 0, -90], upleft: [-0.707, -0.707, 45], upright: [0.707, -0.707, -45], downleft: [-0.707, 0.707, 135], downright: [0.707, 0.707, -135] };
  for (const [name, [x, y, want]] of Object.entries(dirs)) {
    reset(); const yaw = f.camYaw; f.stick = { x, y }; const m = f.me; let ang0 = null, moved = 0, solid = 0;
    for (let i = 0; i < 72; i++) { d.tick(1 / 60); if (i === 5) ang0 = deg(wrap(Math.atan2(m.vy, m.vx) - yaw)); if (f.solidAt && f.solidAt(m.x, m.y)) solid++; }
    moved = Math.hypot(m.x - home.x, m.y - home.y); out.dirs.push({ name, want, got: ang0, moved, solid, camYawTurn: deg(wrap(f.camYaw - yaw)) });
  }
  reset(); f.stick = { x: 0, y: 0 }; let st = 0; for (let i = 0; i < 120; i++) { d.tick(1 / 60); st = Math.hypot(f.me.x - home.x, f.me.y - home.y); } out.noInput = { moved: st };
  out.shots = shots; return out;
});
for (const [k, v] of Object.entries(res.shots)) fs.writeFileSync(`${out}/${label}_${k}.jpg`, Buffer.from(v.split(',')[1], 'base64'));
delete res.shots; console.log(JSON.stringify(res, null, 1)); console.log('page errors:', errs.length, errs.slice(0, 3));
await b.close();
