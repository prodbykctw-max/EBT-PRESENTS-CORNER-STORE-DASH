// The park cut, frame by frame: node tools-park/cut.mjs <port> <outdir> [bot|hold] [seed]
// Drives to the spot as measure.mjs does, then from 12 m before the spot steps at 1/30 s and, every step, draws the frame (snapshot) and composites the
// `.drive-cut` veil over it exactly as the page does (black at the veil's opacity). Prints the mean luminance of every composite frame (0-255) and the veil
// opacity: one smooth dip to black and back, no frame-to-frame jump above a few tens of levels. Saves the frames before / mid-fade / dark / mid fade-in / after.
import { chromium } from 'playwright-core'; import fs from 'fs';
const PORT = +process.argv[2], OUT = process.argv[3], MODE = process.argv[4] || 'bot', SEED = +(process.argv[5] || 1);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((seed) => { let a = seed; Math.random = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }, SEED);
  const page = await ctx.newPage();
  const logs = []; page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/drive/index.html?qa&skipfoot&bot`);
  await page.waitForFunction(() => window.__drive && window.__drive.world && window.__drive.foot, null, { timeout: 1800000, polling: 2000 });
  const frames = [];
  await page.exposeFunction('__keep', (rec) => { frames.push(rec); });
  const res = await page.evaluate(async ([MODE]) => {
    const d = window.__drive; d.manual = true;
    let rep = null, clockMs = 0;
    if (MODE === 'bot') { const { autopilot } = await import('/drive/autopilot.js'); rep = autopilot(d, { manual: true, clock: () => clockMs }); }
    const cv = document.createElement('canvas'); cv.width = 800; cv.height = 450; const g = cv.getContext('2d', { willReadFrequently: true });
    const img = new Image();
    const shot = async () => {
      img.src = d.snapshot(0.92); await img.decode();
      const veil = document.querySelector('.drive-cut'), op = veil ? +veil.style.opacity || 0 : 0;
      g.globalAlpha = 1; g.drawImage(img, 0, 0, 800, 450); g.globalAlpha = op; g.fillStyle = '#000'; g.fillRect(0, 0, 800, 450); g.globalAlpha = 1;
      const px = g.getImageData(0, 0, 800, 450).data; let sum = 0; for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      return { lum: sum / (px.length / 4), op, url: cv.toDataURL('image/jpeg', 0.85) };
    };
    const DT = 1 / 30, rows = []; let n = 0, k = 0, afterPark = 0;
    while (n < 20000) {
      if (MODE === 'hold') { d.keys.add('gas'); d.car.targetD = d.car.s > d.spot.s - 70 ? d.spot.d : d.route.lane(d.car.s, 0); }
      d.tick(DT); clockMs += DT * 1000; n++; if (rep && n % 2 === 0) rep.tick();
      if (d.car.s > d.spot.s - 12 || d.state !== 'driving') {
        const r = await shot();
        const row = { k: k++, state: d.state, s: +d.car.s.toFixed(2), dOff: +(d.car.d - d.spot.d).toFixed(2), v: +d.car.v.toFixed(2), op: +r.op.toFixed(3), lum: +r.lum.toFixed(1) };
        rows.push(row); await window.__keep({ row, url: r.url });
        if (d.state !== 'driving') { afterPark++; if (afterPark > 40 || d.state === 'busted' || d.state === 'late') break; }
      }
    }
    return { rows, final: d.state, result: { ...d.result }, parkEntry: d.parkEntry ? { ...d.parkEntry } : null, timeLeft: d.time };
  }, [MODE]);
  fs.writeFileSync(`${OUT}/rows_${MODE}.json`, JSON.stringify(res, null, 1));
  const rows = res.rows; const pk = rows.findIndex((r) => r.state !== 'driving');
  // pick: last driving frame, a mid-fade-out frame (veil nearest 0.5 on the way down), the darkest, mid fade-in (veil nearest 0.5 on the way up), later ones
  const pick = {}; pick.before = pk - 1; let darkest = pk; rows.forEach((r, i) => { if (i >= pk && r.op >= rows[darkest].op) darkest = i; });
  pick.dark = darkest;
  let bi = pk; for (let i = pk; i <= darkest; i++) if (Math.abs(rows[i].op - 0.5) < Math.abs(rows[bi].op - 0.5)) bi = i; pick.midOut = bi;
  let ci = Math.min(rows.length - 1, darkest + 1); for (let i = darkest + 1; i < rows.length; i++) if (Math.abs(rows[i].op - 0.5) < Math.abs(rows[ci].op - 0.5)) ci = i; pick.midIn = ci;
  pick.after = Math.min(rows.length - 1, darkest + 14); pick.arrival = rows.length - 1;
  for (const [name, i] of Object.entries(pick)) { const f = frames[i]; if (f) fs.writeFileSync(`${OUT}/${MODE}_${name}_k${f.row.k}.jpg`, Buffer.from(f.url.split(',')[1], 'base64')); }
  const lums = rows.map((r) => r.lum), jumps = lums.slice(1).map((v, i) => Math.abs(v - lums[i]));
  console.log(JSON.stringify({ mode: MODE, picks: pick, maxFrameJump: Math.max(...jumps), lumCurve: rows.map((r) => `${r.k}:${r.state[0]}:op${r.op}:L${r.lum}`), parkEntry: res.parkEntry, result: res.result, timeLeft: res.timeLeft }));
  console.log('LOGS', JSON.stringify(logs.filter((l) => !/AudioContext|KHR_parallel/.test(l))));
} finally { await browser.close(); }
