// The ATL look: ?storelook=atl (Nov 24 2026, owner: "Generate a new aged store. Look for movie references and show references as well as game
// and other media depictions of small cornerstores in atl", then "We want their energy but our layout"). An ALTERNATIVE look to compare with
// the live one, which stays the default and is not touched by anything here: without the param none of this file runs.
//
// What it takes from real inner-city corner stores (reporting on real stores and on how FX's Atlanta was shot): the plexi / security glass
// round the register with a cut-out, the cigarette wall and the scratch-off case by it, taped photos and notes, a dome camera and a convex
// mirror, candy and gum on the counter, a shoebox for cash, hand-lettered paper and cardboard signs (NO LOITERING, EBT, LOTTO, ATM, ID),
// a steady neon OPEN, faded vinyl and sun-bleached posters, peeling paint and water stains, fogged cooler glass, clip strips of chips,
// milk crates and cases left about, a wet-floor sign and a mop bucket by a dull puddle, heavier rust and grime, paths worn into the floor, and
// a dimmer, greener fluorescent light with a grainy, low-contrast, slightly foggy grade. What it does NOT take: anybody's layout. The aisles,
// fixtures, collision (layout.json), pickups, aisle signs, camera, people and the default TUNE / LAMP numbers are ours and unchanged.
//
// Everything is steady (no blink, no flicker, nothing that changes with time) and comes from hashes (never Math.random). No real brand
// names or logos: every label here is made up. Cost: the set dressing goes into the same merged band meshes; the signs are two more meshes
// (opaque + see-through) on one more 2048 x 1536 canvas.
import * as THREE from '../drive/vendor/three.module.min.js';

/** one-line knobs for the ATL look. tune: overrides of store3d.js TUNE (only for this look). grade: the final pass (store3d.js ATL_GRADE):
 *  lift (blacks lifted, 0..0.1), fog (a dull grey-green veil, 0..0.3), vignette (corner darkening, 0..0.6), grain (static film grain, 0..0.06,
 *  fixed to the screen pixel so it never shimmers), tint (the fluorescent cast, multiplies the picture), fogCol. lamps: the floor light pools:
 *  uneven (0 = all the same .. 1 = some nearly out; steady), col (the tubes' colour). wear / floor: store3d WEAR / FLOOR_WEAR for this look.
 *  dress: 0 turns all the set dressing and signs off (light and grade only). */
export const ATL = {
  tune: { key: 1.25, hemi: 0.28, env: 0.34, ex: 0.66, lm: 0.6, bloom: 0.24, bt: 1.6, sat: 0.78, con: -0.06 },
  grade: { lift: 0.028, fog: 0.05, vignette: 0.36, grain: 0.03, tint: [0.95, 1.02, 0.84], fogCol: [0.5, 0.53, 0.43] },
  lamps: { uneven: 0.7, col: [222, 240, 188] },
  wear: { grime: 1.7, rust: 1.9, chips: 1.6, scuffs: 1.5 },
  floor: { dirt: 1.45, marks: 1.35, tape: 1.05, paths: 1, puddles: 1 },   // (tape at most 1.1: the tape patches are baked at 0.9)
  glass: { color: 0xb9c4b8, opacity: 0.32 },
  floorRGB: [146, 136, 104],   // the tile: an older, greyer beige than the live look's sand (textures.js FLOOR_RGB)
  signAge: 1,                  // how aged the aisle boards, EXIT plate, posters and mats are (0..1: faded, yellowed, scuffed; the text stays legible)
  dress: 1,
};
/** the stock and fixtures a bit more shopped and more tired than the default MESS (structure.js), same meaning */
export const MESS_ATL = { yaw: 0.1, yawBigShare: 0.12, gapFront: 0.1, halfEmpty: 0.22, misplace: 0.03, levelVar: 0.045, frontVar: 0.05, sag: 0.018, bowedShare: 0.35, stripTilt: 0.018, crookedShare: 0.25, tagMiss: 0.24, tape: 0.75, stackSlop: 0.07 };

// ------------------------------------------------------------------------------------------------------------------------------------
// geometry (no canvas here: the node tools build the structure too)
const P = {
  crateBlue: ['#2a55a0', 0.62, 0], crateRed: ['#a3262a', 0.62, 0], crateGrey: ['#55595f', 0.62, 0], plexiFrame: 'frame', dark: 'dark',
  yellow: ['#e8b923', 0.5, 0], yellowDk: ['#a8820e', 0.6, 0], mop: ['#cfc8b0', 0.95, 0], wood: 'wood', shoebox: ['#e4ddd0', 0.8, 0], lid: ['#c9c0ae', 0.8, 0],
};
const CANDY = ['#d6402f', '#f5c518', '#2f6fd6', '#3f8f4a', '#7b4aa8', '#e8892a', '#f06aa8', '#ffffff', '#5a3a20', '#1fb5c4'];
function whiteGeo(g, white) { const n = g.attributes.position.count, uv = new Float32Array(n * 2); for (let i = 0; i < n; i++) { uv[i * 2] = white[0]; uv[i * 2 + 1] = white[1]; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g.index ? g.toNonIndexed() : g; }
let SPH = null, HEMI = null;
const sphere = (w) => SPH || (SPH = whiteGeo(new THREE.SphereGeometry(1, 12, 8), w));
const hemi = (w) => HEMI || (HEMI = whiteGeo(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), w));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function put(B, g, paint, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) { _q.setFromEuler(_e.set(rx, ry, rz)); _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)); B.bufFor(z).geo(g, _m, paint); }

/** a milk crate: open top, four sides with a dark slot pattern read as a darker band; yaw ry about its centre */
function milkCrate(B, x, y, z, paint, ry = 0, up = true) {
  const w = 0.33, h = 0.28, d = 0.33;
  B.tilted(x, y, z, 0, ry, 0, () => {
    B.box(paint, x - w / 2, y, z - d / 2, x + w / 2, y + 0.03, z + d / 2, { skip: up ? 'ny' : '' });   // the floor of the crate (or its top, upside down)
    for (const [a, b, c, e] of [[-w / 2, -d / 2, w / 2, -d / 2 + 0.02], [-w / 2, d / 2 - 0.02, w / 2, d / 2], [-w / 2, -d / 2, -w / 2 + 0.02, d / 2], [w / 2 - 0.02, -d / 2, w / 2, d / 2]]) {
      B.box(paint, x + a, y, z + b, x + c, y + h, z + e);
      B.box(['#14161a', 0.8, 0], x + a - 0.001, y + 0.09, z + b - 0.001, x + c + 0.001, y + 0.2, z + e + 0.001, { skip: 'ny py' });   // the hand slots, dark
    }
  });
}

