// The pickups' own models where no usable scanned model was reachable (see items/CREDITS.txt): finer procedural shapes than the shelf
// stock in products.js, made here, no brands. Real sizes in metres, front facing +z (the camera), base at y = 0, origin in the middle.
// Same vertex format as products.js (colour per vertex, roughness / metalness in aRM, labels from the atlas), so they draw with the
// store's one paint material, one draw call each. Deterministic: the crust and skin grain come from a hash noise, never Math.random.
import * as THREE from '../drive/vendor/three.module.min.js';
import { part, merge, RM } from './products.js';

// value noise on the integer lattice, smooth in between (hash: no state, no Math.random)
function hash(x, y, z) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), s = (t) => t * t * (3 - 2 * t), fx = s(x - xi), fy = s(y - yi), fz = s(z - zi), L = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash(xi + i, yi + j, zi + k);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), fx), L(c(0, 1, 0), c(1, 1, 0), fx), fy), L(L(c(0, 0, 1), c(1, 0, 1), fx), L(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
const fbm = (x, y, z, o = 3) => { let a = 0, w = 0.5, f = 1, t = 0; for (let i = 0; i < o; i++) { a += w * vnoise(x * f, y * f, z * f); t += w; w *= 0.5; f *= 2.03; } return a / t; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const C = (h) => new THREE.Color(h);

/** a surface from pos(u, v) on an (nu x nv) grid (u wraps when closed), uv 0..1, smooth normals */
function surface(pos, nu, nv, closedU = true) {
  const P = [], UV = [], I = [], cols = closedU ? nu : nu + 1;
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) { const u = i / nu, v = j / nv; P.push(...pos(u, v)); UV.push(u, v); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * cols + i, b = j * cols + ((i + 1) % cols), c = a + cols, d = b + cols; I.push(a, b, d, a, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals();
  return g;
}
/** colour every vertex from its position and normal (after part() placed it): fn(p, n) -> THREE.Color */
function paint(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color, v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { const k = fn(v.fromBufferAttribute(p, i), w.fromBufferAttribute(n, i)); c.setXYZ(i, k.r, k.g, k.b); }
  return g;
}
/** push every vertex out along its normal by d(p) (before part(); then the normals are recomputed) */
function bump(g, d) {
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); w.fromBufferAttribute(n, i); v.addScaledVector(w, d(v)); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
/** an ellipsoid (radii rx, ry, rz) */
const ellipsoid = (rx, ry, rz, a = 24, b = 16) => { const g = new THREE.SphereGeometry(1, a, b); g.scale(rx, ry, rz); g.computeVertexNormals(); return g; };

// ---- the roast chicken (the game's CHICKEN icon is a whole roast chicken in a black tray) ----
const SKIN = [C('#6e3210'), C('#a3561b'), C('#cf8536'), C('#eab067')];   // deep, roast, golden, glaze highlight
function skin(p, n) {
  const g = fbm(p.x * 70, p.y * 70, p.z * 70), spot = fbm(p.x * 160 + 7, p.y * 160, p.z * 160 + 3, 2);
  let t = clamp01(0.42 + 0.42 * n.y + 0.5 * (g - 0.5) + 2.2 * (p.y - 0.06));   // browner low and in the folds, golden on top
  const c = t < 0.5 ? SKIN[0].clone().lerp(SKIN[1], t * 2) : t < 0.85 ? SKIN[1].clone().lerp(SKIN[2], (t - 0.5) / 0.35) : SKIN[2].clone().lerp(SKIN[3], (t - 0.85) / 0.15);
  if (spot > 0.66) c.lerp(SKIN[0], Math.min(1, (spot - 0.66) * 4));   // roasted spots
  return c;
}
const crust = (amp, f) => (v) => amp * (fbm(v.x * f, v.y * f, v.z * f) - 0.5);
/** a drumstick from a (the meaty end) to b (the bone tip), meat radius r */
function drumstick(a, b, r) {
  const L = a.distanceTo(b), rb = r * 0.3;
  const R = (t) => t < 0.14 ? r * Math.sqrt(Math.max(0, 1 - ((0.14 - t) / 0.14) ** 2)) : t < 0.42 ? r : t < 0.76 ? r + (rb - r) * ((x) => x * x * (3 - 2 * x))((t - 0.42) / 0.34) : t < 0.9 ? rb : rb * (1 + 0.55 * Math.sin(Math.PI * Math.min(1, (t - 0.9) / 0.07) * 0.5)) * Math.sqrt(Math.max(0, 1 - Math.max(0, (t - 0.94) / 0.06) ** 2));
  const g = surface((u, v) => { const a2 = u * Math.PI * 2, rr = R(v); return [rr * Math.cos(a2), rr * Math.sin(a2) * 0.92, v * L]; }, 16, 24);
  bump(g, (p) => (p.z < L * 0.72 ? crust(0.0022, 120)(p) : 0));
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0)), q = new THREE.Quaternion().setFromRotationMatrix(m);
  // lookAt points -z at the target: turn so +z (our axis) runs from a to b
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
  return { g, a, b, L };
}
function roastChicken() {
  const P = [], BONE = C('#ecd9b4');
  // the black plastic tray: a floor and a rim
  const TW = 0.27, TD = 0.21, TH = 0.034, tr = [0.32, 0];
  P.push(part(new THREE.BoxGeometry(TW, 0.008, TD), { color: '#141418', pos: [0, 0.004, 0], rm: tr }));
  for (const [w, d, x, z] of [[TW, 0.012, 0, TD / 2 - 0.006], [TW, 0.012, 0, -TD / 2 + 0.006], [0.012, TD, TW / 2 - 0.006, 0], [0.012, TD, -TW / 2 + 0.006, 0]]) P.push(part(new THREE.BoxGeometry(w, TH, d), { color: '#1b1b20', pos: [x, TH / 2, z], rm: tr }));
  for (const [w, d, x, z] of [[TW + 0.012, 0.02, 0, TD / 2 + 0.002], [TW + 0.012, 0.02, 0, -TD / 2 - 0.002], [0.02, TD + 0.012, TW / 2 + 0.002, 0], [0.02, TD + 0.012, -TW / 2 - 0.002, 0]]) P.push(part(new THREE.BoxGeometry(w, 0.004, d), { color: '#202027', pos: [x, TH, z], rm: tr }));   // the lip
  const Y0 = 0.008;
  // the body: breast up, a soft keel, a flat underside, narrower toward the neck (-z)
  const body = new THREE.SphereGeometry(1, 32, 20), bp = body.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i), taper = 1 - 0.16 * Math.max(0, -z) + 0.05 * Math.max(0, z);
    bp.setXYZ(i, x * 0.074 * taper, (y > 0 ? y * 0.064 * (1 + 0.13 * (1 - Math.abs(x)) ** 2) : y * 0.022) + 0.024 + Y0, z * 0.1);
  }
  body.computeVertexNormals(); bump(body, crust(0.0028, 90));
  P.push(paint(part(body, { rm: [0.34, 0] }), skin));
  // thighs, wings (tucked), legs crossed and tied at the front, bone tips showing
  for (const s of [-1, 1]) {
    const th = bump(ellipsoid(0.042, 0.04, 0.058, 20, 14), crust(0.0024, 90)); th.rotateY(s * 0.32); th.translate(s * 0.058, Y0 + 0.042, 0.03);
    P.push(paint(part(th, { rm: [0.34, 0] }), skin));
    const wg = bump(ellipsoid(0.022, 0.026, 0.05, 18, 12), crust(0.002, 100)); wg.rotateZ(s * 0.5); wg.rotateY(-s * 0.25); wg.translate(s * 0.07, Y0 + 0.03, -0.055);
    P.push(paint(part(wg, { rm: [0.34, 0] }), skin));
    const d = drumstick(new THREE.Vector3(s * 0.052, Y0 + 0.042, 0.052), new THREE.Vector3(s * 0.008, Y0 + 0.05, 0.142), 0.026);
    P.push(paint(part(d.g, { rm: [0.36, 0] }), (p, n) => { const t = new THREE.Vector3().subVectors(p, d.a).dot(new THREE.Vector3().subVectors(d.b, d.a)) / (d.L * d.L); return t > 0.8 ? BONE.clone().lerp(C('#b88a52'), clamp01((0.9 - t) * 6)) : skin(p, n); }));
  }
  return merge(P);
}

