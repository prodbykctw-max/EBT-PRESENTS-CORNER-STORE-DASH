import { launch } from './lib.mjs';
const [url] = process.argv.slice(2);
const { b, p, errs } = await launch();
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
const r = await p.evaluate(() => {
  const d = window.__drive, R = d.route, f = d.foot, o = {};
  o.len = R.length; o.spot = d.spot; o.homeS = f.homeS; o.doorS = f.doorS;
  o.pts = [0, 14, 44, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, d.spot.s].map((s) => { const q = R.at(s, 0); return [s, +q.x.toFixed(1), +q.y.toFixed(1), +q.z.toFixed(1), +q.a.toFixed(2)]; });
  o.me = [f.me.x, f.me.y]; o.him = [f.him.x, f.him.y]; o.door = f.door;
  const c = d.three.camera; o.cam = [c.position.x, c.position.y, c.position.z]; o.fov = c.fov; o.aspect = c.aspect;
  return o;
});
console.log(JSON.stringify(r)); console.log(errs);
await b.close();
