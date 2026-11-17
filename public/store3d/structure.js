// The store's solid geometry, built FROM the layout (layout.json = the live game's collision mask + its constants).
// World units are metres: x = board_x / PX, z = board_y / PX, y up. The camera looks north (-z) from the south, so the south
// face of everything (+z) is the face you see. PX = 48 board px per metre makes the 84 px player sprite a 1.75 m person.
//
// How the painted shelf maps to a real one. The board paints each unit as its FRONT ELEVATION (products, base, a banner on top) on the
// floor region that the mask blocks: ~116 px (2.4 m) deep. The 3D camera sees a real 2 m shelf from 45 degrees: a tall gondola 1.0 m
// deep standing on the SOUTH edge of that region hides exactly the 2 m of floor behind it, so the rest of the blocked region (the
// north part) is a low stock plinth nobody can see. Every cell of the mask is therefore still a solid thing in 3D (see align.mjs).
import * as THREE from '../drive/vendor/three.module.min.js';
import { mergeGeometries } from '../drive/vendor/BufferGeometryUtils.js';
import { Stock } from './products.js';
import { GeoBuf, PAINT } from './geobuf.js';

export const PX = 48;
export const m = (b) => b / PX;
const W_H = 3.4;           // wall height
const SHELF_H = 1.9, FRONT_D = 1.0;   // tall front gondola: height and depth

/** which painted fixture is which (centres read off the board), with the stock each carries */
const FIXTURES = [
  { id: 'dairy', kind: 'cooler', rect: [138, 148, 382, 270], sign: 'DAIRY AISLE', stock: 'dairy', trim: '#2f6fd6' },
  { id: 'rice', kind: 'gondola', rect: [486, 100, 760, 270], sign: 'RICE & BEANS', stock: 'rice' },
  { id: 'co1', kind: 'checkout', at: [606, 422], sign: 'CHECKOUT' },
  { id: 'bread', kind: 'gondola', at: [256, 446], sign: 'BREAD AISLE', stock: 'bread' },
  { id: 'co2', kind: 'checkout', at: [606, 598], sign: 'CHECKOUT' },
  { id: 'juice', kind: 'gondola', at: [250, 630], sign: 'JUICE AISLE', stock: 'juice' },
  { id: 'co3', kind: 'checkout', at: [606, 774], sign: 'CHECKOUT' },
  { id: 'snack', kind: 'gondola', at: [234, 818], sign: 'SNACK AISLE', stock: 'snack' },
  { id: 'fruit', kind: 'produce', at: [228, 1006], sign: 'PRODUCE', stock: 'fruit' },
  { id: 'meat', kind: 'cooler', at: [598, 1010], sign: 'MEAT', stock: 'meat', trim: '#c1272d' },
  { id: 'veg', kind: 'produce', at: [222, 1194], sign: 'PRODUCE', stock: 'veg' },
  { id: 'house', kind: 'gondola', at: [594, 1198], sign: 'HOUSEHOLD', stock: 'house' },
  { id: 'bev', kind: 'gondola', at: [210, 1386], sign: 'BEVERAGES', stock: 'bev' },
  { id: 'frozen', kind: 'cooler', at: [594, 1380], sign: 'FROZEN FOODS', stock: 'frozen', trim: '#2f6fd6', glass: true },
];
const CORRALS = [[39, 1497, 229, 1634], [598, 1497, 792, 1634]];

export function resolveFixtures(layout) {
  return FIXTURES.map((f) => {
    let rect = f.rect;
    if (!rect) { const b = layout.blobs.find((q) => f.at[0] >= q.x0 && f.at[0] <= q.x1 && f.at[1] >= q.y0 && f.at[1] <= q.y1 && q.cells < 5000); if (!b) throw new Error('no blob for ' + f.id); rect = [b.x0, b.y0, b.x1, b.y1]; }
    return { ...f, rect };
  });
}

/** the solid cells of a fixture's blocked rectangle, and the biggest block of them that is solid right to its edges (rows and columns that are
 *  less than 90% solid, the painted unit's rounded corners and ragged feet, are trimmed off): the tall structure stands on that core, the low plinth on the exact cells */
export function fixtureCells(layout, rect) {
  const { cell } = layout.board, fld = (cx, cy) => layout.field[cy][cx] === '1';
  let cx0 = Math.floor(rect[0] / cell), cy0 = Math.floor(rect[1] / cell), cx1 = Math.ceil(rect[2] / cell), cy1 = Math.ceil(rect[3] / cell);
  const exact = cover(layout.board.mw, layout.board.mh, (x, y) => x >= cx0 && x < cx1 && y >= cy0 && y < cy1 && !fld(x, y));
  const frac = (fn, a, b, c, d) => { let n = 0, t = 0; for (let y = c; y < d; y++) for (let x = a; x < b; x++) { t++; if (!fld(x, y)) n++; } return t ? n / t : 0; };
  for (let k = 0; k < 40; k++) {
    let ch = false;
    if (frac(0, cx0, cx1, cy0, cy0 + 1) < 0.9) { cy0++; ch = true; } if (frac(0, cx0, cx1, cy1 - 1, cy1) < 0.9) { cy1--; ch = true; }
    if (frac(0, cx0, cx0 + 1, cy0, cy1) < 0.9) { cx0++; ch = true; } if (frac(0, cx1 - 1, cx1, cy0, cy1) < 0.9) { cx1--; ch = true; }
    if (!ch) break;
  }
  return { exact, core: [cx0 * cell, cy0 * cell, cx1 * cell, cy1 * cell] };
}

/** greedy rectangle cover of the cells where pred(cx, cy) is true -> [[cx0, cy0, cx1, cy1)] */
export function cover(mw, mh, pred) {
  const used = new Uint8Array(mw * mh), out = [];
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (used[y * mw + x] || !pred(x, y)) continue;
    let x1 = x; while (x1 + 1 < mw && !used[y * mw + x1 + 1] && pred(x1 + 1, y)) x1++;
    let y1 = y, ok = true; while (ok && y1 + 1 < mh) { for (let k = x; k <= x1; k++) if (used[(y1 + 1) * mw + k] || !pred(k, y1 + 1)) { ok = false; break; } if (ok) y1++; }
    for (let j = y; j <= y1; j++) for (let k = x; k <= x1; k++) used[j * mw + k] = 1;
    out.push([x, y, x1 + 1, y1 + 1]);
  }
  return out;
}

