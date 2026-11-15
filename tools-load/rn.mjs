// Same drive, two servers: is the Math.random count and the state at the first frame (and after 4 s of on-foot ticks) identical?
//   flock /tmp/claude-browser.lock node tools-load/rn.mjs <url of /standalone.html> [extra query]   -> one JSON line (compare two with cmp)
import { launch, sig } from '../tools-restart/lib.mjs';
const { b, p, errs } = await launch();
await p.goto(process.argv[2]);
await p.waitForFunction(() => document.getElementById('btnDrive'), null, { timeout: 60000 });
await p.waitForTimeout(1500);   // (the title's prefetch runs, as it does for a player)
await p.evaluate(() => document.getElementById('btnDrive').click());
await p.waitForFunction(() => window.__boots.length >= 1 && window.__drive && window.__drive.state, null, { timeout: 900000 });
const first = await p.evaluate(() => ({ ...window.__sigs[0], boot: window.__boots[0].rn }));
await p.evaluate(() => { const d = window.__drive; d.endFly && d.endFly(); d.manual = true; d.keys.add('gas'); for (let i = 0; i < 240; i++) d.tick(1 / 60); });
const later = await p.evaluate(() => (window.__sigFn)());
console.log(JSON.stringify({ first, later, errs }));
await b.close();
