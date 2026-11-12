import { launch } from './lib.mjs';
const { b, p, errs } = await launch();
await p.goto(process.argv[2]);
await p.waitForFunction(() => window.__drive && window.__drive.state === 'driving', null, { timeout: 600000 });
const a = await p.evaluate(() => window.__drive.car.s); await p.waitForTimeout(8000);
console.log(JSON.stringify({ s0: a, s1: await p.evaluate(() => [window.__drive.car.s, window.__drive.car.v, window.__drive.state]), errs })); await b.close();
