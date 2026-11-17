// Do the front wheels, the body lean and the nose turn the way the steering asks, and do touch, mouse and keyboard all steer?
//   node tools-steer/signs.mjs <port>      (a phone-sized touch page: ?qa&skipfoot, stepped by hand at 1/60 s)
// For ◀ (left) and ▶ (right) held through each input kind, at 15 m/s: the steering value, nose yaw, the front wheels' heading relative to the body
// (world-space, read off the model's own *_STEER nodes) and the body's roll (height of its right side minus its left side, world-space; right side
// up = leaning left; measured inside the rig, so the road's slope does not count). Left must give: steer > 0, yaw > 0, front wheels turned left (+), and the body leaning to the right (right side DOWN) while the
// car is accelerating to the left. Also: a touch that starts and ends between two frames (a quick tap) still steers.
import { chromium } from 'playwright-core';
const PORT = +process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  const res = await page.evaluate(async () => {
    const d = window.__drive; d.manual = true; d.freezeClock = true;
    const DT = 1 / 60, car = d.car, route = d.route, THREE = d.three.THREE, root = document.querySelector('.drive-root');
    for (let i = 0; i < 400 && d.state !== 'driving'; i++) d.tick(DT);
    let s0 = null;
    for (let s = 60; s < route.length - 400 && s0 === null; s += 5) { let ok = true; const a0 = route.at(s).a; for (let k = 0; k <= 120 && ok; k += 10) { const a = route.at(s + k).a; if (Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0))) > 0.02) ok = false; } if (ok) s0 = s; }
    const rig = d.three.carRig, model = rig.children[0];
    const wheels = []; model.traverse((o) => { if (!o.isMesh && /^F[LR]_STEER$/.test(o.name)) wheels.push(o); });
    const hd = (o, v) => { const a = v.clone().applyMatrix4(o.matrixWorld), b = new THREE.Vector3().applyMatrix4(o.matrixWorld); return Math.atan2(a.x - b.x, a.z - b.z); };   // heading about +Y of the node's local Z
    const rel = () => { rig.updateMatrixWorld(true); const Z = new THREE.Vector3(0, 0, 1); const hb = hd(model, Z); return wheels.map((w) => { let x = hd(w, Z) - hb; return Math.atan2(Math.sin(x), Math.cos(x)); }); };
    const roll = () => { rig.updateMatrixWorld(true); const R = rig.worldToLocal(model.localToWorld(new THREE.Vector3(1, 0, 0))), L = rig.worldToLocal(model.localToWorld(new THREE.Vector3(-1, 0, 0))); return R.y - L.y; };   // the body's roll against the rig it sits in (the road's own slope is in the rig, not here)
    const reset = (V) => { for (const e of d.world.ents) if (Math.abs(e.s - s0) < 300) e.alive = false; Object.assign(car, { s: s0, d: route.lane(s0, 0), targetD: route.lane(s0, 0), v: V, dv: 0, steer: 0, yaw: 0, slide: 0, ay: 0, invuln: 1e9 }); d.keys.clear(); d.keys.add('gas'); for (let i = 0; i < 30; i++) { car.v = V; car.s = s0; d.tick(DT); } car.v = V; car.s = s0; car.d = route.lane(s0, 0); car.dv = 0; car.yaw = 0; car.steer = 0; car.slide = 0; car.ay = 0; d.tick(DT); };
    const mkTouch = (b, type) => { const r = b.getBoundingClientRect(), t = new Touch({ identifier: 7, target: b, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }); b.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t], changedTouches: [t] })); };
    const press = { touch: (k) => mkTouch(root.querySelector(`[data-k=${k}]`), 'touchstart'), key: (k) => dispatchEvent(new KeyboardEvent('keydown', { code: k === 'left' ? 'ArrowLeft' : 'ArrowRight' })),
      mouse: (k) => { const b = root.querySelector(`[data-k=${k}]`); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 3 })); }, wasd: (k) => dispatchEvent(new KeyboardEvent('keydown', { code: k === 'left' ? 'KeyA' : 'KeyD' })) };
    const lift = { touch: (k) => mkTouch(root.querySelector(`[data-k=${k}]`), 'touchend'), key: (k) => dispatchEvent(new KeyboardEvent('keyup', { code: k === 'left' ? 'ArrowLeft' : 'ArrowRight' })),
      mouse: (k) => root.querySelector(`[data-k=${k}]`).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', pointerId: 3 })), wasd: (k) => dispatchEvent(new KeyboardEvent('keyup', { code: k === 'left' ? 'KeyA' : 'KeyD' })) };
    const out = { s0, rows: [] };
    reset(15); const base = { rel: rel(), roll: roll() };
    for (const kind of ['touch', 'key', 'mouse', 'wasd']) for (const k of ['left', 'right']) {
      reset(15); press[kind](k);
      let peak = { steer: 0, yaw: 0, wheel: 0, ayPos: 0, rollAtAy: null, d: 0 }, d0 = car.d, rollMax = 0, rollAt = 0, ayAt = 0, rollAfterRelease = 0;
      for (let i = 0; i < 40; i++) { car.v = 15; d.tick(DT);
        if (Math.abs(car.steer) > Math.abs(peak.steer)) peak.steer = car.steer; if (Math.abs(car.yaw) > Math.abs(peak.yaw)) peak.yaw = car.yaw;
        const w = rel().map((x, j) => { const q = x - base.rel[j]; return Math.atan2(Math.sin(q), Math.cos(q)); }); const wm = (w[0] + w[1]) / 2; if (Math.abs(wm) > Math.abs(peak.wheel)) peak.wheel = wm;
        if (Math.abs(car.ay) > Math.abs(ayAt)) { ayAt = car.ay; rollAt = roll() - base.roll; } }
      lift[kind](k);
      for (let i = 0; i < 20; i++) { car.v = 15; d.tick(DT); if (i === 8) rollAfterRelease = roll() - base.roll; }
      out.rows.push({ kind, k, peakSteer: +peak.steer.toFixed(2), peakYaw: +peak.yaw.toFixed(3), frontWheelTurn: +peak.wheel.toFixed(3), peakAy: +ayAt.toFixed(1), rollRightMinusLeft_atPeakAy: +rollAt.toFixed(4), rollAfterRelease: +rollAfterRelease.toFixed(4), dMoved: +(car.d - d0).toFixed(2) });
    }
    // a touch that begins and ends between two frames
    for (const k of ['left', 'right']) { reset(15); const d0 = car.d; press.touch(k); lift.touch(k); for (let i = 0; i < 60; i++) { car.v = 15; d.tick(DT); } out.rows.push({ kind: 'quick touch (no frame between)', k, dMoved: +(car.d - d0).toFixed(2), keysLeft: [...d.keys].join(',') }); }
    // a stuck key after the pause / unpause
    out.base = { wheelsRest: base.rel.map((x) => +x.toFixed(4)), rollRest: +base.roll.toFixed(4) };
    return out;
  });
  console.log('straight stretch s0', res.s0, JSON.stringify(res.base));
  for (const r of res.rows) console.log(JSON.stringify(r));
  console.log('errors', JSON.stringify(errs.filter((l) => !/AudioContext|KHR_parallel/.test(l))));
} finally { await browser.close(); }
