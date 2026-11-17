// node tools-light/cap.mjs <url> <outdir> <name> [flyTimes=0.6,1.8,3.2] [streetJSON]
// Loads the drive (?qa&fly...), captures the flyover at the given fly times (one tick jumps there), then the first on-foot frame
// and a street-level frame behind the player's car, and writes <outdir>/<name>_fly<k>.jpg, <name>_street.jpg. Wrap in flock /tmp/claude-browser.lock.
import fs from 'fs'; import { chromium } from 'playwright-core';
const [url, out, name, flyArg = '0.6,1.8,3.2'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 480, height: 854 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 300)); });
await p.route(/open-meteo/, (r) => r.abort());
const t0 = Date.now();
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 1500000 });
console.log('boot s', ((Date.now() - t0) / 1000).toFixed(0));
fs.mkdirSync(out, { recursive: true });
await p.evaluate(() => { window.__drive.manual = true; });
const save = (n, s) => fs.writeFileSync(`${out}/${name}_${n}.jpg`, Buffer.from(s.split(',')[1], 'base64'));
let t = 0;
for (const [k, ft] of flyArg.split(',').map(Number).entries()) {
  await p.evaluate((dt) => window.__drive.tick(dt), Math.max(0.001, ft - t)); t = ft;
  save('fly' + k, await p.evaluate(() => window.__drive.snapshot(0.9)));
}
await p.evaluate(() => window.__drive.endFly && window.__drive.endFly()); await p.evaluate(() => window.__drive.tick(0.05));
// street level: a chase camera on the route behind the point s, in the lane
const info = await p.evaluate(() => { const d = window.__drive; return { s: d.car.s, spot: d.spot.s, len: d.route.length, st: d.state }; });
console.log(JSON.stringify(info));
const street = JSON.parse(process.env.STREET || '{"s":0}');
const r = await p.evaluate((st) => {
  const d = window.__drive, T = d.three.THREE, R = d.route, s = st.s || d.spot.s - 70, dd = st.d ?? R.lane(s, 0);
  const a = R.at(s - 11, dd), l = R.at(s + 30, dd);
  d.camOverride = { pos: new T.Vector3(a.x, a.z + 3.2, -a.y), look: new T.Vector3(l.x, l.z + 1.6, -l.y) };
  d.tick(1 / 60); d.tick(1 / 60); return d.snapshot(0.9);
}, street);
save('street', r);
console.log('errs', JSON.stringify(errs), 's', ((Date.now() - t0) / 1000).toFixed(0));
await b.close();
