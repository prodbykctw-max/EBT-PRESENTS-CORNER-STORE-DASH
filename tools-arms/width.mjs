import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
await p.goto(process.argv[2]); await p.waitForFunction(() => window.__out, null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(() => window.__out))); await b.close();
