// node tools-allb/motion.mjs <port> "<query>" : ~90 frames of the crowd with the shadow box and the near/far limit in play. Every drawn instance must be the person at that spot,
// with that person's body type and mask (shoe bits included): no body swaps, no shoe changes. Also: people count, first-40 fingerprint, Math.random calls through the Crowd ctor.
import { chromium } from '/home/claude/wt-real/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const [port, query] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
await page.route(/open-meteo\.com/, (r) => r.abort());
await page.addInitScript(() => { let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; });
await page.route(/\/drive\/crowd\.js/, async (route) => { const r = await route.fetch(); let b = await r.text(); const a = 'Object.assign(this, { route, ground, surfAt, visible, camera });'; if (b.includes(a)) b = b.replace(a, a + ' { let s = 777; window.__rc = 0; Math.random = () => { window.__rc++; s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }'); await route.fulfill({ response: r, body: b }); });
await page.route(/\/drive\/drive\.js/, async (route) => { const r = await route.fetch(); let b = await r.text(); const a = 'crowd.shadowBox = world.shadowBox;'; if (b.includes(a)) b = b.replace(a, a + ' window.__rcAfter = [window.__rc, Math.random()]; window.__fp0 = [crowd.people.length, crowd.people.slice(0, 40).map((m) => [m.s, m.d, m.phase].map((v) => Math.round((v || 0) * 1e4) / 1e4).join(",")).join("|")];'); await route.fulfill({ response: r, body: b }); });
await page.goto(`http://localhost:${port}/drive/index.html?${query}`);
await page.waitForFunction(() => window.__drive && window.__drive.world, null, { timeout: 1500000, polling: 2000 });
const out = await page.evaluate(() => {
  const d = window.__drive, cr = d.world.crowd, alt = cr.alt; d.manual = true; d.freezeClock = true;
  const res = { people: cr.people.length, rcAfter: window.__rcAfter, fp: window.__fp0, kinds: alt ? alt.vs.map((v) => v.name) : null };
  for (let i = 0; i < 40; i++) d.tick(1 / 60);
  if (!alt) return res;
  const dist = {}; alt.tr.forEach((t) => { dist[t.variant] = (dist[t.variant] || 0) + 1; }); res.bodyTypes = dist;
  let sameBody = 0, sameOutfit = 0; for (let i = 1; i < alt.tr.length; i++) { if (alt.tr[i].variant === alt.tr[i - 1].variant) sameBody++; if (alt.tr[i].outfit === alt.tr[i - 1].outfit) sameOutfit++; } res.neighbourSameBody = sameBody; res.neighbourSameOutfit = sameOutfit;
  const bits = { 1024: 0, 2048: 0, 4096: 0 }; alt.tr.forEach((t) => { for (const b of [1024, 2048, 4096]) if (t.mask & b) bits[b]++; }); res.shoeKinds = { sneaker: bits[1024], dress: bits[2048], boot: bits[4096] };
  const colours = {}; alt.tr.forEach((t) => { colours[t.shoe] = (colours[t.shoe] || 0) + 1; }); res.shoeColours = colours;
  let bad = 0, checked = 0, swaps = 0, lodSwaps = 0; const seen = new Map(), seenLod = new Map(), seenMask = new Map();
  for (let f = 0; f < 90; f++) {
    d.tick(1 / 60);
    alt.lods.forEach((l, k) => {
      const a = l.mesh.instanceMatrix.array, A = l.attr;
      for (let i = 0; i < l.mesh.count; i++) {
        const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
        let bi = -1, bd = 1e9;
        for (let n = 0; n < cr.people.length; n++) { const m = cr.people[n]; if (!m.on) continue; const dd = Math.abs(m.x - x) + Math.abs(m.z - y) + Math.abs(-m.y - z); if (dd < bd) { bd = dd; bi = n; } }
        checked++;
        const body = A.iPose.array[i * 4 + 2], mask = A.iAnim.array[i * 4 + 2], t = alt.tr[bi];
        if (bd > 0.3 || body !== t.variant || mask !== t.mask) bad++;
        const pb = seen.get(bi); if (pb !== undefined && pb !== body) swaps++; seen.set(bi, body);
        const pm = seenMask.get(bi); if (pm !== undefined && pm !== mask) swaps++; seenMask.set(bi, mask);
        const pl = seenLod.get(bi); if (pl !== undefined && pl !== l.name) lodSwaps++; seenLod.set(bi, l.name);
      }
    });
  }
  res.motion = { frames: 90, instancesChecked: checked, mismatches: bad, bodyOrShoeSwaps: swaps, nearFarCrossings: lodSwaps, distinctPeople: seen.size };
  return res;
});
console.log(JSON.stringify({ ...out, logs }, null, 1)); await browser.close();
