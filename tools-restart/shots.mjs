// node tools-restart/shots.mjs <url> <outdir> '<json: [[px,py,pz,lx,ly,lz],...] in world x,y(north),z(up)>'
import fs from 'fs'; import { launch } from './lib.mjs';
const [url, out, spec] = process.argv.slice(2);
const { b, p, errs } = await launch();
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
await p.evaluate(() => { window.__drive.manual = true; });
fs.mkdirSync(out, { recursive: true });
const shots = JSON.parse(spec);
for (let i = 0; i < shots.length; i++) {
  const s = shots[i];
  const r = await p.evaluate((s) => { const d = window.__drive, T = d.three.THREE; d.camOverride = { pos: new T.Vector3(s[0], s[2], -s[1]), look: new T.Vector3(s[3], s[5], -s[4]) }; d.tick(1 / 60); d.tick(1 / 60); return d.snapshot(0.85); }, s);
  fs.writeFileSync(`${out}/s${i}.jpg`, Buffer.from(r.split(',')[1], 'base64'));
}
console.log('done', errs);
await b.close();
