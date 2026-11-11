// Drive close-ups of the EBT cards. Usage: node tools-ebtcard/cards.mjs <drive url incl. ?qa&skipfoot[&look=comic]> <tag> <out dir>
// Counts Math.random at boot, snapshots a card ahead at three distances, then drives through the first run of tokens and reports the pickup count + token sound calls.
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, tag, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678, n = 0; Math.random = () => { n++; a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; window.__rn = () => n; });   // (seeded: the same street every run, and a count of the draws)
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick, null, { timeout: 900000 });
const save = async (name) => { const s = await p.evaluate(() => window.__drive.snapshot(0.92)); fs.writeFileSync(`${out}/${tag}_${name}.jpg`, Buffer.from(s.split(',')[1], 'base64')); };
const info = await p.evaluate(() => { const d = window.__drive; d.manual = true; d.audio.__n = 0; const o = d.audio.token.bind(d.audio); d.audio.token = () => { d.audio.__n++; return o(); };
  const tk = d.world.tokens.find((t) => t.alive); return { tk: { s: tk.s, d: tk.d }, state: d.state, n: d.world.tokens.length, randomDraws: window.__rn() }; });
const px = [];
for (const dist of [14, 8, 4.5]) {
  await p.evaluate(({ s, d, dist }) => { const D = window.__drive; for (let i = 0; i < 400 && D.state !== 'driving'; i++) D.tick(1 / 60); D.car.s = s - dist; D.car.d = d; D.car.targetD = d; D.car.v = 0; for (let i = 0; i < 30; i++) { D.car.s = s - dist; D.car.d = d; D.car.targetD = d; D.car.v = 0; D.tick(1 / 60); } }, { ...info.tk, dist });
  await save('d' + dist);
  px.push(await p.evaluate(({ s, d }) => { const D = window.__drive, T = D.three, c = T.camera, q = D.world.route.at(s, d), w = new T.THREE.Vector3(q.x, q.z + 1.0, -q.y); const r = w.distanceTo(c.position); return { camDist_m: +r.toFixed(2), px_per_m: +(innerHeight / 2 / (r * Math.tan(c.fov * Math.PI / 360))).toFixed(1) }; }, info.tk)); // (px_per_m x the card's long side = its on-screen width, face-on)
}
const res = await p.evaluate(({ s, d }) => { const D = window.__drive; D.car.s = s - 30; D.car.d = d; D.car.targetD = d; D.keys.add('gas'); let k = 0; for (let i = 0; i < 900; i++) { D.car.targetD = d; D.tick(1 / 60); } return { s: D.car.s, tokensSound: D.audio.__n, hud: document.querySelector('.drive-tokens').textContent, state: D.state }; }, info.tk);
console.log(JSON.stringify({ tag, info, px, res, errs }));
await b.close();
