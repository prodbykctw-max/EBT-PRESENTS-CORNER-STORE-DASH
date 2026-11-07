import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1200, height: 420 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto(process.argv[2]); await p.waitForFunction(() => window.__done, null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(() => window.__out)));
await p.screenshot({ path: process.argv[3] }); await b.close();
