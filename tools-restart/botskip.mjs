// skip: a tap (and, on a second boot, a key) ends the flyover on the on-foot start; bot: ?qa&bot has no flyover, reaches the car and drives
import fs from 'fs'; import { launch } from './lib.mjs';
const [base, basef] = process.argv.slice(2);
const baseCam = JSON.parse(fs.readFileSync(basef)).sig.cam;
const out = {};
for (const mode of ['tap', 'key', 'bot']) {
  const { b, p, errs } = await launch();
  await p.goto(base + (mode === 'bot' ? '?qa&bot' : '?qa&fly'));
  await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
  await p.evaluate(() => { window.__drive.manual = true; });
  if (mode === 'bot') {
    const r = await p.evaluate(() => { const d = window.__drive; const s0 = d.state, f0 = d.fly; let n = 0; while (d.state === 'onfoot' && n < 4000) { d.tick(1 / 60); n++; } const at = d.state; for (let i = 0; i < 600; i++) d.tick(1 / 60); return { start: s0, fly: f0, afterFoot: at, ticksToCar: n, car: [d.car.s, d.car.v] }; });
    out.bot = { ...r, errs };
  } else {
    await p.evaluate(() => { for (let i = 0; i < 40; i++) window.__drive.tick(1 / 30); });
    const mid = await p.evaluate(() => window.__drive.fly);
    if (mode === 'tap') await p.evaluate(() => { const c = document.querySelector('.drive-root canvas'); c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, clientX: 100, clientY: 400 })); });
    else await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })));
    const r = await p.evaluate(() => { const d = window.__drive; const f = d.fly; d.tick(1 / 60); const c = d.three.camera, q = c.quaternion; return { flyAfter: f, flyNext: d.fly, state: d.state, cam: [c.position.x, c.position.y, c.position.z, q.x, q.y, q.z, q.w].map((v) => +v.toFixed(5)), stick: !!d.foot.drag, cls: document.querySelector('.drive-root').className, keysHeld: [...d.keys] }; });
    out[mode] = { mid, ...r, camEqualsFreshStart: JSON.stringify(r.cam) === JSON.stringify(baseCam), errs };
  }
  await b.close();
}
console.log(JSON.stringify(out));
