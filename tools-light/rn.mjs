// node tools-light/rn.mjs <url>: how many shared Math.random draws the drive has made when its first on-foot frame is up (tools-restart/lib.mjs seeds and counts them). Same URL on origin/main and on this branch must agree.
import { launch } from '../tools-restart/lib.mjs';
const [url] = process.argv.slice(2);
const { b, p, errs } = await launch();
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
await p.evaluate(() => { window.__drive.manual = true; window.__drive.tick(1 / 60); window.__drive.tick(1 / 60); });
console.log(url, 'boot rn', await p.evaluate(() => window.__boots[0].rn), 'after 2 on-foot frames', await p.evaluate(() => window.__rn()), 'errs', JSON.stringify(errs));
await b.close();
