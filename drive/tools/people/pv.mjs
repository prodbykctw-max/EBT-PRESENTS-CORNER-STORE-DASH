// preview shots: node pv.mjs <port> <out.jpg> "<query>"
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const [port, out, query] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
const logs = []; page.on('console', (m) => logs.push(m.type() + ': ' + m.text())); page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
await page.goto(`http://localhost:${port}/drive/tools/people/preview.html?${query}`);
try { await page.waitForFunction(() => window.__done, null, { timeout: 240000 }); } catch (e) { console.log('timeout'); }
console.log(JSON.stringify(await page.evaluate(() => window.__done)));
const data = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/jpeg', 0.92));
if (data) fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log(logs.filter((l) => !/parallel_shader/.test(l)).slice(0, 15).join('\n'));
await browser.close();
