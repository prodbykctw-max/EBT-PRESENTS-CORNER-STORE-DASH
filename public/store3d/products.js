// Product models for the shelves: small low-poly shapes merged into one geometry per kind, coloured by vertex colour, labels from the
// atlas (textures.js). Everything faces +z (south, toward the camera). Origin: the middle of the base. Sizes in metres.
import * as THREE from '../drive/vendor/three.module.min.js';
import { mergeGeometries } from '../drive/vendor/BufferGeometryUtils.js';

const C = (h) => new THREE.Color(h);
let ATLAS = null;
export function useAtlas(a) { ATLAS = a; }

/** one part: geometry g, a colour, an optional atlas label cell (the geometry's own 0..1 uv is mapped into it), placed by pos / rot / scale */
function part(g, { color = '#fff', label = null, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  g = g.index ? g.toNonIndexed() : g.clone();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  const uv = g.attributes.uv, n = g.attributes.position.count, col = new Float32Array(n * 3), c = C(color);
  const cell = ATLAS.cell(label || 'white');
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    if (label) uv.setXY(i, cell[0] + uv.getX(i) * (cell[2] - cell[0]), cell[1] + uv.getY(i) * (cell[3] - cell[1]));
    else uv.setXY(i, (cell[0] + cell[2]) / 2, (cell[1] + cell[3]) / 2);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const merge = (parts) => { const g = mergeGeometries(parts, false); g.computeBoundingSphere(); return g; };
const cyl = (rt, rb, h, seg = 8, thetaStart = 0, thetaLen = Math.PI * 2, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, thetaStart, thetaLen);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const plane = (w, h) => new THREE.PlaneGeometry(w, h);
const sph = (r, a = 7, b = 5) => new THREE.SphereGeometry(r, a, b);

/** half-round label strip around a bottle's front */
const wrap = (r, h, label, y, arc = 2.4) => part(cyl(r + 0.0015, r + 0.0015, h, 7, -arc / 2, arc, true), { label, pos: [0, y, 0], rot: [0, 0, 0] });
function bottle({ r, h, body, cap, label, neck = 0.35, capH = 0.02, liquid }) {
  const bh = h * 0.68, sh = h * 0.2, nh = h - bh - sh - capH, nr = r * neck;
  return merge([
    part(cyl(r, r, bh, 10), { color: body, pos: [0, bh / 2, 0] }),
    part(cyl(nr, r, sh, 10), { color: body, pos: [0, bh + sh / 2, 0] }),
    part(cyl(nr, nr, nh, 8), { color: body, pos: [0, bh + sh + nh / 2, 0] }),
    part(cyl(nr * 1.15, nr * 1.15, capH, 8), { color: cap, pos: [0, h - capH / 2, 0] }),
    wrap(r, bh * 0.78, label, bh * 0.46),
  ]);
}
const KINDS = {
  jug: ({ label, body = '#f6f6f2', cap = '#2f6fd6' }) => merge([
    part(box(0.15, 0.2, 0.09), { color: body, pos: [0, 0.1, 0] }),
    part(box(0.15, 0.04, 0.085), { color: body, pos: [0, 0.22, -0.003], rot: [0.0, 0, 0], scale: [0.9, 1, 0.9] }),
    part(cyl(0.025, 0.03, 0.03, 8), { color: body, pos: [0.04, 0.255, 0] }),
    part(cyl(0.03, 0.03, 0.022, 8), { color: cap, pos: [0.04, 0.281, 0] }),
    part(box(0.05, 0.1, 0.07), { color: body, pos: [-0.06, 0.255, 0], scale: [1, 0.5, 1] }),   // the handle block
    part(plane(0.14, 0.17), { label, pos: [0, 0.105, 0.0455] }),
  ]),
  carton: ({ label, body = '#ffffff' }) => merge([
    part(box(0.07, 0.17, 0.07), { color: body, pos: [0, 0.085, 0] }),
    part(new THREE.CylinderGeometry(0.0, 0.0707, 0.07, 4, 1), { color: body, pos: [0, 0.205, 0], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.55] }),
    part(plane(0.068, 0.15), { label, pos: [0, 0.09, 0.0355] }),
  ]),
  sack: ({ label, body = '#f4d27a' }) => merge([   // a rice sack / flat pouch, slightly puffy
    part(box(0.2, 0.3, 0.07), { color: body, pos: [0, 0.15, 0], scale: [1, 1, 1] }),
    part(box(0.2, 0.012, 0.075), { color: '#e8e0d0', pos: [0, 0.306, 0] }),
    part(plane(0.19, 0.27), { label, pos: [0, 0.15, 0.0355] }),
  ]),
  can: ({ label, body = '#cfd4d8' }) => merge([
    part(cyl(0.037, 0.037, 0.105, 10), { color: body, pos: [0, 0.0525, 0] }),
    part(cyl(0.039, 0.039, 0.006, 10), { color: '#aeb4ba', pos: [0, 0.102, 0] }),
    part(cyl(0.039, 0.039, 0.006, 10), { color: '#aeb4ba', pos: [0, 0.003, 0] }),
    part(cyl(0.0385, 0.0385, 0.08, 6, -1.3, 2.6, true), { label, pos: [0, 0.052, 0] }),
  ]),
  loaf: ({ label, body = '#d99a4a' }) => merge([
    part(new THREE.CapsuleGeometry(0.055, 0.2, 2, 6), { color: body, pos: [0, 0.06, 0], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.95] }),
    part(box(0.3, 0.07, 0.085), { color: '#efe6d2', pos: [0, 0.035, 0], scale: [0.9, 1, 0.96] }),   // the bag's lower half
    part(plane(0.2, 0.09), { label, pos: [0, 0.058, 0.057] }),
    part(box(0.02, 0.03, 0.01), { color: '#2f6fd6', pos: [0.16, 0.1, 0] }),
  ]),
  bottle: (o) => bottle({ r: 0.032, h: 0.2, cap: '#f4f4f0', ...o }),
  soda: (o) => bottle({ r: 0.052, h: 0.36, neck: 0.3, capH: 0.025, ...o }),
  chips: ({ label, body = '#e8a42b' }) => merge([
    part(box(0.2, 0.27, 0.05), { color: body, pos: [0, 0.135, 0], scale: [1, 1, 1] }),
    part(box(0.2, 0.025, 0.055), { color: '#cfcfcf', pos: [0, 0.27, 0] }),
    part(box(0.2, 0.02, 0.055), { color: '#cfcfcf', pos: [0, 0.01, 0] }),
    part(plane(0.19, 0.22), { label, pos: [0, 0.135, 0.0255] }),
  ]),
  box: ({ label, body = '#f1f6fb', w = 0.17, h = 0.22, d = 0.05 }) => merge([
    part(box(w, h, d), { color: body, pos: [0, h / 2, 0] }),
    part(plane(w * 0.97, h * 0.97), { label, pos: [0, h / 2, d / 2 + 0.0015] }),
  ]),
  jugL: ({ label, body = '#3a9ee0', cap = '#f4f4f0' }) => merge([   // laundry jug
    part(box(0.14, 0.2, 0.085), { color: body, pos: [0, 0.1, 0] }),
    part(cyl(0.045, 0.07, 0.05, 8), { color: body, pos: [0, 0.225, 0], scale: [1, 1, 0.8] }),
    part(cyl(0.032, 0.032, 0.03, 8), { color: cap, pos: [0, 0.265, 0] }),
    part(plane(0.13, 0.15), { label, pos: [0, 0.1, 0.043] }),
  ]),
  apple: ({ body = '#c8282b' }) => merge([part(sph(0.04, 7, 5), { color: body, pos: [0, 0.038, 0], scale: [1, 0.92, 1] }), part(cyl(0.003, 0.003, 0.014, 4), { color: '#5a3a1a', pos: [0, 0.082, 0] })]),
  orange: ({ body = '#ee8b1d' }) => merge([part(sph(0.043, 7, 5), { color: body, pos: [0, 0.043, 0] })]),
  pepper: ({ body = '#2f9e44' }) => merge([part(new THREE.CapsuleGeometry(0.03, 0.07, 2, 6), { color: body, pos: [0, 0.055, 0], scale: [1, 1, 0.9] }), part(cyl(0.008, 0.008, 0.02, 4), { color: '#3b6a2a', pos: [0, 0.115, 0] })]),
  banana: () => merge([0, 1, 2].map((i) => part(new THREE.CapsuleGeometry(0.016, 0.15, 2, 5), { color: '#f0cf2e', pos: [(i - 1) * 0.034, 0.03 + i * 0.002, 0], rot: [Math.PI / 2 - 0.15, 0, (i - 1) * 0.12] }))),
  cabbage: () => merge([part(sph(0.085, 8, 6), { color: '#7fbf55', pos: [0, 0.08, 0], scale: [1, 0.9, 1] }), part(sph(0.07, 7, 5), { color: '#a2d777', pos: [0.01, 0.1, 0.02], scale: [1, 0.8, 1] })]),
  broccoli: () => merge([part(cyl(0.012, 0.016, 0.07, 6), { color: '#9bc46a', pos: [0, 0.035, 0] }), part(sph(0.05, 7, 5), { color: '#2f7d32', pos: [0, 0.095, 0], scale: [1.1, 0.8, 1] }), part(sph(0.03, 7, 5), { color: '#3b8c3b', pos: [0.04, 0.085, 0.01] }), part(sph(0.03, 7, 5), { color: '#3b8c3b', pos: [-0.04, 0.085, 0.01] })]),
  carrot: () => merge([part(new THREE.ConeGeometry(0.018, 0.17, 6), { color: '#ee7b16', pos: [0, 0.03, 0], rot: [Math.PI / 2 + 0.1, 0, 0] }), part(cyl(0.004, 0.012, 0.03, 4), { color: '#3f8f2f', pos: [0, 0.04, -0.09], rot: [Math.PI / 2, 0, 0] })]),
  potato: () => merge([part(sph(0.05, 7, 5), { color: '#a87a47', pos: [0, 0.04, 0], scale: [1.2, 0.85, 0.95] })]),
  onion: () => merge([part(sph(0.05, 7, 5), { color: '#d9a85a', pos: [0, 0.05, 0], scale: [1, 0.9, 1] }), part(cyl(0.004, 0.012, 0.025, 4), { color: '#c9985a', pos: [0, 0.1, 0] })]),
  tray: ({ label, meat = '#b3262f' }) => merge([
    part(box(0.2, 0.026, 0.14), { color: '#f4f4f0', pos: [0, 0.013, 0] }),
    part(box(0.18, 0.022, 0.12), { color: meat, pos: [0, 0.034, 0] }),
    part(box(0.2, 0.004, 0.14), { color: '#dfeaf0', pos: [0, 0.047, 0] }),
    part(plane(0.1, 0.03), { label, pos: [0, 0.015, 0.0705] }),
  ]),
  drumsticks: () => merge([
    part(box(0.2, 0.026, 0.14), { color: '#f4f4f0', pos: [0, 0.013, 0] }),
    ...[-0.05, 0, 0.05].map((x) => part(new THREE.CapsuleGeometry(0.022, 0.06, 2, 6), { color: '#c98a45', pos: [x, 0.048, 0], rot: [0, 0, Math.PI / 2 - 0.7] })),
    part(box(0.2, 0.004, 0.14), { color: '#e6f1f7', pos: [0, 0.075, 0] }),
  ]),
  tissue: ({ label, body = '#e9f2fb' }) => merge([part(box(0.22, 0.13, 0.12), { color: body, pos: [0, 0.065, 0] }), part(plane(0.21, 0.12), { label, pos: [0, 0.065, 0.0615] })]),
  tag: () => merge([part(box(0.05, 0.022, 0.003), { color: '#fff3a8', pos: [0, 0, 0] })]),   // shelf-edge price tag
};
export const KIND_NAMES = Object.keys(KINDS);
const cache = new Map();
export function productGeometry(kind, opts = {}) {
  const k = kind + JSON.stringify(opts); if (!cache.has(k)) { if (!KINDS[kind]) throw new Error('product ' + kind); cache.set(k, KINDS[kind](opts)); } return cache.get(k);
}
/** Instance batches: add(kind, opts, x, y, z, rotY, scale), then build() -> InstancedMesh[] (one per distinct kind + options) */
export class Stock {
  constructor(material) { this.material = material; this.groups = new Map(); this.n = 0; }
  add(kind, opts, x, y, z, ry = 0, s = 1) {
    const key = kind + JSON.stringify(opts); let g = this.groups.get(key); if (!g) { g = { kind, opts, list: [] }; this.groups.set(key, g); }
    g.list.push([x, y, z, ry, s]); this.n++;
  }
  build(shadow = false) {
    const out = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const g of this.groups.values()) {
      const geo = productGeometry(g.kind, g.opts), im = new THREE.InstancedMesh(geo, this.material, g.list.length);
      g.list.forEach(([x, y, z, ry, s], i) => { e.set(0, ry, 0); q.setFromEuler(e); m.compose(v.set(x, y, z), q, sc.set(s, s, s)); im.setMatrixAt(i, m); });
      im.instanceMatrix.needsUpdate = true; im.castShadow = shadow; im.receiveShadow = true; im.computeBoundingSphere(); im.userData.stock = g.kind; out.push(im);
    }
    return out;
  }
}
