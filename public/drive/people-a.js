// Option A: a hand-built parametric person, much better than the old box person. Built once from lofted rings (smooth, tapered limbs, a
// head with a jaw, nose and ears, shoulders, a waist, hands, shoes) plus optional parts a person may or may not wear (hair in six styles,
// cap, backpack, hood, skirt/dress). Parts that are not worn collapse inside the torso in the vertex shader (the accessory mask, as the old
// person's cap/bag/hood did), so the whole crowd is still ONE draw per level of detail.
// The walk is analytic, in the vertex shader: hips, knees and ankles swing and bend, the arms swing opposite the legs with the elbows bending,
// the shoulders counter-rotate against the hips, the head stays level with a small nod, and the body drops so the lowest foot is always on the
// ground (that gives the bob for free). Phone-in-hand and the startle (hands up) are arm poses mixed in.
// Faces and clothes are painted per fragment by people-alt.js from the rest-pose position, so they stay crisp at any triangle count.
import * as THREE from './vendor/three.module.min.js';

const H = 1.74;   // standing height of the model, m (the crowd scales it by 0.9..1.1 per person)
const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ geometry builder
class Acc {
  constructor() { this.pos = []; this.idx = []; this.info = []; this.reg = []; this.reg2 = []; }
  get n() { return this.pos.length / 3; }
  vert(x, y, z, a) { this.pos.push(x, y, z); this.info.push(a.slot || 0, a.part || 0, a.seg || 0, a.bit || 0); this.reg.push(...(a.reg || [0, 0, 0, 0])); this.reg2.push(...(a.reg2 || [0, 0, 0, 0])); return this.n - 1; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setAttribute('aReg', new THREE.Float32BufferAttribute(this.reg, 4));
    g.setAttribute('aReg2', new THREE.Float32BufferAttribute(this.reg2, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
/** push triangle (a, b, c) so that its normal points the way `want` says (a cap fan: the vertex order depends on the ring order) */
function pushFacing(acc, a, b, c, want) {
  const P = acc.pos, ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  acc.idx.push(...(nx * want[0] + ny * want[1] + nz * want[2] >= 0 ? [a, b, c] : [a, c, b]));
}
const R = (y, cx, cz, rx, rz, g = 0) => ({ y, cx, cz, rx, rz, g });   // g: half the gap (rad) left open at the FRONT of this ring (0 = a closed ring)

/** a lofted tube around a vertical axis. attr(y, x, z, ring) -> per-vertex attributes. capTop / capBottom close the ends with a fan. */
function loft(acc, rings, n, attr, { capTop = false, capBottom = false } = {}) {
  const base = acc.n, open = rings.some((r) => r.g > 0), W = open ? n + 1 : n;
  const radial = [];
  rings.forEach((r, ri) => {
    const a0 = r.g, a1 = TAU - r.g;
    for (let j = 0; j < W; j++) {
      const t = open ? a0 + ((a1 - a0) * j) / n : (TAU * j) / n;
      const x = r.cx + r.rx * Math.sin(t), z = r.cz + r.rz * Math.cos(t);
      acc.vert(x, r.y, z, attr(r.y, x, z, ri, r));
      radial.push([x - r.cx, 0, z - r.cz]);
    }
  });
  const tris = [];
  for (let ri = 0; ri + 1 < rings.length; ri++) for (let j = 0; j < (open ? n : n); j++) {
    const jn = open ? j + 1 : (j + 1) % n;
    const a = base + ri * W + j, b = base + ri * W + jn, c = base + (ri + 1) * W + j, d = base + (ri + 1) * W + jn;
    tris.push([a, c, b], [b, c, d]);
  }
  const first = rings[0], last = rings[rings.length - 1];
  const caps = [];
  const cap = (ri, top) => {
    const r = rings[ri], c = acc.vert(r.cx, r.y, r.cz, attr(r.y, r.cx, r.cz, ri, r));
    for (let j = 0; j < n; j++) { const jn = open ? j + 1 : (j + 1) % n; caps.push([c, base + ri * W + j, base + ri * W + jn, [0, top ? 1 : -1, 0]]); }
    radial.push([0, 0, 0]);
  };
  const wantUp = first.y > last.y;   // ring order top→bottom or bottom→top decides which end is which
  if (capTop) cap(wantUp ? 0 : rings.length - 1, true);
  if (capBottom) cap(wantUp ? rings.length - 1 : 0, false);
  // orient: make the strip's normals point away from the axis (the cap fans are fixed by their own order, so test only the strip)
  const P = acc.pos; let score = 0;
  for (let k = 0; k < tris.length; k++) {
    const [a, b, c] = tris[k], ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx, rd = radial[a - base] || [0, 0, 0];
    score += nx * rd[0] + nz * rd[2];
  }
  const flip = score < 0;
  for (const [a, b, c] of tris) acc.idx.push(...(flip ? [a, c, b] : [a, b, c]));
  for (const [a, b, c, want] of caps) pushFacing(acc, a, b, c, want);
}

/** a lofted tube along Z (shoes): rings {z, cx, cy, rx, ry}; θ = 0 is up */
function loftZ(acc, rings, n, attr, { capEnds = true } = {}) {
  const base = acc.n, radial = [];
  rings.forEach((r, ri) => {
    for (let j = 0; j < n; j++) {
      const t = (TAU * j) / n, x = r.cx + r.rx * Math.sin(t), y = r.cy + r.ry * Math.cos(t);
      acc.vert(x, y, r.z, attr(y, x, r.z, ri, r)); radial.push([x - r.cx, y - r.cy, 0]);
    }
  });
  const tris = [];
  for (let ri = 0; ri + 1 < rings.length; ri++) for (let j = 0; j < n; j++) {
    const jn = (j + 1) % n, a = base + ri * n + j, b = base + ri * n + jn, c = base + (ri + 1) * n + j, d = base + (ri + 1) * n + jn;
    tris.push([a, c, b], [b, c, d]);
  }
  const P = acc.pos; let score = 0;
  for (const [a, b, c] of tris) {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, rd = radial[a - base];
    score += nx * rd[0] + ny * rd[1];
  }
  const flip = score < 0;
  for (const [a, b, c] of tris) acc.idx.push(...(flip ? [a, c, b] : [a, b, c]));
  if (capEnds) for (const [ri, dir] of [[0, -1], [rings.length - 1, 1]]) {
    const r = rings[ri], c = acc.vert(r.cx, r.cy, r.z, attr(r.cy, r.cx, r.z, ri, r));
    for (let j = 0; j < n; j++) { const jn = (j + 1) % n; pushFacing(acc, c, base + ri * n + j, base + ri * n + jn, [0, 0, dir]); }
  }
}

function box(acc, w, h, d, x, y, z, a) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(), p = g.attributes.position;
  const base = acc.n;
  for (let i = 0; i < p.count; i++) { acc.vert(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z, a); acc.idx.push(base + i); }
}

/** build the person at a level of detail. lod 0: ~1.4k triangles with every optional part; lod 1: a ~250-triangle silhouette */
export function buildPerson(lod) {
  const acc = new Acc(), far = lod > 0;
  const N = far ? { torso: 6, leg: 4, arm: 4, head: 6, shoe: 4, hair: 6 } : { torso: 9, leg: 7, arm: 6, head: 12, shoe: 6, hair: 8 };
  const thin = (rs, keepFar) => (far && keepFar ? keepFar.map((i) => rs[i]) : rs);   // (far: only the listed rings)
  const MORPH = (y, z, rz) => {   // x scale weights by region: [shoulders, hips, front bump (bust above the ribs, belly below)]
    const fr = Math.max(0, Math.min(1, z / (rz || 1)));
    return [smooth(1.28, 1.42, y), 1 - smooth(0.93, 1.05, y), fr * (Math.exp(-(((y - 1.25) / 0.07) ** 2)) + Math.exp(-(((y - 1.04) / 0.075) ** 2)))];
  };

  // --- torso (hips to shoulders), part 0
  loft(acc, thin([R(1.47, 0, 0, 0.058, 0.052), R(1.44, 0, 0, 0.125, 0.074), R(1.385, 0, 0, 0.172, 0.090), R(1.34, 0, 0.004, 0.180, 0.106), R(1.25, 0, 0.005, 0.172, 0.112),
    R(1.15, 0, 0.002, 0.160, 0.095), R(1.06, 0, 0.003, 0.150, 0.088), R(0.98, 0, 0, 0.165, 0.096), R(0.90, 0, 0, 0.178, 0.104), R(0.83, 0, 0, 0.172, 0.100), R(0.79, 0, 0, 0.12, 0.08)], [0, 2, 4, 7, 9]), N.torso,
    (y, x, z, ri, r) => ({ slot: 0, part: 0, reg: [0, 0, 0, 0], reg2: [0, ...MORPH(y, z, r.rz)] }), { capTop: true, capBottom: true });

  // --- neck + head (part 6: the head stays level while the shoulders turn)
  loft(acc, thin([R(1.435, 0, 0.005, 0.048, 0.050), R(1.50, 0, 0.012, 0.046, 0.050), R(1.545, 0, 0.014, 0.046, 0.050)], [0, 2]), far ? 4 : 6, () => ({ part: 6 }));
  const HEAD = [R(1.495, 0, 0.045, 0.035, 0.045), R(1.515, 0, 0.035, 0.066, 0.078), R(1.55, 0, 0.025, 0.078, 0.090), R(1.60, 0, 0.015, 0.082, 0.100), R(1.65, 0, 0.010, 0.082, 0.102),
    R(1.70, 0, 0.005, 0.076, 0.095), R(1.73, 0, 0, 0.054, 0.068), R(1.745, 0, 0, 0.022, 0.032)];
  loft(acc, far ? [HEAD[0], HEAD[3], HEAD[6], HEAD[7]] : HEAD, N.head, () => ({ part: 6 }), { capTop: true, capBottom: true });
  if (!far) {
    for (const s of [-1, 1]) loft(acc, [R(1.648, s * 0.084, -0.005, 0.012, 0.018), R(1.62, s * 0.088, -0.005, 0.016, 0.022), R(1.592, s * 0.084, -0.005, 0.011, 0.016)], 4, () => ({ part: 6 }), { capTop: true, capBottom: true });   // ears
    loft(acc, [R(1.626, 0, 0.100, 0.005, 0.006), R(1.606, 0, 0.104, 0.010, 0.014), R(1.585, 0, 0.102, 0.014, 0.016)], 5, () => ({ part: 6 }), { capTop: true, capBottom: true });   // nose
  }

  // --- arms (part 3 at x < 0, part 4 at x > 0); seg: 0 upper arm … 1 forearm, blended across the elbow
  for (const [s, part] of [[-1, 3], [1, 4]]) {
    const armS = (y) => Math.max(0, Math.min(1, (1.40 - y) / 0.55));
    const seg = (y) => 1 - smooth(1.04, 1.16, y);
    const A = (y, c, r) => R(y, s * c, 0, r, r);
    loft(acc, thin([A(1.445, 0.160, 0.022), A(1.42, 0.181, 0.044), A(1.395, 0.192, 0.052), A(1.30, 0.200, 0.047), A(1.18, 0.208, 0.040), A(1.10, 0.213, 0.038), A(1.02, 0.217, 0.040), A(0.85, 0.224, 0.026)], [1, 4, 7]), N.arm,
      (y) => ({ part, seg: seg(y), reg: [1, 0, 0, 0], reg2: [armS(y), 1, 0, 0] }), { capTop: true });
    loft(acc, thin([R(0.852, s * 0.225, 0, 0.030, 0.020), R(0.80, s * 0.227, 0.002, 0.038, 0.018), R(0.75, s * 0.228, 0.004, 0.034, 0.016), R(0.705, s * 0.228, 0.006, 0.014, 0.010)], [0, 3]), far ? 4 : 5,
      (y) => ({ part, seg: 1, reg: [1, 0, 1, 0], reg2: [armS(y), 1, 0, 0] }), { capBottom: true });
  }
  // --- legs (part 1 at x < 0, part 2 at x > 0); seg: 0 thigh … 1 shin, blended across the knee; shoes seg 2 (rotate about the ankle too)
  for (const [s, part] of [[-1, 1], [1, 2]]) {
    const seg = (y) => 1 - smooth(0.43, 0.56, y);
    const L = (y, c, rx, rz) => R(y, s * c, 0, rx, rz);
    loft(acc, thin([L(0.92, 0.090, 0.062, 0.062), L(0.79, 0.090, 0.084, 0.086), L(0.70, 0.089, 0.074, 0.080), L(0.58, 0.088, 0.060, 0.064), L(0.49, 0.087, 0.054, 0.058), L(0.40, 0.086, 0.054, 0.064),
      L(0.27, 0.086, 0.045, 0.052), L(0.085, 0.086, 0.034, 0.034)], [0, 4, 7]), N.leg,
      (y) => ({ part, seg: seg(y), reg: [0, 1, 0, 0], reg2: [0, 0, 1, 0] }), { capTop: true });
    const Z = (z, cy, rx, ry) => ({ z, cy, cx: s * 0.086, rx, ry });
    loftZ(acc, far ? [Z(-0.06, 0.05, 0.036, 0.05), Z(0.21, 0.025, 0.02, 0.025)] : [Z(-0.068, 0.052, 0.034, 0.048), Z(-0.04, 0.055, 0.040, 0.055), Z(0.04, 0.054, 0.043, 0.052), Z(0.12, 0.042, 0.044, 0.040), Z(0.19, 0.030, 0.036, 0.028), Z(0.218, 0.022, 0.018, 0.020)], N.shoe,
      () => ({ part, seg: 2, reg: [0, 1, 0, 1], reg2: [0, 0, 0.5, 0] }));
  }

  // --- hair and what's on the head. Slots: 1 hair, 2 cap, 3 backpack, 4 hood, 5 skirt. Bits (people-alt.js BIT): which people wear it.
  const hairA = (bit) => () => ({ slot: 1, part: 6, bit });
  const T = 0.012;   // hair thickness over the skull
  // the scalp: closed over the crown, with an open front (the face) and a hairline that sweeps back to the nape
  const scalp = [R(1.755, 0, 0, 0.02, 0.03, 0), R(1.738, 0, 0, 0.056 + T, 0.068 + T, 0.0), R(1.705, 0, 0.005, 0.077 + T, 0.096 + T, 0.55), R(1.66, 0, 0.01, 0.083 + T, 0.103 + T, 1.15), R(1.615, 0, 0.012, 0.084 + T, 0.101 + T, 1.75), R(1.57, 0, 0.02, 0.080 + T, 0.093 + T, 2.45)];
  if (!far) loft(acc, scalp, N.hair, hairA(2));
  else loft(acc, [scalp[0], scalp[2], scalp[4]], 6, hairA(2));
  // an afro: a round cloud around the head
  loft(acc, far ? [R(1.85, 0, -0.01, 0.03, 0.03), R(1.78, 0, -0.01, 0.15, 0.15), R(1.66, 0, -0.01, 0.15, 0.15, 1.0)] : [R(1.855, 0, -0.01, 0.03, 0.03), R(1.82, 0, -0.01, 0.11, 0.11), R(1.75, 0, -0.01, 0.165, 0.165), R(1.67, 0, -0.01, 0.16, 0.16, 0.5), R(1.57, 0, -0.01, 0.11, 0.11, 1.5)], far ? 7 : 8, hairA(32));
  // long hair: a sheet down the back to the shoulder blades
  loft(acc, far ? [R(1.62, 0, 0.0, 0.098, 0.112, 1.25), R(1.28, 0, -0.045, 0.14, 0.10, 1.55)] : [R(1.64, 0, 0.0, 0.098, 0.112, 1.15), R(1.55, 0, -0.012, 0.104, 0.116, 1.3), R(1.44, 0, -0.03, 0.13, 0.108, 1.45), R(1.34, 0, -0.045, 0.14, 0.10, 1.55), R(1.26, 0, -0.05, 0.13, 0.09, 1.7)], far ? 5 : 7, hairA(4));
  // a bun on top, a ponytail from the back of the head
  loft(acc, far ? [R(1.77, 0, -0.085, 0.01, 0.01), R(1.72, 0, -0.085, 0.05, 0.05), R(1.67, 0, -0.085, 0.01, 0.01)] : [R(1.775, 0, -0.085, 0.012, 0.012), R(1.735, 0, -0.085, 0.048, 0.048), R(1.69, 0, -0.085, 0.045, 0.045), R(1.668, 0, -0.085, 0.012, 0.012)], far ? 5 : 6, hairA(8));
  loft(acc, far ? [R(1.72, 0, -0.11, 0.04, 0.04), R(1.38, 0, -0.14, 0.018, 0.018)] : [R(1.74, 0, -0.105, 0.03, 0.03), R(1.66, 0, -0.13, 0.042, 0.04), R(1.52, 0, -0.14, 0.032, 0.03), R(1.38, 0, -0.145, 0.014, 0.014)], far ? 5 : 6, hairA(16), { capBottom: true });
  // locs / braids: a few thin ropes hanging from the crown
  const nL = far ? 2 : 4;
  for (let k = 0; k < nL; k++) {
    const t = Math.PI + (k - (nL - 1) / 2) * (far ? 1.2 : 0.7), x0 = Math.sin(t) * 0.093, z0 = Math.cos(t) * 0.104 - 0.005, f = 1.18;
    loft(acc, [R(1.68, x0, z0, 0.017, 0.017), R(1.52, x0 * f, z0 * f - 0.012, 0.015, 0.015), R(1.36, x0 * f * 1.05, z0 * f - 0.03, 0.008, 0.008)], 4, hairA(64), { capBottom: true });
  }
  // cap: dome + brim
  loft(acc, [R(1.78, 0, 0, 0.01, 0.01), R(1.76, 0, 0, 0.075, 0.088), R(1.722, 0, 0.003, 0.098, 0.112), R(1.684, 0, 0.004, 0.100, 0.114)], far ? 6 : 8, () => ({ slot: 2, part: 6, bit: 1 }));
  {
    const br = [{ y: 1.684, rx: 0.100, rz: 0.114 }, { y: 1.680, rx: 0.112, rz: 0.205 }], base = acc.n, m = far ? 3 : 5;
    br.forEach((r) => { for (let j = 0; j <= m; j++) { const t = -0.95 + (1.9 * j) / m; acc.vert(r.rx * Math.sin(t), r.y, 0.004 + r.rz * Math.cos(t), { slot: 2, part: 6, bit: 1 }); } });
    for (let j = 0; j < m; j++) { const a = base + j, b = base + j + 1, c = base + (m + 1) + j, d = base + (m + 1) + j + 1; acc.idx.push(a, b, c, b, d, c); }
  }
  // backpack
  box(acc, 0.30, 0.38, 0.14, 0, 1.18, -0.165, { slot: 3, part: 0, bit: 128 });
  // hood (bunched behind the neck)
  loft(acc, far ? [R(1.40, 0, -0.05, 0.12, 0.09, 1.2), R(1.60, 0, -0.03, 0.10, 0.11, 1.4)] : [R(1.38, 0, -0.04, 0.13, 0.10, 1.1), R(1.48, 0, -0.058, 0.122, 0.118, 1.2), R(1.61, 0, -0.03, 0.098, 0.108, 1.4)], far ? 5 : 8, () => ({ slot: 4, part: 0, bit: 256 }));
  // skirt / dress: flares from the waist to the knee; the hem follows the legs a little (seg = how far down the hem is)
  loft(acc, far ? [R(1.06, 0, 0, 0.15, 0.092), R(0.60, 0, 0, 0.36, 0.23)] : [R(1.06, 0, 0, 0.152, 0.093), R(0.93, 0, 0, 0.21, 0.13), R(0.76, 0, 0, 0.29, 0.185), R(0.60, 0, 0, 0.35, 0.225)], far ? 6 : 8,
    (y) => ({ slot: 5, part: 5, seg: Math.min(1, Math.max(0, (1.06 - y) / 0.46)), bit: 512 }));
  return acc.geometry();
}

// ------------------------------------------------------------------ the walk, in the vertex shader
const POSE_DECL = /* glsl */`
const float HIP_Y = 0.90, KNEE_Y = 0.49, ANK_Y = 0.085, SH_Y = 1.40, ELB_Y = 1.10, STAND = ${H.toFixed(2)};
void pedLeg(float ph, float amp, out float hip, out float knee, out float ank) {
  hip = 0.40 * amp * sin(ph);                                          // + swings the leg back
  float swing = max(0.0, -cos(ph - 0.45));                             // the leg is moving forward: knee bends
  knee = amp * (0.07 + 0.88 * pow(swing, 1.5));
  float pitch = 0.65 * hip + 0.05 * amp;                               // the foot's own tilt: toe up at heel strike, toe down at push-off
  ank = pitch - hip - knee;
}
float pedRise(float hip, float knee) { return 0.815 - 0.41 * cos(hip) - 0.405 * cos(hip + knee); }   // how far the ankle is lifted by the leg's pose
vec3 pedAbout(mat3 R, vec3 p, vec3 c) { return R * (p - c) + c; }
void pedPose(out vec3 pos, out vec3 nrm, out vec3 pedRest) {
  vec3 p = position, n = normal;
  float part = aInfo.y, seg = aInfo.z, amp = clamp(iAnim.y, 0.0, 1.15), ph = iAnim.x, masc = iHair.z;
  // body shape: shoulders and hips by masculinity, a bust / belly bump
  float sK = mix(-0.09, 0.07, masc), hK = mix(0.16, -0.03, masc);
  p.x *= 1.0 + sK * aReg2.y + hK * aReg2.z;
  p.z += aReg2.w * (p.y > 1.15 ? (1.0 - masc) * 0.026 : iPose.w * 0.04);
  pedRest = p / STAND;
  float hL, kL, aL, hR, kR, aR;
  pedLeg(ph, amp, hL, kL, aL); pedLeg(ph + 3.14159265, amp, hR, kR, aR);
  float lift = min(pedRise(hL, kL), pedRise(hR, kR));                  // the lowest foot stays on the ground: the body drops by that much
  vec3 H = vec3(0.0, HIP_Y, 0.0), K = vec3(0.0, KNEE_Y, 0.0), A = vec3(0.0, ANK_Y, 0.0), S = vec3(0.0, SH_Y, 0.0), E = vec3(0.0, ELB_Y, 0.0);
  float upper = 0.0;                                                    // 1 for what turns with the shoulders
  if (part > 0.5 && part < 2.5) {                                      // legs
    bool left = part < 1.5;
    float hip = left ? hL : hR, knee = left ? kL : kR, ank = left ? aL : aR;
    mat3 Rh = pedRotX(hip), Rk = pedRotX(knee), Ra = pedRotX(ank);
    vec3 pU = pedAbout(Rh, p, H), pL = Rh * (Rk * (p - K) + K - H) + H, pF = Rh * (Rk * (Ra * (p - A) + A - K) + K - H) + H;
    vec3 nU = Rh * n, nL = Rh * Rk * n, nF = Rh * Rk * Ra * n;
    if (seg > 1.5) { p = pF; n = nF; } else { float w = clamp(seg, 0.0, 1.0); p = mix(pU, pL, w); n = normalize(mix(nU, nL, w)); }
  } else if (part > 2.5 && part < 4.5) {                               // arms
    bool left = part < 3.5;
    float sA = sin(left ? ph + 3.14159265 : ph);
    float as = 0.30 * amp * sA, el = -(0.12 + 0.30 * amp * (0.5 - 0.5 * sA));
    if (!left && iPose.x > 0.5) { as = -0.55; el = -1.9; }              // the phone, at the chest
    as = mix(as, -2.5, iPose.y); el = mix(el, -0.35, iPose.y);           // hands up
    mat3 Rs = pedRotX(as), Re = pedRotX(el);
    vec3 pU = pedAbout(Rs, p, S), pL = Rs * (Re * (p - E) + E - S) + S;
    float w = clamp(seg, 0.0, 1.0);
    p = mix(pU, pL, w); n = normalize(mix(Rs * n, Rs * Re * n, w));
    upper = 1.0;
  } else if (part > 4.5 && part < 5.5) {                               // the skirt: its hem follows the leg on its side
    float hip = (p.x < 0.0 ? hL : hR) * 0.5 * seg;
    mat3 Rh = pedRotX(hip); p = pedAbout(Rh, p, H); n = Rh * n;
  } else {                                                              // torso, head, hair, hood, pack
    upper = part > 5.5 ? 1.0 : smoothstep(0.90, 1.30, p.y);
    if (part > 5.5) { mat3 Rn = pedRotX(0.03 * amp * sin(2.0 * ph)); vec3 C = vec3(0.0, 1.50, 0.0); p = pedAbout(Rn, p, C); n = Rn * n; }   // a small nod
  }
  if (part > 2.5 && part < 4.5) upper = 1.0;
  float psi = 0.10 * amp * sin(ph);                                    // the shoulders turn against the hips
  float yaw = psi * (-0.5 + 1.5 * upper);
  if (part > 5.5) yaw -= psi * 0.85;                                   // the head keeps facing front
  mat3 Ry = pedRotY(yaw);
  p = Ry * p; n = Ry * n;
  p.y -= lift;
  p.z += p.y * iAnim.w;                                                 // lean (into the walk / away from a startle)
  pos = p; nrm = normalize(n);
}
`;

const FACE = Array.from({ length: 8 }, () => new THREE.Vector4(1.63 / H, 0.034 / H, 1.554 / H, 0.098 / H));

/** the variant object people-alt.js draws */
export function makeA() {
  return { name: 'A', lods: [buildPerson(0), buildPerson(1)].map((geo) => ({ geo, uniforms: {}, decl: POSE_DECL })), face: FACE, bodies: 1, hf: true };
}
