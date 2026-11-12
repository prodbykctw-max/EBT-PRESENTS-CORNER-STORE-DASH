// how many Math.random draws the drive's lazily loaded modules take just by being loaded the first time (module-level objects): explains a first boot vs a restart in the same page
import { launch } from './lib.mjs';
const { b, p } = await launch();
await p.route('**/stub.html', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
await p.goto(process.argv[2]);
const r = await p.evaluate(async () => { window.__seed(1); const out = {}; for (const m of ['real.js', 'cars.js', 'animals.js', 'people-alt.js', 'people-b.js', 'contact.js', 'people.js', 'drive.js']) { const n0 = window.__rn(); try { await import('/drive/' + m); } catch (e) { out[m] = 'ERR ' + e.message; continue; } out[m] = window.__rn() - n0; } return out; });
console.log(JSON.stringify(r)); await b.close();
