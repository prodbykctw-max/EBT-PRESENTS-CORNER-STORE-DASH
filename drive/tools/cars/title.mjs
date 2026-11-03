// the title screen on a phone-sized viewport: does the credits block (with the car-model line) fit and clear the button?  node title.mjs <port> <out.png> [wxh]
import { chromium } from 'playwright-core';
const PORT = +process.argv[2], OUT = process.argv[3], [W, H] = (process.argv[4] || '390x844').split('x').map(Number);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/standalone.html`);
  await page.waitForSelector('#btnTitle', { state: 'visible' }); await page.waitForTimeout(2500);
  const r = await page.evaluate(() => { const b = document.querySelector('#btnTitle').getBoundingClientRect(), c = document.querySelector('.credits').getBoundingClientRect();
    return { viewport: [innerWidth, innerHeight], button: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], credits: [Math.round(c.left), Math.round(c.top), Math.round(c.right), Math.round(c.bottom)], text: document.querySelector('.credits').innerText, gapPx: Math.round(c.top - b.bottom), creditsLines: Math.round(c.height / parseFloat(getComputedStyle(document.querySelector('.credits')).lineHeight)) }; });
  console.log(JSON.stringify(r)); await page.screenshot({ path: OUT });
} finally { await browser.close(); }