export const CHUNK = 6;   // metres of store (north-south) per merged static mesh: the camera sees about 22 m, so 4 or 5 of the 7 bands are drawn
export class Builder {
  constructor(THREEns, mats, { white = [0.5, 0.5] } = {}) { this.mats = mats; this.white = white; this.solids = []; this.boxes = []; this.chunks = new Map(); this.wallBuf = new GeoBuf(); this.glassBuf = new GeoBuf(); this.stock = null; }
  /** the merged paint buffer for the band of the store that holds z */
  bufFor(z) { const k = Math.max(0, Math.floor(z / CHUNK)); if (!this.chunks.has(k)) this.chunks.set(k, new GeoBuf()); return this.chunks.get(k); }
  /** a box from world min/max corners. mat: a PAINT name, 'wall' or 'glass'. opts: solid (counts for collision / the alignment check), skip (faces left out) */
  box(mat, x0, y0, z0, x1, y1, z1, o = {}) {
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    if (o.solid) this.solids.push({ x0, y0, z0, x1, y1, z1, id: o.id || '' });
    if (mat !== 'glass') this.boxes.push([x0, y0, z0, x1, y1, z1]);
    const zc = (z0 + z1) / 2;
    if (mat === 'glass') { this.glassBuf.box(['#d6ecf6', 0.05, 0], x0, y0, z0, x1, y1, z1, { skip: 'ny' }); return; }
    if (mat === 'wall') {   // the painted wall texture on the sides (u along the wall, v up its height); the top is a plain dark cap, never the texture
      const W = this.wallBuf, n0 = W.count; W.box(['#ffffff', 0.82, 0], x0, y0, z0, x1, y1, z1, { skip: 'ny py' });
      for (let i = n0; i < W.count; i++) { const nx = Math.abs(W.N[i * 3]), x = W.P[i * 3], y = W.P[i * 3 + 1], z = W.P[i * 3 + 2]; W.U[i * 2] = (nx > 0.5 ? z : x) / 3.0; W.U[i * 2 + 1] = y / W_H; }
      this.bufFor(zc).box('wallcap', x0, y1 - 0.001, z0, x1, y1, z1, { skip: 'ny nx px nz pz', white: this.white });
      return;
    }
    this.bufFor(zc).box(mat, x0, y0, z0, x1, y1, z1, { skip: o.skip || 'ny', white: this.white });
  }
  finish() {
    const grp = new THREE.Group(); grp.name = 'static';
    const add = (geo, mat, name, cast = true) => { const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = cast; mesh.receiveShadow = true; mesh.name = name; grp.add(mesh); return mesh; };
    for (const [k, buf] of [...this.chunks].sort((a, b) => a[0] - b[0])) if (buf.count) add(buf.build(), this.mats.paint || this.mats.default, 'static:paint' + k);
    if (this.wallBuf.count) add(this.wallBuf.build(), this.mats.wall || this.mats.default, 'static:wall');
    if (this.glassBuf.count) add(this.glassBuf.build(), this.mats.glass || this.mats.default, 'static:glass', false);
    return grp;
  }
}

