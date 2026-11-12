// the whole game (/standalone.html): START DRIVE -> the drive (opening flyover skipped by a tap) -> pause -> RESTART -> a fresh drive with no flyover
import { launch } from './lib.mjs';
const { b, p, errs } = await launch();
await p.goto(process.argv[2]);
await p.waitForFunction(() => document.getElementById('btnDrive'), null, { timeout: 60000 });
await p.evaluate(() => document.getElementById('btnDrive').click());
const ready = (n) => p.waitForFunction((n) => window.__boots.length >= n && window.__drive && window.__drive.state, n, { timeout: 900000 });
await ready(1);
const a = await p.evaluate(() => ({ fly: !!window.__drive.fly, state: window.__drive.state }));
await p.evaluate(() => document.querySelector('.drive-root canvas').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0, clientX: 80, clientY: 300 })));
const b1 = await p.evaluate(() => ({ fly: !!window.__drive.fly }));
await p.evaluate(() => document.querySelector('[data-pause]').click());
const pausedTxt = await p.evaluate(() => [...document.querySelectorAll('.drive-paused button')].map((x) => x.textContent.trim()));
await p.evaluate(() => document.querySelector('[data-restart]').click());
await ready(2);
const c = await p.evaluate(() => ({ fly: window.__drive.fly, state: window.__drive.state, time: window.__drive.time, roots: document.querySelectorAll('.drive-root').length, boots: window.__boots.length, listeners: window.__listenerCount(), gl: window.__glLive() }));
console.log(JSON.stringify({ first: a, afterTap: b1, pausedTxt, afterRestart: c, errs })); await b.close();
