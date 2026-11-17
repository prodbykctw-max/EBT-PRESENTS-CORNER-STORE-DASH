// Proof: E.B.T cards are collectible on foot. Usage: node tools-footcards/foot.mjs <drive url incl. ?qa[&look=comic]> <tag> <out dir>
// Boots the drive on foot (no skipfoot), then: (1) runner 3 m from a card: not taken; (2) the parked car's pickup box no longer swallows a card while you are on foot;
// (3) runs THROUGH a card line at 6.4 m/s in real 1/120 s steps: taken, count 0 -> 1, card dead; (4) runs the same speed one lane over: nothing taken;
// (5) gets in the car and drives through a card (unchanged path): count goes up by the pickup. Screenshots before / after to <out dir>.
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, tag, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; });
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 1500000 });
const save = async (name) => { const s = await p.evaluate(() => window.__drive.snapshot(0.92)); fs.writeFileSync(`${out}/${tag}_${name}.jpg`, Buffer.from(s.split(',')[1], 'base64')); };
const R = {};
// everything below runs inside the page
R.setup = await p.evaluate(() => {
  const D = window.__drive; D.manual = true; D.audio.__n = 0; const o = D.audio.token.bind(D.audio); D.audio.token = () => { D.audio.__n++; return o(); };
  const F = D.foot, tks = D.world.tokens, alive = () => tks.filter((t) => t.alive).length;
  window.P = { D, F, tks, alive, hud: () => +document.querySelector('.drive-tokens').textContent, pos: (t) => D.world.route.at(t.s, t.d),
    step: (n, dt = 1 / 120) => { for (let i = 0; i < n; i++) D.tick(dt); } };
  D.tick(1 / 60);
  // the card nearest the parked car (by route distance), alive, that is not at the door
  const near = tks.filter((t) => t.alive).sort((a, b) => Math.abs(a.s - F.homeS) - Math.abs(b.s - F.homeS))[0];
  window.P.near = near;
  const q = window.P.pos(near), dd = Math.hypot(q.x - F.door.x, q.y - F.door.y);
  return { state: D.state, cards: tks.length, aliveCards: alive(), hud: window.P.hud(), homeS: F.homeS, homeD: F.homeD, nearCard: { s: near.s, d: near.d, dsFromCar: +(near.s - F.homeS).toFixed(2), distToDoor_m: +dd.toFixed(2) }, runSpeed: 6.4 };
});
// (1) runner 3 m from the card (perpendicular): not collected
R.negative3m = await p.evaluate(() => {
  const { D, F, near, pos } = window.P, q = pos(near), a = q.a; const x = q.x - Math.sin(a) * 3, y = q.y + Math.cos(a) * 3;
  const h0 = window.P.hud(), a0 = window.P.alive();
  F.me.x = F.me.px = x; F.me.y = F.me.py = y; F.me.vx = F.me.vy = 0; window.P.step(60);
  return { runnerToCard_m: +Math.hypot(F.me.x - q.x, F.me.y - q.y).toFixed(2), cardAlive: near.alive, hudBefore: h0, hudAfter: window.P.hud(), aliveBefore: a0, aliveAfter: window.P.alive(), state: D.state };
});
// (2) the parked car's pickup box does not eat a card on foot: put the car's box on the card, runner stays 3 m away
R.carBoxOnFoot = await p.evaluate(() => {
  const { D, F, near } = window.P, c = D.car, s0 = c.s, d0 = c.d; c.s = near.s; c.d = near.d; window.P.step(30);
  const r = { cardAliveWithCarBoxOnIt: near.alive, hud: window.P.hud() }; c.s = s0; c.d = d0; c.v = 0; window.P.step(2); return r;
});
// screenshot: runner a few metres back on the card line, looking down it
await p.evaluate(() => { const { F, near, pos } = window.P, q = pos(near), a = q.a; F.me.x = F.me.px = q.x - Math.cos(a) * 2; F.me.y = F.me.py = q.y - Math.sin(a) * 2; F.me.vx = F.me.vy = 0; F.me.heading = a; F.camYaw = a; window.P.step(90); });
await save('before');
// (3) run through the card at full speed in real 1/120 s steps; the position is set each step so the runner moves exactly FOOT.run per step, the game's own step does the pickup
R.runThrough = await p.evaluate(() => {
  const { D, F, near, pos } = window.P, q = pos(near), a = q.a, V = 6.4 / 120, h0 = window.P.hud(), a0 = window.P.alive(), n0 = D.audio.__n; let minD = 9, popTxt = '';
  for (let i = 0; i < 60; i++) { const k = -2 + i * V; F.me.x = F.me.px = q.x + Math.cos(a) * k; F.me.y = F.me.py = q.y + Math.sin(a) * k; F.me.vx = F.me.vy = 0; D.tick(1 / 120); minD = Math.min(minD, Math.hypot(F.me.x - q.x, F.me.y - q.y)); popTxt = popTxt || document.querySelector('.drive-pop')?.textContent || ''; }
  return { closest_m: +minD.toFixed(2), cardAlive: near.alive, hudBefore: h0, hudAfter: window.P.hud(), aliveBefore: a0, aliveAfter: window.P.alive(), tokenSounds: D.audio.__n - n0, pop: popTxt, state: D.state };
});
await p.evaluate(() => window.P.step(30)); await save('after');
// (4) the same run one lane over (the side with more clearance to any other live card): nothing taken
R.laneAway = await p.evaluate(() => {
  const { D, F, tks, pos } = window.P, c = tks.filter((t) => t.alive && t.s > F.homeS - 30).sort((x, y) => Math.abs(x.s - F.homeS) - Math.abs(y.s - F.homeS))[0], q = pos(c), a = q.a;
  const lane = D.world.route.travel(c.s), V = 6.4 / 120, h0 = window.P.hud(), a0 = window.P.alive();
  const clear = (side) => { let m = 99; for (let i = 0; i < 60; i++) { const k = -2 + i * V, x = q.x + Math.cos(a) * k - Math.sin(a) * lane * side, y = q.y + Math.sin(a) * k + Math.cos(a) * lane * side; for (const t of tks) if (t.alive) { const u = pos(t); m = Math.min(m, Math.hypot(u.x - x, u.y - y)); } } return m; };
  const side = clear(1) >= clear(-1) ? 1 : -1, clearance = clear(side); let minD = 99;
  for (let i = 0; i < 60; i++) { const k = -2 + i * V; F.me.x = F.me.px = q.x + Math.cos(a) * k - Math.sin(a) * lane * side; F.me.y = F.me.py = q.y + Math.sin(a) * k + Math.cos(a) * lane * side; F.me.vx = F.me.vy = 0; D.tick(1 / 120); minD = Math.min(minD, Math.hypot(F.me.x - q.x, F.me.y - q.y)); }
  return { laneOffset_m: +lane.toFixed(2), clearanceToAnyLiveCard_m: +clearance.toFixed(2), closestToTargetCard_m: +minD.toFixed(2), cardAlive: c.alive, hudBefore: h0, hudAfter: window.P.hud(), aliveBefore: a0, aliveAfter: window.P.alive() };
});
// (5) get in the car (walk to the door), then drive through the next card the old way
R.drive = await p.evaluate(() => {
  const { D, F, tks, pos } = window.P, h0 = window.P.hud(), n0 = D.audio.__n;
  for (let i = 0; i < 60 && D.state === 'onfoot'; i++) { F.me.stun = 0; F.me.x = F.me.px = F.door.x; F.me.y = F.me.py = F.door.y; F.me.vx = F.me.vy = 0; D.tick(1 / 120); }
  const state = D.state, c = tks.filter((t) => t.alive && t.s > D.car.s + 40 && Math.abs(t.d - D.world.route.lane(t.s, 0)) < 0.1)[0];   // (a card in the right-hand travel lane: the stiff lane steering holds the car there) if (!c) return { state, err: 'no card ahead' };
  const a0 = window.P.alive(); D.car.s = c.s - 30; D.car.d = c.d; D.car.targetD = c.d; D.car.v = 0; D.keys.add('gas');
  for (let i = 0; i < 900 && c.alive; i++) { D.car.targetD = c.d; D.tick(1 / 60); }
  return { stateAfterGetIn: state, car: { s: +D.car.s.toFixed(1), d: +D.car.d.toFixed(2), v: +D.car.v.toFixed(1) }, card: { s: c.s, d: +c.d.toFixed(2) }, hits: D.result.hits, cardAlive: c.alive, hudBefore: h0, hudAfter: window.P.hud(), aliveBefore: a0, aliveAfter: window.P.alive(), tokenSounds: D.audio.__n - n0, finalState: D.state };
});
const css = await p.evaluate(() => { const hb = document.querySelector('.drive-tokens'); const bx = hb.closest('.drive-box, .rb-cell'); const r = bx.getBoundingClientRect(); return { onfootClass: document.querySelector('.drive-root').className, visible: getComputedStyle(bx).display !== 'none' && r.width > 0, rect: [r.x, r.y, r.width, r.height].map(Math.round) }; });
console.log(JSON.stringify({ tag, url, ...R, css, errs }, null, 1));
await b.close();
