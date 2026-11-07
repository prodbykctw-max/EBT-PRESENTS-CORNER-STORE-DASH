// Open the store run (?nodrive) at phone size, walk the shopper in each direction and screenshot it, so the sprite
// sheets can be seen in the game itself. Usage: node tools-arms/store.mjs <url to standalone.html> <tag>
import { chromium } from 'playwright-core';
import fs from 'fs';
const [url, tag] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await p.goto(url + (url.includes('?') ? '&' : '?') + 'nodrive');
await p.waitForFunction(() => window.__csd, null, { timeout: 60000 });
const click = async (id) => { await p.waitForSelector('#' + id, { state: 'visible', timeout: 20000 }); await p.click('#' + id); await p.waitForTimeout(900); };
await click('btnTitle'); await click('btnStart');
await p.waitForTimeout(1500);
await p.evaluate(() => window.__csd.freeze(true));
fs.mkdirSync('tools-arms/out', { recursive: true });
let k = 0;
for (const [x, y] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
  await p.evaluate(([x, y]) => window.__csd.setInput(x, y), [x, y]);
  for (let i = 0; i < 3; i++) { await p.waitForTimeout(140); await p.screenshot({ path: `tools-arms/out/${tag}_store_${k++}.png` }); }
}
await p.evaluate(() => window.__csd.setInput(null));
console.log(JSON.stringify({ tag, state: await p.evaluate(() => window.__csd.S.state || window.__csd.S.mode || null), errs: errs.slice(0, 5) }));
await b.close();
