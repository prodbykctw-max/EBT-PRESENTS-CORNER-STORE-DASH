// Shared helpers for the restart / flyover proofs: boot the drive on software WebGL with a seeded Math.random that is
// re-seeded (and its call counter zeroed) the moment each drive's root is appended, so two boots of the drive can be compared.
// Also counts what a restart could leak: window/document listeners, live WebGL contexts, open AudioContexts, pending timers.
import { chromium } from 'playwright-core';
export const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export async function launch(extra = {}) {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, ...extra });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/open-meteo|ERR_FAILED/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.route(/open-meteo/, (r) => r.abort());
  await p.addInitScript(() => {
    let a = 0, n = 0; const seed = (s) => { a = s | 0; n = 0; };
    Math.random = () => { n++; a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    seed(0x12345678); window.__rn = () => n; window.__seed = seed;
    window.__boots = []; // one record per drive root created: Math.random count when the drive object appeared
    const ap = Element.prototype.appendChild;
    Element.prototype.appendChild = function (c) { if (c && c.classList && c.classList.contains('drive-root')) { seed(0x12345678); window.__t0 = performance.now(); } return ap.call(this, c); };
    let drv; Object.defineProperty(window, '__drive', { configurable: true, get: () => drv, set: (v) => { drv = v; if (v) window.__boots.push({ rn: n, at: performance.now() - window.__t0 }); if (window.__sigFn) { try { (window.__sigs ||= []).push(window.__sigFn()); } catch (e) { (window.__sigs ||= []).push({ err: String(e) }); } } } });
    // leak counters
    const live = new Map(); window.__lis = () => [...live.values()].reduce((s, v) => s + v, 0);
    const key = (t, type, f, o) => { if (!(t === window || t === document || t === window.visualViewport)) return null; if (!f) return null; (f.__id || (f.__id = ++window.__lid)); return (t === window ? 'w' : t === document ? 'd' : 'v') + ':' + type + ':' + f.__id + ':' + ((o && (o.capture || o === true)) ? 1 : 0); };
    window.__lid = 0; const set = new Set();
    for (const T of [EventTarget.prototype]) {
      const add = T.addEventListener, rem = T.removeEventListener;
      T.addEventListener = function (type, f, o) { const k = key(this, type, f, o); if (k) set.add(k); return add.call(this, type, f, o); };
      T.removeEventListener = function (type, f, o) { const k = key(this, type, f, o); if (k) set.delete(k); return rem.call(this, type, f, o); };
    }
    window.__listeners = () => { const c = {}; for (const k of set) { const [t, ty] = k.split(':'); c[t + ':' + ty] = (c[t + ':' + ty] || 0) + 1; } return c; };
    window.__listenerCount = () => set.size;
    // WebGL contexts
    window.__gl = []; const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...r) { const c = gc.call(this, t, ...r); if (c && /webgl/.test(t)) window.__gl.push(c); return c; };
    window.__glLive = () => window.__gl.filter((g) => { try { return !g.isContextLost(); } catch { return false; } }).length;
    // audio
    window.__ac = []; const AC = window.AudioContext; if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ac.push(this); } };
    window.__acOpen = () => window.__ac.filter((c) => c.state !== 'closed').length;
    // timers: pending short chains (the QA frame loop is a setTimeout(16) chain; the page loop is requestAnimationFrame)
    const pend = new Set(), st = window.setTimeout, ct = window.clearTimeout;
    window.setTimeout = function (f, ms, ...a) { if (ms !== undefined && ms <= 20 && typeof f === 'function') { const id = st(function () { pend.delete(id); return f.apply(this, arguments); }, ms, ...a); pend.add(id); return id; } return st(f, ms, ...a); };
    window.clearTimeout = function (id) { pend.delete(id); return ct(id); };
    window.__shortTimers = () => pend.size;
    const rq = window.requestAnimationFrame, cr = window.cancelAnimationFrame, rp = new Set();
    window.requestAnimationFrame = (f) => { const id = rq((t) => { rp.delete(id); f(t); }); rp.add(id); return id; };
    window.cancelAnimationFrame = (id) => { rp.delete(id); cr(id); };
    window.__rafs = () => rp.size;
  });
  await p.addInitScript(`window.__sigFn = ${sig.toString()}`);
  return { b, p, errs };
}
export const sig = () => {
  const d = window.__drive, T = d.three, c = T.camera, q = c.quaternion, f = d.foot;
  const ents = d.world.ents.filter((e) => e.alive).map((e) => [e.type, +e.s.toFixed(2), +e.d.toFixed(2)]);
  const ppl = d.world.crowd.people.slice(0, 40).map((q) => [+q.s.toFixed(3), +q.d.toFixed(3)]);
  return {
    rn: window.__rn(), state: d.state, time: d.time,
    cam: [c.position.x, c.position.y, c.position.z, q.x, q.y, q.z, q.w].map((v) => +v.toFixed(5)),
    me: [f.me.x, f.me.y, f.me.heading].map((v) => +v.toFixed(5)), him: [f.him.x, f.him.y].map((v) => +v.toFixed(5)),
    car: [d.car.s, d.car.d].map((v) => +v.toFixed(4)), nEnts: ents.length, ents: ents.slice(0, 60), ppl,
  };
};