/**
 * The set dressing, written into the store's own merged buffers (B: structure.js Builder). Only non-colliding things (no `solid`), and only on
 * or against fixtures and on the sidewalk outside the storefront, never standing in a lane the player walks. info gets info.atl: where the
 * signs go (store3d.js draws them).
 */
export function dressAtl(B, info, layout, { hash, Stock }) {
  const A = (info.atl = { counters: [] });
  if (!ATL.dress) return;
  const W = B.white, h = (a, b, s) => hash(a, b, 900 + s);
  // ---- the checkouts: security glass round the register end, the cut-out, camera, mirror, cigarettes, scratch-offs, candy, the shoebox
  info.fixtures.filter((f) => f.kind === 'checkout').forEach((f, ci) => {
    const [x0, z0, x1, z1] = f.box, top = 0.92, gx0 = x1 - 1.55, gx1 = x1 - 0.06, zg = z1 - 0.6, gy1 = 1.62, rx = x1 - 1.0, hx0 = rx - 0.24, hx1 = rx + 0.24, hy1 = top + 0.2;
    // the frame: two posts, a top and a bottom rail, and a frame round the pass-through
    B.box('steel', gx0 - 0.04, top, zg - 0.04, gx0 + 0.04, gy1, zg + 0.04); B.box('steel', gx1 - 0.04, top, zg - 0.04, gx1 + 0.04, gy1, zg + 0.04);
    B.box('steel', gx0 - 0.04, gy1, zg - 0.04, gx1 + 0.04, gy1 + 0.06, zg + 0.04); B.box('frame', gx0, top, zg - 0.025, gx1, top + 0.025, zg + 0.025);
    B.box('frame', hx0 - 0.02, top, zg - 0.025, hx0, hy1 + 0.02, zg + 0.025); B.box('frame', hx1, top, zg - 0.025, hx1 + 0.02, hy1 + 0.02, zg + 0.025); B.box('frame', hx0, hy1, zg - 0.025, hx1, hy1 + 0.02, zg + 0.025);
    // the panes (the store's glass: faint), leaving the cut-out open
    B.box('glass', gx0 + 0.03, top + 0.025, zg - 0.006, hx0 - 0.02, gy1, zg + 0.006); B.box('glass', hx1 + 0.02, top + 0.025, zg - 0.006, gx1 - 0.03, gy1, zg + 0.006); B.box('glass', hx0 - 0.02, hy1 + 0.02, zg - 0.006, hx1 + 0.02, gy1, zg + 0.006);
    // a dome camera on the top rail, a convex mirror on an arm at the east post (dark smoked dome, a chrome bulge)
    put(B, hemi(W), 'dark', (gx0 + gx1) / 2 - 0.3, gy1 + 0.04, zg, 0.07, 0.06, 0.07, Math.PI, 0, 0);
    B.box('frame', gx1 - 0.015, gy1, zg - 0.015, gx1 + 0.015, gy1 + 0.18, zg + 0.015); put(B, sphere(W), 'chrome', gx1 - 0.02, gy1 + 0.26, zg + 0.04, 0.14, 0.14, 0.05, -0.35, -0.5, 0);
    // the cigarette rack on the cashier's desk (its lettered face is a decal), clear of the CHECKOUT lettering
    B.box('dark', x1 - 0.64, top, z0 + 0.38, x1 - 0.12, top + 0.48, z0 + 0.6);
    // a shoebox of cash with its lid leaned against it, next to the till
    B.tilted(rx - 0.6, top, z0 + 0.42, 0, 0.18 * (h(ci, 1, 1) - 0.5) * 2, 0, () => { B.box(P.shoebox, rx - 0.76, top, z0 + 0.3, rx - 0.44, top + 0.11, z0 + 0.5); B.box(['#3f7a3a', 0.85, 0], rx - 0.73, top + 0.11, z0 + 0.33, rx - 0.47, top + 0.115, z0 + 0.47); });
    B.tilted(rx - 0.42, top + 0.08, z0 + 0.4, 0, 0, -0.5, () => B.box(P.lid, rx - 0.43, top, z0 + 0.3, rx - 0.41, top + 0.2, z0 + 0.5));
    // the scratch-off case on the customer counter by the glass (its face a decal), the candy and gum rack west of it
    B.tilted(gx0 - 0.3, top, z1 - 0.32, -0.12, 0, 0, () => B.box('dark', gx0 - 0.55, top, z1 - 0.52, gx0 - 0.06, top + 0.24, z1 - 0.14));
    const ra = gx0 - 1.3, rb = gx0 - 0.66;
    for (let k = 0; k < 3; k++) {
      const za = z1 - 0.5 + k * 0.13, zb2 = za + 0.12, yb = top + 0.16 - k * 0.07;
      B.box('dark', ra, top, za, rb, yb, zb2);
      for (let x = ra + 0.02, i = 0; x < rb - 0.05; i++) { const wd = 0.045 + h(ci * 100 + k * 30 + i, 2, 3) * 0.04, ht = 0.04 + h(ci, k * 30 + i, 4) * 0.06, c = CANDY[Math.floor(h(ci * 7 + k, i, 5) * CANDY.length)];
        if (h(ci + k, i, 6) > 0.12) B.box([c, 0.45, 0], x, yb, za + 0.015, x + wd, yb + ht, zb2 - 0.015); x += wd + 0.008; }
    }
    // a milk crate on the desk, holding bags
    milkCrate(B, x0 + 1.25, top, z0 + 0.4, P.crateBlue, 0.2 * (h(ci, 7, 7) - 0.5));
    A.counters.push({ x0, z0, x1, z1, top, gx0, gx1, zg, gy1, rx, hx0, hx1, hy1 });
  });
  // ---- the storefront: a steady neon OPEN's backing box inside the glass; outside on the sidewalk the milk crates people sit on,
  //      the wet-floor sign, the mop bucket and mop (the puddle is a decal)
  const sf = info.storefront, ez = sf.z;
  A.neon = { x: 13.35, y: 1.78, z: ez - 0.07, w: 0.92, h: 0.4 };
  B.box('dark', A.neon.x - A.neon.w / 2, A.neon.y - A.neon.h / 2, ez - 0.1, A.neon.x + A.neon.w / 2, A.neon.y + A.neon.h / 2, ez - 0.075);
  B.box('dark', A.neon.x - 0.3, A.neon.y + A.neon.h / 2, ez - 0.09, A.neon.x - 0.29, sf.H - 0.12, ez - 0.085); B.box('dark', A.neon.x + 0.29, A.neon.y + A.neon.h / 2, ez - 0.09, A.neon.x + 0.3, sf.H - 0.12, ez - 0.085);   // hung on two chains
  milkCrate(B, 2.7, 0, ez + 0.4, P.crateBlue, 0.12); milkCrate(B, 2.72, 0.28, ez + 0.41, P.crateRed, -0.1); milkCrate(B, 3.25, 0, ez + 0.47, P.crateGrey, 0.35);
  milkCrate(B, 3.72, 0.28, ez + 0.62, P.crateRed, -0.25, false); B.box(['#6a4a2a', 0.9, 0], 3.58, 0.28, ez + 0.48, 3.86, 0.3, ez + 0.76);   // one upside down with a flattened box on it: a seat
  // the wet-floor sign: an A-frame, the two boards leaning together (faces are decals)
  // (each board stands on its own foot, 0.17 m either side of the middle, and leans in so the tops meet)
  A.wet = { x: 12.05, z: ez + 0.55, lean: 0.27, foot: 0.17, yaw: 0.35 };
  for (const s of [1, -1]) { const zf = A.wet.z + s * A.wet.foot; B.tilted(A.wet.x, 0, zf, -s * A.wet.lean, A.wet.yaw, 0, () => B.box(P.yellow, A.wet.x - 0.15, 0, zf - 0.008, A.wet.x + 0.15, 0.62, zf + 0.008)); }
  // the mop bucket (a yellow tub on four casters with a wringer) and the mop leaning on the glass
  { const bx = 13.35, bz = ez + 0.55;
    B.box(P.yellow, bx - 0.24, 0.07, bz - 0.17, bx + 0.24, 0.42, bz + 0.17, { skip: 'ny py' }); B.box(['#3a3a2e', 0.4, 0], bx - 0.22, 0.34, bz - 0.15, bx + 0.22, 0.345, bz + 0.15);   // the grey water
    B.box(P.yellowDk, bx + 0.02, 0.42, bz - 0.15, bx + 0.22, 0.62, bz + 0.15); B.box(P.yellowDk, bx - 0.25, 0.38, bz - 0.18, bx + 0.25, 0.44, bz + 0.18, { skip: 'ny' });
    for (const [cx, cz] of [[-0.2, -0.13], [0.2, -0.13], [-0.2, 0.13], [0.2, 0.13]]) B.box('dark', bx + cx - 0.03, 0, bz + cz - 0.03, bx + cx + 0.03, 0.07, bz + cz + 0.03);
    B.tilted(bx + 0.5, 0, ez + 0.45, -0.3, 0, 0.05, () => { B.box('wood', bx + 0.49, 0.14, ez + 0.43, bx + 0.52, 1.45, ez + 0.46); B.box(P.mop, bx + 0.4, 0, ez + 0.39, bx + 0.6, 0.16, ez + 0.51); }); }   // the mop: head on the sidewalk, handle back against the glass
  // ---- coolers: cases and milk crates on their tops (clear of the sign posts)
  for (const u of info.units || []) {
    const posts = [u.signX - u.signW / 2 + 0.23, u.signX + u.signW / 2 - 0.23], y = u.H + 0.06, ok = (x, w) => posts.every((p) => Math.abs(p - x) > w / 2 + 0.08);
    if (u.kind === 'cooler') {
      let k = 0; for (let x = u.x0 + 0.35; x < u.x1 - 0.35; x += 0.55 + h(k, 3, 11) * 0.5, k++) {
        if (!ok(x, 0.4) || h(k, idn(u.id), 12) < 0.35) continue;
        if (u.id === 'dairy' && k % 2 === 0) { milkCrate(B, x, y, u.zb + 0.4, k % 4 ? P.crateRed : P.crateBlue, (h(k, 1, 13) - 0.5) * 0.4); if (h(k, 2, 13) < 0.6) milkCrate(B, x + 0.01, y + 0.28, u.zb + 0.41, P.crateBlue, (h(k, 3, 13) - 0.5) * 0.5); continue; }
        const st = 1 + (h(k, 4, 13) < 0.4 ? 1 : 0); for (let j = 0; j < st; j++) Stock.add('case', { label: 'casetop', w: 0.38 + h(k, j, 14) * 0.1, h: 0.26, d: 0.34, color: j % 2 ? '#a8794a' : '#b88a5a' }, x + (h(k, j, 15) - 0.5) * 0.08, y + j * 0.26, u.zb + 0.35 + (h(k, j, 16) - 0.5) * 0.08, (h(k, j, 17) - 0.5) * 0.5, 1);
      }
    }
    // clip strips of chips hanging on the snack and drinks units' end posts (against the fixture, a few cm proud of it)
    if (u.id === 'snack' || u.id === 'bev') for (const fx of [u.x0 + 0.22, u.x1 - 0.22]) {
      B.box('chrome', fx - 0.012, 0.45, u.z1 + 0.012, fx + 0.012, 1.78, u.z1 + 0.02);
      const bodies = ['#e8a42b', '#cf3b36', '#6d3aa6', '#3a6ed6', '#4f9f45'], labs = ['chips', 'chips3', 'chips2', 'pretzel', 'chips'];
      for (let j = 0; j < 5; j++) { const q = h(j, Math.round(fx * 10), 21); if (q < 0.15) continue; const b = Math.floor(h(j, idn(u.id), 22) * 5); Stock.add('chips', { label: labs[b], body: bodies[b] }, fx + (q - 0.5) * 0.03, 1.5 - j * 0.24, u.z1 + 0.05, (q - 0.5) * 0.3, 0.78, -0.12); }
    }
  }
  // ---- convex mirrors in the two back corners and a dome camera over the north wall
  const zw = 100 / 48;
  put(B, sphere(W), 'chrome', 2.55, 2.95, zw + 0.12, 0.26, 0.26, 0.1, -0.4, 0.5, 0); B.box('frame', 2.5, 2.95, zw, 2.6, 2.98, zw + 0.1);
  put(B, sphere(W), 'chrome', 7.85, 2.95, zw + 0.12, 0.26, 0.26, 0.1, -0.4, -0.5, 0); B.box('frame', 7.8, 2.95, zw, 7.9, 2.98, zw + 0.1);
  put(B, hemi(W), 'dark', 5.1, 3.2, zw + 0.12, 0.1, 0.08, 0.1, Math.PI, 0, 0);
}
const idn = (id) => { let v = 7; for (const ch of id) v = (v * 31 + ch.charCodeAt(0)) | 0; return Math.abs(v) % 1000; };

