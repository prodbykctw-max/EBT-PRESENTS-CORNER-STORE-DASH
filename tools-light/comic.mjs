// node tools-light/comic.mjs <url> <out.jpg>: the comic look's first on-foot frame and a street frame at a fixed camera, on a seeded Math.random (tools-restart/lib.mjs), so the same code gives the same pixels.
// Run it on origin/main and on this branch and compare with tools-light/cmp.py. Wrap in flock /tmp/claude-browser.lock.
import fs from 'fs';
import { launch } from '../tools-restart/lib.mjs';
const [url, out] = process.argv.slice(2);
const { b, p, errs } = await launch();
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 1500000 });
const r = await p.evaluate(() => {
  const d = window.__drive, T = d.three.THREE, R = d.route; d.manual = true; let fake = 100000; performance.now = () => fake; Date.now = () => 1.7e12;   // a frozen clock: nothing driven by real time can differ
  const look = d.comic ? 'ok' : 'none';
  for (let i = 0; i < 6; i++) { fake += 16.667; d.tick(1 / 60); }
  const s = d.spot.s - 12, dd = R.lane(s, 0); d.car.s = s + 2; d.car.d = d.car.targetD = dd;
  const a = R.at(s - 11, dd), l = R.at(s + 30, dd);
  d.camOverride = { pos: new T.Vector3(a.x, a.z + 3.2, -a.y), look: new T.Vector3(l.x, l.z + 1.6, -l.y) };
  fake += 16.667; d.tick(1 / 60);
  return { jpg: d.snapshot(0.95), rn: window.__rn(), real: !!document.querySelector('.drive-root.real'), look };
});
fs.writeFileSync(out, Buffer.from(r.jpg.split(',')[1], 'base64'));
console.log(url, 'rn', r.rn, 'real-class', r.real, 'errs', JSON.stringify(errs));
await b.close();