export function buildStructure(layout, mats, opts = {}) {
  const B = new Builder(THREE, mats), root = new THREE.Group(), info = { fixtures: [], signs: [], doors: [] };
  const { mw, mh, cell } = layout.board, fieldAt = (cx, cy) => (cx < 0 || cy < 0 || cx >= mw || cy >= mh) ? 0 : layout.field[cy].charCodeAt(cx) - 48;
  const fixtures = resolveFixtures(layout);
  const inRect = (r, bx, by) => bx >= r[0] && bx < r[2] && by >= r[1] && by < r[3];
  const inFix = (cx, cy) => { const bx = cx * cell + 2, by = cy * cell + 2; return fixtures.some((f) => inRect(f.rect, bx, by)); };
  const inCorral = (cx, cy) => { const bx = cx * cell + 2, by = cy * cell + 2; return CORRALS.some((r) => inRect(r, bx, by)); };

  // ---- the walls: every solid cell of the mask that is not a fixture, within 1.5 m of the floor (beyond it the dark void is the same colour)
  const near = new Uint8Array(mw * mh), R = 20;
  for (let cy = 0; cy < mh; cy++) for (let cx = 0; cx < mw; cx++) if (fieldAt(cx, cy)) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < mw && y < mh && Math.abs(dx) + Math.abs(dy) <= R + 6) near[y * mw + x] = 1; }
  // thin solid slivers of the mask (the painted banners' dark top edges: 4 px high lines inside open lanes) are low floor strips, not walls
  const rails = layout.blobs.filter((b) => b.cells < 100 && b.fill > 0.99), inRail = (cx, cy) => rails.some((b) => cx * cell >= b.x0 && cx * cell < b.x1 && cy * cell >= b.y0 && cy * cell < b.y1);
  const wallCells = (cx, cy) => !fieldAt(cx, cy) && near[cy * mw + cx] && !inFix(cx, cy) && !inCorral(cx, cy) && !inRail(cx, cy) && cy * cell >= 96 - 4 && cy * cell < 1600;
  const sillCells = (cx, cy) => !fieldAt(cx, cy) && near[cy * mw + cx] && !inFix(cx, cy) && !inCorral(cx, cy) && cy * cell >= 1600 && cy * cell < 1640;   // the storefront is open: a door sill, not a wall (a wall would hide the entrance from the camera)
  for (const [x0, y0, x1, y1] of cover(mw, mh, sillCells)) B.box('rail', m(x0 * cell), 0, m(y0 * cell), m(x1 * cell), 0.14, m(y1 * cell), { solid: true, id: 'sill' });
  for (const b of rails) B.box('rail', m(b.x0), 0, m(b.y0), m(b.x1), 0.12, m(b.y1), { solid: true, id: 'rail' });
  // small isolated wall pieces (a 4 px banner edge between two checkouts) are low strips like the rails, not 3.4 m slabs hiding the counters
  const wmask = new Uint8Array(mw * mh), comp = new Int32Array(mw * mh), small = new Uint8Array(mw * mh);
  for (let cy = 0; cy < mh; cy++) for (let cx = 0; cx < mw; cx++) wmask[cy * mw + cx] = wallCells(cx, cy) ? 1 : 0;
  for (let i0 = 0; i0 < mw * mh; i0++) if (wmask[i0] && !comp[i0]) {
    const st = [i0], seen = [i0]; comp[i0] = 1;
    while (st.length) { const i = st.pop(), cx = i % mw, cy = (i / mw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= mw || ny >= mh) continue; const j = ny * mw + nx; if (wmask[j] && !comp[j]) { comp[j] = 1; st.push(j); seen.push(j); } } }
    if (seen.length < 200) for (const j of seen) small[j] = 1;
  }
  for (const [x0, y0, x1, y1] of cover(mw, mh, (cx, cy) => small[cy * mw + cx] === 1)) B.box('rail', m(x0 * cell), 0, m(y0 * cell), m(x1 * cell), 0.12, m(y1 * cell), { solid: true, id: 'rail' });
  for (const [x0, y0, x1, y1] of cover(mw, mh, (cx, cy) => wmask[cy * mw + cx] === 1 && !small[cy * mw + cx])) B.box('wall', m(x0 * cell), 0, m(y0 * cell), m(x1 * cell), W_H, m(y1 * cell), { solid: true, id: 'wall', uv: 1.6, wallUV: true });
  // a skirting board in front of the wall (not solid: it sits inside the wall's own cells' edge) is skipped on purpose: the wall's own face carries the base colour.

  // ---- the floor: one quad per rectangle of walkable cells
  const floorG = []; const FS = 0.6 * 4;
  for (const [x0, y0, x1, y1] of cover(mw, mh, (cx, cy) => fieldAt(cx, cy) || inFix(cx, cy) || inCorral(cx, cy))) {
    const wx0 = m(x0 * cell), wx1 = m(x1 * cell), wz0 = m(y0 * cell), wz1 = m(y1 * cell);
    const g = new THREE.PlaneGeometry(wx1 - wx0, wz1 - wz0); g.rotateX(-Math.PI / 2); g.translate((wx0 + wx1) / 2, 0, (wz0 + wz1) / 2);
    const p = g.attributes.position, uv = g.attributes.uv, uv1 = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv.setXY(i, p.getX(i) / FS, p.getZ(i) / FS); uv1[i * 2] = p.getX(i) / m(layout.board.w); uv1[i * 2 + 1] = p.getZ(i) / m(layout.board.h); }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2)); floorG.push(g);
  }
  const floor = new THREE.Mesh(mergeGeometries(floorG, false), mats.floor || mats.default); floor.receiveShadow = true; floor.name = 'floor'; floor.frustumCulled = false; root.add(floor);

  // ---- fixtures
  const stock = new Stock(); B.stock = stock;
  for (const f of fixtures) {
    const fc = fixtureCells(layout, f.rect), [bx0, by0, bx1, by1] = fc.core, x0 = m(bx0), z0 = m(by0), x1 = m(bx1), z1 = m(by1);
    const rec = { id: f.id, kind: f.kind, rect: f.rect, core: fc.core, sign: f.sign, box: [x0, z0, x1, z1] };
    // the plinth under the whole blocked region, cell for cell (solid), dark
    for (const [a, b, c, d] of fc.exact) B.box('base', m(a * cell), 0, m(b * cell), m(c * cell), 0.16, m(d * cell), { solid: true, id: f.id });
    if (f.kind === 'checkout') checkout(B, f, x0, z0, x1, z1, mats, info);
    else gondola(B, f, x0, z0, x1, z1, stock, info);
    info.fixtures.push(rec);
  }
  // ---- cart corrals: a low grey platform, a rail round it, and two calm rows of nested carts (solid basket sides, chrome rims, red grips)
  for (const r of CORRALS) {
    const x0 = m(r[0]), z0 = m(r[1]), x1 = m(r[2]), z1 = m(r[3]);
    B.box('corral', x0, 0.0, z0, x1, 0.12, z1, { solid: true, id: 'corral' });
    for (const [a, b, c, d] of [[x0, z0, x1, z0 + 0.04], [x0, z1 - 0.04, x1, z1], [x0, z0, x0 + 0.04, z1], [x1 - 0.04, z0, x1, z1]]) { B.box('steel', a, 0.12, b, c, 0.9, d, { id: 'corral' }); B.box('trimGold', a, 0.9, b, c, 0.94, d, { id: 'corral' }); }
    info.corrals = (info.corrals || []).concat([[x0, z0, x1, z1]]);
    const cg = cartGeometry(), mm = new THREE.Matrix4(), rows = 2, gap = (z1 - z0 - 0.2) / rows, n = Math.floor((x1 - x0 - 0.3 - 0.95) / 0.3) + 1;
    for (let row = 0; row < rows; row++) for (let i = 0; i < n; i++) { const z = z0 + 0.1 + gap * (row + 0.5); mm.makeRotationY(0).setPosition(x0 + 0.65 + i * 0.3, 0.12 + i * 0.004, z); B.bufFor(z).geo(cg, mm, 'cart'); }
  }
  storefront(B, layout, info);
  // ---- the exit door in the north pier (south face of the solid block between the dairy and the rice units)
  // (set 0.22 m into the pier: the walkable floor reaches the pier's face at y 232, and a door standing proud of it hid a player hugging the wall)
  { const zf = m(232) - 0.22, cxd = m(435); info.exit = { x: cxd, z: zf };
    B.box('doorframe', cxd - 0.85, 0, zf, cxd + 0.85, 2.35, zf + 0.09, { id: 'exit' });
    B.box('door', cxd - 0.72, 0, zf + 0.09, cxd + 0.72, 2.2, zf + 0.12, { id: 'exit' });
    B.box('doorglass', cxd - 0.5, 0.5, zf + 0.12, cxd + 0.5, 2.05, zf + 0.135, { id: 'exit' });
    B.box('doorframe', cxd - 0.03, 0.5, zf + 0.135, cxd + 0.03, 2.05, zf + 0.15, { id: 'exit' });
    B.box('bar', cxd - 0.6, 1.0, zf + 0.14, cxd + 0.6, 1.07, zf + 0.2, { id: 'exit' }); }
  // ---- the welcome mat (a thick rubber mat; its lettered top is a decal, store3d.js) and the potted plants by the entrance
  { const [x0, y0, x1, y1] = [335, 1562, 490, 1630]; B.box('mat', m(x0), 0, m(y0), m(x1), 0.025, m(y1)); info.welcome = [m(x0), m(y0), m(x1), m(y1), 0.026]; }
  for (const [bx, by] of [[262, 1588], [566, 1588]]) plant(B, m(bx), m(by));
  // ---- loose gold and pink accent tiles on the walkable cream floor (the painted floor has them too)
  { const TS = 0.6, nx = Math.floor(m(layout.board.w) / TS), nz = Math.floor(m(1640) / TS), w = B.white;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const h = hash(i, j, 41); if (h > 0.045) continue;
      const x = i * TS + TS / 2, z = j * TS + TS / 2, ok = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].every(([a, b]) => fieldAt(Math.floor((x + a * TS * 0.45) * PX / cell), Math.floor((z + b * TS * 0.45) * PX / cell)));
      if (ok) B.bufFor(z).box([h < 0.022 ? '#e2a82e' : '#d0709a', 0.3, 0], x - TS / 2 + 0.02, 0, z - TS / 2 + 0.02, x + TS / 2 - 0.02, 0.003, z + TS / 2 - 0.02, { skip: 'ny nx px nz pz', white: w });
    } }

  stock.emit((z) => B.bufFor(z)); info.stockCount = stock.n;
  root.add(B.finish()); info.solids = B.solids;
  return { root, info, builder: B };
}
const hash = (a, b, s = 0) => { let h = (a * 374761393 + b * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** a shopping cart for the corral: basket with solid wire-panel sides (calm from above, no moire), chrome rim, red handle grip, base tray, wheels. Long axis x, handle at +x */
let CART = null;
function cartGeometry() {
  if (CART) return CART;
  const B = new GeoBuf(), Lb = 0.95, Wd = 0.56;
  B.box('cart', -Lb / 2, 0.45, -Wd / 2, Lb / 2, 0.47, Wd / 2, { skip: '' });                 // basket floor
  for (const z of [-Wd / 2, Wd / 2 - 0.012]) B.box(['#7d8491', 0.5, 0.6], -Lb / 2, 0.47, z, Lb / 2, 0.84, z + 0.012, { skip: 'ny' });   // the sides
  B.box(['#7d8491', 0.5, 0.6], -Lb / 2, 0.47, -Wd / 2, -Lb / 2 + 0.012, 0.84, Wd / 2, { skip: 'ny' }); B.box(['#7d8491', 0.5, 0.6], Lb / 2 - 0.012, 0.47, -Wd / 2, Lb / 2, 0.84, Wd / 2, { skip: 'ny' });
  for (const z of [-Wd / 2 - 0.006, Wd / 2 - 0.006]) B.box('chrome', -Lb / 2, 0.84, z, Lb / 2, 0.86, z + 0.024);   // the rim
  B.box('chrome', -Lb / 2 - 0.006, 0.84, -Wd / 2, -Lb / 2 + 0.018, 0.86, Wd / 2); B.box('chrome', Lb / 2 - 0.018, 0.84, -Wd / 2, Lb / 2 + 0.006, 0.86, Wd / 2);
  B.box('cartRed', Lb / 2 + 0.03, 0.94, -Wd / 2 - 0.02, Lb / 2 + 0.1, 0.99, Wd / 2 + 0.02, { skip: '' });            // the handle grip
  for (const z of [-Wd / 2, Wd / 2 - 0.02]) B.box('chrome', Lb / 2, 0.7, z, Lb / 2 + 0.06, 0.96, z + 0.02);
  B.box('cart', -Lb / 2 + 0.05, 0.19, -0.22, Lb / 2 - 0.05, 0.21, 0.22);                                           // the base tray
  for (const x of [-0.38, 0.4]) for (const z of [-0.2, 0.2]) { B.box('dark', x - 0.05, 0.0, z - 0.02, x + 0.05, 0.1, z + 0.02); B.box('cart', x - 0.01, 0.1, z - 0.01, x + 0.01, 0.45, z + 0.01); }
  return (CART = B.build());
}
function plant(B, x, z) {
  const buf = B.bufFor(z), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const put = (g, paint, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { q.setFromEuler(e.set(rx, ry, rz)); mm.compose(v.set(x + px, py, z + pz), q, sc.set(sx, sy, sz)); buf.geo(g, mm, paint); };
  put(new THREE.CylinderGeometry(0.3, 0.22, 0.5, 14), 'pot', 0, 0.25, 0); put(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 14), 'soil', 0, 0.5, 0);
  const leaf = new THREE.SphereGeometry(0.17, 8, 6); for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; put(leaf, i % 2 ? 'leaf' : 'leaf2', Math.cos(a) * 0.2, 0.75 + (i % 3) * 0.12, Math.sin(a) * 0.2, 0, -a, 0.6, 1, 0.4, 0.55); }
  put(new THREE.SphereGeometry(0.24, 9, 7), 'leaf', 0, 0.95, 0, 0, 0, 0, 1, 0.7, 1);
}
/**
 * The storefront on the sill line: a dark kick plate, full-height glass with aluminium mullions and a header rail, and at the entrance
 * (the opening between the two corrals) two sliding door leaves parked open, each a framed glass panel with a push bar, plus the
 * door track. From above the frames, the header and the leaves' edges read as a glass front; the glass itself is faint.
 */
function storefront(B, layout, info) {
  const ez = m(1636), z0 = ez - 0.05, z1 = ez + 0.05, X0 = m(16), X1 = m(layout.board.w - 16), ex0 = m(229), ex1 = m(598), H = 2.5;
  const run = (a, b) => {   // a fixed glass run from x = a to b
    B.box('kick', a, 0.1, z0, b, 0.32, z1); B.box('frame', a, 0.32, z0 - 0.01, b, 0.36, z1 + 0.01);
    B.box('frame', a, H - 0.12, z0 - 0.02, b, H, z1 + 0.02);                       // the header rail
    B.box('glass', a, 0.36, ez - 0.01, b, H - 0.12, ez + 0.01);
    const n = Math.max(1, Math.round((b - a) / 1.3)); for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; B.box('frame', x - 0.035, 0.32, z0 - 0.01, x + 0.035, H - 0.12, z1 + 0.01); }
  };
  run(X0, ex0); run(ex1, X1);
  // the entrance: the header carries on over the opening (with a sign box), the door track on the floor, the two leaves parked open
  B.box('frame', ex0, H - 0.12, z0 - 0.04, ex1, H + 0.18, z1 + 0.04);
  B.box('chrome', ex0, 0.0, ez - 0.03, ex1, 0.012, ez + 0.03);
  for (const [a, b] of [[ex0 + 0.02, ex0 + 1.3], [ex1 - 1.3, ex1 - 0.02]]) {
    const dz = ez - 0.14;   // the leaves sit just inside the fixed glass
    B.box('frame', a, 0.02, dz - 0.03, b, 0.1, dz + 0.03); B.box('frame', a, H - 0.2, dz - 0.03, b, H - 0.12, dz + 0.03);
    B.box('frame', a, 0.02, dz - 0.03, a + 0.07, H - 0.12, dz + 0.03); B.box('frame', b - 0.07, 0.02, dz - 0.03, b, H - 0.12, dz + 0.03);
    B.box('glass', a + 0.07, 0.1, dz - 0.008, b - 0.07, H - 0.2, dz + 0.008);
    B.box('chrome', a + 0.25, 1.0, dz + 0.03, b - 0.25, 1.05, dz + 0.07);         // the push bar
  }
  info.storefront = { z: ez, ex0, ex1, H };
}