// ------------------------------------------------------------------------------------------------------------------------------------
// the signs: one canvas, drawn here (browser only)
const FONT = '"Arial Black","Helvetica Neue",Impact,"DejaVu Sans",sans-serif';
const HAND = '"Comic Sans MS","Chalkboard SE","Marker Felt","Segoe Print","DejaVu Sans",sans-serif';
/** hand-lettered: every letter its own little tilt and bob, drawn thick like a marker; fits maxW */
function hand(g, text, cx, cy, size, color, seed, hash, maxW = 1e9) {
  let fs = size; g.font = `bold ${fs}px ${HAND}`; while (g.measureText(text).width > maxW && fs > 8) { fs -= 1; g.font = `bold ${fs}px ${HAND}`; }
  const wds = [...text].map((ch) => g.measureText(ch).width * 1.02), tot = wds.reduce((a, b) => a + b, 0); let x = cx - tot / 2;
  g.fillStyle = color; g.strokeStyle = color; g.lineWidth = Math.max(1, fs * 0.05); g.lineJoin = 'round'; g.textBaseline = 'middle'; g.textAlign = 'left';
  [...text].forEach((ch, i) => { g.save(); g.translate(x, cy + (hash(i, seed, 61) - 0.5) * fs * 0.12); g.rotate((hash(i, seed, 63) - 0.5) * 0.16); g.strokeText(ch, 0, 0); g.fillText(ch, 0, 0); g.restore(); x += wds[i]; });
}
/** paper taped up: off-white, yellowed unevenly, a fold, specks, tape at the top corners, one corner a lighter curl */
function paper(g, w, h, seed, hash, tone = '#f1ecdc') {
  g.fillStyle = tone; g.fillRect(0, 0, w, h);
  let gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, 'rgba(255,255,255,0.15)'); gr.addColorStop(0.6, 'rgba(170,150,90,0.12)'); gr.addColorStop(1, 'rgba(140,110,60,0.28)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(120,105,80,0.25)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, h * (0.45 + hash(seed, 1, 65) * 0.1)); g.lineTo(w, h * (0.45 + hash(seed, 2, 65) * 0.1)); g.stroke();
  for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(80,65,40,${0.08 + hash(k, seed, 67) * 0.12})`; g.fillRect(hash(k, seed, 69) * w, hash(seed, k, 71) * h, 1 + hash(k, k, 73) * 2, 1 + hash(k, seed, 75) * 2); }
  g.strokeStyle = 'rgba(60,50,30,0.35)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  g.fillStyle = 'rgba(214,208,186,0.85)'; for (const x of [6, w - 46]) { g.save(); g.translate(x + 20, 8); g.rotate((hash(seed, x, 77) - 0.5) * 0.6); g.fillRect(-22, -7, 44, 14); g.restore(); }
}
function cardboard(g, w, h, seed, hash) {
  g.fillStyle = '#b48a58'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 5) { g.fillStyle = `rgba(90,60,30,${0.05 + 0.04 * (y % 10 === 0)})`; g.fillRect(0, y, w, 2); }
  const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7); gr.addColorStop(0, 'rgba(255,240,210,0.12)'); gr.addColorStop(1, 'rgba(60,35,10,0.35)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(60,40,20,0.5)'; for (let x = 0; x < w; x += 6) g.fillRect(x, h - 3 - hash(x, seed, 79) * 4, 6, 8);   // the torn bottom edge
  g.fillStyle = 'rgba(214,208,186,0.8)'; g.fillRect(w / 2 - 25, 0, 50, 12);
}
const RED = '#c0201c', BLK = '#1a1a1a', BLU = '#1d3f9a', GRN = '#1f6a2c';
/** [name, w, h, draw(g, w, h, hash), see-through] */
function entries() {
  const pp = (lines, tone) => (g, w, h, H, s) => { paper(g, w, h, s, H, tone); const n = lines.length; lines.forEach(([t, c, sz], i) => hand(g, t, w / 2, h * (0.2 + 0.68 * (i + 0.5) / n), sz, c, s * 10 + i, H, w * 0.88)); };
  const cb = (lines) => (g, w, h, H, s) => { cardboard(g, w, h, s, H); const n = lines.length; lines.forEach(([t, c, sz], i) => hand(g, t, w / 2, h * (0.18 + 0.7 * (i + 0.5) / n), sz, c, s * 10 + i, H, w * 0.88)); };
  return [
    ['p_noloiter', 256, 200, pp([['NO', RED, 52], ['LOITERING', RED, 46], ['no soliciting', BLK, 26]])],
    ['p_ebt', 256, 180, pp([['WE TAKE', BLK, 34], ['EBT', BLU, 72]])],
    ['p_cash', 256, 220, pp([['CASH ONLY', BLK, 40], ['under $5', BLK, 26], ['EBT', GRN, 40], ['ACCEPTED', GRN, 30]], '#f6f0c8')],
    ['p_id', 256, 200, pp([['WE CARD', RED, 44], ['ID', BLK, 56], ['REQUIRED', BLK, 34]])],
    ['p_lotto', 256, 180, pp([['LOTTO', RED, 64], ['play here', BLU, 30]], '#fbf4d0')],
    ['p_atm', 256, 150, pp([['ATM', GRN, 66], ['INSIDE', BLK, 32]])],
    ['p_hours', 200, 240, pp([['OPEN', BLK, 40], ['7 DAYS', BLK, 32], ['7am-11pm', RED, 30]])],
    ['p_nochecks', 220, 150, pp([['NO CHECKS', RED, 34], ['NO CREDIT', BLK, 28], ['no exceptions', BLK, 20]])],
    ['p_nobags', 220, 150, pp([['NO BOOK', BLK, 34], ['BAGS', BLK, 40]], '#eaf0f4')],
    ['c_ice', 256, 200, cb([['ICE', BLK, 70], ['$2.99', RED, 52]])],
    ['c_2for5', 256, 200, cb([['2 FOR', BLK, 54], ['$5', RED, 76]])],
    ['c_wings', 300, 240, cb([['LEMON PEPPER', BLK, 34], ['WINGS', RED, 56], ['6 pc  $7.99', BLK, 34]])],
    ['c_99', 160, 120, cb([['99¢', RED, 64]])], ['c_129', 160, 120, cb([['$1.29', BLK, 50]])], ['c_2for3', 160, 120, cb([['2/$3', RED, 56]])],
    ['c_sale', 160, 120, cb([['SALE', RED, 54]])], ['c_noret', 200, 120, cb([['NO', BLK, 34], ['RETURNS', BLK, 32]])],
    ['neon', 384, 168, (g, w, h) => {   // the steady neon OPEN: tubes on a dark backing (the glow itself is the mesh's own light, steady)
      g.fillStyle = '#0c0c12'; g.fillRect(0, 0, w, h); g.lineCap = g.lineJoin = 'round';
      const tube = (fn, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; fn(); g.stroke(); };
      const rr = () => { g.beginPath(); g.roundRect ? g.roundRect(12, 12, w - 24, h - 24, 26) : g.rect(12, 12, w - 24, h - 24); };
      tube(rr, 'rgba(60,120,255,0.35)', 14); tube(rr, '#8fc0ff', 5);
      g.font = `bold 104px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(255,60,40,0.4)'; g.lineWidth = 16; g.strokeText('OPEN', w / 2, h / 2 + 4); g.strokeStyle = '#ff7a5c'; g.lineWidth = 6; g.strokeText('OPEN', w / 2, h / 2 + 4); g.strokeStyle = '#ffe2d6'; g.lineWidth = 2; g.strokeText('OPEN', w / 2, h / 2 + 4);
    }],
    ['cigs', 512, 256, (g, w, h, H) => {   // the cigarette wall: rows of generic packs, a price strip under each row
      g.fillStyle = '#16161a'; g.fillRect(0, 0, w, h); const cols = ['#e8e4da', '#c0201c', '#1d3f9a', '#2b7a3c', '#d8b23a', '#6b6b70', '#f0f0f0', '#5a2a6a'];
      for (let r = 0; r < 4; r++) { for (let c = 0; c < 14; c++) { const x = 6 + c * 36, y = 6 + r * 62, k = Math.floor(H(r, c, 81) * cols.length); g.fillStyle = cols[k]; g.fillRect(x, y, 30, 46); g.fillStyle = k === 0 || k === 6 ? cols[1 + (c % 3)] : '#f4f0e6'; g.fillRect(x, y + 10, 30, 10); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 26, y, 4, 46); }
        g.fillStyle = '#f4f0e6'; g.fillRect(0, 54 + r * 62, w, 8); }
    }],
    ['lotto', 512, 256, (g, w, h, H) => {   // the scratch-off case: rows of bright tickets under a smudged face
      g.fillStyle = '#20232a'; g.fillRect(0, 0, w, h); const cols = ['#f5c518', '#e8452c', '#2fa0e0', '#3fbf5a', '#c04ad0', '#ff8a2a', '#f06aa8'];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) { const x = 8 + c * 62, y = 10 + r * 80, k = Math.floor(H(r, c, 83) * cols.length); g.fillStyle = cols[k]; g.fillRect(x, y, 56, 70); g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(x + 6, y + 8, 44, 14); g.fillStyle = '#c8c8c8'; g.fillRect(x + 8, y + 34, 40, 26); g.fillStyle = 'rgba(0,0,0,0.6)'; g.font = `bold 16px ${FONT}`; g.textAlign = 'center'; g.fillText('$' + [1, 2, 5, 10, 20][(r + c) % 5], x + 28, y + 20); }
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 0, w, h * 0.3);
    }],
    ['photos', 384, 256, (g, w, h, H) => {   // photos and notes taped to the glass (no faces: snapshots of a cookout, a car, a sky)
      g.clearRect(0, 0, w, h); g.fillStyle = '#e9e4d6'; g.fillRect(0, 0, w, h);
      const snap = (x, y, r, k) => { g.save(); g.translate(x, y); g.rotate(r); g.fillStyle = '#f7f5ee'; g.fillRect(-46, -56, 92, 112); const sky = ['#7fb3d8', '#e9a46a', '#9bc48a'][k]; const gr = g.createLinearGradient(0, -48, 0, 30); gr.addColorStop(0, sky); gr.addColorStop(1, ['#3a5a2a', '#5a3a2a', '#2a3a5a'][k]); g.fillStyle = gr; g.fillRect(-40, -50, 80, 80); g.fillStyle = 'rgba(20,20,20,0.6)'; g.fillRect(-30 + k * 8, 0, 40 - k * 6, 18 + k * 4); g.fillStyle = 'rgba(214,208,186,0.85)'; g.fillRect(-15, -62, 30, 12); g.restore(); };
      snap(60, 120, -0.08, 0); snap(160, 110, 0.06, 1); snap(262, 128, -0.03, 2);
      g.save(); g.translate(330, 110); g.rotate(0.1); g.fillStyle = '#fbf3a0'; g.fillRect(-40, -50, 80, 100); hand(g, 'NO', 0, -22, 26, RED, 7, H); hand(g, 'CHECKS', 0, 8, 18, BLK, 8, H); g.restore();
    }],
    ['poster_old1', 256, 340, (g, w, h) => {   // sun-faded: the colours gone pale and blue-ish, a brown water mark at the bottom
      g.fillStyle = '#eee6d2'; g.fillRect(0, 0, w, h); g.fillStyle = '#b9a6c8'; g.fillRect(10, 10, w - 20, h - 20); g.fillStyle = '#e8e0f0'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `bold ${w * 0.17}px ${FONT}`; g.fillText('BILL PAY', w / 2, h * 0.3); g.font = `bold ${w * 0.1}px ${FONT}`; g.fillText('PHONE CARDS', w / 2, h * 0.48); g.fillText('MONEY ORDERS', w / 2, h * 0.6);
      const gr = g.createLinearGradient(0, h * 0.7, 0, h); gr.addColorStop(0, 'rgba(150,110,50,0)'); gr.addColorStop(1, 'rgba(150,110,50,0.45)'); g.fillStyle = gr; g.fillRect(0, h * 0.7, w, h * 0.3);
    }],
    ['poster_old2', 256, 340, (g, w, h) => {
      g.fillStyle = '#efe9da'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#9cc2d6'); gr.addColorStop(1, '#d8c8a8'); g.fillStyle = gr; g.fillRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#c9938a'; g.beginPath(); g.ellipse(w / 2, h * 0.58, w * 0.13, h * 0.26, 0, 0, 6.283); g.fill(); g.fillStyle = '#ead6d0'; g.fillRect(w / 2 - w * 0.07, h * 0.24, w * 0.14, h * 0.1);   // a generic bottle shape
      g.fillStyle = '#f4efe6'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${w * 0.15}px ${FONT}`; g.fillText('ICE COLD', w / 2, h * 0.14); g.font = `bold ${w * 0.08}px ${FONT}`; g.fillText('2 FOR $3', w / 2, h * 0.92);
    }],
    ['cooler_decal', 512, 96, (g, w, h) => {   // a supplier's strip on the cooler, faded
      g.fillStyle = '#a83a32'; g.fillRect(0, 0, w, h); g.fillStyle = '#d9c9b0'; g.fillRect(0, h * 0.72, w, h * 0.12); g.fillStyle = '#efe4d6'; g.font = `bold ${h * 0.5}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ICE COLD  •  STAY COOL', w / 2, h * 0.4);
      g.fillStyle = 'rgba(240,235,225,0.25)'; g.fillRect(0, 0, w, h);
    }],
    ['wetfloor', 128, 240, (g, w, h) => {
      g.fillStyle = '#f0c419'; g.fillRect(0, 0, w, h); g.fillStyle = '#1a1a1a'; g.font = `bold 22px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CAUTION', w / 2, 26);
      g.beginPath(); g.moveTo(w / 2, 60); g.lineTo(w / 2 + 40, 130); g.lineTo(w / 2 - 40, 130); g.closePath(); g.lineWidth = 6; g.stroke();
      g.beginPath(); g.arc(w / 2 + 2, 86, 6, 0, 6.283); g.fill(); g.fillRect(w / 2 - 4, 94, 6, 18); g.fillRect(w / 2 - 16, 112, 30, 4);
      g.font = `bold 20px ${FONT}`; g.fillText('WET', w / 2, 168); g.fillText('FLOOR', w / 2, 194);
      g.fillStyle = 'rgba(60,50,20,0.3)'; g.fillRect(0, h - 30, w, 30);
    }],
    // ---- see-through (drawn on a clear background)
    ['plexi', 256, 256, (g, w, h, H) => {   // scratched, smudged plexi: a faint milky fill, fine pale scratches, a hand-greased patch round the cut-out
      g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(205,215,205,0.16)'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(20,22,24,0.5)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
      for (let k = 0; k < 160; k++) { const x = H(k, 1, 85) * w, y = H(k, 2, 85) * h, a = (H(k, 3, 85) < 0.7 ? 0.15 : 1.4) + (H(k, 4, 85) - 0.5) * 0.6, l = 6 + H(k, 5, 85) * 50; g.strokeStyle = `rgba(235,240,235,${0.12 + H(k, 6, 85) * 0.25})`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
      const gr = g.createRadialGradient(w / 2, h * 0.9, 8, w / 2, h * 0.9, w * 0.5); gr.addColorStop(0, 'rgba(210,205,180,0.32)'); gr.addColorStop(1, 'rgba(210,205,180,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, true],
    ['fog', 256, 256, (g, w, h, H) => {   // fogged cooler glass: a frosted band low down, drips, finger streaks
      g.clearRect(0, 0, w, h); let gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(225,232,228,0.03)'); gr.addColorStop(0.55, 'rgba(225,232,228,0.1)'); gr.addColorStop(1, 'rgba(225,232,228,0.26)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 18; k++) { const x = H(k, 1, 87) * w, y0 = h * (0.45 + H(k, 2, 87) * 0.4), l = 20 + H(k, 3, 87) * 60; g.fillStyle = 'rgba(40,50,48,0.14)'; g.fillRect(x, y0, 2, l); }
      for (let k = 0; k < 5; k++) { const x = H(k, 4, 87) * w; gr = g.createLinearGradient(x - 14, 0, x + 14, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(60,70,66,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 14, h * 0.4, 28, h * 0.6); }
    }, true],
    ['vinyl1', 384, 160, (g, w, h) => { g.clearRect(0, 0, w, h); g.globalAlpha = 0.55; g.fillStyle = '#c84a3c'; g.beginPath(); g.arc(70, h / 2, 56, 0, 6.283); g.fill(); g.fillStyle = '#f2ece0'; g.font = `bold 34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ICE', 70, h / 2 - 12); g.font = `bold 20px ${FONT}`; g.fillText('COLD', 70, h / 2 + 18);
      g.fillStyle = '#e8e2d2'; g.font = `bold 30px ${FONT}`; g.textAlign = 'left'; g.fillText('DRINKS • SNACKS', 136, h / 2 - 14); g.font = `bold 22px ${FONT}`; g.fillText('CANDY • GROCERY', 138, h / 2 + 20); g.globalAlpha = 1;
      for (let k = 0; k < 40; k++) g.clearRect(H0(k, 1) * w, H0(k, 2) * h, 3 + H0(k, 3) * 10, 2 + H0(k, 4) * 5); }, true],   // the vinyl flaking off
    ['vinyl2', 384, 160, (g, w, h) => { g.clearRect(0, 0, w, h); g.globalAlpha = 0.5; g.fillStyle = '#e9e3d0'; g.font = `bold 40px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('WE ACCEPT', w / 2, h * 0.32); g.fillStyle = '#4a7ad0'; g.font = `bold 56px ${FONT}`; g.fillText('EBT • WIC', w / 2, h * 0.7); g.globalAlpha = 1;
      for (let k = 0; k < 50; k++) g.clearRect(H0(k, 5) * w, H0(k, 6) * h, 3 + H0(k, 7) * 9, 2 + H0(k, 8) * 4); }, true],
    ['puddle', 256, 256, (g, w, h) => {   // a dull, drying puddle: dark, a darker rim, a few splash dots
      g.clearRect(0, 0, w, h); g.beginPath(); for (let a = 0; a <= 6.3; a += 0.15) { const r = 92 + 18 * Math.sin(a * 3 + 1) + 10 * Math.sin(a * 7); g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r * 0.8); } g.closePath();
      g.fillStyle = 'rgba(22,24,22,0.34)'; g.fill(); g.strokeStyle = 'rgba(30,26,18,0.4)'; g.lineWidth = 6; g.stroke();
      for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(22,24,22,0.3)'; g.beginPath(); g.arc(w / 2 + (H0(k, 9) - 0.5) * w * 0.95, h / 2 + (H0(k, 10) - 0.5) * h * 0.9, 2 + H0(k, 11) * 5, 0, 6.283); g.fill(); }
    }, true],
  ];
}
let H0 = () => 0;
/** the ATL sign canvas: 2048 x 1536, packed in rows. Returns { canvas, cell(name) -> [u0, v0, u1, v1], white: [u, v] } */
export function atlCanvas(hash) {
  H0 = (a, b) => hash(a, b, 89);
  const N = 2048, M = 1536, c = document.createElement('canvas'); c.width = N; c.height = M; const g = c.getContext('2d'), rects = {}, PAD = 6;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 32); rects.white = [0, 0, 32, 32]; let x = 32 + PAD, y = 0, rowH = 32, s = 1;
  for (const [name, w, h, draw] of entries().sort((a, b) => b[2] - a[2])) {   // tallest first: shelf packing
    if (x + w > N) { x = 0; y += rowH + PAD; rowH = 0; } if (y + h > M) throw new Error('atl atlas full at ' + name);
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, w, h, hash, s++); g.restore();
    rects[name] = [x, y, w, h]; x += w + PAD; rowH = Math.max(rowH, h);
  }
  const cell = (n) => { const r = rects[n]; if (!r) throw new Error('atl decal ' + n); const e = 0.5; return [(r[0] + e) / N, 1 - (r[1] + r[3] - e) / M, (r[0] + r[2] - e) / N, 1 - (r[1] + e) / M]; };
  return { canvas: c, cell, white: [16 / N, 1 - 16 / M] };
}
/** names of the see-through entries (they go on the second, transparent mesh) */
export const SEE_THROUGH = new Set(['plexi', 'fog', 'vinyl1', 'vinyl2', 'puddle']);

/**
 * Where every ATL sign goes: [{ name, kind: 'v' (upright, facing the camera, +z) | 'f' (flat on the floor), x, y, z, w, h, rot, curl, glow }].
 * x, y the centre (for 'f', y is the height and h the depth along z). rot: radians in its own plane; curl: how far one corner lifts (m).
 */
export function atlPlacements(info, hash) {
  const A = info.atl, out = [], h = (a, b, s) => hash(a, b, 950 + s);
  if (!A || !ATL.dress) return out;
  const v = (name, x, y, z, w, ht, rot = 0, curl = 0, glow = 0) => out.push({ name, kind: 'v', x, y, z, w, h: ht, rot, curl, glow });
  // checkouts
  const CS = [['p_cash', 'p_noloiter'], ['p_lotto', 'p_cash'], ['p_id', 'p_cash']];
  A.counters.forEach((c, i) => {
    const { x0, x1, z1, top, gx0, gx1, zg, gy1, hx0, hx1, hy1 } = c, zf = z1 + 0.016;
    v(CS[i % 3][0], x0 + 0.75 + h(i, 1, 1) * 0.3, 0.55, zf, 0.42, CS[i % 3][0] === 'p_cash' ? 0.36 : 0.33, (h(i, 2, 1) - 0.5) * 0.12, 0.02);
    v(CS[i % 3][1], x0 + 2.0 + h(i, 3, 1) * 0.4, 0.5, zf, 0.4, 0.33, (h(i, 4, 1) - 0.5) * 0.14, 0.015);
    v('plexi', (gx0 + gx1) / 2, (top + gy1) / 2, zg + 0.009, gx1 - gx0, gy1 - top);
    v('photos', hx1 + 0.3, top + 0.42, zg + 0.011, 0.5, 0.33, (h(i, 5, 1) - 0.5) * 0.06);
    v(i === 1 ? 'p_nochecks' : 'p_id', (gx0 + hx0) / 2, top + 0.45, zg + 0.011, 0.34, 0.24, (h(i, 6, 1) - 0.5) * 0.1, 0.012);
    v('p_ebt', (hx0 + hx1) / 2, hy1 + 0.22, zg + 0.011, 0.3, 0.21, (h(i, 7, 1) - 0.5) * 0.1, 0.01);
    v('cigs', x1 - 0.38, top + 0.24, c.z0 + 0.6 + 0.004, 0.5, 0.44);
    { const lz = z1 - 0.14, ly = top + 0.12; out.push({ name: 'lotto', kind: 'v', x: gx0 - 0.305, y: ly, z: lz + 0.004, w: 0.47, h: 0.22, rot: 0, curl: 0, glow: 0.25, tiltX: -0.12, pivot: [gx0 - 0.3, top, z1 - 0.32] }); }
  });
  // storefront: paper and cardboard on the glass (outside face), faded vinyl, the neon behind the glass
  const ez = info.storefront.z, zo = ez + 0.014, sf = info.storefront;
  const glassSigns = [['p_noloiter', 1.25, 1.55, 0.5, 0.39], ['c_wings', 0.95, 0.85, 0.55, 0.44], ['c_2for5', 2.2, 1.0, 0.5, 0.39], ['p_ebt', 3.25, 1.62, 0.5, 0.35], ['p_atm', 4.25, 1.2, 0.46, 0.27],
    ['p_lotto', 14.45, 1.6, 0.5, 0.35], ['c_ice', 15.55, 1.0, 0.5, 0.39], ['p_id', 16.55, 1.6, 0.48, 0.38], ['p_hours', 13.0, 0.95, 0.36, 0.43], ['p_cash', 17.0, 0.9, 0.4, 0.34]];
  glassSigns.forEach(([n, x, y, w, ht], i) => v(n, x, y, zo, w, ht, (h(i, 8, 2) - 0.5) * 0.12, 0.02 + h(i, 9, 2) * 0.02));
  v('vinyl1', 2.7, 2.08, zo - 0.002, 1.05, 0.44); v('vinyl2', 15.6, 2.08, zo - 0.002, 1.05, 0.44);
  v('p_ebt', sf.ex0 + 0.7, 1.45, ez - 0.14 + 0.012, 0.36, 0.25, 0.05, 0.015); v('p_noloiter', sf.ex1 - 0.7, 1.45, ez - 0.14 + 0.012, 0.36, 0.28, -0.04, 0.015);
  v('neon', A.neon.x, A.neon.y, ez - 0.073, A.neon.w, A.neon.h, 0, 0, 1.6);
  // the wet-floor sign's two faces and the puddle on the sidewalk
  if (A.wet) { const { x, z, lean, foot, yaw } = A.wet, zf = z + foot; out.push({ name: 'wetfloor', kind: 'v', x, y: 0.31, z: zf + 0.0095, w: 0.28, h: 0.56, rot: 0, curl: 0, glow: 0, tiltX: -lean, tiltY: yaw, pivot: [x, 0, zf] }); }
  out.push({ name: 'puddle', kind: 'f', x: 12.7, y: 0.004, z: ez + 0.95, w: 1.5, h: 0.95, rot: 0.2 });
  // coolers: a supplier strip on the kick trim; the frozen doors fogged and stickered
  for (const u of info.units || []) {
    if (u.kind === 'cooler') { v('cooler_decal', u.x0 + 1.0 + h(idn(u.id), 1, 3) * 0.4, 0.27, u.z1 + 0.012, 1.1, 0.13, (h(idn(u.id), 2, 3) - 0.5) * 0.03); v('cooler_decal', u.x1 - 1.0, 0.27, u.z1 + 0.012, 1.1, 0.13, 0.01); }
    if (u.id === 'frozen') { const n = 4, w = (u.x1 - u.x0 - 0.14) / n; for (let k = 0; k < n; k++) v('fog', u.x0 + 0.07 + w * (k + 0.5), 1.12, u.z1 + 0.036, w, 1.5, 0); v('vinyl1', u.x0 + 1.2, 1.55, u.z1 + 0.037, 0.8, 0.33); }
    // cardboard price signs taped to the shelf fronts
    if (u.kind === 'gondola' && u.levels.length) for (let k = 0; k < 3; k++) {
      const L = k % u.levels.length, t = h(idn(u.id), k, 4), x = u.sx0 + 0.35 + t * (u.sx1 - u.sx0 - 0.7), sag = u.sags[L] * 4 * ((x - u.sx0) / (u.sx1 - u.sx0)) * (1 - (x - u.sx0) / (u.sx1 - u.sx0));
      if (h(idn(u.id), k, 5) < 0.25) continue;
      const nm = ['c_99', 'c_129', 'c_2for3', 'c_sale', 'c_noret'][Math.floor(h(idn(u.id), k, 6) * 5)];
      v(nm, x, u.levels[L] - sag - 0.15, u.fronts[L] + 0.03, nm === 'c_noret' ? 0.36 : 0.3, 0.2, (h(idn(u.id), k, 7) - 0.5) * 0.3, 0.012);
    }
  }
  // the north wall: two sun-faded posters curling off the wall, a paper sign
  const zw = 100 / 48 + 0.014;
  v('poster_old1', 2.5, 1.45, zw, 0.5, 0.66, -0.05, 0.07); v('poster_old2', 6.7, 1.5, zw, 0.5, 0.66, 0.06, 0.06); v('p_nobags', 4.7, 1.55, zw, 0.4, 0.27, 0.08, 0.02);
  return out;
}

/** write the placements into GeoBuf-like buffers: opaque into `op`, see-through into `tr` (sheet: a 4 x 4 grid, so a corner can curl) */
export function writePlacements(list, cell, op, tr) {
  const col = new THREE.Color(1, 1, 1), M4 = new THREE.Matrix4(), vv = new THREE.Vector3(), nn = new THREE.Vector3();
  for (const p of list) {
    const c = cell(p.name), buf = SEE_THROUGH.has(p.name) ? tr : op, rm = [0.85, 0, p.glow || 0], n = 4;
    if (p.kind === 'f') {
      const cs = Math.cos(p.rot || 0), sn = Math.sin(p.rot || 0), at = (u, w) => { const lx = (u - 0.5) * p.w, lz = (0.5 - w) * p.h; return [p.x + lx * cs - lz * sn, p.y, p.z + lx * sn + lz * cs]; };
      buf.quad(at(0, 0), at(1, 0), at(1, 1), at(0, 1), [0, 1, 0], [[c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]], col, rm); continue;
    }
    const cs = Math.cos(p.rot || 0), sn = Math.sin(p.rot || 0);
    if (p.pivot) M4.makeRotationFromEuler(new THREE.Euler(p.tiltX || 0, p.tiltY || 0, 0)); else M4.identity();
    const at = (u, w) => {
      const lx = (u - 0.5) * p.w, ly = (w - 0.5) * p.h, t = Math.max(0, u + w - 1.35) / 0.65;   // the top-right corner lifts off
      vv.set(p.x + lx * cs - ly * sn, p.y + lx * sn + ly * cs, p.z + (p.curl || 0) * t * t);
      if (p.pivot) { vv.sub(nn.set(...p.pivot)).applyMatrix4(M4).add(nn); }
      return [vv.x, vv.y, vv.z];
    };
    const nrm = p.pivot ? nn.set(0, 0, 1).applyMatrix4(M4).toArray() : [0, 0, 1];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, w0 = j / n, w1 = (j + 1) / n, U = (u) => c[0] + u * (c[2] - c[0]), V = (w) => c[1] + w * (c[3] - c[1]);
      buf.quad(at(u0, w0), at(u1, w0), at(u1, w1), at(u0, w1), nrm, [[U(u0), V(w0)], [U(u1), V(w0)], [U(u1), V(w1)], [U(u0), V(w1)]], col, rm);
    }
  }
}

/** the ATL grade, spliced into the store's own copy of the final pass (store3d.js) before the dither line; on display values */
export const ATL_GRADE = `
    { vec3 c = gl_FragColor.rgb * uAtlTint;
      float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, uAtlFog, uAtl.y * (0.55 + 0.45 * (1.0 - L)));                 // a dull, foggy veil, thicker in the darks
      c = uAtl.x + c * (1.0 - uAtl.x);                                          // the blacks lifted: low contrast, like film
      vec2 q = (vUv - 0.5) * vec2(1.0, 0.85); c *= 1.0 - uAtl.z * smoothstep(0.22, 0.78, length(q));   // a soft vignette
      float gn = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);       // static grain: fixed to the pixel, never changes over time
      c += (gn - 0.5) * uAtl.w;
      gl_FragColor.rgb = clamp(c, 0.0, 1.0); }
