// node tools-light/cap2.mjs <url> <outdir> <spec.json> [flyTimes=1.8]
// One boot, many moments: spec = [{ name, time:'HH:MM', date?:'YYYY-MM-DD', wx?:'rain'|'clear' }]. For each fly time the flyover is advanced there once and held
// (tick(~0) does not move it), then for each moment the drive is relit (window.__drive.relight) and a still is saved as <name>_fly<k>.jpg; then the flyover is ended
// and the street-level chase frame is saved for each moment as <name>_street.jpg. Wrap in `flock /tmp/claude-browser.lock`.
import fs from 'fs'; import { chromium } from 'playwright-core';
import { atlantaInstant } from '../public/drive/daylight.js';
const [url, out, specf, flyArg = '1.8'] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specf, 'utf8'));
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
const save = (n, s) => fs.writeFileSync(`${out}/${n}.jpg`, Buffer.from(s.split(',')[1], 'base64'));
const when = (m) => { const [y, mo, d] = (m.date || '2026-11-16').split('-').map(Number), [h, mi] = m.time.split(':').map(Number); return atlantaInstant(y, mo, d, h, mi); };
const WX = { rain: { code: 63, cloud: 90, rain: 1 }, clear: { code: 0, cloud: 10, rain: 0 }, overcast: { code: 3, cloud: 95, rain: 0 } };
const shot = async (n, m) => {
  const ph = await p.evaluate(([w, wx]) => { const d = window.__drive; const ph = d.relight ? d.relight(w, wx) + ' el=' + d.three.scene.userData.light.el.toFixed(1) : 'no relight (origin/main)'; d.tick(0.0001); return ph; }, [when(m), WX[m.wx || 'clear']]);
  save(n, await p.evaluate(() => window.__drive.snapshot(0.9))); console.log(n, ph, ((Date.now() - t0) / 1000).toFixed(0) + 's');
};
let t = 0;
for (const [k, ft] of flyArg.split(',').map(Number).entries()) {
  await p.evaluate((dt) => window.__drive.tick(dt), Math.max(0.001, ft - t)); t = ft;
  for (const m of spec) await shot(`${m.name}_fly${k}`, m);
}
await p.evaluate(() => window.__drive.endFly && window.__drive.endFly()); await p.evaluate(() => window.__drive.tick(0.05));
const st = JSON.parse(process.env.STREET || '{}');
await p.evaluate((st) => {
  const d = window.__drive, T = d.three.THREE, R = d.route, s = st.s || d.spot.s - 12, dd = st.d ?? R.lane(s, 0);
  d.car.s = s + 2; d.car.d = d.car.targetD = dd;
  const a = R.at(s - 11, dd), l = R.at(s + 30, dd);
  d.camOverride = { pos: new T.Vector3(a.x, a.z + 3.2, -a.y), look: new T.Vector3(l.x, l.z + 1.6, -l.y) };
}, st);
for (const m of spec) await shot(`${m.name}_street`, m);
console.log('errs', JSON.stringify(errs));
await b.close();
