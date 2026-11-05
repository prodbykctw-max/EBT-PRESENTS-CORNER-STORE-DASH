// Realistic pedestrians for the drive (the default of the realistic look; ?people=none gives the old ones back; ?people=A|B|AB picks a kind). This file is imported only by the realistic look
// (drive.js: after the look's own code has loaded, never in the comic look); crowd.js decides everything about the people and only hands the drawing over.
//
// What changes: the BODY and its walk. Everything the crowd decides (who stands where, who walks, who steps aside, the corral that keeps
// them out of walls and roads) stays in crowd.js and runs unchanged; this module only draws what crowd.js decided. It reads each
// person's phase / stride / lean / phone / startle, which crowd.js already computes, and the person's palette indices and accessory
// bits that crowd.js already rolled (`m.pal`, `m.acc`), so the same person keeps the same skin, top, bottoms and cap/long hair/bag/hood.
// Everything this file adds to a person (build, hair, outfit, shoes) comes from a hash of the person's index, NOT from Math.random,
// so no random number is drawn here and the rest of the run is the same as with the old people.
//
// Two draw calls per kind of person (near + far level of detail) instead of one, each one InstancedMesh; the default draws both kinds, half the crowd each
// (person n is kind n % 2: the crowd was laid along the route in order, so a group's neighbours alternate):
//   A  people-a.js: a hand-built parametric person (about 1.4k triangles near), the walk done analytically in the vertex shader
//   B  people-b.js: MakeHuman (CC0) bodies, decimated, with the walk baked into a vertex-animation texture
// Both are painted by the same fragment code below (skin, hair, top, bottoms, shoes, face), from fields the geometry carries.
import * as THREE from './vendor/three.module.min.js';
import { uploadUsed, shadowSplit } from './runner.js';
import { SKIN, TOPS, BOTTOMS, ACCENT } from './crowd.js';
import { LEVEL } from './levels.js';

/** three.js draws Math.random for the id of every geometry, material and texture it makes. The crowd's layout, the traffic and the planner share that
 *  one stream, so building the new people (and when, relative to the crowd) must not move it: everything that makes three.js objects here runs under
 *  this, which swaps in a private generator for the duration of the (synchronous) call. */
export function withoutRandom(fn) {
  const real = Math.random; let s = 2463534242;
  Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  try { return fn(); } finally { Math.random = real; }
}

/** which option the page asked for: 'A' | 'B' | 'C' | null */
export function peopleOption() {
  const q = new URLSearchParams(location.search).get('people');
  return q && /^[abc]$/i.test(q) ? q.toUpperCase() : null;
}

// ------------------------------------------------------------------ what a person wears (a hash of the index, no Math.random)
export const HAIR = [0x0e0e10, 0x15100c, 0x1b120c, 0x2c1a10, 0x3d2616, 0x5a3a22, 0x7a4a24, 0x8a2a1a, 0xb08d57, 0xd0b27a, 0xc9c9c4, 0x6b6f75];
export const SHOE = [0xf2f2f0, 0x15151a, 0x4a3b2f, 0xc0392b, 0x3b6fb6, 0x7f8c8d, 0xd9c7a0, 0x222a44];
// accessory bits (instance mask, vertex attribute aInfo.w holds the bit a part belongs to; 0 = always drawn)
export const BIT = { cap: 1, crop: 2, long: 4, bun: 8, tail: 16, afro: 32, locs: 64, pack: 128, hood: 256, skirt: 512 };
// outfits: sleeve length (0 none … 1 wrist), how much of the leg the bottoms cover (1 full length, .4 shorts), jacket (a heavier torso),
// tights, dress (the top colour carries on below the waist), hood, skirt
const OUTFITS = [
  { sleeve: 0.36, cover: 1.0 },                              // 0 tee + jeans
  { sleeve: 0.36, cover: 0.40 },                             // 1 tee + shorts
  { sleeve: 1.0, cover: 1.0 },                               // 2 long sleeve + pants
  { sleeve: 1.0, cover: 1.0, jacket: 1, hood: 1 },           // 3 hoodie
  { sleeve: 1.0, cover: 1.0, jacket: 1 },                    // 4 jacket
  { sleeve: 0.36, cover: 0.0, dress: 1, skirt: 1 },          // 5 dress
  { sleeve: 0.36, cover: 0.0, skirt: 1 },                    // 6 skirt + top
  { sleeve: 0.0, cover: 0.62, tight: 1 },                    // 7 tank + capris / leggings
];
const OUTFIT_M = [[0, 0.30], [1, 0.15], [2, 0.15], [3, 0.15], [4, 0.15], [7, 0.10]];
const OUTFIT_F = [[0, 0.14], [1, 0.08], [2, 0.14], [3, 0.10], [4, 0.08], [5, 0.20], [6, 0.14], [7, 0.12]];

