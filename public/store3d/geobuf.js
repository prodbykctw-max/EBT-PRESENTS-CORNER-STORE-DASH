// One merged geometry for many static things that share one material (the "paint" material below): boxes, quads and whole
// product models, each with its own colour, roughness, metalness and glow carried per vertex. This is what keeps the store at
// a few draw calls: every shelf, counter, trim, tag, product, cart and plant of a band of the store is ONE mesh.
import * as THREE from '../drive/vendor/three.module.min.js';

/** the paint table: name -> [colour, roughness, metalness, glow] (glow: emissive = the surface's own colour x glow) */
export const PAINT = {
  default: ['#888888', 0.5, 0], rail: ['#3a3d4a', 0.7, 0.2], base: ['#1d2140', 0.55, 0.15], steel: ['#1a1f40', 0.38, 0.5],
  shelf: ['#232a55', 0.34, 0.45], coolershelf: ['#8892a6', 0.3, 0.5], coolerbody: ['#232733', 0.38, 0.45], coolerback: ['#dfeaf6', 0.6, 0, 0.42],
  coolerlight: ['#ffffff', 0.3, 0, 1.3], tagwhite: ['#f3efe0', 0.6, 0], doorglass: ['#a9d2f6', 0.15, 0.1, 0.45], cooler: ['#e3e9ef', 0.34, 0.25],
  coolerbase: ['#9fb0c2', 0.4, 0.2], cap: ['#1f2552', 0.3, 0.45], back: ['#2a3166', 0.7, 0.1], wood: ['#b78a55', 0.78, 0], woodDark: ['#8a6236', 0.8, 0],
  lip: ['#f6efc0', 0.5, 0], worn: ['#232a55', 0.34, 0.45], wornLam: ['#2d313f', 0.28, 0.25], tape: ['#9ea3a6', 0.55, 0.1], cartWire: ['#7d8491', 0.5, 0.6],
  tapeTan: ['#c9a66b', 0.5, 0], wornBase: ['#1d2140', 0.55, 0.15], wornCoolerBase: ['#9fb0c2', 0.4, 0.2], wornGold: ['#f5c518', 0.3, 0.6], trimBlue: ['#2f6fd6', 0.35, 0.2], trimRed: ['#c1272d', 0.35, 0.2], trimGold: ['#f5c518', 0.3, 0.6],
  chrome: ['#cfd4da', 0.22, 1.0], lam: ['#171c3e', 0.42, 0.1], top: ['#2d313f', 0.28, 0.25], belt: ['#2a2c33', 0.8, 0], dark: ['#15171d', 0.5, 0.3],
  screen: ['#3a86e8', 0.2, 0, 1.4], lamp: ['#35d070', 0.3, 0, 1.2], door: ['#24160f', 0.6, 0.1], doorframe: ['#e0a01c', 0.4, 0.4], bar: ['#cfd4da', 0.25, 1],
  wallcap: ['#1b1f3c', 0.8, 0.05], cart: ['#8a909c', 0.42, 0.75], cartRed: ['#b3262f', 0.5, 0.1], corral: ['#5a6070', 0.6, 0.4],
  card: ['#b88a5a', 0.85, 0], cardDark: ['#8d6640', 0.9, 0], wrap: ['#e8eef4', 0.25, 0], pot: ['#8a4a2a', 0.7, 0], soil: ['#2a1c12', 1, 0],
  leaf: ['#2f7d3a', 0.6, 0], leaf2: ['#4a9d48', 0.6, 0], mat: ['#4a1218', 0.95, 0], frame: ['#9aa1ab', 0.3, 0.85], kick: ['#2a2f45', 0.5, 0.3],
};
/**
 * Wear (Nov 24 2026, owner: "too neat ... edges aged, a little rust on metal ... a tried and true corner store in the inner city of ATL").
 * Every paint has a wear class, carried in the paint's glow slot as a negative number (aRM.z = -class; a paint that glows never wears).
 * The static paint material (paintMaterial(map, { wear })) turns it into grime near the floor, chipped paint, rust spots and streaks and
 * scuffs, from a baked tileable noise texture (textures.js wearTexture) sampled in world space: no extra draw call, two texture reads.
 * Classes: 1 painted steel, 2 bare / plated metal, 3 laminate, counter tops and wood, 4 gold trim, 5 coloured paint, 6 only grime and rust
 * near the floor, 7 a worn edge strip (structure.js wornEdge: the paint is mostly rubbed through to bare steel).
 */
