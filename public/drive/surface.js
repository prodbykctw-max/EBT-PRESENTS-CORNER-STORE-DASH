// Height queries against the REAL rendered triangles (not a formula), shared by the game and the QA scanner.
// Triangles are binned into an XZ grid once; a query is an exact point-in-triangle + barycentric height test —
// a vertical ray without a raycaster. Packed typed arrays keep it light enough for phones.
import * as THREE from './vendor/three.module.min.js';

export class TopSurface {
  /** `keep(minX, minZ, maxX, maxZ)` (optional): only the triangles whose x/z bounds it accepts are kept (the crowd's ground: just the
   *  ones near the route; a triangle is judged by all three corners, so a park's few huge triangles are not missed) */
  constructor(meshes, cell = 8, keep = null) {
    this.cell = cell; this.names = [];
    let n = 0; const kept = keep ? [] : null;
    meshes.forEach((m, mi) => {
      const P = m.geometry.attributes.position, I = m.geometry.index ? m.geometry.index.array : null, cnt = I ? I.length : P.count;
      if (!keep) { n += cnt / 3; return; }
      m.updateMatrixWorld(true); const e = m.matrixWorld.elements, ok = new Uint8Array(cnt / 3);
      const ident = e[0] === 1 && e[5] === 1 && e[10] === 1 && e[12] === 0 && e[13] === 0 && e[14] === 0 && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[6] === 0 && e[8] === 0 && e[9] === 0;
      // (plain float arrays read directly: this pass looks at every triangle of the meshes it is given)
      const A = P.isInterleavedBufferAttribute || P.normalized || P.itemSize !== 3 ? null : P.array;   // (plain 3-float arrays read directly; anything else through getX/Y/Z)
      for (let k = 0, t = 0; k < cnt; k += 3, t++) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let q = 0; q < 3; q++) {
          const i = I ? I[k + q] : k + q;
          const x = A ? A[i * 3] : P.getX(i), y = A ? A[i * 3 + 1] : P.getY(i), z = A ? A[i * 3 + 2] : P.getZ(i);
          const wx = ident ? x : e[0] * x + e[4] * y + e[8] * z + e[12], wz = ident ? z : e[2] * x + e[6] * y + e[10] * z + e[14];
          if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wz < z0) z0 = wz; if (wz > z1) z1 = wz;
        }
        if (keep(x0, z0, x1, z1)) { ok[t] = 1; n++; }
      }
      kept[mi] = ok;
    });
    this.tri = new Float32Array(n * 9); this.who = new Uint16Array(n);
    const lists = new Map(), W = new Float64Array(9), T0 = this.tri;
    let t = 0;
    meshes.forEach((m, mi) => {
      m.updateMatrixWorld(true); this.names[mi] = m.name;
      const P = m.geometry.attributes.position, I = m.geometry.index ? m.geometry.index.array : null, cnt = I ? I.length : P.count;
      const e = m.matrixWorld.elements, A = P.isInterleavedBufferAttribute || P.normalized || P.itemSize !== 3 ? null : P.array, ok = kept ? kept[mi] : null;
      for (let k = 0, ti = 0; k < cnt; k += 3, ti++) {
        if (ok && !ok[ti]) continue;
        for (let q = 0; q < 3; q++) {
          const i = I ? I[k + q] : k + q;
          const x = A ? A[i * 3] : P.getX(i), y = A ? A[i * 3 + 1] : P.getY(i), z = A ? A[i * 3 + 2] : P.getZ(i);
          W[q * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; W[q * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; W[q * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        }
        for (let q = 0; q < 9; q++) T0[t * 9 + q] = W[q];
        this.who[t] = mi;
        const x0 = Math.floor(Math.min(W[0], W[3], W[6]) / cell), x1 = Math.floor(Math.max(W[0], W[3], W[6]) / cell);
        const z0 = Math.floor(Math.min(W[2], W[5], W[8]) / cell), z1 = Math.floor(Math.max(W[2], W[5], W[8]) / cell);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const key = gx * 65536 + gz; let l = lists.get(key); if (!l) lists.set(key, (l = [])); l.push(t); }
        t++;
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
