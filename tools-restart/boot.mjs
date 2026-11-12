// node tools-restart/boot.mjs <url> <out.json>: boot once, record the first on-foot frame (camera, positions, Math.random count, a traffic + crowd signature)
import fs from 'fs'; import { launch, sig } from './lib.mjs';
const [url, out] = process.argv.slice(2);
const { b, p, errs } = await launch();
const t0 = Date.now();
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
const boot = await p.evaluate(() => { window.__drive.manual = true; return window.__boots; });
const s = await p.evaluate(sig);
fs.writeFileSync(out, JSON.stringify({ boot, sig: s, ms: Date.now() - t0, errs }, null, 1));
console.log(JSON.stringify({ boot, rn: s.rn, cam: s.cam, state: s.state, ms: Date.now() - t0, errs }));
await b.close();
