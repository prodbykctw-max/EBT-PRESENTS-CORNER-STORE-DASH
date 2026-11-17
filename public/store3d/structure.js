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

export class Builder {
  constructor(THREEns, mats, { merge = true } = {}) { this.mats = mats; this.boxes = []; this.solids = []; this.merge = merge; this.extra = new THREE.Group(); this.stock = null; }
  /** a box from world min/max corners. opts: solid (counts for collision / the alignment check), cast, uv (world-scale UV size in m) */
  box(mat, x0, y0, z0, x1, y1, z1, o = {}) {
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    this.boxes.push({ mat, x0, y0, z0, x1, y1, z1, o });
    if (o.solid) this.solids.push({ x0, y0, z0, x1, y1, z1, id: o.id || '' });
  }
  finish() {
    const byMat = new Map();
    for (const b of this.boxes) {
      const g = new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0); g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, s = b.o.uv || 1.2;
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        if (ay > 0.5) uv.setXY(i, p.getX(i) / s, p.getZ(i) / s); else if (ax > 0.5) uv.setXY(i, p.getZ(i) / s, p.getY(i) / s); else uv.setXY(i, p.getX(i) / s, p.getY(i) / s);
      }
      if (!byMat.has(b.mat)) byMat.set(b.mat, { geos: [], cast: false, recv: true });
      const e = byMat.get(b.mat); e.geos.push(g); e.cast = e.cast || b.o.cast !== false;
    }
    const grp = new THREE.Group(); grp.name = 'static';
    for (const [mat, e] of byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(e.geos, false), this.mats[mat] || this.mats.default); mesh.castShadow = e.cast; mesh.receiveShadow = true; mesh.name = 'static:' + mat; mesh.frustumCulled = false; grp.add(mesh);
    }
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
  const wallCells = (cx, cy) => !fieldAt(cx, cy) && near[cy * mw + cx] && !inFix(cx, cy) && !inCorral(cx, cy) && !inRail(cx, cy) && cy * cell >= 96 - 4 && cy * cell < 1640;
  for (const b of rails) B.box('rail', m(b.x0), 0, m(b.y0), m(b.x1), 0.12, m(b.y1), { solid: true, id: 'rail' });
  for (const [x0, y0, x1, y1] of cover(mw, mh, wallCells)) B.box('wall', m(x0 * cell), 0, m(y0 * cell), m(x1 * cell), W_H, m(y1 * cell), { solid: true, id: 'wall', uv: 1.6 });
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
  const stock = new Stock(mats.products || mats.default); B.stock = stock;
  for (const f of fixtures) {
    const fc = fixtureCells(layout, f.rect), [bx0, by0, bx1, by1] = fc.core, x0 = m(bx0), z0 = m(by0), x1 = m(bx1), z1 = m(by1);
    const rec = { id: f.id, kind: f.kind, rect: f.rect, core: fc.core, sign: f.sign };
    // the plinth under the whole blocked region, cell for cell (solid), dark
    for (const [a, b, c, d] of fc.exact) B.box('base', m(a * cell), 0, m(b * cell), m(c * cell), 0.16, m(d * cell), { solid: true, id: f.id });
    if (f.kind === 'checkout') checkout(B, f, x0, z0, x1, z1, mats, info);
    else gondola(B, f, x0, z0, x1, z1, stock, info);
    info.fixtures.push(rec);
  }
  // ---- cart corrals (low frames; the carts are instanced by the engine)
  for (const r of CORRALS) {
    const x0 = m(r[0]), z0 = m(r[1]), x1 = m(r[2]), z1 = m(r[3]);
    B.box('chrome', x0, 0.0, z0, x1, 0.12, z1, { solid: true, id: 'corral' });
    for (const [a, b, c, d, h] of [[x0, z0, x1, z0 + 0.06, 0.95], [x0, z1 - 0.06, x1, z1, 0.95], [x0, z0, x0 + 0.06, z1, 0.95], [x1 - 0.06, z0, x1, z1, 0.95]]) B.box('chrome', a, 0.06, b, c, h, d, { solid: true, id: 'corral' });
    B.box('chrome', x0, 0.5, z0, x1, 0.55, z0 + 0.04, { solid: true, id: 'corral' });
    info.corrals = (info.corrals || []).concat([[x0, z0, x1, z1]]);
  }
  // ---- the exit door in the north pier (south face of the solid block between the dairy and the rice units)
  { const zf = m(224), cxd = m(435); info.exit = { x: cxd, z: zf };
    B.box('doorframe', cxd - 0.85, 0, zf, cxd + 0.85, 2.35, zf + 0.09, { id: 'exit' });
    B.box('door', cxd - 0.72, 0, zf + 0.09, cxd + 0.72, 2.2, zf + 0.12, { id: 'exit' });
    B.box('glass', cxd - 0.5, 0.9, zf + 0.12, cxd + 0.5, 2.05, zf + 0.135, { id: 'exit' });
    B.box('bar', cxd - 0.6, 1.0, zf + 0.14, cxd + 0.6, 1.07, zf + 0.2, { id: 'exit' }); }

  root.add(B.finish());
  for (const im of stock.build(false)) root.add(im);
  info.stockCount = stock.n; info.solids = B.solids;
  return { root, info, builder: B };
}

