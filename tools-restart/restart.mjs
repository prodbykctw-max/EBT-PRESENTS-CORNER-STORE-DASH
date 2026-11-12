// node tools-restart/restart.mjs <url> <outdir>: RESTART from the pause menu three times (on foot, then driving, then on foot again), comparing every start with the first boot
// (same Math.random seed at each drive's start) and counting what could leak (window/document listeners, live WebGL contexts, open AudioContexts, pending frame timers).
import fs from 'fs'; import { launch, sig } from './lib.mjs';
const [url, out] = process.argv.slice(2);
const { b, p, errs } = await launch();
fs.mkdirSync(out, { recursive: true });
const t00 = Date.now();
await p.goto(url);
const ready = (n) => p.waitForFunction((n) => window.__boots.length >= n && window.__drive && window.__drive.tick && window.__drive.foot && window.__drive.state, n, { timeout: 900000 });
await ready(1);
const bootMs = Date.now() - t00;
const counts = () => p.evaluate(() => ({ listeners: window.__listenerCount(), byType: window.__listeners(), gl: window.__glLive(), glTotal: window.__gl.length, ac: window.__acOpen(), acTotal: window.__ac.length, timers: window.__shortTimers(), rafs: window.__rafs(), roots: document.querySelectorAll('.drive-root').length, canvases: document.querySelectorAll('canvas').length }));
const hud = () => p.evaluate(() => { const q = (s) => document.querySelector(s)?.textContent; return { time: q('.drive-time'), tokens: q('.drive-tokens'), cp: q('.drive-cp'), pos: q('.drive-pos'), speed: q('.drive-speed'), gap: q('.drive-race .gap'), raceHidden: document.querySelector('.drive-race').hidden, paused: !document.querySelector('.drive-paused').hidden }; });
const state = () => p.evaluate(() => { const d = window.__drive, f = d.foot; return { state: d.state, time: d.time, race: d.race, car: [d.car.s, d.car.d, d.car.v], me: [f.me.x, f.me.y, f.me.s], him: [f.him.x, f.him.y, f.him.s] }; });
await p.evaluate(() => { window.__drive.manual = true; });
const flyBoot = await p.evaluate(() => window.__drive.fly);
const A0 = await p.evaluate(() => window.__sigs[0]); const c0 = await counts(); const h0 = await hud(); const s0 = await state();
const log = { bootMs, A0: { rn: A0.rn, cam: A0.cam, nEnts: A0.nEnts }, c0, h0, s0, restarts: [] };
let REF = null;
async function restartFrom(kind, k) {
  const d0 = await p.evaluate(() => window.__boots.length);
  if (kind === 'foot') { await p.evaluate(() => { const d = window.__drive; d.keys.add('gas'); for (let i = 0; i < 240; i++) d.tick(1 / 60); d.keys.delete('gas'); }); }
  else { // into the car: stand at its door, then drive 4 s
    await p.evaluate(() => { const d = window.__drive, f = d.foot; f.me.x = f.door.x; f.me.y = f.door.y; f.me.px = f.me.x; f.me.py = f.me.y; for (let i = 0; i < 30; i++) d.tick(1 / 60); d.keys.add('gas'); for (let i = 0; i < 240; i++) d.tick(1 / 60); });
  }
  const before = { st: await state(), hud: await hud() };
  // pause, then press RESTART in the panel (a real click on the button)
  await p.evaluate(() => document.querySelector('[data-pause]').click());
  const pausedHud = await hud();
  const tClick = Date.now();
  await p.evaluate(() => document.querySelector('[data-restart]').click());
  await ready(d0 + 1);
  const ms = Date.now() - tClick;
  await p.evaluate(() => { window.__drive.manual = true; });
  const S = await p.evaluate((k) => window.__sigs[k], d0); const st = await state(); const hd = await hud();
  const flyNow = await p.evaluate(() => window.__drive.fly);
  const sameFn = (R) => ({ rn: S.rn === R.rn, cam: JSON.stringify(S.cam) === JSON.stringify(R.cam), me: JSON.stringify(S.me) === JSON.stringify(R.me), him: JSON.stringify(S.him) === JSON.stringify(R.him), car: JSON.stringify(S.car) === JSON.stringify(R.car), ents: JSON.stringify(S.ents) === JSON.stringify(R.ents), ppl: JSON.stringify(S.ppl) === JSON.stringify(R.ppl), state: S.state === R.state, time: S.time === R.time });
  const sameAsRestart1 = REF ? sameFn(REF) : null; if (!REF) REF = S;
  const same = { rn: S.rn === A0.rn, cam: JSON.stringify(S.cam) === JSON.stringify(A0.cam), me: JSON.stringify(S.me) === JSON.stringify(A0.me), him: JSON.stringify(S.him) === JSON.stringify(A0.him), car: JSON.stringify(S.car) === JSON.stringify(A0.car), ents: JSON.stringify(S.ents) === JSON.stringify(A0.ents), ppl: JSON.stringify(S.ppl) === JSON.stringify(A0.ppl), state: S.state === A0.state, time: S.time === A0.time };
  await p.waitForTimeout(1500);   // the old audio context closes 0.6 s after it is stopped
  const c = await counts();
  const shot = await p.evaluate(() => window.__drive.snapshot(0.8)); fs.writeFileSync(`${out}/restart_${k}.jpg`, Buffer.from(shot.split(',')[1], 'base64'));
  log.restarts.push({ k, flyNow, sameAsRestart1, from: kind, before, pausedHud, ms, rn: S.rn, same, state: st, hud: hd, counts: c, boots: await p.evaluate(() => window.__boots) });
  if (!Object.values(same).every(Boolean)) log.restarts[log.restarts.length - 1].diff = { nEnts: [S.nEnts, A0.nEnts], cam: [S.cam, A0.cam], rn: [S.rn, A0.rn] };
}
const N = +(process.env.RS || 3);
await restartFrom('foot', 1);
if (N > 1) { await restartFrom('driving', 2); await restartFrom('foot', 3); }
log.errs = errs;
fs.writeFileSync(`${out}/restart.json`, JSON.stringify(log, null, 1));
console.log(JSON.stringify({ bootMs: log.bootMs, c0: { l: c0.listeners, gl: c0.gl, ac: c0.ac, t: c0.timers, r: c0.rafs }, restarts: log.restarts.map((r) => ({ k: r.k, flyNow: r.flyNow, sameAsRestart1: r.sameAsRestart1, rn: r.rn, from: r.from, ms: r.ms, same: r.same, st: r.state.state, time: r.state.time, race: r.state.race, hud: r.hud, c: { l: r.counts.listeners, gl: r.counts.gl, glT: r.counts.glTotal, ac: r.counts.ac, acT: r.counts.acTotal, t: r.counts.timers, rf: r.counts.rafs, roots: r.counts.roots, cv: r.counts.canvases } })), errs }));
await b.close();
