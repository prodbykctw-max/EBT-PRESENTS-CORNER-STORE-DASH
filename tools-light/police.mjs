// node tools-light/police.mjs <url ?qa&skipfoot[&time=21:00]> <outdir> <frames> <fps>: a police car ahead, drive into it (BUSTED), record the frames around its roof lights (from the flash proofs, tools drive.mjs)
import fs from 'fs';
import { chromium } from 'playwright-core';
const [url, out, N = '60', fps = '20'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 360, height: 740 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.state, null, { timeout: 1500000 });
await p.evaluate(() => { const d = window.__drive; d.manual = true; window.__fake = 100000; performance.now = () => window.__fake; });
const info = await p.evaluate(() => { const d = window.__drive; const c = d.car; d.world.add('police', { s: c.s + 24, d: c.d, v: 0, cruise: 0, dir: 1, color: 0xffffff, hold: true }); return { state: d.state, s: c.s, d: c.d }; });
console.log(JSON.stringify(info));
const step = async (dt) => p.evaluate((dt) => { window.__fake += dt * 1000; window.__drive.tick(dt); return window.__drive.state; }, dt);
await p.evaluate(() => window.__drive.keys.add('gas'));
let st = '', k = 0;
while (st !== 'busted' && k++ < 1800) st = await step(1 / 30);
console.log('state', st, 'ticks', k);
await p.evaluate(() => window.__drive.keys.delete('gas'));
// let the crash settle 0.3 s, then record
for (let i = 0; i < 9; i++) await step(1 / 30);
const pos = [];
for (let i = 0; i < +N; i++) {
  await step(1 / +fps);
  const r = await p.evaluate(() => { const d = window.__drive, T = d.three; let g = null; T.scene.traverse((o) => { if (!g && o.isGroup && o.children.length === 2 && o.children.every((c) => c.isSprite)) g = o; });
    let xy = null; if (g) { const v = g.getWorldPosition(new T.THREE.Vector3()).project(T.camera); const c = T.renderer.domElement; xy = [(v.x * 0.5 + 0.5) * c.width, (-v.y * 0.5 + 0.5) * c.height, c.width, c.height]; }
    return { xy, jpg: d.snapshot(0.92) }; });
  pos.push(r.xy); fs.writeFileSync(`${out}/f${String(i).padStart(4, '0')}.jpg`, Buffer.from(r.jpg.split(',')[1], 'base64'));
}
fs.writeFileSync(`${out}/beacon_xy.json`, JSON.stringify(pos));
const j = await p.evaluate(() => { const d = window.__drive; return d.snapshot(0.9); });
fs.writeFileSync(`${out}/snapshot.jpg`, Buffer.from(j.split(',')[1], 'base64'));
console.log(JSON.stringify({ errs: errs.slice(0, 3), card: await p.evaluate(() => !!document.querySelector('.drive-busted')) }));
await b.close();
