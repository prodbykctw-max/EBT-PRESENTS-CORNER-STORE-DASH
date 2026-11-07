// Quick in-game smoke test of free roam: boot the drive, run with the stick (up, then right, then down), check you
// moved in the world and never ended inside a building, then let ?bot run to the car and into the drive.
// Usage: node tools-roam/smoke.mjs <port>
import { chromium } from '/home/claude/wt-engine/node_modules/playwright-core/index.mjs';
const port = process.argv[2] || 5401;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
async function run(q) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route(/open-meteo/, (r) => r.abort());
  await p.goto(`http://localhost:${port}/drive/index.html?qa${q}`);
  await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.state === 'onfoot', null, { timeout: 900000 });
  return { p, errs };
}
{
  const { p, errs } = await run('');
  const res = await p.evaluate(() => {
    const d = window.__drive, f = d.foot; d.manual = true;
    const at = () => ({ x: f.me.x, y: f.me.y, s: f.me.s, d: f.me.d });
    const out = { start: at(), legs: [], inside: 0, nan: 0 };
    for (const [x, y, secs] of [[0, -1, 4], [1, 0, 3], [0, 1, 3], [-0.7, -0.7, 3]]) {
      f.stick = { x, y }; const a = at();
      for (let i = 0; i < secs * 60; i++) {
        d.tick(1 / 60);
        if (!Number.isFinite(f.me.x) || !Number.isFinite(f.me.y)) out.nan++;
        if (f.solidAt && f.solidAt(f.me.x, f.me.y)) out.inside++;
        if (d.state !== 'onfoot') break;
      }
      const z = at(); out.legs.push({ x, y, moved: Math.hypot(z.x - a.x, z.y - a.y), state: d.state });
    }
    f.stick = null; out.end = at(); out.camYaw = f.camYaw; return out;
  });
  console.log(JSON.stringify(res));
  ok(errs.length === 0, 'run: no page errors ' + errs.slice(0, 3).join(' | '));
  ok(res.nan === 0, 'run: position always a number');
  ok(res.inside === 0, 'run: never inside a building (solidAt)');
  ok(res.legs[0].moved > 10, `run: drag up moves you (${res.legs[0].moved.toFixed(1)} m in 4 s)`);
  ok(res.legs[1].moved > 5, `run: drag right moves you (${res.legs[1].moved.toFixed(1)} m in 3 s)`);
  const shot = await p.evaluate(() => window.__drive.snapshot(0.85));
  (await import('fs')).writeFileSync('/tmp/claude-0/-home-claude/e2e83a67-c174-5b6b-8bbe-da1ab9df0c73/scratchpad/roam_smoke.jpg', Buffer.from(shot.split(',')[1], 'base64'));
  await p.close();
}
{
  const { p, errs } = await run('&bot');
  const st = await p.evaluate(() => { const d = window.__drive; d.manual = true; let i = 0; while (d.state === 'onfoot' && i < 60 * 90) { d.tick(1 / 60); i++; } for (let k = 0; k < 120; k++) d.tick(1 / 60); return { state: d.state, secs: i / 60, v: d.car.v }; });
  console.log(JSON.stringify(st));
  ok(errs.length === 0, 'bot: no page errors ' + errs.slice(0, 3).join(' | '));
  ok(st.state !== 'onfoot', `bot: reached the car and got in (${st.secs.toFixed(1)} s, state ${st.state})`);
  await p.close();
}
await b.close();
console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