`;

/**
 * Age a board drawn on the store's decal canvas (store3d.js buildDecals, ATL look only): the colour sun-faded and yellowed, a grimy top edge,
 * a brown water run from one corner, scuffs and a few chips to the backing. The lettering stays readable (nothing covers its middle heavily).
 */
export function ageBoard(g, w, h, seed, hash, k = ATL.signAge) {
  if (!(k > 0)) return;
  g.save(); g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(214,196,150,${0.3 * k})`; g.fillRect(0, 0, w, h);   // faded toward a dusty cream
  let gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, `rgba(40,32,18,${0.42 * k})`); gr.addColorStop(0.25, 'rgba(40,32,18,0)'); gr.addColorStop(0.85, 'rgba(40,32,18,0)'); gr.addColorStop(1, `rgba(40,32,18,${0.3 * k})`); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const cx = hash(seed, 1, 101) < 0.5 ? w * 0.08 : w * 0.92; gr = g.createRadialGradient(cx, 0, 2, cx, 0, h * 1.3); gr.addColorStop(0, `rgba(100,70,30,${0.45 * k})`); gr.addColorStop(1, 'rgba(100,70,30,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) { const x = hash(seed, i, 103) * w, y = hash(i, seed, 105) * h, l = 6 + hash(i, i + seed, 107) * w * 0.08; g.strokeStyle = `rgba(250,245,230,${0.18 * k})`; g.lineWidth = 1 + hash(i, 3, 109) * 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (hash(i, 4, 109) - 0.5) * 6); g.stroke(); }
  for (let i = 0; i < 6; i++) { const edge = hash(seed, i, 111) < 0.5, x = edge ? hash(i, seed, 113) * w : (hash(i, seed, 113) < 0.5 ? 0 : w), y = edge ? (hash(i, 7, 115) < 0.5 ? 0 : h) : hash(i, seed, 117) * h, r = 3 + hash(i, 8, 119) * 9;
    g.fillStyle = `rgba(30,26,22,${0.8 * k})`; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); }   // chips knocked off the edges
  g.restore();
}