function hash(i, k) {
  let x = (Math.imul(i + 1, 374761393) + Math.imul(k + 7, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const pick = (table, r) => { let a = 0; for (const [v, w] of table) { a += w; if (r < a) return v; } return table[table.length - 1][0]; };

/** everything a person is made of that crowd.js doesn't decide: gender, build, hair, outfit, shoes (deterministic per index) */
export function traitsFor(m, i, bodyVariants = 1, heightByGender = true) {
  const fem = hash(i, 1) < 0.5, h = (k) => hash(i, k);
  const ACC = { cap: 1, long: 2, bag: 4, hood: 8 };   // crowd.js's own bits (m.acc)
  const masc = fem ? 0.05 + h(2) * 0.3 : 0.65 + h(2) * 0.35;
  const skin = m.pal[0];
  const dark = skin <= 4;
  // hair colour: darker skin tones → mostly black / dark brown; lighter → the whole range
  const hairCol = dark ? (h(3) < 0.93 ? (h(4) * 4) | 0 : 10 + ((h(5) * 2) | 0)) : ((h(4) * HAIR.length) | 0);
  // hair style
  let style;   // crop | short(=crop, taller) | afro | long | bun | tail | locs | bald
  const r = h(6);
  if (m.acc & ACC.long) style = fem ? (r < 0.5 ? 'long' : r < 0.8 ? 'locs' : 'tail') : (r < 0.6 ? 'locs' : 'long');
  else if (fem) style = r < 0.25 ? 'long' : r < 0.42 ? 'bun' : r < 0.58 ? 'tail' : r < 0.74 ? 'afro' : r < 0.86 ? 'crop' : 'locs';
  else style = r < 0.42 ? 'crop' : r < 0.60 ? 'afro' : r < 0.72 ? 'short' : r < 0.82 ? 'locs' : r < 0.9 ? 'bald' : 'tail';
  if (!dark && style === 'afro') style = fem ? 'bun' : 'short';          // (the curls follow the skin tone's neighbourhood: a light-skinned afro is rarer here)
  let mask = 0;
  const S = { crop: BIT.crop, short: BIT.crop, long: BIT.crop | BIT.long, bun: BIT.crop | BIT.bun, tail: BIT.crop | BIT.tail, afro: BIT.afro, locs: BIT.crop | BIT.locs, bald: 0 }[style];
  mask |= S;
  if (m.acc & ACC.cap) mask = (mask & ~(BIT.afro)) | BIT.cap | (mask & BIT.afro ? BIT.crop : 0);   // a cap over short hair (an afro under a cap shrinks to a crop)
  if (m.acc & ACC.bag) mask |= BIT.pack;
  // outfit
  let o = pick(fem ? OUTFIT_F : OUTFIT_M, h(7));
  if (m.acc & ACC.hood) o = 3;
  const O = OUTFITS[o];
  if (O.hood) mask |= BIT.hood;
  if (O.skirt) mask |= BIT.skirt;
  const variant = bodyVariants > 1 ? Math.min(bodyVariants - 1, (fem ? 0 : 1) + 2 * ((h(8) * Math.ceil(bodyVariants / 2)) | 0)) : 0;
  let hairOut = hairCol;
  if (bodyVariants > 4 && variant >= 4) hairOut = h(11) < 0.75 ? 10 : 11;                // the two older bodies: grey hair
  return {
    fem, masc, mask, variant, style, outfit: o,
    pal: m.pal,                                              // skin, top, bottoms, accent (crowd.js's own roll)
    hair: hairOut, shoe: (h(9) * SHOE.length) | 0, belly: Math.pow(h(10), 2),
    sleeve: O.sleeve, cover: O.cover, jacket: O.jacket || 0, tight: O.tight || 0, dress: O.dress || 0,
    hf: heightByGender ? 0.95 + 0.06 * masc : 1,             // women are a little shorter than men on average (the MakeHuman bodies already are)
  };
}

// ------------------------------------------------------------------ shader: paint (shared by A and B)
const PAINT_DECL_V = /* glsl */`
attribute vec4 aInfo;   // x slot · y part · z seg (variant specific) · w accessory bit (0 = always drawn)
attribute vec4 aReg;    // x arm · y leg · z hand · w foot (soft memberships; the clothes are painted from these and the rest-pose position)
attribute vec4 aReg2;   // x along the arm 0 shoulder … 1 wrist · yzw variant specific (A: shoulder / hip / bust weights)
attribute vec4 iAnim;   // x gait phase (rad) · y stride amount · z accessory mask · w lean
attribute vec4 iPose;   // x phone-in-hand 0/1 · y startle 0..1 · z body variant · w unused
attribute vec4 iPal;    // skin, top, bottoms, accent (palette indices)
attribute vec4 iHair;   // hair colour, shoe colour, masculinity 0..1, dress flag
attribute vec4 iOut;    // sleeve, cover, jacket, tights
varying vec3 vRest; varying vec4 vReg; varying float vArmS;
flat varying vec4 vInfo; flat varying vec4 vPal; flat varying vec4 vHair; flat varying vec4 vOut; flat varying float vVar;
bool pedHidden() { return aInfo.w > 0.5 && mod(floor(iAnim.z / aInfo.w + 0.001), 2.0) < 0.5; }
mat3 pedRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 pedRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
`;
const PAINT_SET_V = /* glsl */`
vRest = pedRest; vReg = aReg; vArmS = aReg2.x; vInfo = aInfo; vPal = iPal; vHair = iHair; vOut = iOut; vVar = iPose.z;
`;
const PAINT_FRAG = /* glsl */`
varying vec3 vRest; varying vec4 vReg; varying float vArmS;
flat varying vec4 vInfo; flat varying vec4 vPal; flat varying vec4 vHair; flat varying vec4 vOut; flat varying float vVar;
uniform vec3 uSkin[${SKIN.length}]; uniform vec3 uTop[${TOPS.length}]; uniform vec3 uBot[${BOTTOMS.length}]; uniform vec3 uAcc[${ACCENT.length}];
uniform float uSole; uniform vec3 uHair[${HAIR.length}]; uniform vec3 uShoe[${SHOE.length}];
uniform vec4 uFace[8];   // per body variant: eye height, half eye spacing, mouth height, head front z (all as fractions of standing height)
float pedEllipse(vec2 d, vec2 r) { return 1.0 - smoothstep(0.55, 1.0, length(d / r)); }
vec3 pedColor() {
  vec3 skin = uSkin[int(vPal.x + 0.5)], top = uTop[int(vPal.y + 0.5)], bot = uBot[int(vPal.z + 0.5)], acc = uAcc[int(vPal.w + 0.5)];
  vec3 hair = uHair[int(vHair.x + 0.5)], shoe = uShoe[int(vHair.y + 0.5)];
  float slot = vInfo.x, sleeve = vOut.x, cover = vOut.y, jacket = vOut.z, tight = vOut.w, dress = vHair.w;
  vec3 p = vRest;
  if (slot > 0.5) {
    if (slot < 1.5) return hair;                                   // hair
    if (slot < 2.5) return acc;                                    // cap
    if (slot < 3.5) return uAcc[int(mod(vPal.w + 3.0, 8.0))] * 0.9; // backpack
    if (slot < 4.5) return top * 0.92;                             // hood
    return dress > 0.5 ? top : bot;                                // skirt / dress
  }
  vec3 c = skin;
  bool isArm = vReg.x > 0.5, isLeg = vReg.y > 0.5;
  if (vReg.w > 0.5) {                                              // shoes: coloured upper, light sole
    c = shoe;
    if (p.y < 0.0105 * uSole) c = vec3(0.62);
    else if (p.y < 0.0155 * uSole) c = mix(c, vec3(0.9), 0.5);
    return c;
  }
  if (isArm) {
    if (vReg.z < 0.5 && vArmS < sleeve) { c = top; if (jacket > 0.5 && vArmS > sleeve - 0.08) c *= 0.88; }   // sleeve (jacket cuffs a shade darker)
  } else if (isLeg) {
    float hem = 0.517 * (1.0 - cover);
    if (dress < 0.5 && p.y > hem) c = bot;                         // trousers / shorts
    else if (tight > 0.5 && dress > 0.5) c = bot;                  // tights under a dress
    if (dress < 0.5 && p.y > hem && p.y < hem + 0.006) c *= 0.82;  // hem
  } else if (p.y < 0.846) {                                        // torso below the neck
    float hemTop = jacket > 0.5 ? 0.455 : 0.50;                    // where the top ends (a jacket is longer)
    float neck = 0.846 - 0.034 * smoothstep(0.0, 0.05, p.z) * (1.0 - jacket * 0.6);   // the neckline dips at the front (a hood or jacket collar sits high)
    bool inTop = p.y > hemTop;
    if (inTop && p.y < neck) c = top;
    else if (!inTop) c = dress > 0.5 ? top : bot;
    if (dress < 0.5 && !inTop && p.y > hemTop - 0.006) c *= 0.8;   // the top's hem over the waistband
    // details
    if (inTop && p.z > 0.0) {
      if (jacket > 0.5) {
        c *= 1.0 - 0.45 * (1.0 - smoothstep(0.0012, 0.0022, abs(p.x)));        // zip
        if (vOut.x > 0.5 && p.y < 0.56 && p.y > 0.50) c *= 0.9 - 0.1 * smoothstep(0.045, 0.06, abs(p.x));   // pocket band
      }
    }
    if (dress < 0.5 && !inTop && p.y > 0.505 && p.y < 0.53) c = mix(c, vec3(0.05), 0.55);   // belt
  }
  // the face: eyes (white + dark iris), brows, mouth
  vec4 F = uFace[int(vVar + 0.5)];
  if (p.y > 0.862 && p.z > F.w * 0.55 && !isArm && !isLeg) {
    vec2 e = vec2(abs(p.x) - F.y, p.y - F.x);
    float white = pedEllipse(e, vec2(0.0092, 0.0050)), iris = pedEllipse(e - vec2(0.0, -0.0003), vec2(0.0049, 0.0049));
    c = mix(c, vec3(0.86, 0.84, 0.82), white * 0.9);
    c = mix(c, vec3(0.03, 0.02, 0.02), iris);
    float brow = pedEllipse(vec2(abs(p.x) - F.y * 1.02, p.y - (F.x + 0.0125)), vec2(0.0105, 0.0023));
    c = mix(c, uHair[int(vHair.x + 0.5)] * 0.7, brow * 0.85);
    float lip = pedEllipse(vec2(p.x, p.y - F.z), vec2(0.0125, 0.0022));
    c = mix(c, mix(skin, vec3(0.36, 0.10, 0.12), 0.65), lip * 0.9);
  }
  return c;
}
`;

/** vertex + fragment patch for a pedestrian material. A level of detail supplies `uniforms` and `decl` (GLSL declarations plus
 *  `void pedPose(out vec3 pos, out vec3 nrm, out vec3 pedRest)`: where this vertex is, which way it faces and where it is at rest, normalised by height) */
function patch(shader, variant, lod, colour) {
  Object.assign(shader.uniforms, lod.uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + PAINT_DECL_V + lod.decl);
  const call = 'vec3 pedP, pedN, pedRest; pedPose(pedP, pedN, pedRest);\nif (pedHidden()) { pedP = vec3(0.0, 1.1, 0.0); }\n';
  if (colour) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', call + 'vec3 objectNormal = pedN;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = pedP;\n' + PAINT_SET_V);
    shader.uniforms.uSkin = { value: SKIN.map((h) => new THREE.Vector3(...new THREE.Color(h).toArray())) };
    shader.uniforms.uTop = { value: TOPS.map((h) => new THREE.Vector3(...new THREE.Color(h).toArray())) };
    shader.uniforms.uBot = { value: BOTTOMS.map((h) => new THREE.Vector3(...new THREE.Color(h).toArray())) };
    shader.uniforms.uAcc = { value: ACCENT.map((h) => new THREE.Vector3(...new THREE.Color(h).toArray())) };
    shader.uniforms.uHair = { value: HAIR.map((h) => new THREE.Vector3(...new THREE.Color(h).toArray())) };
    shader.uniforms.uShoe = { value: SHOE.map((h) => new THREE.Vector3(...new THREE.Color(h).toArray())) };
    shader.uniforms.uFace = { value: variant.face };
    shader.uniforms.uSole = { value: variant.sole ?? 1 };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PAINT_FRAG)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= pedColor();');
  } else {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', call + 'vec3 transformed = pedP;\n');
  }
}

// ------------------------------------------------------------------ the draw
const LOD_NEAR = 30;   // m: nearer than this the full model, beyond it the cheap one

/** variant: { name, lods: [{ geo, uniforms, decl } near, far], face: Vector4[8], bodies, hf } (people-a.js / people-b.js) */
export class AltPeople {
  /** variants: one (?people=A / B) or several (the mix). Which variant a person is drawn with is decided once, from the person's index (no
   *  Math.random: the crowd's layout, the traffic and the planner share that stream), and alternates along the crowd's order, which is the
   *  order people were laid along the route, so a group's neighbours are a mix. */
  constructor(o) { withoutRandom(() => this.init(o)); }
  init({ crowd, variants, variant, scene, mobile }) {
    this.crowd = crowd; this.vs = variants || [variant]; this.variant = this.vs[0];
    const people = crowd.people, NV = this.vs.length;
    this.vi = people.map((m, i) => (NV > 1 ? i % NV : 0));
    // static per-person traits, as flat arrays
    this.tr = people.map((m, i) => { const v = this.vs[this.vi[i]]; return traitsFor(m, i, v.bodies, v.hf !== false); });
    this.far2 = (mobile ? 22 : LOD_NEAR) ** 2;
    this.lods = [];   // k = variant * 2 + level of detail (0 near, 1 far)
    this.vs.forEach((variant, vx) => {
      const cap = Math.max(1, this.vi.filter((x) => x === vx).length);
      const inst = (k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
      for (const [li, name] of ['near', 'far'].entries()) {
        const def = variant.lods[li];
        const g = def.geo.clone();   // (the geometry is shared by nothing else, but keep the original clean for tests)
        const attr = { iAnim: inst(4), iPose: inst(4), iPal: inst(4), iHair: inst(4), iOut: inst(4) };
        for (const [k, a] of Object.entries(attr)) g.setAttribute(k, a);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
        mat.onBeforeCompile = (sh) => patch(sh, variant, def, true);
        mat.customProgramCacheKey = () => 'people-' + variant.name + '-' + name;
        const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        depth.onBeforeCompile = (sh) => patch(sh, variant, def, false);
        depth.customProgramCacheKey = () => 'people-depth-' + variant.name + '-' + name;
        const mesh = new THREE.InstancedMesh(g, mat, cap);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        Object.assign(mesh, { name: 'crowd_' + name + (vx ? '_' + variant.name : ''), frustumCulled: false, castShadow: !mobile, receiveShadow: true, customDepthMaterial: depth, count: 0 });
        shadowSplit(mesh);
        scene.add(mesh);
        this.lods.push({ mesh, attr, name, vx });
      }
    });
    this.mesh = this.lods[0].mesh;   // what integrity.js and the QA tools look at
    // the per-person values that never change (palette, hair, outfit): written once into every slot the person could take
    this.stat = new Float32Array(people.length * 16);
    this.tr.forEach((t, i) => {
      this.stat.set([t.pal[0], t.pal[1], t.pal[2], t.pal[3], t.hair, t.shoe, t.masc, t.dress, t.sleeve, t.cover, t.jacket, t.tight, t.mask, t.variant, t.hf, t.belly], i * 16);
    });
  }

  /** draw everyone the camera can see: the same placement, margin and shadow ordering as Crowd.render, split by variant and level of detail */
  render(car) {
    const cr = this.crowd, r = cr.route, people = cr.people, cam = cr.camera.position;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
    const M0 = this.lods[0].mesh;
    const SB = M0.castShadow && car ? cr.shadowBox : null, cp = SB ? r.at(car.s, car.d) : null;
    let ax, ay, lim;
    if (SB) { const zA = new THREE.Vector3().copy(SB.dir).normalize(); ax = new THREE.Vector3(0, 1, 0).cross(zA).normalize(); ay = zA.clone().cross(ax); lim = SB.half() + 25; }
    const lo = this.lods.map(() => 0), hi = this.lods.map(() => 0);
    let drawn = 0;
    for (let n = 0; n < people.length; n++) {
      const m = people[n];
      if (m.dirty || m.x === undefined) {
        const p = r.at(m.s, m.g.side * m.d), gz = cr.ground(p.x, p.y);
        m.x = p.x; m.y = p.y; m.z = Math.max(cr.footAt(p.x, p.y, gz + 1.2) ?? -Infinity, gz + LEVEL.TERRAIN);
        m.dirty = false;
      }
      const dx = m.x - cam.x, dz = -m.y - cam.z, dy = m.z - cam.y, d2 = dx * dx + dy * dy + dz * dz, far = Math.sqrt(d2);
      m.on = cr.visible(m.x, m.y, m.z + 0.9, 3 + far * 0.04) && drawn < people.length;
      if (!m.on) continue;
      drawn++;
      const k = this.vi[n] * 2 + (d2 > this.far2 ? 1 : 0), lod = this.lods[k], cap = lod.mesh.instanceMatrix.count;
      let i;
      if (SB) {
        const rx = m.x - cp.x, ry = m.z - cp.z, rz = -m.y + cp.y;
        i = Math.abs(rx * ax.x + ry * ax.y + rz * ax.z) <= lim && Math.abs(rx * ay.x + ry * ay.y + rz * ay.z) <= lim ? lo[k]++ : cap - 1 - hi[k]++;
      } else i = lo[k]++;
      const t = this.tr[n], S = this.stat, o = n * 16, A = lod.attr;
      m4.compose(pos.set(m.x, m.z + (m.hop >= 0 ? 0.12 * Math.sin(Math.PI * m.hop) : 0), -m.y), q.setFromAxisAngle(up, m.yaw + Math.PI / 2), sc.set(m.w, m.h * t.hf, m.w));
      lod.mesh.setMatrixAt(i, m4);
      A.iAnim.setXYZW(i, m.phase, Math.min(1.15, Math.max(0.05, m.sp / 1.3)), S[o + 12], m.lean);
      A.iPose.setXYZW(i, m.phone && m.startle < 0.3 && !(m.fl > 0.3) && !(m.lkT > 0) ? 1 : 0, Math.min(1, Math.max(m.startle, m.fl) * 1.4), S[o + 13], S[o + 15]);
      A.iPal.setXYZW(i, S[o], S[o + 1], S[o + 2], S[o + 3]);
      A.iHair.setXYZW(i, S[o + 4], S[o + 5], S[o + 6], S[o + 7]);
      A.iOut.setXYZW(i, S[o + 8], S[o + 9], S[o + 10], S[o + 11]);
    }
    this.lods.forEach(({ mesh, attr }, k) => {
      const cap = mesh.instanceMatrix.count;
      if (hi[k]) {   // close the gap between the shadow-box people (front) and the rest (filled from the back)
        mesh.instanceMatrix.array.copyWithin(lo[k] * 16, (cap - hi[k]) * 16, cap * 16);
        for (const a of Object.values(attr)) a.array.copyWithin(lo[k] * a.itemSize, (cap - hi[k]) * a.itemSize, cap * a.itemSize);
      }
      const n = lo[k] + hi[k];
      mesh.count = n; mesh.userData.shadowCount = lo[k]; uploadUsed(mesh.instanceMatrix, n);
      for (const a of Object.values(attr)) uploadUsed(a, n);
    });
  }
}
