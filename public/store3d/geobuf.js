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
  lip: ['#f6efc0', 0.5, 0], trimBlue: ['#2f6fd6', 0.35, 0.2], trimRed: ['#c1272d', 0.35, 0.2], trimGold: ['#f5c518', 0.3, 0.6],
  chrome: ['#cfd4da', 0.22, 1.0], lam: ['#171c3e', 0.42, 0.1], top: ['#2d313f', 0.28, 0.25], belt: ['#2a2c33', 0.8, 0], dark: ['#15171d', 0.5, 0.3],
  screen: ['#3a86e8', 0.2, 0, 1.4], lamp: ['#35d070', 0.3, 0, 1.2], door: ['#24160f', 0.6, 0.1], doorframe: ['#e0a01c', 0.4, 0.4], bar: ['#cfd4da', 0.25, 1],
  wallcap: ['#1b1f3c', 0.8, 0.05], cart: ['#8a909c', 0.42, 0.75], cartRed: ['#b3262f', 0.5, 0.1], corral: ['#5a6070', 0.6, 0.4],
  card: ['#b88a5a', 0.85, 0], cardDark: ['#8d6640', 0.9, 0], wrap: ['#e8eef4', 0.25, 0], pot: ['#8a4a2a', 0.7, 0], soil: ['#2a1c12', 1, 0],
  leaf: ['#2f7d3a', 0.6, 0], leaf2: ['#4a9d48', 0.6, 0], mat: ['#4a1218', 0.95, 0], frame: ['#9aa1ab', 0.3, 0.85], kick: ['#2a2f45', 0.5, 0.3],
};
const col = new THREE.Color();

export class GeoBuf {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.R = []; }
  get count() { return this.P.length / 3; }
  _v(x, y, z, nx, ny, nz, u, v, c, rm) { this.P.push(x, y, z); this.N.push(nx, ny, nz); this.U.push(u, v); this.C.push(c.r, c.g, c.b); this.R.push(rm[0], rm[1], rm[2]); }
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
    const p = typeof paint === 'string' ? PAINT[paint] || PAINT.default : paint, c = col.set(p[0]).clone(), rm = [p[1], p[2], p[3] || 0];
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
    const p = typeof paint === 'string' ? PAINT[paint] || PAINT.default : paint, c0 = col.set(p[0]).clone(), r0 = rm || [p[1], p[2], p[3] || 0];
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, cc = g.attributes.color, rr = g.attributes.aRM, idx = g.index;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), n = new THREE.Vector3(), cv = new THREE.Color(), n0 = idx ? idx.count : pos.count;
    for (let k = 0; k < n0; k++) {
      const i = idx ? idx.getX(k) : k;
      v.fromBufferAttribute(pos, i).applyMatrix4(m); n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      const c = cc ? cv.fromBufferAttribute(cc, i) : c0, r = rr ? [rr.getX(i), rr.getY(i), rr.getZ(i)] : r0;
      this._v(v.x, v.y, v.z, n.x, n.y, n.z, uv ? uv.getX(i) : 0.5, uv ? uv.getY(i) : 0.5, c, r);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.R, 3)); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}

/** the paint material: a MeshStandardMaterial whose roughness, metalness and glow come per vertex (aRM), colour per vertex, map = an atlas */
export function paintMaterial(map, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 1, metalness: 1, ...extra });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRM;\nvarying vec3 vRM;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = aRM;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRM;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vRM.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vRM.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vRM.z;');
  };
  mat.customProgramCacheKey = () => 'store3d-paint';
  return mat;
}
/** a product geometry (products.js) gets the paint attribute it needs to be drawn alone with the paint material (the pickups) */
export function withRM(g, rm = [0.52, 0, 0]) { if (!g.attributes.aRM) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(rm, i * 3); g.setAttribute('aRM', new THREE.BufferAttribute(a, 3)); } return g; }
