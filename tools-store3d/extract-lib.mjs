// The browser half of the layout extraction: read the live game's own mask through window.__csd (fieldAt = the playfield, boxFree = the actor collider).
import { assemble } from './layout-lib.mjs';
export async function extractLayout(page, ROOT, base) {
  await page.goto(`${base}/standalone.html?nodrive`);
  await page.waitForFunction(() => window.__csd && window.__csd.player && window.__csd.items.every((i) => i.sx !== undefined), null, { timeout: 600000 });
  const data = await page.evaluate(() => {
    const c = window.__csd, IW = 853, IH = 1844, MC = 4, MW = Math.ceil(IW / MC), MH = Math.ceil(IH / MC), field = [], box = [];
    for (let y = 0; y < MH; y++) { let f = '', q = ''; for (let x = 0; x < MW; x++) { f += c.fieldAt(x * MC + 1, y * MC + 1) ? '1' : '0'; q += c.boxFree(x * MC + 2, y * MC + 2) ? '1' : '0'; } field.push(f); box.push(q); }
    const probe = {}; for (const [k, x, y] of [['dairyBody', 250, 200], ['dairyBehindLane', 250, 125], ['riceBody', 600, 200], ['riceBehind', 600, 125], ['milkSpot', 190, 292], ['exitLane', 435, 240]]) probe[k] = { field: !!c.fieldAt(x, y), boxFree: !!c.boxFree(x, y) };
    return { field, box, probe, items: c.items.map((i) => ({ id: i.id, x: i.x, y: i.y, sx: i.sx, sy: i.sy, shelf: i.shelf, icon: i.icon, pts: i.pts })), player: [c.player.x, c.player.y], bully: [c.bully.x, c.bully.y] };
  });
  const L = assemble({ field: data.field, boxFree: data.box, items: data.items, ROOT, note: 'tools-store3d/extract-lib.mjs: window.__csd of the live store (public/standalone.html) + the literal constants of standalone/csd.js' });
  L.probe = data.probe; return L;
}