// ---- the chips bag: a pillow with crimped seals, the 'chips' print on the front ----
function chipsBag({ body = '#e8a42b', label = 'chips' } = {}) {
  const W = 0.2, H = 0.28, T = 0.042, SEAL = 0.07;
  const thick = (u, v) => { const a = Math.pow(Math.max(0, 1 - (2 * u - 1) ** 2), 0.55), b = Math.pow(Math.max(0, Math.sin(Math.PI * clamp01((v - SEAL) / (1 - 2 * SEAL)))), 0.5); return T * a * b * (1 + 0.08 * (fbm(u * 6, v * 6, 1) - 0.5)); };
  const crimp = (u, v) => (v < SEAL || v > 1 - SEAL ? 0.0016 * (Math.abs(((u * 26) % 2) - 1) - 0.5) : 0);
  const sideX = (u, v) => (u - 0.5) * W * (1 - 0.035 * Math.sin(Math.PI * v));   // the sides draw in a little where it bulges
  const face = (s, u0 = 0, u1 = 1, v0 = 0, v1 = 1, lift = 0) => surface((u, v) => { const U = u0 + (u1 - u0) * u, V = v0 + (v1 - v0) * v; return [s * sideX(U, V), V * H, s * (thick(U, V) + crimp(U, V) + lift)]; }, 24, 30, false);
  const front = face(1), back = face(-1), lab = face(1, 0.08, 0.92, SEAL + 0.04, 1 - SEAL - 0.04, 0.0012);
  // (the back is the front mirrored in x and z, so its winding already faces -z)
  const seal = C(body).lerp(C('#ffffff'), 0.18), bodyC = C(body);
  const tone = (p, n) => (p.y < SEAL * H || p.y > (1 - SEAL) * H ? seal : bodyC.clone().multiplyScalar(0.86 + 0.14 * clamp01(n.y + 0.6)));
  return merge([paint(part(front, { rm: RM.foil }), tone), paint(part(back, { rm: RM.foil }), tone), part(lab, { label, rm: [0.28, 0.4] })]);
}