// ---------------------------------------------------------------------------------------------------------------------
function gondola(B, f, x0, z0, x1, z1, stock, info) {
  const Wd = x1 - x0, zb = z1 - FRONT_D, cooler = f.kind === 'cooler', produce = f.kind === 'produce';
  const body = cooler ? 'cooler' : 'steel', side = 0.07, H = SHELF_H;
  // end caps, back panel, top, plank shelves with a lip
  B.box(body, x0, 0.16, zb, x0 + side, H, z1, { solid: true, id: f.id }); B.box(body, x1 - side, 0.16, zb, x1, H, z1, { solid: true, id: f.id });
  B.box('back', x0 + side, 0.16, zb, x1 - side, H, zb + 0.05, { solid: true, id: f.id });
  B.box(body, x0, H, zb, x1, H + 0.06, z1, { solid: true, id: f.id });
  B.box(cooler ? 'coolerbase' : 'base', x0, 0.16, z1 - 0.34, x1, 0.2, z1, { solid: true, id: f.id });   // the kick plate
  const levels = [0.5, 0.9, 1.3, 1.7];
  for (const y of levels) {
    B.box(produce ? 'wood' : 'plank', x0 + side, y - 0.03, zb + 0.05, x1 - side, y, z1 - 0.02, { solid: true, id: f.id });
    if (produce) { B.box('wood', x0 + side, y, z1 - 0.06, x1 - side, y + 0.07, z1 - 0.02, { id: f.id }); B.box('wood', x0 + side, y, zb + 0.05, x1 - side, y + 0.09, zb + 0.09, { id: f.id, cast: false }); const n = Math.round(Wd / 1.2); for (let i = 1; i < n; i++) B.box('wood', x0 + Wd * i / n - 0.02, y, zb + 0.05, x0 + Wd * i / n + 0.02, y + 0.08, z1 - 0.02, { id: f.id, cast: false }); }
    else B.box('lip', x0 + side, y - 0.07, z1 - 0.035, x1 - side, y, z1 - 0.012, { id: f.id, cast: false });
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
  fillShelves(stock, f, x0 + side + 0.06, x1 - side - 0.06, z1, levels, zb);
  // (the north part of the blocked region is the plinth, already placed)
}

function fillShelves(S, f, xa, xb, zf, levels, zb) {
  const rows = (y, n, fn) => { for (let r = 0; r < n; r++) fn(zf - 0.17 - r * 0.28, y, r); };
  const ys = [0.2, ...levels.slice(0, 3).map((y) => y + 0.0)];   // product bases: the kick plate top, then each plank
  const lvl = [0.2, 0.5, 0.9, 1.3];
  const span = (step, fn) => { let i = 0; for (let x = xa + step / 2; x < xb - step / 2 + 1e-6; x += step, i++) fn(x, i); };
  const jit = (i, k) => (((i * 37 + k * 101) % 17) / 17 - 0.5);
  const put = (kind, o, x, y, z, i) => S.add(kind, o, x + jit(i, 1) * 0.01, y, z + jit(i, 2) * 0.01, jit(i, 3) * 0.12);
  switch (f.stock) {
    case 'dairy': {
      const seq = [['jug', { label: 'milk', cap: '#2f6fd6' }], ['jug', { label: 'milk2', cap: '#d6402f' }], ['carton', { label: 'carton' }], ['jug', { label: 'milk', cap: '#2f6fd6' }], ['carton', { label: 'carton', body: '#fff7c8' }]];
      lvl.forEach((y, L) => rows(y + 0.0, 2, (z, yy, r) => span(L % 2 ? 0.2 : 0.17, (x, i) => { const s = seq[(i + L + r) % seq.length]; put(s[0], s[1], x, yy, z, i + L * 50 + r * 9); })));
      break; }
    case 'rice': {
      lvl.forEach((y, L) => rows(y, 2, (z, yy, r) => { const sec = (xb - xa) / 3; span(0.24, (x, i) => { const t = Math.floor((x - xa) / sec);
        if (t === 0) put('sack', { label: L % 2 ? 'rice2' : 'rice', body: L % 2 ? '#e8e2cc' : '#f4d27a' }, x, yy, z, i + L * 40 + r * 7);
        else { const cs = i % 2 ? 'beans' : 'beans2'; put('can', { label: cs, body: cs === 'beans' ? '#b3322b' : '#3d8c4f' }, x, yy, z, i); put('can', { label: cs, body: cs === 'beans' ? '#b3322b' : '#3d8c4f' }, x + 0.09, yy, z, i + 3); } }); }));
      break; }
    case 'bread': {
      lvl.forEach((y, L) => rows(y, 2, (z, yy, r) => span(0.32, (x, i) => put('loaf', i % 3 === 0 ? { label: 'bread2', body: '#ecd9a8' } : { label: 'bread', body: '#c98a3c' }, x, yy, z, i + L * 31 + r * 5))));
      break; }
    case 'juice': {
      const set = [['juice', '#e8892a'], ['juice3', '#4f9f45'], ['juice2', '#7b4aa8'], ['lemonade', '#f0d23a'], ['juice', '#e8892a']];
      lvl.forEach((y, L) => rows(y, 2, (z, yy, r) => span(0.085, (x, i) => { const s = set[Math.floor(i / 4 + L) % set.length]; put('bottle', { label: s[0], body: s[1] }, x, yy, z, i + L * 13 + r * 3); })));
      break; }
    case 'snack': {
      const set = [['chips', '#e8a42b'], ['chips2', '#6d3aa6'], ['chips3', '#cf3b36']];
      lvl.forEach((y, L) => rows(y, 2, (z, yy, r) => span(0.23, (x, i) => { const s = set[(i + L + r) % 3]; put('chips', { label: s[0], body: s[1] }, x, yy, z, i + L * 17 + r * 3); })));
      break; }
    case 'fruit': case 'veg': {
      const fr = f.stock === 'fruit', secs = fr ? [['banana', {}, 0.15], ['apple', { body: '#6fb23a' }, 0.085], ['apple', { body: '#c8282b' }, 0.085], ['orange', {}, 0.09], ['pepper', { body: '#d9382b' }, 0.07]] : [['cabbage', {}, 0.19], ['broccoli', {}, 0.13], ['carrot', {}, 0.07], ['potato', {}, 0.11], ['onion', {}, 0.105]];
      const sw = (xb - xa) / secs.length;
      lvl.forEach((y, L) => {
        // a wooden crate tray under each section
        secs.forEach(([k, o, st], s) => {
          const a = xa + s * sw, b = a + sw - 0.03;
          const rowsN = 3;
          for (let r = 0; r < rowsN; r++) for (let x = a + st / 2 + 0.03, i = 0; x < b - st / 2; x += st, i++) {
            const z = zf - 0.2 - r * (st > 0.1 ? 0.24 : 0.2) , tilt = 0.02 + (r * 0.03);
            if (k === 'carrot') { S.add(k, o, x, y + 0.03 + r * 0.01, z, 0, 1.0); S.add(k, o, x + 0.02, y + 0.07 + r * 0.01, z + 0.02, 0.2, 1.0); }
            else S.add(k, o, x + (((i * 7 + r * 3 + L) % 5) - 2) * 0.004, y + 0.02 + r * 0.025 + (k === 'banana' ? 0.0 : 0.0), z, ((i + r + L) % 7) * 0.8, 1);
            if (st >= 0.085 && k !== 'banana' && k !== 'carrot') S.add(k, o, x + 0.02, y + 0.02 + r * 0.025 + st * 0.8, z - 0.04, ((i + L) % 5), 0.98);   // a second layer
          }
        });
      });
      break; }
    case 'meat': {
      const set = [['tray', { label: 'meat', meat: '#b3262f' }], ['tray', { label: 'meat', meat: '#d9737a' }], ['drumsticks', {}], ['tray', { label: 'meat', meat: '#9c2430' }]];
      lvl.forEach((y, L) => rows(y, 3, (z, yy, r) => span(0.25, (x, i) => { const s = set[(i + L + r) % set.length]; put(s[0], s[1], x, yy + r * 0.0, z, i + L * 11 + r * 3); })));
      break; }
    case 'house': {
      const set = [['jugL', { label: 'soap', body: '#3a9ee0' }], ['tissue', { label: 'tissue' }], ['jugL', { label: 'soap2', body: '#f08a2a' }], ['bottle', { label: 'soap', body: '#3a9ee0', cap: '#fff' }]];
      lvl.forEach((y, L) => rows(y, 2, (z, yy, r) => span(0.25, (x, i) => { const s = set[(i + L * 2 + r) % set.length]; put(s[0], s[1], x, yy, z, i + L * 19 + r * 3); })));
      break; }
    case 'bev': {
      const set = [['soda', { label: 'soda2', body: '#a8231f', cap: '#f4f4f0' }], ['soda', { label: 'soda', body: '#2f8f4a', cap: '#f4f4f0' }], ['soda', { label: 'soda3', body: '#3a6ed6', cap: '#f4f4f0' }], ['soda', { label: 'soda4', body: '#e8892a', cap: '#f4f4f0' }], ['soda', { label: 'soda5', body: '#7b4aa8', cap: '#f4f4f0' }]];
      lvl.forEach((y, L) => rows(y, 2, (z, yy, r) => span(0.13, (x, i) => { const s = set[Math.floor(i / 3 + L) % set.length]; put(s[0], s[1], x, yy, z, i + L * 7 + r * 3); })));
      break; }
    case 'frozen': {
      const set = [['box', { label: 'frozen', body: '#e9f1fa' }], ['box', { label: 'frozen2', body: '#fff0d6' }], ['box', { label: 'frozen3', body: '#e6f4e8' }]];
      lvl.forEach((y, L) => rows(y, 3, (z, yy, r) => span(0.2, (x, i) => { const s = set[(i + L + r) % 3]; put(s[0], { ...s[1], w: 0.17, h: 0.24, d: 0.06 }, x, yy, z, i + L * 5 + r * 3); })));
      break; }
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
