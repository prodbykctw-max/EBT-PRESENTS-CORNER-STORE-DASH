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

/** cream floor tiles: 4 x 4 tiles per canvas (0.6 m each). Returns { map, normalMap, roughnessMap } (tileable). accent: gold / rose inlay tiles. */
export function floorTextures(aniso) {
  const N = 512, T = N / 4, c = cv(N, N), g = c.getContext('2d'), hmap = new Float32Array(N * N), rough = cv(N, N), rg = rough.getContext('2d');
  const accent = (i, j) => { const r = hash(i, j, 7); return r < 0.035 ? 'gold' : r < 0.06 ? 'rose' : null; };
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const v = hash(i, j, 1), a = accent(i, j);
    let base = a === 'gold' ? [240, 201, 92] : a === 'rose' ? [232, 160, 186] : [236 + v * 8 - 4, 224 + v * 8 - 4, 202 + v * 8 - 4];
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
export function signTexture(text, w = 768, h = 112) {
  const c = cv(w, h), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f06aa8'); gr.addColorStop(0.55, '#d4306f'); gr.addColorStop(1, '#a81c55'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(0, 0, w, 5);
  g.fillStyle = '#f5c518'; g.fillRect(0, h - 9, w, 5); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 4, w, 4);
  let fs = h * 0.56; g.font = `bold ${fs}px ${FONT}`; while (g.measureText(text).width > w * 0.86) { fs -= 2; g.font = `bold ${fs}px ${FONT}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(70,0,30,0.45)'; g.fillText(text, w / 2 + 2, h * 0.47 + 3); g.fillStyle = '#fff'; g.fillText(text, w / 2, h * 0.47);
  return tex(c, { aniso: 8 });
}
/** a plain painted label (exit door sign, welcome mat, entrance mat, wall signs) */
export function plateTexture(text, { w = 512, h = 128, bg = '#b3202a', fg = '#fff', border = '#f5c518', rot = false, font } = {}) {
  const c = cv(w, h), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = border; g.lineWidth = Math.max(4, h * 0.06); g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
  let fs = h * 0.5; g.font = `bold ${fs}px ${font || FONT}`; while (g.measureText(text).width > w * 0.8) { fs -= 2; g.font = `bold ${fs}px ${font || FONT}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg; g.fillText(text, w / 2, h * 0.53);
  return tex(c, { aniso: 8 });
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
  const c = cv(256, 256), g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 60, 128, 128, 126);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.72, 'rgba(255,255,255,1)'); gr.addColorStop(0.86, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return tex(c, { aniso: 1 });
}