// ---- the lemonade bottle: a smooth lathe-turned bottle, yellow drink, white cap, the 'lemonade' wrap ----
function lemonBottle({ body = '#f2d23c', label = 'lemonade' } = {}) {
  const pts = [[0, 0], [0.03, 0], [0.0345, 0.003], [0.036, 0.01], [0.036, 0.15], [0.034, 0.163], [0.027, 0.18], [0.018, 0.196], [0.0135, 0.208], [0.0135, 0.222], [0.0152, 0.224], [0.0152, 0.226], [0, 0.226]].map(([x, y]) => new THREE.Vector2(x, y));
  const lathe = new THREE.LatheGeometry(pts, 28); lathe.computeVertexNormals();
  return merge([
    part(lathe, { color: body, rm: [0.12, 0] }),
    part(new THREE.CylinderGeometry(0.0158, 0.0158, 0.022, 20), { color: '#f4f4f0', pos: [0, 0.236, 0], rm: RM.plastic }),
    part(new THREE.CylinderGeometry(0.0368, 0.0368, 0.1, 28, 1, true, -1.35, 2.7), { label, pos: [0, 0.085, 0], rm: RM.paper }),
  ]);
}

const KINDS = { roastChicken, chipsBag, lemonBottle };
export const PICKUP_KINDS = Object.keys(KINDS);
export function pickupGeometry(kind, opts) { return KINDS[kind](opts); }
