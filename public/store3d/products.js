// Product models for the shelves: small low-poly shapes merged into one geometry per kind, coloured by vertex colour, labels from the
// atlas (textures.js), roughness / metalness per part (aRM, geobuf.js). Everything faces +z (south, toward the camera). Origin: the
// middle of the base. Sizes in metres. All designs are generic, made up here: no real brands.
import * as THREE from '../drive/vendor/three.module.min.js';
import { mergeGeometries } from '../drive/vendor/BufferGeometryUtils.js';

const C = (h) => new THREE.Color(h);
let ATLAS = null;
export function useAtlas(a) { ATLAS = a; }

const RM = { plastic: [0.42, 0], gloss: [0.24, 0], paper: [0.75, 0], card: [0.85, 0], metal: [0.3, 0.85], foil: [0.3, 0.55], wrap: [0.18, 0], food: [0.6, 0] };
/** one part: geometry g, a colour, an optional atlas label cell (the geometry's own 0..1 uv is mapped into it), placed by pos / rot / scale */
function part(g, { color = '#fff', label = null, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], rm = RM.plastic } = {}) {
  g = g.index ? g.toNonIndexed() : g.clone();
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  g.applyMatrix4(m);
  const uv = g.attributes.uv, n = g.attributes.position.count, col = new Float32Array(n * 3), r = new Float32Array(n * 3), c = C(color);
  const cell = ATLAS.cell(label || 'white');
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; r[i * 3] = rm[0]; r[i * 3 + 1] = rm[1];
    if (label) uv.setXY(i, cell[0] + uv.getX(i) * (cell[2] - cell[0]), cell[1] + uv.getY(i) * (cell[3] - cell[1]));
    else uv.setXY(i, (cell[0] + cell[2]) / 2, (cell[1] + cell[3]) / 2);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aRM', new THREE.BufferAttribute(r, 3));
  return g;
}
const merge = (parts) => { const g = mergeGeometries(parts, false); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
const cyl = (rt, rb, h, seg = 8, thetaStart = 0, thetaLen = Math.PI * 2, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, thetaStart, thetaLen);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const plane = (w, h) => new THREE.PlaneGeometry(w, h);
const sph = (r, a = 7, b = 5) => new THREE.SphereGeometry(r, a, b);
const top = (w, d, label, y) => part(plane(w, d), { label, pos: [0, y, 0], rot: [-Math.PI / 2, 0, 0], rm: RM.paper });   // a label on a top face, readable from the camera

/** half-round label strip around a bottle's front */
const wrap = (r, h, label, y, arc = 2.4) => part(cyl(r + 0.0015, r + 0.0015, h, 7, -arc / 2, arc, true), { label, pos: [0, y, 0], rm: RM.paper });
function bottle({ r, h, body, cap, label, neck = 0.35, capH = 0.02, rm = RM.gloss, square = false }) {
  const bh = h * 0.68, sh = h * 0.2, nh = h - bh - sh - capH, nr = r * neck, seg = square ? 4 : 10, rot = square ? [0, Math.PI / 4, 0] : [0, 0, 0];
  return merge([
    part(cyl(r, r * 0.96, bh, seg), { color: body, pos: [0, bh / 2, 0], rot, rm }),
    part(cyl(nr, r, sh, seg), { color: body, pos: [0, bh + sh / 2, 0], rot, rm }),
    part(cyl(nr, nr, nh, 8), { color: body, pos: [0, bh + sh + nh / 2, 0], rm }),
    part(cyl(nr * 1.2, nr * 1.2, capH, 8), { color: cap, pos: [0, h - capH / 2, 0], rm: RM.plastic }),
    square ? part(plane(r * 1.38, bh * 0.78), { label, pos: [0, bh * 0.46, r * 0.71 + 0.002], rm: RM.paper }) : wrap(r, bh * 0.78, label, bh * 0.46),
  ]);
}
/** a gallon jug: square body, sloped shoulders, a handle loop at the back corner, a cap on the front corner */
function gallon({ label, body = '#f6f6f2', cap = '#2f6fd6', w = 0.15, liquid = null }) {
  const H = 0.2;
  return merge([
    part(box(w, H, w), { color: liquid || body, pos: [0, H / 2, 0], rm: RM.plastic }),
    part(cyl(0.035, w * 0.68, 0.05, 4), { color: body, pos: [0.02, H + 0.025, 0.012], rot: [0, Math.PI / 4, 0], rm: RM.plastic }),
    part(cyl(0.022, 0.022, 0.02, 8), { color: body, pos: [0.025, H + 0.06, 0.02], rm: RM.plastic }),
    part(cyl(0.025, 0.025, 0.02, 8), { color: cap, pos: [0.025, H + 0.078, 0.02], rm: RM.plastic }),
    part(new THREE.TorusGeometry(0.035, 0.009, 4, 8, Math.PI), { color: body, pos: [-0.04, H + 0.02, -0.035], rot: [0, Math.PI / 4, 0], rm: RM.plastic }),   // the handle loop
    part(plane(w * 0.92, H * 0.7), { label, pos: [0, H * 0.48, w / 2 + 0.002], rm: RM.paper }),
  ]);
}
/** a cardboard case (overstock on the unit tops): plain brown box, tape across the top, the product's label printed on the front */
function kase({ label, w = 0.4, h = 0.28, d = 0.32, color = '#b88a5a', tape = '#d9b98a' }) {
  return merge([
    part(box(w, h, d), { color, pos: [0, h / 2, 0], rm: RM.card }),
    part(box(w * 1.002, 0.004, 0.06), { color: tape, pos: [0, h + 0.001, 0], rm: [0.3, 0] }),
    part(box(0.004, h * 0.5, 0.06), { color: tape, pos: [w / 2 + 0.001, h * 0.75, 0], rm: [0.3, 0] }),
    part(plane(w * 0.55, h * 0.55), { label, pos: [0, h * 0.52, d / 2 + 0.002], rm: RM.card }),
    part(plane(w * 0.86, d * 0.5), { label: 'casetop', pos: [0, h + 0.004, -d * 0.18], rot: [-Math.PI / 2, 0, 0], rm: RM.card }),
  ]);
}
/** a shrink-wrapped tray of bottles or cans: the units under a clear glossy film */
function pack({ body, cap = '#f4f4f0', nx = 4, nz = 3, r = 0.034, h = 0.2, label = null }) {
  const P = [];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { const x = (i - (nx - 1) / 2) * r * 2.05, z = (k - (nz - 1) / 2) * r * 2.05; P.push(part(cyl(r, r, h * 0.8, 7), { color: body, pos: [x, h * 0.4, z], rm: RM.gloss }), part(cyl(r * 0.45, r * 0.8, h * 0.2, 6), { color: body, pos: [x, h * 0.9, z], rm: RM.gloss }), part(cyl(r * 0.5, r * 0.5, 0.012, 6), { color: cap, pos: [x, h + 0.006, z], rm: RM.plastic })); }
  P.push(part(box(nx * r * 2.05 + 0.01, 0.03, nz * r * 2.05 + 0.01), { color: '#2a2f45', pos: [0, 0.015, 0], rm: RM.card }));
  if (label) P.push(part(plane(nx * r * 1.6, h * 0.35), { label, pos: [0, h * 0.42, nz * r * 1.03 + 0.004], rm: RM.wrap }));
  return merge(P);
}
const KINDS = {
  jug: (o) => gallon(o),
  carton: ({ label, body = '#ffffff' }) => merge([
    part(box(0.07, 0.17, 0.07), { color: body, pos: [0, 0.085, 0], rm: RM.paper }),
    part(new THREE.CylinderGeometry(0.0, 0.0707, 0.05, 4, 1), { color: body, pos: [0, 0.195, 0], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.12], rm: RM.paper }),   // the gable
    part(box(0.07, 0.025, 0.006), { color: body, pos: [0, 0.2275, 0], rm: RM.paper }),
    part(plane(0.068, 0.15), { label, pos: [0, 0.09, 0.0355], rm: RM.paper }),
  ]),
  eggs: ({ body = '#d9cfb8' }) => {   // a pulp egg carton: a low box with a humped lid
    const P = [part(box(0.3, 0.05, 0.12), { color: body, pos: [0, 0.025, 0], rm: RM.card })];
    for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) P.push(part(sph(0.024, 6, 4), { color: body, pos: [(i - 2.5) * 0.048, 0.05, (k - 0.5) * 0.055], scale: [1, 0.7, 1], rm: RM.card }));
    P.push(part(plane(0.12, 0.045), { label: 'eggs', pos: [0, 0.07, 0], rot: [-Math.PI / 2, 0, 0], rm: RM.paper }));
    return merge(P);
  },
  yogurt: ({ body = '#f4f4f0', lid = '#d6402f', label = 'yogurt' }) => {   // a 4-pack of cups
    const P = []; for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) { const x = (i - 0.5) * 0.068, z = (k - 0.5) * 0.068; P.push(part(cyl(0.033, 0.026, 0.07, 8), { color: body, pos: [x, 0.035, z], rm: RM.plastic }), part(cyl(0.034, 0.034, 0.004, 8), { color: lid, pos: [x, 0.072, z], rm: RM.foil })); }
    P.push(part(plane(0.12, 0.05), { label, pos: [0, 0.035, 0.069], rm: RM.paper })); return merge(P);
  },
  sack: ({ label, body = '#f4d27a' }) => merge([   // a rice sack: a pillowy bag with a crimped top
    part(box(0.2, 0.28, 0.06), { color: body, pos: [0, 0.14, 0], rm: RM.plastic }),
    part(sph(0.1, 8, 6), { color: body, pos: [0, 0.14, 0.012], scale: [0.98, 1.38, 0.32], rm: RM.plastic }),
    part(box(0.2, 0.02, 0.03), { color: '#e8e0d0', pos: [0, 0.29, 0], rm: RM.plastic }),
    part(plane(0.18, 0.24), { label, pos: [0, 0.14, 0.046], rm: RM.paper }),
  ]),
  can: ({ label, body = '#cfd4d8' }) => merge([
    part(cyl(0.037, 0.037, 0.105, 10), { color: body, pos: [0, 0.0525, 0], rm: RM.metal }),
    part(cyl(0.039, 0.039, 0.006, 10), { color: '#c4c9cf', pos: [0, 0.102, 0], rm: RM.metal }),
    part(cyl(0.03, 0.03, 0.002, 10), { color: '#9aa1a8', pos: [0, 0.1055, 0], rm: RM.metal }),
    part(cyl(0.039, 0.039, 0.006, 10), { color: '#aeb4ba', pos: [0, 0.003, 0], rm: RM.metal }),
    part(cyl(0.0385, 0.0385, 0.08, 6, -1.3, 2.6, true), { label, pos: [0, 0.052, 0], rm: RM.paper }),
  ]),
  pasta: ({ label, body = '#2f6fd6' }) => merge([part(box(0.17, 0.24, 0.05), { color: body, pos: [0, 0.12, 0], rm: RM.card }), part(plane(0.165, 0.235), { label, pos: [0, 0.12, 0.0255], rm: RM.card }), top(0.16, 0.045, label, 0.241)]),
  cereal: ({ label, body = '#e8a42b' }) => merge([part(box(0.19, 0.29, 0.06), { color: body, pos: [0, 0.145, 0], rm: RM.card }), part(plane(0.185, 0.285), { label, pos: [0, 0.145, 0.0305], rm: RM.card })]),
  loaf: ({ label, body = '#d99a4a', tie = '#2f6fd6' }) => merge([
    part(new THREE.CapsuleGeometry(0.055, 0.2, 2, 6), { color: body, pos: [0, 0.06, 0], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.95], rm: RM.food }),
    part(box(0.3, 0.07, 0.085), { color: '#efe6d2', pos: [0, 0.035, 0], scale: [0.9, 1, 0.96], rm: RM.wrap }),   // the bag's lower half
    part(new THREE.CapsuleGeometry(0.06, 0.2, 2, 6), { color: '#f4efe4', pos: [0, 0.058, 0], rot: [0, 0, Math.PI / 2], scale: [1.02, 1.03, 1.0], rm: RM.wrap }),
    part(plane(0.2, 0.09), { label, pos: [0, 0.064, 0.062], rm: RM.paper }),
    part(cyl(0.016, 0.03, 0.05, 6), { color: '#f4efe4', pos: [0.18, 0.06, 0], rot: [0, 0, Math.PI / 2], rm: RM.wrap }),   // the twisted end
    part(box(0.012, 0.04, 0.035), { color: tie, pos: [0.165, 0.06, 0], rm: RM.plastic }),
  ]),
  bagels: ({ label = 'bagels' }) => { const P = [part(box(0.24, 0.07, 0.12), { color: '#f2ece0', pos: [0, 0.035, 0], rm: RM.wrap })]; for (let i = 0; i < 3; i++) P.push(part(new THREE.TorusGeometry(0.034, 0.016, 5, 9), { color: '#d29a52', pos: [(i - 1) * 0.075, 0.072, 0], rot: [Math.PI / 2, 0, 0], rm: RM.food })); P.push(part(plane(0.2, 0.05), { label, pos: [0, 0.035, 0.0605], rm: RM.paper })); return merge(P); },
  bottle: (o) => bottle({ r: 0.032, h: 0.2, cap: '#f4f4f0', ...o }),
  juicejug: (o) => bottle({ r: 0.05, h: 0.26, neck: 0.42, capH: 0.022, square: true, cap: '#f4f4f0', ...o }),
  soda: (o) => bottle({ r: 0.052, h: 0.36, neck: 0.3, capH: 0.025, ...o }),
  chips: ({ label, body = '#e8a42b' }) => merge([   // a pillow bag with crimped ends
    part(sph(0.1, 10, 7), { color: body, pos: [0, 0.135, 0], scale: [1, 1.3, 0.3], rm: RM.foil }),
    part(box(0.205, 0.028, 0.02), { color: '#f1ede2', pos: [0, 0.272, 0], rm: RM.foil }), part(box(0.205, 0.028, 0.02), { color: '#f1ede2', pos: [0, 0.003, 0], rm: RM.foil }),
    part(plane(0.17, 0.2), { label, pos: [0, 0.135, 0.0305], rm: RM.foil }),
  ]),
  cookies: ({ label, body = '#3a6ed6' }) => merge([part(box(0.2, 0.06, 0.13), { color: body, pos: [0, 0.03, 0], rm: RM.foil }), part(plane(0.19, 0.12), { label, pos: [0, 0.061, 0], rot: [-Math.PI / 2, 0, 0], rm: RM.foil }), part(plane(0.19, 0.055), { label, pos: [0, 0.03, 0.0655], rm: RM.foil })]),
  box: ({ label, body = '#f1f6fb', w = 0.17, h = 0.22, d = 0.05 }) => merge([
    part(box(w, h, d), { color: body, pos: [0, h / 2, 0], rm: RM.card }),
    part(plane(w * 0.97, h * 0.97), { label, pos: [0, h / 2, d / 2 + 0.0015], rm: RM.card }),
  ]),
  tub: ({ label = 'icecream', body = '#f6efe2', lid = '#7a4a2a' }) => merge([part(cyl(0.07, 0.06, 0.12, 10), { color: body, pos: [0, 0.06, 0], rm: RM.card }), part(cyl(0.073, 0.073, 0.015, 10), { color: lid, pos: [0, 0.125, 0], rm: RM.plastic }), wrap(0.066, 0.08, label, 0.06, 2.0)]),
  jugL: ({ label, body = '#3a9ee0', cap = '#f4f4f0' }) => merge([   // a laundry jug: tall body, handle hump at the back, spout cap at the front
    part(box(0.15, 0.22, 0.09), { color: body, pos: [0, 0.11, 0], rm: RM.plastic }),
    part(box(0.15, 0.05, 0.05), { color: body, pos: [0, 0.245, -0.02], rm: RM.plastic }),
    part(new THREE.TorusGeometry(0.03, 0.011, 4, 8, Math.PI), { color: body, pos: [-0.035, 0.27, -0.02], rm: RM.plastic }),
    part(cyl(0.03, 0.03, 0.035, 8), { color: cap, pos: [0.04, 0.262, 0.015], rm: RM.plastic }),
    part(plane(0.13, 0.15), { label, pos: [0, 0.105, 0.0455], rm: RM.paper }),
  ]),
  spray: ({ label = 'spray', body = '#f0d23a', cap = '#d6402f' }) => merge([part(cyl(0.03, 0.032, 0.16, 8), { color: body, pos: [0, 0.08, 0], rm: RM.plastic }), part(box(0.035, 0.04, 0.07), { color: cap, pos: [0, 0.18, 0.012], rm: RM.plastic }), part(box(0.02, 0.012, 0.03), { color: cap, pos: [0, 0.19, 0.055], rm: RM.plastic }), wrap(0.031, 0.1, label, 0.075, 2.0)]),
  towels: ({ body = '#f6f8fb', label = 'towels' }) => { const P = []; for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) P.push(part(cyl(0.055, 0.055, 0.24, 9), { color: body, pos: [(i - 1) * 0.11, 0.12, (k - 0.5) * 0.11], rm: RM.paper })); P.push(part(box(0.34, 0.245, 0.225), { color: '#dfe9f4', pos: [0, 0.122, 0], scale: [1, 1, 1], rm: RM.wrap }), part(plane(0.24, 0.12), { label, pos: [0, 0.13, 0.114], rm: RM.wrap })); return merge(P); },
  apple: ({ body = '#c8282b' }) => merge([part(sph(0.04, 7, 5), { color: body, pos: [0, 0.038, 0], scale: [1, 0.92, 1], rm: RM.gloss }), part(cyl(0.003, 0.003, 0.014, 4), { color: '#5a3a1a', pos: [0, 0.082, 0], rm: RM.food })]),
  orange: ({ body = '#ee8b1d' }) => merge([part(sph(0.043, 7, 5), { color: body, pos: [0, 0.043, 0], rm: RM.food })]),
  lemon: ({ body = '#f2d43a' }) => merge([part(sph(0.036, 7, 5), { color: body, pos: [0, 0.036, 0], scale: [1.25, 1, 1], rm: RM.food })]),
  pepper: ({ body = '#2f9e44' }) => merge([part(new THREE.CapsuleGeometry(0.03, 0.07, 2, 6), { color: body, pos: [0, 0.055, 0], scale: [1, 1, 0.9], rm: RM.gloss }), part(cyl(0.008, 0.008, 0.02, 4), { color: '#3b6a2a', pos: [0, 0.115, 0], rm: RM.food })]),
  banana: () => merge([0, 1, 2, 3].map((i) => part(new THREE.CapsuleGeometry(0.017, 0.15, 2, 5), { color: i === 3 ? '#e6c22a' : '#f0cf2e', pos: [(i - 1.5) * 0.032, 0.03 + (i % 2) * 0.006, 0], rot: [Math.PI / 2 - 0.15, 0, (i - 1.5) * 0.12], rm: RM.food }))),
  grapes: ({ body = '#6a2f6f' }) => { const P = []; for (let i = 0; i < 9; i++) P.push(part(sph(0.018, 5, 4), { color: body, pos: [((i % 3) - 1) * 0.026, 0.02 + Math.floor(i / 3) * 0.012, (Math.floor(i / 3) - 1) * 0.024], rm: RM.gloss })); return merge(P); },
  cabbage: () => merge([part(sph(0.085, 8, 6), { color: '#7fbf55', pos: [0, 0.08, 0], scale: [1, 0.9, 1], rm: RM.food }), part(sph(0.07, 7, 5), { color: '#a2d777', pos: [0.01, 0.1, 0.02], scale: [1, 0.8, 1], rm: RM.food })]),
  broccoli: () => merge([part(cyl(0.012, 0.016, 0.07, 6), { color: '#9bc46a', pos: [0, 0.035, 0], rm: RM.food }), part(sph(0.05, 7, 5), { color: '#2f7d32', pos: [0, 0.095, 0], scale: [1.1, 0.8, 1], rm: RM.food }), part(sph(0.03, 7, 5), { color: '#3b8c3b', pos: [0.04, 0.085, 0.01], rm: RM.food }), part(sph(0.03, 7, 5), { color: '#3b8c3b', pos: [-0.04, 0.085, 0.01], rm: RM.food })]),
  carrot: () => merge([part(new THREE.ConeGeometry(0.018, 0.17, 6), { color: '#ee7b16', pos: [0, 0.03, 0], rot: [Math.PI / 2 + 0.1, 0, 0], rm: RM.food }), part(cyl(0.004, 0.012, 0.03, 4), { color: '#3f8f2f', pos: [0, 0.04, -0.09], rot: [Math.PI / 2, 0, 0], rm: RM.food })]),
  potato: () => merge([part(sph(0.05, 7, 5), { color: '#a87a47', pos: [0, 0.04, 0], scale: [1.2, 0.85, 0.95], rm: RM.food })]),
  onion: () => merge([part(sph(0.05, 7, 5), { color: '#d9a85a', pos: [0, 0.05, 0], scale: [1, 0.9, 1], rm: RM.gloss }), part(cyl(0.004, 0.012, 0.025, 4), { color: '#c9985a', pos: [0, 0.1, 0], rm: RM.food })]),
  tomato: () => merge([part(sph(0.04, 7, 5), { color: '#d9382b', pos: [0, 0.036, 0], scale: [1, 0.85, 1], rm: RM.gloss }), part(cyl(0.012, 0.012, 0.006, 5), { color: '#3b7a2a', pos: [0, 0.07, 0], rm: RM.food })]),
  tray: ({ label, meat = '#b3262f' }) => merge([
    part(box(0.2, 0.026, 0.14), { color: '#f4f4f0', pos: [0, 0.013, 0], rm: RM.plastic }),
    part(sph(0.08, 8, 5), { color: meat, pos: [0, 0.03, 0], scale: [1.1, 0.3, 0.75], rm: [0.3, 0] }),   // (the film over it is left out: from above it hid the meat)
    part(plane(0.07, 0.045), { label, pos: [0.06, 0.03, 0.045], rot: [-Math.PI / 2, 0, 0], rm: RM.paper }),
  ]),
  drumsticks: () => merge([
    part(box(0.2, 0.026, 0.14), { color: '#f4f4f0', pos: [0, 0.013, 0], rm: RM.plastic }),
    ...[-0.05, 0, 0.05].map((x) => part(new THREE.CapsuleGeometry(0.022, 0.06, 2, 6), { color: '#c98a45', pos: [x, 0.048, 0], rot: [0, 0, Math.PI / 2 - 0.7], rm: RM.food })),
    part(plane(0.08, 0.05), { label: 'chicken', pos: [0.06, 0.03, 0.045], rot: [-Math.PI / 2, 0, 0], rm: RM.paper }),
  ]),
  tissue: ({ label, body = '#e9f2fb' }) => merge([part(box(0.22, 0.13, 0.12), { color: body, pos: [0, 0.065, 0], rm: RM.card }), part(plane(0.21, 0.12), { label, pos: [0, 0.065, 0.0615], rm: RM.card }), part(box(0.07, 0.02, 0.04), { color: '#ffffff', pos: [0, 0.135, 0], rm: RM.paper })]),
  case: (o) => kase(o),
  pack: (o) => pack(o),
  tag: () => merge([part(box(0.05, 0.022, 0.003), { color: '#fff3a8', pos: [0, 0, 0] })]),   // shelf-edge price tag
};
export const KIND_NAMES = Object.keys(KINDS);
export { part, merge, RM };   // for pickups.js (the pickups' own, finer models)
const cache = new Map();
export function productGeometry(kind, opts = {}) {
  const k = kind + JSON.stringify(opts); if (!cache.has(k)) { if (!KINDS[kind]) throw new Error('product ' + kind); cache.set(k, KINDS[kind](opts)); } return cache.get(k);
}
/** Static stock: add(kind, opts, x, y, z, rotY, scale[, tilt (about x)[, roll (about z)]]) collects; emit(bufFor) writes every product into the merged buffers (geobuf.js) */
export class Stock {
  constructor() { this.list = []; this.n = 0; }
  add(kind, opts, x, y, z, ry = 0, s = 1, tilt = 0, roll = 0) { this.list.push([kind, opts, x, y, z, ry, s, tilt, roll]); this.n++; }
  emit(bufFor, from = 0, to = this.list.length) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const [kind, opts, x, y, z, ry, s, tilt, roll = 0] of this.list.slice(from, to)) { e.set(tilt, ry, roll, 'XYZ'); q.setFromEuler(e); m.compose(v.set(x, y, z), q, sc.set(s, s, s)); bufFor(z).geo(productGeometry(kind, opts), m); }
  }
}
