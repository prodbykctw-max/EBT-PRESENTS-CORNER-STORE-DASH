// node comic.js <base> <out>: comic look frames (on foot start, after 120 ticks, and skipfoot driving after 240 ticks), phone path
const { chromium } = require('playwright'); const fs = require('fs');
const [base, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  for (const [name, q] of [['foot', 'qa&bot&look=comic&time=21:00&date=2026-11-24'], ['drive', 'qa&bot&skipfoot&look=comic&time=21:00&date=2026-11-24']]) {
    const p = await b.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    if (process.env.FREEZE) await p.addInitScript(() => { let s = 12345; let s2 = 777; const R2 = () => { s2 = (s2 + 0x6D2B79F5) | 0; let t = Math.imul(s2 ^ (s2 >>> 15), 1 | s2); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; Math.random = () => { if (/audio\.js/.test((new Error().stack || '').split('\n')[2] || '')) return R2(); s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; const T0 = 1764000000000; performance.now = () => 5000; Date.now = () => T0; });
    await p.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); });
    await p.route(/open-meteo/, (r) => r.abort());
    await p.goto(`${base}/drive/index.html?${q}`);
    await p.waitForFunction(() => window.__drive && window.__drive.tick, null, { timeout: 600000 });
    for (const n of [3, 240]) {
      const url = await p.evaluate((n) => { const d = window.__drive; d.manual = true; for (let i = 0; i < n; i++) d.tick(1 / 60); d.snapshot(0.5); return d.three.renderer.domElement.toDataURL('image/png'); }, n);
      fs.writeFileSync(`${out}/${name}_${n}.png`, Buffer.from(url.split(',')[1], 'base64'));
    }
    await p.close();
  }
  await b.close();
})();
