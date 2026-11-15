// ?qa&bot with manual ticks: does the autopilot get to the car (state 'driving')?  node tools-load/botticks.mjs <url>
import { launch } from '../tools-restart/lib.mjs';
const { b, p, errs } = await launch();
await p.goto(process.argv[2]);
await p.waitForFunction(() => window.__drive && window.__drive.state, null, { timeout: 900000 });
const r = await p.evaluate(() => { const d = window.__drive; d.manual = true; const seen = []; let last = ''; for (let i = 0; i < 6000; i++) { d.tick(1 / 30); if (d.state !== last) { last = d.state; seen.push([d.state, i]); } if (d.state === 'driving') break; } return { seen, state: d.state, time: +d.time.toFixed(1) }; });
console.log(JSON.stringify({ ...r, errs })); await b.close();
