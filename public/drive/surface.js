// Height queries against the REAL rendered triangles (not a formula), shared by the game and the QA scanner.
// Triangles are binned into an XZ grid once; a query is an exact point-in-triangle + barycentric height test —
// a vertical ray without a raycaster. Packed typed arrays keep it light enough for phones.
import * as THREE from './vendor/three.module.min.js';

export class TopSurface {
  constructor(meshes, cell = 8) {
    this.cell = cell; this.names = [];
    let n = 0;
    for (const m of meshes) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    this.tri = new Float32Array(n * 9); this.who = new Uint8Array(n);
    const lists = new Map(), v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let t = 0;
    meshes.forEach((m, mi) => {
      m.updateMatrixWorld(true); this.names[mi] = m.name;
      const P = m.geometry.attributes.position, I = m.geometry.index ? m.geometry.index.array : null, cnt = I ? I.length : P.count;
      for (let k = 0; k < cnt; k += 3, t++) {
        for (let q = 0; q < 3; q++) { v[q].fromBufferAttribute(P, I ? I[k + q] : k + q).applyMatrix4(m.matrixWorld); this.tri.set([v[q].x, v[q].y, v[q].z], t * 9 + q * 3); }
        this.who[t] = mi;
        const x0 = Math.floor(Math.min(v[0].x, v[1].x, v[2].x) / cell), x1 = Math.floor(Math.max(v[0].x, v[1].x, v[2].x) / cell);
        const z0 = Math.floor(Math.min(v[0].z, v[1].z, v[2].z) / cell), z1 = Math.floor(Math.max(v[0].z, v[1].z, v[2].z) / cell);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const key = gx * 65536 + gz; let l = lists.get(key); if (!l) lists.set(key, (l = [])); l.push(t); }
      }
    });
    this.grid = new Map(); for (const [k, l] of lists) this.grid.set(k, Int32Array.from(l));
    // each triangle's x/z bounds, padded 1 cm, so a query can skip the triangles it is nowhere near with four
    // comparisons before the exact test (the padding is far wider than the exact test's 1e-6 tolerance, so nothing it
    // would have found is skipped: same answers, a fraction of the work; the wheels, crowd and props ask ~500 times a frame)
    const T = this.tri, B = (this.box = new Float32Array(t * 4)), PAD = 0.01;
    for (let q = 0; q < t; q++) {
      const o = q * 9;
      B[q * 4] = Math.min(T[o], T[o + 3], T[o + 6]) - PAD; B[q * 4 + 1] = Math.max(T[o], T[o + 3], T[o + 6]) + PAD;
      B[q * 4 + 2] = Math.min(T[o + 2], T[o + 5], T[o + 8]) - PAD; B[q * 4 + 3] = Math.max(T[o + 2], T[o + 5], T[o + 8]) + PAD;
    }
  }
  /** highest surface at three-space (x, z) that is below `below`: { y, name } or null */
  top(x, z, below = Infinity) {
    const ids = this.grid.get(Math.floor(x / this.cell) * 65536 + Math.floor(z / this.cell)); if (!ids) return null;
    const T = this.tri, B = this.box; let bestY = -Infinity, bestW = -1;
    for (let q = 0; q < ids.length; q++) {
      const b = ids[q] * 4; if (x < B[b] || x > B[b + 1] || z < B[b + 2] || z > B[b + 3]) continue;
      const o = ids[q] * 9, ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (d > -1e-9 && d < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * ay + l2 * by + l3 * cy;
      if (y < below && y > bestY) { bestY = y; bestW = this.who[ids[q]]; }
    }
    return bestW < 0 ? null : { y: bestY, name: this.names[bestW] };
  }
}