export const WEAR_CLASS = {
  steel: 1, shelf: 1, cap: 1, back: 1, base: 1, kick: 1, coolerbody: 1, coolershelf: 2, rail: 1, corral: 1, wallcap: 0,
  chrome: 2, bar: 2, frame: 2, cart: 2, coolerbase: 2, cooler: 2, cartWire: 2,
  lam: 3, top: 3, wood: 3, woodDark: 3, door: 3, belt: 6, card: 3, cardDark: 3,
  trimGold: 4, doorframe: 4, trimBlue: 5, trimRed: 5, cartRed: 5, lip: 6, tagwhite: 6, dark: 6, pot: 6, worn: 7, wornLam: 7, wornBase: 7, wornCoolerBase: 7, wornGold: 7, tape: 0, tapeTan: 0,
};
/** the wear's one-line knobs (0 = none, 1 = as tuned): grime near the floor, rust, paint chips and worn edges, scuffs on counters and wood */
export const WEAR = { grime: 1, rust: 1, chips: 1, scuffs: 1 };
const col = new THREE.Color();
const rmOf = (name, p) => { const g = p[3] || 0, w = typeof name === 'string' && !g ? WEAR_CLASS[name] || 0 : 0; return [p[1], p[2], w ? -w : g]; };

export class GeoBuf {
  // typed arrays that grow by doubling (plain arrays and push() made this the slowest part of the build)
  constructor() { this.n = 0; this.cap = 0; this._grow(1024); }
  _grow(cap) {
    const g = (a, k) => { const b = new Float32Array(cap * k); if (a) b.set(a.subarray(0, this.n * k)); return b; };
    this.P = g(this.P, 3); this.N = g(this.N, 3); this.U = g(this.U, 2); this.C = g(this.C, 3); this.R = g(this.R, 3); this.cap = cap;
  }
  get count() { return this.n; }
  _v(x, y, z, nx, ny, nz, u, v, c, rm) {
    if (this.n === this.cap) this._grow(this.cap * 2);
    const i = this.n++, i3 = i * 3, i2 = i * 2, P = this.P, N = this.N, C = this.C, R = this.R;
    P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z; N[i3] = nx; N[i3 + 1] = ny; N[i3 + 2] = nz; this.U[i2] = u; this.U[i2 + 1] = v;
    C[i3] = c.r; C[i3 + 1] = c.g; C[i3 + 2] = c.b; R[i3] = rm[0]; R[i3 + 1] = rm[1]; R[i3 + 2] = rm[2];
  }
  /** a quad from 4 corners (counter-clockwise seen from the front), one normal, uv per corner */
  quad(a, b, c, d, n, uv, color, rm) {
    const q = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) this._v(q[i][0], q[i][1], q[i][2], n[0], n[1], n[2], uv[i][0], uv[i][1], color, rm);
  }
  /**
   * an axis-aligned box. paint: a PAINT name or [colour, rough, metal, glow]. o.skip: faces to leave out ('ny' bottom by default),
   * o.uv: { faceName: [u0, v0, u1, v1] } a texture cell on that face (else every vertex gets o.white, the atlas's plain cell centre)
   */
  box(paint, x0, y0, z0, x1, y1, z1, o = {}) {
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    const p = typeof paint === 'string' ? PAINT[paint] || PAINT.default : paint, c = col.set(p[0]).clone(), rm = rmOf(paint, p);
    const skip = o.skip || 'ny', w = o.white || [0.5, 0.5], cellUV = (f) => { const r = o.uv && o.uv[f]; return r ? [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] : [w, w, w, w]; };
    const F = {
      pz: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
      nz: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
      px: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]],
      nx: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
      py: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]],
      ny: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
    };
    for (const f in F) { if (skip.includes(f)) continue; const q = F[f]; this.quad(q[0], q[1], q[2], q[3], q[4], cellUV(f), c, rm); }
  }
  /** a whole geometry (position, normal, uv, optional colour) placed by matrix m; colour from the geometry, else paint */
  geo(g, m, paint = 'default', rm) {
    const p = typeof paint === 'string' ? PAINT[paint] || PAINT.default : paint, c0 = col.set(p[0]).clone(), r0 = rm || rmOf(paint, p);
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, cc = g.attributes.color, rr = g.attributes.aRM, idx = g.index;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), n = new THREE.Vector3(), cv = new THREE.Color(), n0 = idx ? idx.count : pos.count;
    for (let k = 0; k < n0; k++) {
      const i = idx ? idx.getX(k) : k;
      v.fromBufferAttribute(pos, i).applyMatrix4(m); n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      const c = cc ? cv.fromBufferAttribute(cc, i) : c0, r = rr ? [rr.getX(i), rr.getY(i), rr.getZ(i)] : r0;
      this._v(v.x, v.y, v.z, n.x, n.y, n.z, uv ? uv.getX(i) : 0.5, uv ? uv.getY(i) : 0.5, c, r);
    }
  }
  /** un-straighten what was written since vertex `from`: fn(x, y, z) -> [x, y, z] moves every vertex (small moves: the normals are kept) */
  warp(from, fn) { const P = this.P; for (let i = from; i < this.n; i++) { const o = i * 3, r = fn(P[o], P[o + 1], P[o + 2]); P[o] = r[0]; P[o + 1] = r[1]; P[o + 2] = r[2]; } }
  /** turn what was written since `from` by small angles (radians, x then y then z) about the point (px, py, pz), normals too */
  tilt(from, px, py, pz, rx = 0, ry = 0, rz = 0) {
    const q = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)), v = new THREE.Vector3(), P = this.P, N = this.N;
    for (let i = from; i < this.n; i++) { const o = i * 3; v.set(P[o] - px, P[o + 1] - py, P[o + 2] - pz).applyMatrix4(q); P[o] = v.x + px; P[o + 1] = v.y + py; P[o + 2] = v.z + pz; v.set(N[o], N[o + 1], N[o + 2]).applyMatrix4(q); N[o] = v.x; N[o + 1] = v.y; N[o + 2] = v.z; }
  }
  /** a long box (x0..x1) that sags in the middle by `sag` metres (a bowed shelf): written as `n` segments so the bend shows */
  sagBox(paint, x0, y0, z0, x1, y1, z1, sag, o = {}, n = 4) {
    const from = this.n, L = x1 - x0;
    for (let k = 0; k < n; k++) this.box(paint, x0 + L * k / n, y0, z0, x0 + L * (k + 1) / n, y1, z1, { ...o, skip: (o.skip || 'ny') + (k ? ' nx' : '') + (k < n - 1 ? ' px' : '') });
    this.warp(from, (x, y, z) => { const t = (x - x0) / L; return [x, y - sag * 4 * t * (1 - t), z]; });
  }
  build() {
    const g = new THREE.BufferGeometry();
    const n = this.n, A = (a, k) => new THREE.BufferAttribute(a.slice(0, n * k), k);
    g.setAttribute('position', A(this.P, 3)); g.setAttribute('normal', A(this.N, 3)); g.setAttribute('uv', A(this.U, 2)); g.setAttribute('color', A(this.C, 3)); g.setAttribute('aRM', A(this.R, 3)); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}

