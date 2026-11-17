// Shared by extract.mjs (browser, window.__csd = the truth) and dev-layout.mjs (no browser, same buildMasks from csd.js).
// Turns the 4 px mask + the literal constants of standalone/csd.js into public/store3d/layout.json.
import fs from 'fs'; import path from 'path';
export function constantsFromSource(ROOT) {
  const src = fs.readFileSync(path.join(ROOT, 'standalone/csd.js'), 'utf8');
  const grab = (re) => { const m = src.match(re); if (!m) throw new Error('csd.js: not found ' + re); return m[1]; };
  return {
    PADS: JSON.parse(grab(/var PADS=(\[\[.*?\]\]);/)),
    DOOR: JSON.parse(grab(/var DOOR=(\{[^}]*\})/).replace(/(\w+):/g, '"$1":')),
    BANNERS: JSON.parse(grab(/var BANNERS=(\[\[[\s\S]*?\]\]);/).replace(/\s+/g, '')),
    PLAYER_DISPLAY: +grab(/PLAYER_DISPLAY=(\d+)/), BULLY_DISPLAY: +grab(/BULLY_DISPLAY=(\d+)/),
    PSPEED: +grab(/var PSPEED=(\d+)/), SPAWN_P: JSON.parse(grab(/var SPAWN_P=(\{[^}]*\})/).replace(/(\w+):/g, '"$1":')), SPAWN_B: JSON.parse(grab(/SPAWN_B=(\{[^}]*\})/).replace(/(\w+):/g, '"$1":')),
    INTRO_ZOOM_SCALE: 0.8,
  };
}
// field/boxFree: arrays of MH strings of '0'/'1' (one char per 4 px cell)
export function assemble({ field, boxFree, items, ROOT, note }) {
  const C = constantsFromSource(ROOT), MW = field[0].length, MH = field.length, MC = 4;
  const at = (x, y) => field[y][x] === '1';
  const seen = new Uint8Array(MW * MH), blobs = [];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (at(x, y) || seen[y * MW + x]) continue;
    const q = [[x, y]]; seen[y * MW + x] = 1; let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
    while (q.length) { const [cx, cy] = q.pop(); n++; x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || at(nx, ny) || seen[ny * MW + nx]) continue; seen[ny * MW + nx] = 1; q.push([nx, ny]); } }
    if (n >= 40) blobs.push({ cells: n, x0: x0 * MC, y0: y0 * MC, x1: (x1 + 1) * MC, y1: (y1 + 1) * MC, fill: +(n / ((x1 - x0 + 1) * (y1 - y0 + 1))).toFixed(2) });
  }
  const SIGNS = ['DAIRY AISLE', 'RICE & BEANS', 'CHECKOUT', 'BREAD AISLE', 'CHECKOUT', 'JUICE AISLE', 'CHECKOUT', 'SNACK AISLE', 'MEAT', 'PRODUCE', 'PRODUCE', 'HOUSEHOLD', 'BEVERAGES', 'FROZEN FOODS'];   // read off the painted board, in BANNERS order
  return { generated: note, board: { w: 853, h: 1844, cell: MC, mw: MW, mh: MH }, field, boxFree, items,
    PADS: C.PADS, DOOR: C.DOOR, BANNERS: C.BANNERS.map((b, i) => ({ rect: b, text: SIGNS[i] })), spawnPlayer: C.SPAWN_P, spawnBully: C.SPAWN_B,
    PLAYER_DISPLAY: C.PLAYER_DISPLAY, BULLY_DISPLAY: C.BULLY_DISPLAY, PSPEED: C.PSPEED,
    camera: { zoomScale: C.INTRO_ZOOM_SCALE, followY: 0.52, viewport: [390, 844], note: '2D camera (placeView): screen = board px * zoomScale + (tx,ty); the player is centred horizontally and at 52% of the screen height, both clamped so the board never leaves the screen' },
    blobs };
}
