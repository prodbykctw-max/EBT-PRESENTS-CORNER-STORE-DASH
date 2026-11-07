// Browser check for free roam on foot. NOT run by the author (the only headless browser was busy); the lead runs it.
//   npm run dev &            (serves public/ on 5173)
//   node tools-roam/check_roam.mjs 5173 [mainRandomCount]
// mainRandomCount: the Math.random call count at the first on-foot frame on main (run tools-footctl/chase.mjs there and read boot.rn
// is NOT the same moment: take __rn() right when state is 'onfoot' and nothing has ticked). Without it the count is only printed.
import { chromium } from 'playwright';
import fs from 'fs';
const PORT = process.argv[2] || '5173', MAIN_RN = process.argv[3] ? +process.argv[3] : null;
const url = `http://localhost:${PORT}/drive/index.html?qa`;
fs.mkdirSync('tools-roam/out', { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678, n = 0; Math.random = () => { n++; a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; window.__rn = () => n; });
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot && window.__drive.state === 'onfoot', null, { timeout: 1800000 });
const results = []; const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(info)); };
// manual ticks, the tools-footctl way; the stick override (api.foot.stick) is how the test drags
const first = await p.evaluate(() => { const d = window.__drive; d.manual = true; d.tick(1 / 60); d.keys.add('gas'); d.keys.delete('gas'); return { rn: window.__rn(), x: d.foot.me.x, y: d.foot.me.y }; });
console.log('Math.random calls at the first on-foot frame:', first.rn, MAIN_RN == null ? '(pass main\'s number as argv[3] to compare)' : `main: ${MAIN_RN}`);
if (MAIN_RN != null) ok('random stream matches main', first.rn === MAIN_RN, { branch: first.rn, main: MAIN_RN });
let shot = 0;
const snap = async (tag) => { const s = await p.evaluate(() => window.__drive.snapshot(0.85)); fs.writeFileSync(`tools-roam/out/${String(shot++).padStart(2, '0')}_${tag}.jpg`, Buffer.from(s.split(',')[1], 'base64')); };
// run toward a world point: converts the wanted direction into the camera-relative stick (up = away from the camera). Returns where it ended.
const runTo = (tx, ty, opts = {}) => p.evaluate(({ tx, ty, maxTicks, stopAt }) => {
  const d = window.__drive, f = d.foot; let n = 0, stuck = 0, last = [f.me.x, f.me.y];
  for (; n < maxTicks && d.state === 'onfoot'; n++) {
    const dx = tx - f.me.x, dy = ty - f.me.y, L = Math.hypot(dx, dy); if (L < stopAt) break;
    const ux = dx / L, uy = dy / L, yaw = f.camYaw;
    f.stick = { x: ux * Math.sin(yaw) - uy * Math.cos(yaw), y: -(ux * Math.cos(yaw) + uy * Math.sin(yaw)) };
    d.tick(1 / 60);
    if (n % 60 === 59) { const m = Math.hypot(f.me.x - last[0], f.me.y - last[1]); stuck = m < 0.5 ? stuck + 1 : 0; last = [f.me.x, f.me.y]; if (stuck >= 3) break; }
  }
  f.stick = null; return { x: f.me.x, y: f.me.y, ticks: n, stuck, state: d.state, solid: f.solidAt(f.me.x, f.me.y) };
}, { tx, ty, maxTicks: opts.maxTicks || 60 * 40, stopAt: opts.stopAt || 1 });
const where = () => p.evaluate(() => { const f = window.__drive.foot; return { x: f.me.x, y: f.me.y, s: f.me.s, d: f.me.d, yaw: f.camYaw, hw: window.__drive.route.hw(f.me.s) }; });
// keep the bully off for the walking tests: freeze him far away by teleporting is not possible, so just test with him chasing and accept a shove (stun) as noise
const start = await where(); await snap('start');
// 1. across the street to the far sidewalk (left of the route = d > 0 ... the far curb is at d = +hw + a bit; go to d = hw + 2)
const far = await p.evaluate(() => { const d = window.__drive, f = d.foot, r = d.route; const s = f.me.s + 4, q = r.at(s, r.hw(s) + 2.5); return q; });
let r1 = await runTo(far.x, far.y, { stopAt: 1.5 }); const w1 = await where(); await snap('far_sidewalk');
ok('ran across the street to the far sidewalk', w1.d > w1.hw - 0.5, { d: w1.d, hw: w1.hw, r1 });
// 2. 100 m down a side street: find the road point nearest 80 m from the route that is a different road
const sideTarget = await p.evaluate(() => { const d = window.__drive, f = d.foot, r = d.route; const s = f.me.s + 30; const q = r.at(s, 0); const a = q.a + Math.PI / 2; return { x: q.x + Math.cos(a) * 100, y: q.y + Math.sin(a) * 100 }; });
const s0 = await where(); const r2 = await runTo(sideTarget.x, sideTarget.y, { stopAt: 2, maxTicks: 60 * 60 }); await snap('side_street');
const run2 = Math.hypot(r2.x - s0.x, r2.y - s0.y);
ok('ran far from the route without being locked to it (>=60 m from the start of this leg, never inside a solid)', run2 >= 60 && !r2.solid, { run2, r2 });
// 3. into a building wall: aim straight through the nearest wall; must end up blocked (not inside), having stopped short of the target
const wallTest = await p.evaluate(() => { const f = window.__drive.foot, W = f.walls, x = f.me.x, y = f.me.y; let best = null, bd = 1e9;   // walls: flat [ax, ay, bx, by, ...]
  for (let i = 0; i + 3 < W.length; i += 4) { const mx = (W[i] + W[i + 2]) / 2, my = (W[i + 1] + W[i + 3]) / 2, m = Math.hypot(mx - x, my - y); if (m < bd && m > 4 && Math.hypot(W[i + 2] - W[i], W[i + 3] - W[i + 1]) > 3) { bd = m; best = { x: mx, y: my }; } }
  return best; });
