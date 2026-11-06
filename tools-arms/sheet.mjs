import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1536, height: 576 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto(process.argv[2]); await p.waitForFunction(() => window.__done, null, { timeout: 180000 });
await p.screenshot({ path: process.argv[3] }); await b.close();
