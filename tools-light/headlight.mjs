// node tools-light/headlight.mjs <url ?qa&time=21:00> <outdir>: the chase-view street frame at night with the player's headlights on (as built) and with the spot light's intensity 0, same everything else
// (python3 tools-light/cmp.py on_off.jpg for the pixel count; tools-light/headlight.py for the mean brightness on the road ahead). Wrap in flock /tmp/claude-browser.lock.
import fs from 'fs'; import { chromium } from 'playwright-core';
const [url, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 480, height: 854 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await p.route(/open-meteo/, (r) => r.abort());
await p.goto(url); await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 1500000 });
const save = (n, s) => fs.writeFileSync(`${out}/${n}.jpg`, Buffer.from(s.split(',')[1], 'base64'));
await p.evaluate(() => { window.__drive.manual = true; const d = window.__drive; d.tick(0.05); d.endFly && d.endFly(); d.tick(0.05);
  const T = d.three.THREE, R = d.route, s = d.spot.s - 12, dd = R.lane(s, 0); d.car.s = s + 2; d.car.d = d.car.targetD = dd;
  const a = R.at(s - 11, dd), l = R.at(s + 30, dd); d.camOverride = { pos: new T.Vector3(a.x, a.z + 3.2, -a.y), look: new T.Vector3(l.x, l.z + 1.6, -l.y) }; d.tick(0.05); });
const info = await p.evaluate(() => { const L = window.__drive.three.scene.getObjectByName('car_headlights'); return L ? { intensity: L.intensity, visible: L.visible, base: L.userData.base } : null; });
console.log('spot', JSON.stringify(info));
save('on', await p.evaluate(() => { window.__drive.tick(0.0001); return window.__drive.snapshot(0.95); }));
await p.evaluate(() => { const L = window.__drive.three.scene.getObjectByName('car_headlights'); L.userData.keep = L.intensity; L.intensity = 0; window.__drive.tick(0.0001); });
save('off', await p.evaluate(() => window.__drive.snapshot(0.95)));
await b.close();
