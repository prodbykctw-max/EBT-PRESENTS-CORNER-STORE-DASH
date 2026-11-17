// Dev only, no browser: node tools-store3d/dev-layout.mjs board.rgba [out]  (board.rgba = RGBA dump of standalone/board.b64)
// Same schema as extract.mjs. The browser extraction is the one that ships; this lets the 3D work go on while the browser is busy.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { build } from './mask-node.mjs'; import { assemble } from './layout-lib.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = build(process.argv[2]), out = process.argv[3] || path.join(ROOT, 'public/store3d/layout.json');
const { MW, MH } = r, field = [], box = [];
for (let y = 0; y < MH; y++) { let f = '', q = ''; for (let x = 0; x < MW; x++) { f += r.fieldAt(x * 4 + 1, y * 4 + 1) ? '1' : '0'; q += r.boxFree(x * 4 + 2, y * 4 + 2) ? '1' : '0'; } field.push(f); box.push(q); }
const items = [ // literal copy of ITEMS (+ the snapped spots), only for the node path
  ['APPLE', 228, 1070], ['CHIPS', 244, 889], ['CHICKEN', 599, 1083], ['LEMONADE', 239, 699], ['BREAD', 209, 519], ['MILK', 190, 292], ['RICE & BEANS', 612, 280]
].map(([id, x, y]) => { const s = r.snap(x, y); return { id, x, y, sx: s.x, sy: s.y }; });
const L = assemble({ field, boxFree: box, items, ROOT, note: 'DEV: tools-store3d/dev-layout.mjs (no browser)' });
fs.writeFileSync(out, JSON.stringify(L)); console.log('wrote', out, L.blobs.length, 'blobs');
