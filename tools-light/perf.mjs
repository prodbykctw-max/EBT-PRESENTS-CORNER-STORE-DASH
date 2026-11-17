// node tools-light/perf.mjs <url> <label>: frame cost of one full realistic-look render (scene + AO + bloom + final pass) at a fixed street camera, after warm-up, GL-synchronised. Software WebGL, so only the
// before / after ratio on the same machine means anything. Wrap in flock /tmp/claude-browser.lock.
import { chromium } from 'playwright-core';
const [url, label] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.route(/open-meteo/, (r) => r.abort());
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.foot, null, { timeout: 900000 });
await p.evaluate(() => { window.__drive.manual = true; });
const r = await p.evaluate(() => {
  const d = window.__drive, T = d.three.THREE, R = d.route, s = d.spot.s - 12, dd = R.lane(s, 0);
  d.car.s = s + 2; d.car.d = d.car.targetD = dd; const a = R.at(s - 11, dd), l = R.at(s + 30, dd);
  d.camOverride = { pos: new T.Vector3(a.x, a.z + 3.2, -a.y), look: new T.Vector3(l.x, l.z + 1.6, -l.y) };
  const gl = d.three.renderer.getContext(), px = new Uint8Array(4), out = [];
  for (let i = 0; i < 3; i++) d.tick(1 / 60);
  for (let i = 0; i < 12; i++) { const t0 = performance.now(); d.comic.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push(performance.now() - t0); }
  out.sort((x, y) => x - y); const info = d.three.renderer.info.render;
  return { median: out[6], min: out[0], calls: info.calls, tris: info.triangles };
});
console.log(label, JSON.stringify(r));
await b.close();
