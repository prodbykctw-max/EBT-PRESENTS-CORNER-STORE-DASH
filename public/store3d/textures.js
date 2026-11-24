// Every texture of the store interior is drawn here, in the page, from code: no downloaded art, no brands. (The only image files the
// store reuses are the drive's own tex/real/conc_*.webp, CC0, credits in public/drive/tex/CREDITS.txt.)
import * as THREE from '../drive/vendor/three.module.min.js';

const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const hash = (a, b, s = 0) => { let h = (a * 374761393 + b * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export { hash };
export function tex(canvas, { srgb = true, repeat = false, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

/** the tile's own colour: the warm sand of the first 3D store the owner was shown (Nov 24 2026: he asked for that pastel look back; from Nov 17 to
 *  then it was a pinker cream, [226, 206, 194], with greyer flecks and grout and white light pools) */
export const FLOOR_RGB = [206, 188, 158];
/** cream floor tiles: 4 x 4 tiles per canvas (0.6 m each). Returns { map, normalMap, roughnessMap } (tileable). accent: gold / rose inlay tiles. */
export function floorTextures(aniso) {
  const N = 512, T = N / 4, c = cv(N, N), g = c.getContext('2d'), hmap = new Float32Array(N * N), rough = cv(N, N), rg = rough.getContext('2d');
  const accent = (i, j) => { const r = hash(i, j, 7); return r < 0.075 ? 'gold' : r < 0.125 ? 'rose' : null; };
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const v = hash(i, j, 1), a = accent(i, j);
    let base = a === 'gold' ? [226, 170, 52] : a === 'rose' ? [214, 112, 150] : [FLOOR_RGB[0] + v * 8 - 4, FLOOR_RGB[1] + v * 8 - 4, FLOOR_RGB[2] + v * 8 - 4];
    g.fillStyle = `rgb(${base.map(Math.round).join(',')})`; g.fillRect(i * T, j * T, T, T);
    // terrazzo flecks
    for (let k = 0; k < 90; k++) { const x = i * T + hash(i * 100 + k, j, 3) * T, y = j * T + hash(i, j * 100 + k, 4) * T, r = 0.6 + hash(k, i + j, 5) * 1.5, tone = hash(k, j, 6);
      g.fillStyle = tone < 0.5 ? 'rgba(150,120,90,0.22)' : tone < 0.8 ? 'rgba(255,255,255,0.35)' : 'rgba(110,90,80,0.2)'; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); }
    // soft wear
    const gr = g.createRadialGradient(i * T + T / 2, j * T + T / 2, T * 0.1, i * T + T / 2, j * T + T / 2, T * 0.75); gr.addColorStop(0, 'rgba(255,250,240,0.10)'); gr.addColorStop(1, 'rgba(120,100,70,0.10)'); g.fillStyle = gr; g.fillRect(i * T, j * T, T, T);
  }
  // grout: 3 px, darker, with a bevelled height profile
  g.fillStyle = 'rgba(150,132,104,0.95)';
  for (let k = 0; k < 4; k++) { g.fillRect(k * T - 1.5, 0, 3, N); g.fillRect(0, k * T - 1.5, N, 3); }
  g.fillRect(N - 1.5, 0, 1.5, N); g.fillRect(0, N - 1.5, N, 1.5);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = Math.min(x % T, T - (x % T)), dy = Math.min(y % T, T - (y % T)), d = Math.min(dx, dy); hmap[y * N + x] = Math.min(1, d / 5); }
  rg.fillStyle = 'rgb(66,66,66)'; rg.fillRect(0, 0, N, N);   // polished tile (roughness ~0.26)
  rg.fillStyle = 'rgb(214,214,214)'; for (let k = 0; k < 4; k++) { rg.fillRect(k * T - 2, 0, 4, N); rg.fillRect(0, k * T - 2, N, 4); }
  const nc = cv(N, N), ng = nc.getContext('2d'), img = ng.createImageData(N, N), S = 2.2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = (xx, yy) => hmap[((yy + N) % N) * N + ((xx + N) % N)], dx = (h(x + 1, y) - h(x - 1, y)) * S, dy = (h(x, y + 1) - h(x, y - 1)) * S, l = Math.hypot(dx, dy, 1), o = (y * N + x) * 4;
    img.data[o] = (-dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  ng.putImageData(img, 0, 0);
  return { map: tex(c, { repeat: true, aniso }), normalMap: tex(nc, { srgb: false, repeat: true, aniso }), roughnessMap: tex(rough, { srgb: false, repeat: true, aniso }) };
}

const FONT = '"Arial Black","Helvetica Neue",Impact,"DejaVu Sans",sans-serif';
/** a header sign: the store's pink with white lettering and a gold rule */
export function drawSign(g, w, h, text) {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f06aa8'); gr.addColorStop(0.55, '#d4306f'); gr.addColorStop(1, '#a81c55'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(0, 0, w, 5);
  g.fillStyle = '#f5c518'; g.fillRect(0, h - 9, w, 5); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 4, w, 4);
  let fs = h * 0.56; g.font = `bold ${fs}px ${FONT}`; while (g.measureText(text).width > w * 0.86) { fs -= 2; g.font = `bold ${fs}px ${FONT}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(70,0,30,0.45)'; g.fillText(text, w / 2 + 2, h * 0.47 + 3); g.fillStyle = '#fff'; g.fillText(text, w / 2, h * 0.47);
}
/** a plain painted label (exit door sign, welcome mat, entrance mat, wall signs) */
export function drawPlate(g, w, h, text, { bg = '#b3202a', fg = '#fff', border = '#f5c518', font } = {}) {
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = border; g.lineWidth = Math.max(4, h * 0.06); g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
  let fs = h * 0.5; g.font = `bold ${fs}px ${font || FONT}`; while (g.measureText(text).width > w * 0.8) { fs -= 2; g.font = `bold ${fs}px ${font || FONT}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; g.fillText(text, w / 2, h * 0.53);
}
/** a small wall poster */
export function drawPoster(g, w, h, kind) {
  const P = { sale: ['#d4306f', '#fff', 'SALE', 'FRESH DEALS'], fresh: ['#2e7d3a', '#fff', 'FRESH', 'FARM TO CART'], eat: ['#25306a', '#f5c518', 'EBT', 'WELCOME HERE'], cold: ['#1f6fb8', '#fff', 'ICE COLD', 'DRINKS'] }[kind];
  g.fillStyle = '#f7f1e2'; g.fillRect(0, 0, w, h); g.fillStyle = P[0]; g.fillRect(10, 10, w - 20, h - 20); g.strokeStyle = '#f5c518'; g.lineWidth = 6; g.strokeRect(18, 18, w - 36, h - 36);
  g.fillStyle = P[1]; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${w * 0.26}px ${FONT}`; g.fillText(P[2], w / 2, h * 0.38); g.font = `bold ${w * 0.1}px ${FONT}`; g.fillText(P[3], w / 2, h * 0.58);
  g.fillStyle = '#f5c518'; g.beginPath(); g.arc(w / 2, h * 0.8, w * 0.12, 0, 6.283); g.fill(); g.fillStyle = P[0]; g.font = `bold ${w * 0.13}px ${FONT}`; g.fillText('$', w / 2, h * 0.805);
}
export function signTexture(text, w = 768, h = 112) { const c = cv(w, h); drawSign(c.getContext('2d'), w, h, text); return tex(c, { aniso: 8 }); }
export function plateTexture(text, o = {}) { const w = o.w || 512, h = o.h || 128, c = cv(w, h); drawPlate(c.getContext('2d'), w, h, text, o); return tex(c, { aniso: 8 }); }
export function posterTexture(kind, w = 256, h = 340) { const c = cv(w, h); drawPoster(c.getContext('2d'), w, h, kind); return tex(c, { aniso: 8 }); }
/**
 * Every sign, plate, poster and mat of the store on ONE canvas (2048 x 2048), so they are all one mesh and one draw call.
 * entries: [{ name, w, h, draw(g, w, h) }]. Returns { map, cell(name) -> [u0, v0, u1, v1], white: [u, v] (a plain white cell) }
 */
export function decalAtlas(entries, aniso = 8) {
  const N = 2048, c = cv(N, N), g = c.getContext('2d'), rects = {}; let x = 0, y = 0, rowH = 0; const PAD = 4;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 32); rects.white = [0, 0, 32, 32]; x = 32 + PAD; rowH = 32;
  for (const e of entries) {
    if (x + e.w > N) { x = 0; y += rowH + PAD; rowH = 0; }
    if (y + e.h > N) throw new Error('decal atlas full at ' + e.name);
    g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, e.w, e.h); g.clip(); e.draw(g, e.w, e.h); g.restore();
    rects[e.name] = [x, y, e.w, e.h]; x += e.w + PAD; rowH = Math.max(rowH, e.h);
  }
  const cell = (n) => { const r = rects[n]; if (!r) throw new Error('decal ' + n); const e = 0.5; return [(r[0] + e) / N, 1 - (r[1] + r[3] - e) / N, (r[0] + r[2] - e) / N, 1 - (r[1] + e) / N]; };
  return { map: tex(c, { aniso }), cell, white: [16 / N, 1 - 16 / N], canvas: c };
}

/** the label atlas for products: 8 x 8 cells of 128 px. Cell 0 is plain white (the parts that carry no label). Returns { map, cell(name) -> [u0,v0,u1,v1] } */
export function labelAtlas(aniso) {
  const N = 1024, K = 8, C = N / K, c = cv(N, N), g = c.getContext('2d'), names = ['white'], rects = {};
  const add = (name, draw) => { const i = names.length; names.push(name); const x = (i % K) * C, y = Math.floor(i / K) * C; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, C, C); g.clip(); draw(g, C); g.restore(); };
  g.fillStyle = '#fff'; g.fillRect(0, 0, C, C);
  const band = (g, s, col, y0, y1) => { g.fillStyle = col; g.fillRect(0, y0 * s, s, (y1 - y0) * s); };
  const txt = (g, s, t, y, size, col = '#fff', stroke) => { g.font = `bold ${size * s}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; if (stroke) { g.strokeStyle = stroke; g.lineWidth = size * s * 0.14; g.strokeText(t, s / 2, y * s); } g.fillStyle = col; g.fillText(t, s / 2, y * s); };
  const tile = (name, bg, bands, lines) => add(name, (g, s) => { g.fillStyle = bg; g.fillRect(0, 0, s, s); for (const b of bands) band(g, s, b[0], b[1], b[2]); for (const l of lines) txt(g, s, ...l); });
  tile('milk', '#f4f8ff', [['#2f6fd6', 0.0, 0.34], ['#2f6fd6', 0.8, 1]], [['MILK', 0.54, 0.26, '#1c4fa8'], ['WHOLE', 0.17, 0.15], ['gallon', 0.9, 0.11]]);
  tile('milk2', '#f7f3f2', [['#d6402f', 0.0, 0.34], ['#d6402f', 0.8, 1]], [['MILK', 0.54, 0.26, '#a82a1c'], ['2%', 0.17, 0.2], ['gallon', 0.9, 0.11]]);
  tile('carton', '#ffffff', [['#e5d24a', 0.0, 0.3], ['#3a8de0', 0.78, 1]], [['FARM', 0.5, 0.2, '#25528f'], ['FRESH', 0.64, 0.14, '#2a7bc4'], ['dairy', 0.16, 0.14, '#6b5a10']]);
  tile('rice', '#f4d27a', [['#b8821f', 0.0, 0.22], ['#b8821f', 0.84, 1]], [['RICE', 0.5, 0.3, '#7a4a0c'], ['LONG GRAIN', 0.12, 0.1], ['5 lb', 0.92, 0.11]]);
  tile('rice2', '#f0e9d6', [['#3f8f4a', 0.0, 0.22], ['#3f8f4a', 0.84, 1]], [['JASMINE', 0.5, 0.17, '#2b6a35'], ['RICE', 0.7, 0.2, '#2b6a35'], ['2 lb', 0.92, 0.11]]);
  tile('beans', '#b3322b', [['#f0c33c', 0.4, 0.62]], [['BEANS', 0.5, 0.2, '#6a1a15'], ['RED', 0.22, 0.16], ['15 oz', 0.84, 0.12]]);
  tile('beans2', '#3d8c4f', [['#f0e6c0', 0.4, 0.62]], [['BLACK', 0.22, 0.15], ['BEANS', 0.5, 0.2, '#1f4b2a'], ['15 oz', 0.84, 0.12]]);
  tile('bread', '#e9b35a', [['#c1272d', 0.32, 0.66]], [['BAKERY', 0.17, 0.14, '#6a3c0a'], ['WHEAT', 0.5, 0.2], ['LOAF', 0.84, 0.15, '#6a3c0a']]);
  tile('bread2', '#f4e6c2', [['#2f6fd6', 0.32, 0.66]], [['SOFT', 0.17, 0.14, '#6a5a2a'], ['WHITE', 0.5, 0.2], ['BREAD', 0.84, 0.15, '#6a5a2a']]);
  tile('juice', '#f7b24a', [['#fff', 0.34, 0.7]], [['JUICE', 0.52, 0.2, '#b2550a'], ['100%', 0.2, 0.14, '#fff'], ['12 oz', 0.86, 0.11]]);
  tile('juice2', '#7b4aa8', [['#fff', 0.34, 0.7]], [['GRAPE', 0.52, 0.19, '#4a2470'], ['juice', 0.2, 0.14, '#fff'], ['12 oz', 0.86, 0.11]]);
  tile('juice3', '#4f9f45', [['#fff', 0.34, 0.7]], [['LIME', 0.52, 0.2, '#2c6a25'], ['juice', 0.2, 0.14, '#fff'], ['12 oz', 0.86, 0.11]]);
  tile('lemonade', '#f6d83a', [['#fff', 0.34, 0.7]], [['LEMON', 0.46, 0.18, '#9a7a00'], ['ADE', 0.62, 0.16, '#9a7a00'], ['12 oz', 0.86, 0.11]]);
  tile('chips', '#e8a42b', [['#c1272d', 0.0, 0.2], ['#c1272d', 0.82, 1]], [['CRUNCH', 0.4, 0.19, '#fff', '#7a1a1a'], ['CHIPS', 0.6, 0.2, '#fff', '#7a1a1a'], ['classic', 0.1, 0.11]]);
  tile('chips2', '#6d3aa6', [['#f5c518', 0.0, 0.2], ['#f5c518', 0.82, 1]], [['SPICY', 0.4, 0.19, '#fff', '#2f1050'], ['CHIPS', 0.6, 0.2, '#fff', '#2f1050'], ['corn', 0.1, 0.11, '#4a3a00']]);
  tile('chips3', '#cf3b36', [['#fff', 0.0, 0.2], ['#fff', 0.82, 1]], [['SALTY', 0.4, 0.19, '#fff', '#6a1410'], ['CRISPS', 0.6, 0.2, '#fff', '#6a1410'], ['party', 0.1, 0.11, '#a22']]);
  tile('meat', '#f3f3ef', [['#c1272d', 0.0, 0.16]], [['FRESH', 0.08, 0.12], ['LEAN', 0.9, 0.12, '#a22']]);
  tile('soda', '#2f8f4a', [['#fff', 0.4, 0.62]], [['SODA', 0.51, 0.18, '#1d5a2c'], ['2 L', 0.84, 0.14]]);
  tile('soda2', '#c1272d', [['#fff', 0.4, 0.62]], [['COLA', 0.51, 0.18, '#8a1a1f'], ['2 L', 0.84, 0.14]]);
  tile('soda3', '#3a6ed6', [['#fff', 0.4, 0.62]], [['BLUE', 0.51, 0.18, '#1e408f'], ['2 L', 0.84, 0.14]]);
  tile('soda4', '#e8892a', [['#fff', 0.4, 0.62]], [['ORANGE', 0.51, 0.15, '#9a540c'], ['2 L', 0.84, 0.14]]);
  tile('soda5', '#7b4aa8', [['#fff', 0.4, 0.62]], [['GRAPE', 0.51, 0.17, '#4a2470'], ['2 L', 0.84, 0.14]]);
  tile('soap', '#3a9ee0', [['#fff', 0.4, 0.66]], [['CLEAN', 0.52, 0.18, '#1a5c92'], ['WASH', 0.2, 0.14], ['64 oz', 0.86, 0.11]]);
  tile('soap2', '#f08a2a', [['#fff', 0.4, 0.66]], [['BRIGHT', 0.52, 0.16, '#9a4a0a'], ['SOAP', 0.2, 0.14], ['48 oz', 0.86, 0.11]]);
  tile('tissue', '#e9f2fb', [['#5aa6e6', 0.0, 0.3]], [['SOFT', 0.52, 0.2, '#2a6aa6'], ['TISSUE', 0.16, 0.15], ['12 roll', 0.86, 0.11, '#2a6aa6']]);
  tile('frozen', '#f1f6fb', [['#2f6fd6', 0.0, 0.22]], [['FROZEN', 0.11, 0.14], ['MEAL', 0.55, 0.22, '#1c4fa8'], ['ready in 5 min', 0.86, 0.09, '#456']]);
  tile('frozen2', '#fff4e0', [['#d6402f', 0.0, 0.22]], [['FROZEN', 0.11, 0.14], ['PIZZA', 0.55, 0.22, '#a82a1c'], ['family size', 0.86, 0.09, '#654']]);
  tile('frozen3', '#e8f6ea', [['#3f8f4a', 0.0, 0.22]], [['FROZEN', 0.11, 0.14], ['VEGGIE', 0.55, 0.2, '#2b6a35'], ['mixed', 0.86, 0.1, '#465']]);
  tile('chicken', '#f6efe0', [['#e8b32a', 0.0, 0.2]], [['CHICKEN', 0.1, 0.13, '#5a3a00'], ['FAMILY PACK', 0.88, 0.1, '#7a4a0a']]);
  tile('eggs', '#f4ecd8', [['#c98a3c', 0.0, 0.3]], [['EGGS', 0.6, 0.3, '#7a4a0c'], ['DOZEN', 0.15, 0.15]]);
  tile('yogurt', '#ffffff', [['#d6402f', 0.0, 0.34]], [['YOGURT', 0.62, 0.18, '#a82a1c'], ['berry', 0.17, 0.15]]);
  tile('yogurt2', '#ffffff', [['#7b4aa8', 0.0, 0.34]], [['YOGURT', 0.62, 0.18, '#4a2470'], ['grape', 0.17, 0.15]]);
  tile('butter', '#f7e9a8', [['#2f6fd6', 0.0, 0.26]], [['BUTTER', 0.6, 0.2, '#6a5a10'], ['sweet cream', 0.13, 0.1]]);
  tile('casetop', '#c39466', [['#9a6c40', 0.44, 0.56]], [['THIS SIDE UP', 0.24, 0.1, '#6a4420'], ['12 CT', 0.78, 0.14, '#6a4420']]);
  tile('pasta', '#2f6fd6', [['#f5f0e0', 0.3, 0.74]], [['PASTA', 0.5, 0.2, '#1c4fa8'], ['ITALIAN STYLE', 0.15, 0.09], ['16 oz', 0.88, 0.11]]);
  tile('pasta2', '#c1272d', [['#f5f0e0', 0.3, 0.74]], [['NOODLES', 0.5, 0.16, '#8a1a1f'], ['EGG', 0.15, 0.12], ['12 oz', 0.88, 0.11]]);
  tile('cereal', '#e8a42b', [['#c1272d', 0.0, 0.24]], [['CORN', 0.44, 0.2, '#fff', '#7a1a1a'], ['FLAKES', 0.64, 0.17, '#fff', '#7a1a1a'], ['GOOD MORNING', 0.12, 0.09]]);
  tile('cereal2', '#6d3aa6', [['#f5c518', 0.0, 0.24]], [['OAT', 0.44, 0.2, '#fff', '#2f1050'], ['RINGS', 0.64, 0.18, '#fff', '#2f1050'], ['honey', 0.12, 0.11, '#4a3a00']]);
  tile('bread3', '#7a4a2a', [['#f0c33c', 0.32, 0.66]], [['RYE', 0.5, 0.22, '#5a3010'], ['DELI', 0.17, 0.14, '#f0c33c'], ['SEEDED', 0.84, 0.12, '#f0c33c']]);
  tile('bagels', '#f2ece0', [['#d6402f', 0.0, 0.3]], [['BAGELS', 0.62, 0.2, '#a82a1c'], ['6 ct', 0.15, 0.13]]);
  tile('juice4', '#c8282b', [['#fff', 0.34, 0.7]], [['FRUIT', 0.46, 0.17, '#8a1a1a'], ['PUNCH', 0.62, 0.15, '#8a1a1a'], ['64 oz', 0.86, 0.11]]);
  tile('juice5', '#f0e6c0', [['#d6402f', 0.0, 0.3]], [['APPLE', 0.55, 0.2, '#a82a1c'], ['100%', 0.15, 0.14]]);
  tile('cookies', '#3a6ed6', [['#f5f0e0', 0.36, 0.7]], [['COOKIES', 0.53, 0.17, '#1e408f'], ['choc chip', 0.17, 0.12], ['family', 0.86, 0.11]]);
  tile('pretzel', '#7a4a2a', [['#f5c518', 0.0, 0.2], ['#f5c518', 0.82, 1]], [['TWIST', 0.4, 0.19, '#fff', '#3a2010'], ['PRETZELS', 0.6, 0.14, '#fff', '#3a2010'], ['salted', 0.1, 0.11, '#5a3a00']]);
  tile('icecream', '#f6efe2', [['#7a4a2a', 0.0, 0.3]], [['ICE', 0.46, 0.2, '#7a4a2a'], ['CREAM', 0.66, 0.17, '#d6402f'], ['vanilla', 0.15, 0.12]]);
  tile('spray', '#fff', [['#d6402f', 0.0, 0.3]], [['SHINE', 0.55, 0.18, '#a82a1c'], ['spray', 0.15, 0.13]]);
  tile('towels', '#f6f8fb', [['#3f8f4a', 0.0, 0.3]], [['PAPER', 0.5, 0.18, '#2b6a35'], ['TOWELS', 0.7, 0.16, '#2b6a35'], ['6 ROLLS', 0.15, 0.12]]);
  tile('bleach', '#f6f8fb', [['#2f6fd6', 0.0, 0.3]], [['BLEACH', 0.55, 0.2, '#1c4fa8'], ['regular', 0.15, 0.12]]);
  tile('water', '#dff1ff', [['#3a8de0', 0.3, 0.7]], [['SPRING', 0.42, 0.16, '#fff'], ['WATER', 0.6, 0.16, '#fff'], ['24 pk', 0.86, 0.12, '#1c4fa8']]);
  tile('soda6', '#e8f2a8', [['#3f8f4a', 0.4, 0.62]], [['LEMON LIME', 0.51, 0.12, '#fff'], ['2 L', 0.84, 0.14, '#3f8f4a']]);
  tile('cans12', '#c1272d', [['#fff', 0.34, 0.66]], [['COLA', 0.5, 0.22, '#8a1a1f'], ['12 CANS', 0.18, 0.14], ['12 fl oz', 0.86, 0.11]]);
  tile('cans12b', '#3a6ed6', [['#fff', 0.34, 0.66]], [['CITRUS', 0.5, 0.18, '#1e408f'], ['12 CANS', 0.18, 0.14], ['12 fl oz', 0.86, 0.11]]);
  tile('frozen4', '#fde6ea', [['#d4306f', 0.0, 0.22]], [['FROZEN', 0.11, 0.14], ['WAFFLES', 0.55, 0.17, '#a81c55'], ['10 ct', 0.86, 0.1, '#654']]);
  const order = names.slice();
  return { map: tex(c, { aniso }), cell: (n) => { const i = order.indexOf(n); if (i < 0) throw new Error('label ' + n); const x = (i % K) * C, y = Math.floor(i / K) * C, e = 0.5; return [(x + e) / N, 1 - (y + C - e) / N, (x + C - e) / N, 1 - (y + e) / N]; } };
}

/** soft round gradient (contact shadows, the pickup glow) */
export function glowTexture() {
  const c = cv(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(c, { aniso: 1 });
}
/** a pickup / pay ring: a soft bright ring (no hard edge, nothing that could strobe) */
export function ringTexture() {
  const c = cv(256, 256), g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 126);
  gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.78, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.86, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.95, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return tex(c, { aniso: 1 });
}
/**
 * The PAY marking painted on the floor in front of a register: a green panel with a double gold edge and PAY in big white
 * letters with a navy outline, upright for the camera (the camera looks north, so the top of the letters is the panel's north end).
 * Steady: nothing about it changes over time. Canvas aspect = the pad's (48 x 120 board px).
 */
export function padTexture(w = 256, h = 640) {
  const c = cv(w, h), g = c.getContext('2d'), r = 22;
  const rr = (x, y, ww, hh, rad) => { g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + ww, y, x + ww, y + hh, rad); g.arcTo(x + ww, y + hh, x, y + hh, rad); g.arcTo(x, y + hh, x, y, rad); g.arcTo(x, y, x + ww, y, rad); g.closePath(); };
  rr(6, 6, w - 12, h - 12, r); g.fillStyle = '#f5c518'; g.fill();                      // the gold outer edge
  rr(18, 18, w - 36, h - 36, r - 8); g.fillStyle = '#1d2650'; g.fill();                 // a thin navy keyline
  rr(24, 24, w - 48, h - 48, r - 10); const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#36c46c'); gr.addColorStop(1, '#2aa95a'); g.fillStyle = gr; g.fill();
  rr(38, 38, w - 76, h - 76, r - 14); g.strokeStyle = 'rgba(255,226,120,0.95)'; g.lineWidth = 5; g.stroke();   // the inner gold pinstripe
  // paint wear: a few faint scuffs so it reads as paint on tile, not a sticker
  for (let k = 0; k < 40; k++) { const x = 30 + hash(k, 1, 9) * (w - 60), y = 30 + hash(k, 2, 9) * (h - 60); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, y, 2 + hash(k, 3, 9) * 10, 1.5); }
  g.save(); g.translate(w / 2, h / 2); g.font = `bold ${Math.round(w * 0.36)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = w * 0.06; g.strokeStyle = '#1d2650'; g.strokeText('PAY', 0, 0); g.fillStyle = '#ffffff'; g.fillText('PAY', 0, 0);
  g.restore();
  return tex(c, { aniso: 8 });
}
/** the painted wall: lavender paint above, a pink band with a gold line at about 1.1 m, a navy wainscot below. u: along the wall (3 m per tile), v: 0..1 over the wall height */
export function wallTexture(aniso = 8) {
  const W = 512, H = 1024, c = cv(W, H), g = c.getContext('2d');
  // v = 1 is the top of the wall (canvas y = 0)
  const y = (m) => H - (m / 3.4) * H;
  let gr = g.createLinearGradient(0, 0, 0, y(1.25)); gr.addColorStop(0, '#9a93c8'); gr.addColorStop(1, '#b4aedb'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = '#25306a'; g.fillRect(0, y(0.95), W, H);                                  // wainscot
  gr = g.createLinearGradient(0, y(1.25), 0, y(0.95)); gr.addColorStop(0, '#e24a8c'); gr.addColorStop(1, '#b52467'); g.fillStyle = gr; g.fillRect(0, y(1.25), W, y(0.95) - y(1.25));
  g.fillStyle = '#f5c518'; g.fillRect(0, y(1.27), W, 5); g.fillRect(0, y(0.93), W, 4);   // gold rules
  g.strokeStyle = 'rgba(10,14,40,0.35)'; g.lineWidth = 2; for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(k * W / 4, y(0.95)); g.lineTo(k * W / 4, H); g.stroke(); }   // wainscot panel seams
  g.fillStyle = 'rgba(255,255,255,0.06)'; for (let k = 0; k < 4; k++) g.fillRect(k * W / 4 + 6, y(0.9), W / 4 - 12, 8);
  gr = g.createLinearGradient(0, 0, 0, 200); gr.addColorStop(0, 'rgba(20,24,60,0.38)'); gr.addColorStop(1, 'rgba(20,24,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, 200);   // darker up to the ceiling
  return tex(c, { repeat: true, aniso });
}