// ---------------------------------------------------------------------------------------------------------------------
function gondola(B, f, x0, z0, x1, z1, stock, info) {
  const Wd = x1 - x0, zb = z1 - FRONT_D, cooler = f.kind === 'cooler', produce = f.kind === 'produce';
  const body = cooler ? 'coolerbody' : 'steel', side = 0.07, H = SHELF_H;
  // end caps, back panel, top, plank shelves with a lip
  B.box(body, x0, 0.16, zb, x0 + side, H, z1, { solid: true, id: f.id }); B.box(body, x1 - side, 0.16, zb, x1, H, z1, { solid: true, id: f.id });
  B.box(cooler ? 'coolerback' : 'back', x0 + side, 0.16, zb, x1 - side, H, zb + 0.05, { solid: true, id: f.id });
  B.box('trimGold', x0, 0.16, z1 - 0.012, x0 + side, H, z1 + 0.012, { id: f.id, cast: false }); B.box('trimGold', x1 - side, 0.16, z1 - 0.012, x1, H, z1 + 0.012, { id: f.id, cast: false });   // gold edging of the end caps
  B.box('trimGold', x0, H + 0.06, z1 - 0.02, x1, H + 0.085, z1 + 0.012, { id: f.id, cast: false });   // gold lip of the top
  if (cooler) B.box('coolerlight', x0 + side + 0.05, H - 0.1, zb + 0.06, x1 - side - 0.05, H - 0.05, z1 - 0.1, { id: f.id, cast: false });   // the light strip under the cooler's canopy
  B.box('cap', x0, H, zb, x1, H + 0.06, z1, { solid: true, id: f.id });
  B.box(cooler ? 'coolerbase' : 'base', x0, 0.16, z1 - 0.34, x1, 0.2, z1, { solid: true, id: f.id });   // the kick plate
  const levels = [0.72, 1.24];
  if (produce) {
    // produce: wooden crates in two tiers, tilted toward the aisle (front edge low), on a stepped stand
    for (const [y, za, zb2] of [[0.42, z1 - 0.62, z1 - 0.04], [0.95, zb + 0.1, z1 - 0.62]]) {
      B.box('woodDark', x0 + side, 0.16, za, x1 - side, y - 0.02, zb2, { solid: true, id: f.id });   // the stand under the tier
      const n = Math.max(1, Math.round((Wd - 2 * side) / 0.62)), cw = (Wd - 2 * side) / n;
      for (let i = 0; i < n; i++) crate(B, x0 + side + i * cw + 0.02, x0 + side + (i + 1) * cw - 0.02, y, za, zb2, f.id);
    }
  } else for (const y of levels) {
    B.box(cooler ? 'coolershelf' : 'shelf', x0 + side, y - 0.03, zb + 0.05, x1 - side, y, z1 - 0.02, { solid: true, id: f.id });
    B.box('trimGold', x0 + side, y - 0.065, z1 - 0.03, x1 - side, y - 0.015, z1 - 0.008, { id: f.id }); for (let tx = x0 + side + 0.15; tx < x1 - side - 0.1; tx += 0.34) B.box('tagwhite', tx, y - 0.058, z1 - 0.012, tx + 0.11, y - 0.024, z1 - 0.004, { id: f.id });   // the gold price strip with its tags
  }
  if (f.trim) B.box(f.trim === '#c1272d' ? 'trimRed' : 'trimBlue', x0, 0.2, z1 - 0.02, x1, 0.34, z1 + 0.008, { id: f.id, cast: false });
  if (f.glass) { // glass doors: thin panes with mullions (no collision of their own: inside the footprint)
    const n = Math.round(Wd / 0.9);
    for (let i = 0; i <= n; i++) B.box('chrome', x0 + side + (Wd - 2 * side) * i / n - 0.02, 0.2, z1, x0 + side + (Wd - 2 * side) * i / n + 0.02, H, z1 + 0.05, { id: f.id });
    B.box('glass', x0 + side, 0.34, z1 + 0.02, x1 - side, H, z1 + 0.03, { id: f.id, cast: false });
  }
  // the header sign on two posts, in front of the top
  const sw = Math.min(Wd - 0.4, 4.4), sx = (x0 + x1) / 2;
  B.box('chrome', sx - sw / 2 + 0.2, H + 0.06, z1 - 0.5, sx - sw / 2 + 0.26, H + 0.15, z1 - 0.44, { id: f.id, cast: false });
  B.box('chrome', sx + sw / 2 - 0.26, H + 0.06, z1 - 0.5, sx + sw / 2 - 0.2, H + 0.15, z1 - 0.44, { id: f.id, cast: false });
  info.signs.push({ text: f.sign, x: sx, y: H + 0.15 + 0.26, z: z1 - 0.47, w: sw, h: 0.52 });
  // stock
  if (produce) fillCrates(stock, f, x0 + side, x1 - side, z1, zb);
  else fillShelves(stock, f, x0 + side + 0.08, x1 - side - 0.08, z1, [0.2, ...levels]);
  if (!cooler) overstock(stock, f, x0 + side, x1 - side, zb, z1, H + 0.06, sx, sw);
  // (the north part of the blocked region is the plinth, already placed)
}

