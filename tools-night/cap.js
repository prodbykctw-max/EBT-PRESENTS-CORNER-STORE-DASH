// node cap.js <base url> <outdir> [onlyFoot]
// Phone (coarse pointer, 390x780) night captures: on foot at start, on foot beside the car, driving on a straight, driving at a signal;
// each also relit to 18:15 (blue hour) and, for foot_start and drive_straight, 13:00 / 16:55 / 17:47. PNGs. Plus a mask pass for the runner/bully
// and the glow sprites (hidden vs shown), and a 3 s 10 fps sequence at night for the flash check.
const { chromium } = require('playwright');
const fs = require('fs');
const [base, out, mode = 'all'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const DATE = '2026-11-24';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await p.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  await p.route(/open-meteo/, (r) => r.abort());
  const t0 = Date.now();
  await p.goto(`${base}/drive/index.html?qa&bot&time=21:00&date=${DATE}`);
  await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 1500000 });
  console.log('boot', ((Date.now() - t0) / 1000).toFixed(0), 's');
  await p.evaluate(() => { window.__drive.manual = true; });
  const inst = (hm) => p.evaluate(([d, hm]) => { const [y, mo, da] = d.split('-').map(Number); return [y, mo, da, ...hm.split(':').map(Number)]; }, [DATE, hm]);
  const relight = async (hm) => p.evaluate(async ([DATE, hm]) => {
    const { atlantaInstant } = await import('./daylight.js');
    const [y, mo, d] = DATE.split('-').map(Number), [h, mi] = hm.split(':').map(Number);
    return window.__drive.relight(atlantaInstant(y, mo, d, h, mi), { code: 0, cloud: 10, rain: 0 });
  }, [DATE, hm]);
  const png = async (name, hide = null) => {
    const url = await p.evaluate((hide) => {
      const d = window.__drive, hidden = [];
      const find = (k) => {
        if (k === 'me') return [d.foot.me.o, d.foot.me.blob].filter(Boolean);
        if (k === 'him') return [d.foot.him.o, d.foot.him.blob].filter(Boolean);
        if (k === 'glows') { const o = []; d.three.scene.traverse((x) => { if ((x.isSprite && x.material.blending === 2) || x.name === 'signal_lamps') o.push(x); }); return o; }
        return [];
      };
      if (hide) for (const k of hide) for (const o of find(k)) { if (o.visible) { o.visible = false; hidden.push(o); } }
      d.snapshot(0.5); const u = d.three.renderer.domElement.toDataURL('image/png');
      for (const o of hidden) o.visible = true;
      return u;
    }, hide);
    fs.writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
  };
  const info = () => p.evaluate(() => { const d = window.__drive; return { state: d.state, s: +d.car.s.toFixed(1), v: +d.car.v.toFixed(1), door: +d.foot.doorDist(d.foot.me).toFixed(1) }; });
  const set = async (name, extraTimes, masks) => {
    await png(name);
    if (masks) { await png(name + '_nome', ['me']); await png(name + '_nohim', ['him']); await png(name + '_noglow', ['glows']); }
    for (const hm of extraTimes) { await relight(hm); await png(`${name}_${hm.replace(':', '')}`); }
    if (extraTimes.length) await relight('21:00');
    console.log(name, JSON.stringify(await info()), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  };
  const tick = (n, dt = 1 / 60) => p.evaluate(([n, dt]) => { for (let i = 0; i < n; i++) window.__drive.tick(dt); }, [n, dt]);
  await tick(3);
  if (process.env.FX) await p.evaluate((k) => { for (const f of k.split(',')) window.__drive.comic.fx[f] = false; }, process.env.FX);
  if (mode === 'quick') { await png('foot_start'); for (let k = 0; k < 4000; k++) { const i = await p.evaluate(() => { const d = window.__drive; for (let j = 0; j < 6; j++) { d.tick(1 / 60); if (d.state !== 'onfoot' || d.foot.doorDist(d.foot.me) < 3.2) break; } return [d.state, d.foot.doorDist(d.foot.me)]; }); if (i[0] !== 'onfoot' || i[1] < 3.2) break; } await png('foot_car'); await b.close(); return; }
  await set('foot_start', ['18:15', '13:00', '16:55', '17:47'], true);
  // flash check sequence (on foot): 30 frames at 10 fps of game time
  if (mode !== 'nofl') { for (let i = 0; i < 30; i++) { await tick(6); await png(`seq_foot_${String(i).padStart(2, '0')}`); } }
  // run toward the car until ~31 m from the door (the owner's first screenshot)
  for (let k = 0; k < 4000; k++) { const i = await p.evaluate(() => { const d = window.__drive; for (let j = 0; j < 6; j++) { d.tick(1 / 60); if (d.state !== 'onfoot' || d.foot.doorDist(d.foot.me) < 31) break; } return [d.state, d.foot.doorDist(d.foot.me)]; }); if (i[0] !== 'onfoot' || i[1] < 31) break; }
  await set('foot_mid', ['18:15'], true);
  // run to the car (the bot runs); stop ~3 m from the door
  for (let k = 0; k < 4000; k++) { const i = await p.evaluate(() => { const d = window.__drive; for (let j = 0; j < 6; j++) { d.tick(1 / 60); if (d.state !== 'onfoot' || d.foot.doorDist(d.foot.me) < 3.2) break; } return [d.state, d.foot.doorDist(d.foot.me)]; }); if (i[0] !== 'onfoot' || i[1] < 3.2) break; }
  await set('foot_car', ['18:15'], true);
  // drive: wait till it is driving, then a straight with no signal near, then a signal ahead
  let gotStraight = false, gotSignal = false;
  for (let k = 0; k < 6000 && !(gotStraight && gotSignal); k++) {
    const r = await p.evaluate(() => {
      const d = window.__drive; for (let j = 0; j < 4; j++) d.tick(1 / 60);
      if (d.state !== 'driving') return { st: d.state };
      const R = d.route, s = d.car.s, a0 = R.at(s).a, a1 = R.at(s + 45).a, bend = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
      const n = d.world.signals.next(s + 2.5, 200);
      return { st: d.state, s, v: d.car.v, bend, gap: n ? n.gap : 999 };
    });
    if (r.st !== 'driving') { if (r.st !== 'onfoot' && r.st !== 'countdown') { console.log('state', r.st); } continue; }
    if (!gotStraight && r.v > 8 && r.bend < 0.04 && r.gap > 70) { gotStraight = true; await set('drive_straight', ['18:15', '13:00', '16:55', '17:47'], true); if (mode !== 'nofl') { for (let i = 0; i < 30; i++) { await tick(6); await png(`seq_drive_${String(i).padStart(2, '0')}`); } } }
    else if (!gotSignal && r.gap > 14 && r.gap < 30 && r.v > 3) { gotSignal = true; await set('drive_signal', ['18:15'], true); }
  }
  console.log('errs', JSON.stringify(errs));
  await b.close();
})();
