// ?bot: print the drive's state every 10 s for up to <secs>, to see whether the autopilot reaches the car (state 'driving').  node tools-load/botstate.mjs <url> [secs]
import { launch } from '../tools-restart/lib.mjs';
const { b, p, errs } = await launch();
await p.goto(process.argv[2]);
await p.waitForFunction(() => window.__drive && window.__drive.state, null, { timeout: 900000 });
const secs = +(process.argv[3] || 120), rows = [];
for (let i = 0; i < secs / 10; i++) { rows.push(await p.evaluate(() => { const d = window.__drive; return [d.state, +d.time.toFixed(1), d.foot && +d.foot.me.s.toFixed(1), +d.car.s.toFixed(1)]; })); if (rows.at(-1)[0] === 'driving') break; await p.waitForTimeout(10000); }
console.log(JSON.stringify({ rows, errs })); await b.close();