// products are drawn about 1.6 to 2.3 times life size: from this height a real can is a speck and the game must read at a glance (the painted board does the same)
const SC = { jug: 1.75, carton: 2.1, eggs: 1.6, yogurt: 2.0, sack: 1.65, can: 2.8, pasta: 1.75, cereal: 1.6, loaf: 2.05, bagels: 1.9, bottle: 2.4, juicejug: 1.75, soda: 1.45, chips: 1.9, cookies: 1.9, box: 1.9, tub: 2.0, jugL: 1.7, spray: 2.0, towels: 1.35, apple: 2.3, orange: 2.2, lemon: 2.2, pepper: 2.0, banana: 2.0, grapes: 2.2, cabbage: 1.4, broccoli: 1.6, carrot: 2.0, potato: 2.0, onion: 2.0, tomato: 2.2, tray: 2.0, drumsticks: 2.0, tissue: 1.6, pack: 1.5, case: 1 };
const NAT = { jug: 0.15, carton: 0.075, eggs: 0.3, yogurt: 0.14, sack: 0.2, can: 0.078, pasta: 0.17, cereal: 0.19, loaf: 0.3, bagels: 0.24, bottle: 0.066, juicejug: 0.1, soda: 0.105, chips: 0.2, cookies: 0.2, box: 0.17, tub: 0.146, jugL: 0.15, spray: 0.066, towels: 0.34, apple: 0.082, orange: 0.088, lemon: 0.09, pepper: 0.07, banana: 0.13, grapes: 0.08, cabbage: 0.17, broccoli: 0.13, carrot: 0.07, potato: 0.11, onion: 0.1, tomato: 0.08, tray: 0.2, drumsticks: 0.2, tissue: 0.22, pack: 0.29 };
const GAP = 1.1;
/** stock on the shelves: each shelf level is a run of "facings" (blocks of the same product, 2 deep), the way a real shelf is faced */
function fillShelves(S, f, xa, xb, zf, bases) {
  const jit = (i, k) => (((i * 37 + k * 101) % 17) / 17 - 0.5);
  // blocks: [[kind, opts, count], ...] repeated along the shelf; rows 2 deep
  const runBlocks = (y, blocks, off) => {
    for (let r = 0; r < 2; r++) {
      let x = xa, i = 0, bi = off, left = blocks[bi % blocks.length][2];
      for (;;) {
        const [k, o] = blocks[bi % blocks.length], w = NAT[k] * SC[k] * GAP; if (x + w > xb + 1e-6) break;
        S.add(k, o, x + w / 2 + jit(i, 1) * 0.01, y, zf - 0.2 - r * 0.4 + jit(i, 2) * 0.012, jit(i + r, 3) * 0.12, SC[k]); x += w; i++;
        if (--left <= 0) { bi++; left = blocks[bi % blocks.length][2]; x += 0.02; }
      }
    }
  };
  const levels = (perLevel) => bases.forEach((y, L) => runBlocks(y, perLevel(L), L * 2));
  const D = {
    dairy: (L) => L === 0 ? [['eggs', {}, 2], ['yogurt', { lid: '#d6402f', label: 'yogurt' }, 3], ['box', { label: 'butter', body: '#f7e9a8', w: 0.16, h: 0.07, d: 0.09 }, 3], ['yogurt', { lid: '#7b4aa8', label: 'yogurt2' }, 3]]
      : [['jug', { label: 'milk', cap: '#2f6fd6' }, 4], ['jug', { label: 'milk2', cap: '#d6402f' }, 4], ['carton', { label: 'carton' }, 5], ['carton', { label: 'carton', body: '#fff7c8' }, 4]],
    rice: (L) => L === 2 ? [['pasta', { label: 'pasta', body: '#2f6fd6' }, 4], ['pasta', { label: 'pasta2', body: '#c1272d' }, 4], ['cereal', { label: 'cereal', body: '#e8a42b' }, 3], ['cereal', { label: 'cereal2', body: '#6d3aa6' }, 3]]
      : L === 1 ? [['can', { label: 'beans', body: '#b3322b' }, 6], ['can', { label: 'beans2', body: '#3d8c4f' }, 6]]
      : [['sack', { label: 'rice', body: '#f4d27a' }, 4], ['sack', { label: 'rice2', body: '#e8e2cc' }, 4]],
    bread: (L) => L === 0 ? [['bagels', {}, 3], ['loaf', { label: 'bread3', body: '#7a4a2a', tie: '#f0c33c' }, 3]] : [['loaf', { label: 'bread', body: '#c98a3c' }, 3], ['loaf', { label: 'bread2', body: '#ecd9a8', tie: '#d6402f' }, 3]],
    juice: (L) => L === 0 ? [['juicejug', { label: 'juice4', body: '#c8282b' }, 5], ['juicejug', { label: 'juice5', body: '#e8c27a', cap: '#d6402f' }, 5]]
      : [['bottle', { label: 'juice', body: '#e8892a' }, 4], ['bottle', { label: 'juice3', body: '#4f9f45' }, 4], ['bottle', { label: 'juice2', body: '#7b4aa8' }, 4], ['bottle', { label: 'lemonade', body: '#f0d23a' }, 4]],
    snack: (L) => L === 0 ? [['cookies', { label: 'cookies', body: '#3a6ed6' }, 3], ['chips', { label: 'pretzel', body: '#7a4a2a' }, 3]]
      : [['chips', { label: 'chips', body: '#e8a42b' }, 3], ['chips', { label: 'chips2', body: '#6d3aa6' }, 3], ['chips', { label: 'chips3', body: '#cf3b36' }, 3]],
    meat: (L) => [['tray', { label: 'meat', meat: '#b3262f' }, 3], ['drumsticks', {}, 3], ['tray', { label: 'meat', meat: '#d9737a' }, 3]],
    house: (L) => L === 0 ? [['towels', {}, 2], ['tissue', { label: 'tissue' }, 3]] : L === 1 ? [['jugL', { label: 'soap', body: '#3a9ee0' }, 4], ['jugL', { label: 'bleach', body: '#f6f8fb', cap: '#2f6fd6' }, 3], ['jugL', { label: 'soap2', body: '#f08a2a' }, 4]] : [['spray', { label: 'spray', body: '#f0d23a', cap: '#d6402f' }, 6], ['bottle', { label: 'soap', body: '#3a9ee0', cap: '#fff' }, 6]],
    bev: (L) => L === 0 ? [['pack', { body: '#bfe3ff', cap: '#3a8de0', label: 'water' }, 2], ['box', { label: 'cans12', body: '#c1272d', w: 0.27, h: 0.13, d: 0.18 }, 2], ['box', { label: 'cans12b', body: '#3a6ed6', w: 0.27, h: 0.13, d: 0.18 }, 2]]
      : [['soda', { label: 'soda2', body: '#a8231f', cap: '#f4f4f0' }, 3], ['soda', { label: 'soda', body: '#2f8f4a', cap: '#f4f4f0' }, 3], ['soda', { label: 'soda6', body: '#d8e88a', cap: '#3f8f4a' }, 3], ['soda', { label: 'soda4', body: '#e8892a', cap: '#f4f4f0' }, 3], ['soda', { label: 'soda5', body: '#7b4aa8', cap: '#f4f4f0' }, 3]],
    frozen: (L) => L === 0 ? [['tub', {}, 4], ['tub', { lid: '#d6402f', body: '#fde6ea' }, 4]] : [['box', { label: 'frozen', body: '#e9f1fa', w: 0.17, h: 0.24, d: 0.06 }, 3], ['box', { label: 'frozen2', body: '#fff0d6', w: 0.17, h: 0.24, d: 0.06 }, 3], ['box', { label: 'frozen3', body: '#e6f4e8', w: 0.17, h: 0.24, d: 0.06 }, 3], ['box', { label: 'frozen4', body: '#fde6ea', w: 0.17, h: 0.24, d: 0.06 }, 3]],
  };
  if (D[f.stock]) levels(D[f.stock]);
}
/** a produce crate: slatted wooden sides and ends round a slatted floor, tilted forward about 14 degrees (front low) */
const TILT = 0.24;
function crate(B, xa, xb, y, za, zb, id) {
  const d = zb - za, h = 0.16, rise = Math.tan(TILT) * d;   // back edge is `rise` higher than the front
  const yb = (z) => y + (zb - z) / d * rise;              // the crate floor height at z
  const n = 6; for (let i = 0; i < n; i++) { const z0 = za + d * i / n, z1 = za + d * (i + 1) / n; B.box('wood', xa, yb((z0 + z1) / 2) - 0.02, z0 + 0.004, xb, yb((z0 + z1) / 2), z1 - 0.004, { id }); }   // floor slats, stepped down to the front
  for (const [a, b] of [[xa, xa + 0.025], [xb - 0.025, xb]]) for (let i = 0; i < n; i++) { const z0 = za + d * i / n, z1 = za + d * (i + 1) / n; B.box('wood', a, yb((z0 + z1) / 2) - 0.02, z0, b, yb((z0 + z1) / 2) + h, z1, { id }); }   // the ends
  B.box('woodDark', xa, y - 0.02, za, xb, yb(za) + h + 0.02, za + 0.025, { id });       // the high back board (north)
  B.box('wood', xa, y - 0.02, zb - 0.025, xb, y + 0.06, zb, { id });                    // the low front board (the aisle side)
  B.box('lip', xa + 0.04, y + 0.065, zb, xa + 0.2, y + 0.11, zb + 0.004, { id });        // a price card on the front
}
/** fruit and vegetables piled in the crates, following the tilt */
function fillCrates(S, f, xa, xb, zf, zbk) {
  const fr = f.stock === 'fruit', secs = fr ? [['banana', {}], ['apple', { body: '#6fb23a' }], ['apple', { body: '#c8282b' }], ['orange', {}], ['lemon', {}], ['grapes', {}], ['pepper', { body: '#d9382b' }]] : [['cabbage', {}], ['broccoli', {}], ['carrot', {}], ['tomato', {}], ['potato', {}], ['onion', {}], ['pepper', { body: '#2f9e44' }]];
  const tiers = [[0.42, zf - 0.62, zf - 0.04], [0.95, zbk + 0.1, zf - 0.62]];
  tiers.forEach(([y, za, zb], T) => {
    const d = zb - za, rise = Math.tan(TILT) * d, Wd = xb - xa, n = Math.max(1, Math.round(Wd / 0.62)), cw = Wd / n;
    for (let c = 0; c < n; c++) {
      const [k, o] = secs[(c + T * 3) % secs.length], st = NAT[k] * SC[k] * 0.95, a = xa + c * cw + 0.05, b = a + cw - 0.1;
      for (let L = 0; L < 2; L++) for (let z = za + 0.05 + st / 2; z < zb - 0.04 - st / 2 * 0.6; z += st * 0.92) for (let x = a + st / 2 + (L ? st / 2 : 0), i = 0; x < b - st / 2; x += st, i++) {
        const yy = y + (zb - z) / d * rise + 0.005 + L * st * 0.45; S.add(k, o, x + ((i * 7 + L) % 5 - 2) * 0.006, yy, z, (i * 1.7 + z * 9 + L) % 6.28, SC[k], TILT);
      }
    }
  });
}
/** overstock on the unit's top: cardboard cases and shrink-wrapped trays, in short stacks, clear of the sign posts */
function overstock(S, f, xa, xb, zb, zf, y, sx, sw) {
  const lab = { dairy: 'milk', rice: 'rice', bread: 'bread', juice: 'juice', snack: 'chips', house: 'soap', bev: 'soda2', frozen: 'frozen' }[f.stock] || 'casetop';
  const posts = [sx - sw / 2 + 0.23, sx + sw / 2 - 0.23];
  let x = xa + 0.1, i = 0;
  while (x < xb - 0.45) {
    const w = 0.38 + ((i * 5) % 3) * 0.06, h = 0.24 + ((i * 7) % 4) * 0.04, d = 0.34 + ((i * 3) % 2) * 0.08;
    if (posts.some((p) => Math.abs(p - (x + w / 2)) < w / 2 + 0.06)) { x += 0.14; continue; }
    if (i % 5 === 3) { x += 0.28; i++; continue; }   // a gap now and then: overstock is never a solid wall
    const z = zb + 0.22 + ((i * 11) % 3) * 0.05, stack = 1 + ((i * 13) % 3 === 0 ? 1 : 0);
    for (let k = 0; k < stack; k++) S.add('case', { label: k ? 'casetop' : lab, w, h, d, color: (i + k) % 3 ? '#b88a5a' : '#a8794a' }, x + w / 2, y + k * h, z, ((i * 3 + k) % 5 - 2) * 0.03, 1);
    x += w + 0.06; i++;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
function checkout(B, f, x0, z0, x1, z1, mats, info) {
  const Wd = x1 - x0, top = 0.92, bx0 = x0 + 0.2, bx1 = x1 - 1.55;
  const solid = { solid: true, id: f.id };
  // the cabinet: a laminate body, the counter top in two bands, the belt between them
  B.box('lam', x0, 0.1, z0, x1, top - 0.04, z1, solid);
  B.box('trimGold', x0, 0.16, z1 - 0.012, x1, 0.22, z1 + 0.008, { id: f.id, cast: false });
  B.box('top', x0, top - 0.04, z1 - 0.62, x1, top, z1, solid);            // customer side counter (south)
  B.box('trimGold', x0, top - 0.005, z1 - 0.012, x1, top + 0.012, z1 + 0.014, { id: f.id, cast: false });   // gold counter edge
  B.box('top', x0, top - 0.04, z0, x1, top, z1 - 1.6, solid);              // the cashier's desk (north)
  B.box('belt', bx0, top - 0.05, z1 - 1.6, bx1, top + 0.02, z1 - 0.62, { id: f.id });   // the conveyor
  for (let x = bx0 + 0.1; x < bx1 - 0.05; x += 0.22) B.box('chrome', x, top + 0.021, z1 - 1.6, x + 0.015, top + 0.03, z1 - 0.62, { id: f.id, cast: false });
  B.box('chrome', bx0 - 0.04, top - 0.05, z1 - 1.64, bx1 + 0.04, top + 0.05, z1 - 1.6, { id: f.id });          // belt side rails
  B.box('chrome', bx0 - 0.04, top - 0.05, z1 - 0.62, bx1 + 0.04, top + 0.05, z1 - 0.58, { id: f.id });
  // the order divider + the register at the east end of the belt
  B.box('dark', bx1, top, z1 - 1.58, bx1 + 0.04, top + 0.3, z1 - 0.64, { id: f.id });
  const rx = x1 - 1.0, rz = z1 - 1.25;
  B.box('dark', rx - 0.28, top, rz - 0.22, rx + 0.28, top + 0.12, rz + 0.22, { id: f.id });                       // the till
  B.box('dark', rx - 0.2, top + 0.12, rz - 0.04, rx + 0.2, top + 0.52, rz + 0.04, { id: f.id });                  // the monitor (tilted by the engine's decal: flat here)
  B.box('screen', rx - 0.17, top + 0.2, rz + 0.041, rx + 0.17, top + 0.48, rz + 0.05, { id: f.id, cast: false });
  B.box('screen', rx - 0.17, top + 0.52, rz - 0.03, rx + 0.17, top + 0.525, rz + 0.04, { id: f.id, cast: false });   // the lit top edge of the monitor, visible from above
  B.box('lamp', rx + 0.14, top + 0.03, rz + 0.3, rx + 0.2, top + 0.045, rz + 0.34, { id: f.id, cast: false });
  B.box('dark', rx - 0.12, top + 0.0, rz + 0.22, rx + 0.12, top + 0.03, rz + 0.36, { id: f.id });                   // card reader
  B.box('chrome', x1 - 0.55, top, z1 - 1.12, x1 - 0.3, top + 0.1, z1 - 0.9, { id: f.id });                          // receipt printer
  // bagging rack and a stack of baskets at the west end of the cashier's desk
  B.box('lip', x0 + 0.25, top, z0 + 0.2, x0 + 1.0, top + 0.18, z0 + 0.6, { id: f.id });
  B.box('lip', x0 + 0.25, top + 0.18, z0 + 0.2, x0 + 1.0, top + 0.36, z0 + 0.6, { id: f.id });
  // the lane light pole at the west end (a steady green lamp)
  B.box('chrome', x0 + 0.1, top, z1 - 0.55, x0 + 0.17, 1.85, z1 - 0.48, { id: f.id });
  B.box('lamp', x0 + 0.03, 1.85, z1 - 0.62, x0 + 0.24, 2.1, z1 - 0.43, { id: f.id, cast: false });
  // the header as a back panel on the desk (reads from the south: see structure.js's note on sign heights)
  const sw = Math.min(Wd - 0.5, 2.8), sx = x0 + 1.35 + sw / 2;
  B.box('dark', x0 + 0.2, top, z0 + 0.02, x0 + 0.26, top + 0.48, z0 + 0.08, { id: f.id, cast: false }); B.box('dark', x1 - 0.26, top, z0 + 0.02, x1 - 0.2, top + 0.48, z0 + 0.08, { id: f.id, cast: false });
  info.signs.push({ text: f.sign, x: (x0 + x1) / 2, y: top + 0.5, z: z0 + 0.07, w: Wd - 0.4, h: 0.46 });
  // goods on the belt
  const S = B.stock;
  S.add('box', { label: 'frozen2', body: '#fff0d6', w: 0.2, h: 0.26, d: 0.1 }, bx0 + 0.45, top + 0.02, z1 - 1.2, 0.3); S.add('can', { label: 'beans', body: '#b3322b' }, bx0 + 0.95, top + 0.02, z1 - 1.05, 0);
  S.add('jug', { label: 'milk', cap: '#2f6fd6' }, bx0 + 1.5, top + 0.02, z1 - 1.25, 0.4);
}
