// Boot the drive (phone size), hold GAS through the on-foot chase on fixed ticks, and report: Math.random calls at
// boot, where you and the bully are after each block of ticks, errors, and snapshots of the chase camera.
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
import fs from 'fs';
const [url, tag] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678, n = 0; Math.random = () => { n++; a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; window.__rn = () => n; });
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
const boot = await p.evaluate(() => { const d = window.__drive; d.manual = true; return { rn: window.__rn(), state: d.state }; });
const rows = [];
await p.evaluate(() => window.__drive.keys.add('gas'));
await p.evaluate(() => { const d = window.__drive; for (let i = 0; i < 120; i++) d.tick(1 / 60); });
for (let k = 0; k < 8; k++) {
  const r = await p.evaluate(() => { const d = window.__drive; for (let i = 0; i < 4; i++) d.tick(1 / 60); const f = d.foot; const T = d.three, v = new T.THREE.Vector3(); f.me.o.getWorldPosition(v); v.y += 1.0; v.project(T.camera); const sc = { x: Math.round((v.x + 1) / 2 * innerWidth), y: Math.round((1 - v.y) / 2 * innerHeight) }; return { sc, st: d.state, me: [+f.me.s.toFixed(2), +f.me.d.toFixed(2), +f.me.v.toFixed(2)], him: [+f.him.s.toFixed(2), +f.him.d.toFixed(2)], rn: window.__rn() }; });
  rows.push(r);
  const shot = await p.evaluate(() => window.__drive.snapshot(0.9));
  fs.writeFileSync(`tools-arms/out/${tag}_${k}.jpg`, Buffer.from(shot.split(',')[1], 'base64'));
}
console.log(JSON.stringify({ tag, boot, rows, errs: errs.slice(0, 5) }));
await b.close();
