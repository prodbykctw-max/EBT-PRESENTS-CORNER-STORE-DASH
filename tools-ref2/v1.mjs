// V1: the comic look is pixel-identical main vs branch
import fs from 'node:fs'; import crypto from 'node:crypto';
import { open, ticks, place, shot } from './lib.mjs';
const which = process.argv[2];
const { b, p } = await open({ which, q: '?qa&look=comic&skipfoot' });
await ticks(p, 200);
const spotS = await p.evaluate(() => window.__drive.spot.s);
const out = {};
for (const s of [120, 182, 600, 1056, spotS - 30]) {
  await place(p, { s: Math.round(s), v: 0, settle: 90 });
  const url = await p.evaluate(() => window.__drive.snapshot(0.92));
  out['snap_' + Math.round(s)] = crypto.createHash('sha1').update(url).digest('hex');
  if (s === 600 || s === 182) { await shot(p, `out/v1_${which}_${Math.round(s)}.png`); out['page_' + Math.round(s)] = crypto.createHash('sha1').update(fs.readFileSync(`out/v1_${which}_${Math.round(s)}.png`)).digest('hex'); }
  console.log(Math.round(s), out['snap_' + Math.round(s)].slice(0, 10));
}
fs.writeFileSync(`out/v1_${which}.json`, JSON.stringify(out, null, 1));
await b.close();
console.log('done');