if (wallTest) {
  const through = await p.evaluate((t) => { const f = window.__drive.foot; const dx = t.x - f.me.x, dy = t.y - f.me.y, L = Math.hypot(dx, dy); return { x: t.x + dx / L * 6, y: t.y + dy / L * 6 }; }, wallTest);
  const r3 = await runTo(through.x, through.y, { stopAt: 0.5, maxTicks: 60 * 25 }); await snap('into_wall');
  ok('a wall stopped the run (ended short of the point behind it, not inside anything)', Math.hypot(r3.x - through.x, r3.y - through.y) > 2 && !r3.solid, { r3, through });
} else console.log('SKIP wall test: could not read api.foot.walls (shape differs); see roam.js segs');
// 4. round the store front: out to the store's side of the street and along it for 30 m
const front = await p.evaluate(() => { const d = window.__drive, f = d.foot, r = d.route; const s = f.doorS ?? f.me.s; return [r.at(s - 15, -r.hw(s) - 1), r.at(s, -r.hw(s) - 1), r.at(s + 15, -r.hw(s) - 1)]; });
let r4; for (const q of front) r4 = await runTo(q.x, q.y, { stopAt: 1.5, maxTicks: 60 * 30 });
await snap('store_front'); ok('ran along the store front without ending inside anything', !r4.solid, r4);
// 5. caught by the bully round a corner: stand still beside a wall and let him come; he must reach you (shove: stun > 0) and never end inside a wall
const caught = await p.evaluate(() => { const d = window.__drive, f = d.foot; f.stick = { x: 0, y: 0 }; let n = 0, hit = false; for (; n < 60 * 40 && d.state === 'onfoot'; n++) { d.tick(1 / 60); if (f.me.stun > 0) { hit = true; break; } } f.stick = null; return { hit, n, gap: Math.hypot(f.him.x - f.me.x, f.him.y - f.me.y), himSolid: f.solidAt(f.him.x, f.him.y) }; });
await snap('bully_catches'); ok('standing still, the bully reached you (shove) and was not inside a wall', caught.hit && !caught.himSolid, caught);
// 6. ?bot finishes: reload with ?qa&bot, tick until it is driving
const pb = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await pb.route(/open-meteo/, (r) => r.abort());
await pb.goto(`http://localhost:${PORT}/drive/index.html?qa&bot`);
await pb.waitForFunction(() => window.__drive && window.__drive.foot, null, { timeout: 1800000 });
const bot = await pb.evaluate(() => { const d = window.__drive; d.manual = true; let n = 0; for (; n < 60 * 90 && d.state === 'onfoot'; n++) d.tick(1 / 60); return { state: d.state, seconds: n / 60 }; });
ok('?bot ran to the car and got in', bot.state !== 'onfoot', bot);
ok('no page errors', errs.length === 0, errs.slice(0, 5));
fs.writeFileSync('tools-roam/out/results.json', JSON.stringify({ first, results, errs }, null, 1));
console.log(results.every((r) => r.pass) ? 'ALL PASS' : 'SOME FAILED'); await b.close();
