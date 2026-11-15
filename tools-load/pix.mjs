// pixel check: the same fixed-tick frame from two servers must hash identically.  node tools-load/pix.mjs <base url> <query>   (e.g. http://localhost:5463 '?qa&look=comic')
import { launch } from '../tools-restart/lib.mjs';
import crypto from 'crypto';
const { b, p, errs } = await launch();
// freeze the page's own real-time loop the moment the drive object appears, so the ticks below are the only time that passes
await p.addInitScript(() => { window.__sigFn = () => { window.__drive.manual = true; return {}; }; });
await p.goto(process.argv[2] + '/drive/index.html' + process.argv[3]);
await p.waitForFunction(() => window.__boots && window.__boots.length >= 1 && window.__drive && window.__drive.tick, null, { timeout: 900000 });
const out = await p.evaluate(() => { const d = window.__drive; d.manual = true; d.keys.add('gas'); for (let i = 0; i < 90; i++) d.tick(1 / 60); return d.snapshot(0.9); });
if (process.argv[4]) (await import('fs')).writeFileSync(process.argv[4], Buffer.from(out.split(',')[1], 'base64'));
console.log(crypto.createHash('sha1').update(out).digest('hex'), out.length, JSON.stringify(errs));
await b.close();
