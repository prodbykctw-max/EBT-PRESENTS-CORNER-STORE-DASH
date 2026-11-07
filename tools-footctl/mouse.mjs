// desktop: press the mouse anywhere on the street and drag (the store's board works the same way)
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route(/open-meteo/, (r) => r.abort());
await p.goto(process.argv[2]);
await p.waitForFunction(() => window.__drive && window.__drive.foot, null, { timeout: 900000 });
await p.waitForTimeout(1500); await p.evaluate(() => { window.__drive.manual = true; });
const tick = (n) => p.evaluate((n) => { const d = window.__drive, f = d.foot; for (let i = 0; i < n; i++) d.tick(1 / 60); return { st: d.state, s: +f.me.s.toFixed(2), d: +f.me.d.toFixed(2), v: +f.me.v.toFixed(2), drag: f.drag ? { x: +f.drag.x.toFixed(2), y: +f.drag.y.toFixed(2) } : null, ring: document.querySelector('.drive-stick').classList.contains('on'), pads: [...document.querySelectorAll('.drive-pad')].map((e) => getComputedStyle(e).display), cls: document.querySelector('.drive-root').className }; }, n);
// pointer events straight to the element under the mouse (headless frames stall here too)
const ptr = (type, x, y) => p.evaluate(([type, x, y]) => { const t = document.elementFromPoint(x, y); t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 })); }, [type, x, y]);
console.log('start      ', JSON.stringify(await tick(1)));
await ptr('pointerdown', 640, 500); await ptr('pointermove', 640, 460); console.log('drag up    ', JSON.stringify(await tick(60)));
await ptr('pointermove', 600, 460); console.log('drag up-left', JSON.stringify(await tick(40)));
await ptr('pointerup', 600, 460); console.log('released   ', JSON.stringify(await tick(30)));
console.log('errors', JSON.stringify(errs)); await b.close();
