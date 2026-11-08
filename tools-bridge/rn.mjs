// node tools-bridge/rn.mjs "http://localhost:5173/drive/index.html?qa" <tag>: Math.random calls at the first on-foot frame, and the world integrity scan (deck lanes)
import { chromium } from 'playwright-core';
const [url, tag] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.route(/open-meteo/, (r) => r.abort());
await p.addInitScript(() => { let a = 0x12345678, n = 0; Math.random = () => { n++; a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; window.__rn = () => n; });
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 1200000 });
const r = await p.evaluate(() => { const d = window.__drive; d.manual = true; const a = window.__rn(); for (let i = 0; i < 60; i++) d.tick(1 / 60); return { state: d.state, rnAtFirstOnFootFrame: a, rnAfter60Ticks: window.__rn(), me: [d.foot.me.s, d.foot.me.d].map((v) => +v.toFixed(2)) }; });
let scan = null; try { scan = await p.evaluate(async () => { const M = await import('/drive/integrity.js'); const o = M.scanWorld(window.__drive); return { summary: o.summary, worst: o.worst }; }); } catch (e) { scan = String(e).slice(0, 200); }
console.log(tag, 'integrity', JSON.stringify(scan).slice(0, 1500));
console.log(tag, JSON.stringify(r), 'errors', JSON.stringify(errs.slice(0, 5)));
await b.close();