/** the paint material: a MeshStandardMaterial whose roughness, metalness and glow come per vertex (aRM), colour per vertex, map = an atlas */
export function paintMaterial(map, extra = {}) {
  const { wear, wearK, ...rest } = extra;   // wearK: { grime, rust, chips, scuffs } for this material (the ATL look's heavier wear); default WEAR
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 1, metalness: 1, ...rest });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRM;\nvarying vec3 vRM;' + (wear ? '\nvarying vec3 vWP;\nvarying vec3 vWN;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = aRM;' + (wear ? '\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normal;' : ''));
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRM;' + (wear ? WEAR_HEAD : ''))
      .replace('#include <color_fragment>', '#include <color_fragment>' + (wear ? WEAR_COLOR : ''))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vRM.x;' + (wear ? '\nroughnessFactor = mix(roughnessFactor, wRough, wAmt);' : ''))
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vRM.y;' + (wear ? '\nmetalnessFactor = mix(metalnessFactor, wMetal, wAmt);' : ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * max(vRM.z, 0.0);');
    if (wear) { sh.uniforms.uWear = { value: wear }; const k = wearK || WEAR; sh.uniforms.uWearK = { value: new THREE.Vector4(k.grime, k.rust, k.chips, k.scuffs) }; mat.userData.shader = sh; }
  };
  mat.customProgramCacheKey = () => (wear ? 'store3d-paint-wear' : 'store3d-paint');
  return mat;
}
// The wear, in the fragment shader (see WEAR_CLASS). n1: the noise at ~3 m, n2: at ~0.6 m; r = blotches, g = spots, b = streaks running
// down, a = fine scratches. Everything is a mix toward a fixed colour; nothing depends on time.
const WEAR_HEAD = `
varying vec3 vWP; varying vec3 vWN; uniform sampler2D uWear; uniform vec4 uWearK;
float wRough = 0.0, wMetal = 0.0, wAmt = 0.0;`;
const WEAR_COLOR = `
{ float cls = vRM.z < -0.5 ? floor(-vRM.z + 0.5) : 0.0;
  if (cls > 0.5) {
    vec3 an = abs(vWN); bool up = an.y > 0.6;
    vec2 wuv = up ? vWP.xz : (an.x > an.z ? vec2(vWP.z, vWP.y) : vec2(vWP.x, vWP.y));
    vec4 n1 = texture2D(uWear, wuv * 0.33), n2 = texture2D(uWear, wuv * vec2(1.6, up ? 1.6 : 0.8) + vec2(0.37, 0.61));
    float y = vWP.y, low = 1.0 - smoothstep(0.0, 0.42, y), grime = low * low * uWearK.x;
    vec3 c = diffuseColor.rgb, bare = vec3(0.16, 0.165, 0.17), rust = mix(vec3(0.20, 0.055, 0.012), vec3(0.34, 0.12, 0.03), n2.r);
    float chip = 0.0, rs = 0.0, sc = 0.0;
    if (cls < 1.5) {            // painted steel: chips through to bare metal, rust spots, rust streaks running down from the feet up
      chip = smoothstep(0.91, 0.95, n2.g + 0.12 * n1.r - 0.06 + 0.1 * low) * (up ? 0.35 : 1.0) * uWearK.z;
      rs = smoothstep(0.84, 0.9, n2.r * 0.5 + n1.g * 0.4 + low * 0.14 + (up ? 0.0 : (n2.b - 0.5) * 0.25)) * (0.25 + 0.75 * low) * 0.85 * uWearK.y;
    } else if (cls < 2.5) {     // plated / bare metal: a few rust pits, more low down; tarnish
      rs = smoothstep(0.86, 0.92, n2.g * 0.6 + n1.r * 0.4 + low * 0.25) * (0.4 + 0.6 * low) * uWearK.y; c *= 1.0 - 0.15 * n1.r * uWearK.z;
    } else if (cls < 3.5) {     // laminate, counters, wood: scuffs and dull worn patches
      sc = smoothstep(0.62, 0.8, n2.a) * (up ? 0.45 : 0.3 + 0.7 * smoothstep(0.55, 0.05, y)) * uWearK.w;
      c = mix(c, c * 1.35 + 0.015, smoothstep(0.55, 0.85, n1.r) * 0.45 * uWearK.w);
    } else if (cls < 4.5) {     // gold trim: rubbed dull and dark in patches
      float d = smoothstep(0.6, 0.82, n2.g * 0.7 + n1.r * 0.3) * uWearK.z; c = mix(c, c * vec3(0.5, 0.4, 0.25), d * 0.7); wRough = 0.75; wMetal = 0.2; wAmt = d * 0.7;
    } else if (cls < 5.5) {     // coloured paint: small chips, a little rust low down
      chip = smoothstep(0.93, 0.97, n2.g + 0.1 * n1.r) * uWearK.z; rs = smoothstep(0.86, 0.92, n2.r * 0.6 + n1.g * 0.4 + low * 0.3) * low * uWearK.y;
    } else if (cls < 6.5) {     // only near the floor
      rs = smoothstep(0.80, 0.88, n2.g * 0.6 + n1.r * 0.4 + low * 0.45) * low * uWearK.y;
    } else {                    // a worn edge: the paint rubbed through along most of it
      chip = smoothstep(0.56, 0.7, n2.g * 0.7 + n2.a * 0.3) * 0.75 * uWearK.z; bare *= 0.75; rs = smoothstep(0.84, 0.9, n2.r * 0.7 + n1.g * 0.3) * 0.6 * uWearK.y;
    }
    chip = min(chip, 1.0); rs = min(rs, 1.0); sc = min(sc, 1.0); grime = min(grime, 1.0);   // (heavier knobs, the ATL look's, never overshoot; at the default WEAR these are all <= 1 already)
    c = mix(c, bare * (0.8 + 0.5 * n2.a), chip); if (chip > 0.0) { wRough = 0.42; wMetal = 0.8; wAmt = max(wAmt, chip); }
    c = mix(c, c * 0.55 + vec3(0.05, 0.045, 0.04) * n2.a, sc);
    c = mix(c, rust, rs); if (rs > 0.0) { wRough = 0.88; wMetal = 0.12; wAmt = max(wAmt, rs); }
    c = mix(c, c * vec3(0.55, 0.5, 0.44), grime);
    diffuseColor.rgb = c;
  } }`;
/** a product geometry (products.js) gets the paint attribute it needs to be drawn alone with the paint material (the pickups) */
export function withRM(g, rm = [0.52, 0, 0]) { if (!g.attributes.aRM) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(rm, i * 3); g.setAttribute('aRM', new THREE.BufferAttribute(a, 3)); } return g; }
