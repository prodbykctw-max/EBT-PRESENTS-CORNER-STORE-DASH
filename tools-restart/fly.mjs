// node tools-restart/fly.mjs <url with ?qa&fly> <outdir> [baseline boot.json]: step the opening flyover on fixed ticks, stills at the start / middle / end, the camera's biggest frame-to-frame jump,
// whether you and the bully moved, and the first on-foot camera against a start with no flyover (baseline = tools-restart/boot.mjs output)
import fs from 'fs'; import { launch, sig } from './lib.mjs';
const [url, out, basef] = process.argv.slice(2);
const { b, p, errs } = await launch();
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
fs.mkdirSync(out, { recursive: true });
await p.evaluate(() => { window.__drive.manual = true; });
const info = await p.evaluate(() => { const d = window.__drive; return { fly: d.fly, hudHidden: getComputedStyle(document.querySelector('.drive-rhud') || document.querySelector('.drive-hud')).opacity, cls: document.querySelector('.drive-root').className }; });
const rows = [], shots = [0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.6];
let prev = null, maxJump = 0, shotI = 0, t = 0;
const mvStart = await p.evaluate(() => { const f = window.__drive.foot; return [f.me.x, f.me.y, f.him.x, f.him.y]; });
for (let i = 0; i < 400; i++) {
  const r = await p.evaluate(() => { const d = window.__drive, c = d.three.camera; const was = d.fly; d.tick(1 / 30); return { fly: was ? +was.t.toFixed(3) : null, now: d.fly ? 1 : 0, cam: [c.position.x, c.position.y, c.position.z], q: [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w], state: d.state }; });
  if (prev) { const j = Math.hypot(r.cam[0] - prev.cam[0], r.cam[1] - prev.cam[1], r.cam[2] - prev.cam[2]); const qd = 2 * Math.acos(Math.min(1, Math.abs(r.q.reduce((s, v, k) => s + v * prev.q[k], 0)))) * 180 / Math.PI; rows.push({ t: r.fly, j: +j.toFixed(2), qd: +qd.toFixed(2), y: +r.cam[1].toFixed(1) }); if (r.fly !== null) maxJump = Math.max(maxJump, j); }
  prev = r;
  if (r.fly !== null && shotI < shots.length && r.fly >= shots[shotI]) { const s = await p.evaluate(() => window.__drive.snapshot(0.85)); fs.writeFileSync(`${out}/fly_${shotI}.jpg`, Buffer.from(s.split(',')[1], 'base64')); shotI++; }
  if (!r.now) break;
}
// one more tick (the first on-foot frame after the flyover) and a still
const after = await p.evaluate(sig);
await p.evaluate(() => window.__drive.tick(1 / 30));
const first = await p.evaluate(sig);
const s = await p.evaluate(() => window.__drive.snapshot(0.85)); fs.writeFileSync(`${out}/fly_end.jpg`, Buffer.from(s.split(',')[1], 'base64'));
const mv = await p.evaluate(() => { const f = window.__drive.foot; return [f.me.x, f.me.y, f.him.x, f.him.y]; });
const res = { info, ticks: rows.length, maxJumpMetres: +maxJump.toFixed(2), lastRows: rows.slice(-6), minY: Math.min(...rows.map((r) => r.y)), moved: mv.map((v, k) => +(v - mvStart[k]).toFixed(6)), hud: await p.evaluate(() => getComputedStyle(document.querySelector('.drive-rhud') || document.querySelector('.drive-hud')).opacity), after: after.cam, first: first.cam, errs };
if (basef) { const base = JSON.parse(fs.readFileSync(basef)); res.baseCam = base.sig.cam; res.camDiff = first.cam.map((v, k) => +(v - base.sig.cam[k]).toExponential(2)); res.rn = [first.rn, base.sig.rn]; res.bootRn = [await p.evaluate(() => window.__boots[0].rn), base.boot[0].rn]; }
fs.writeFileSync(`${out}/fly.json`, JSON.stringify({ res, rows }, null, 1));
console.log(JSON.stringify(res));
await b.close();
