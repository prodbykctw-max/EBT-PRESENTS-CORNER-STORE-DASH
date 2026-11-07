// Realistic pedestrians for the drive (the default of the realistic look; ?people=none gives the old ones back; ?people=A|B|AB picks a kind for QA). This file is imported only by the realistic look
// (drive.js: after the look's own code has loaded, never in the comic look); crowd.js decides everything about the people and only hands the drawing over.
//
// What changes: the BODY and its walk. Everything the crowd decides (who stands where, who walks, who steps aside, the corral that keeps
// them out of walls and roads) stays in crowd.js and runs unchanged; this module only draws what crowd.js decided. It reads each
// person's phase / stride / lean / phone / startle, which crowd.js already computes, and the person's palette indices and accessory
// bits that crowd.js already rolled (`m.pal`, `m.acc`), so the same person keeps the same skin, top, bottoms and cap/long hair/bag/hood.
// Everything this file adds to a person (build, hair, outfit, shoes) comes from a hash of the person's index, NOT from Math.random,
// so this file draws no number from the shared stream except the 4 that the old crowd's InstancedMesh took (see the constructor), and the rest of the run is the same as with the old people.
//
// Two draw calls per kind of person (near + far level of detail) instead of one, each one InstancedMesh. The default draws one kind, B: every person is
// a realistic MakeHuman body (six body types, varied outfits, hair and shoes). A is the older hand-built person, loaded only for ?people=A or ?people=AB
// (person n is then kind n % 2, so a group's neighbours alternate):
//   A  people-a.js: a hand-built parametric person (about 1.4k triangles near), the walk done analytically in the vertex shader
//   B  people-b.js: MakeHuman (CC0) bodies, decimated, with the walk baked into a vertex-animation texture, real shoes skinned to the feet, and the hair / caps /
//      bags / hoods / skirts baked into the same mesh (built offline by drive/tools/people/build_people.py; nothing of A is loaded at run time)
// Both are painted by the same fragment code below (skin, hair, top, bottoms, shoes, face), from fields the geometry carries.
import * as THREE from './vendor/three.module.min.js';
import { uploadUsed, shadowSplit } from './runner.js';
import { SKIN, TOPS, BOTTOMS, ACCENT } from './crowd.js';
import { LEVEL } from './levels.js';

/** three.js draws Math.random for the id of every geometry, material, texture and object it makes. The crowd's layout, the traffic and the planner share
 *  that one stream, so building the new people (and when, relative to the crowd) must not move it: everything that makes three.js objects here runs
 *  under this, which swaps in a private generator for the duration of the (synchronous) call. The generator's state lives at module level, so each
 *  call (A, B, the AltPeople, a second drive in the same page) carries on where the last one stopped and the ids stay distinct (same idea as cars.js isolated()). */
let isoState = 0x9e3779b1;
const isoRandom = () => { isoState ^= isoState << 13; isoState ^= isoState >>> 17; isoState ^= isoState << 5; return (isoState >>> 0) / 4294967296; };
export function withoutRandom(fn) {
  const real = Math.random; Math.random = isoRandom;
  try { return fn(); } finally { Math.random = real; }
}

// ------------------------------------------------------------------ what a person wears (a hash of the index, no Math.random)
export const HAIR = [0x0e0e10, 0x15100c, 0x1b120c, 0x2c1a10, 0x3d2616, 0x5a3a22, 0x7a4a24, 0x8a2a1a, 0xb08d57, 0xd0b27a, 0xc9c9c4, 0x6b6f75];
export const SHOE = [0xf2f2f0, 0x15151a, 0x4a3b2f, 0xc0392b, 0x3b6fb6, 0x7f8c8d, 0xd9c7a0, 0x222a44];
// which SHOE colours each kind of B shoe comes in: [index into SHOE, weight]
const SHOE_COLOURS = [
  [[0, 0.30], [1, 0.20], [3, 0.10], [4, 0.10], [5, 0.10], [7, 0.08], [6, 0.06], [2, 0.06]],   // sneaker: white, black, red, blue, grey, navy, sand, brown
  [[1, 0.55], [2, 0.40], [7, 0.05]],                                                          // dress shoe: black, brown, navy
  [[2, 0.45], [1, 0.35], [6, 0.20]],                                                          // boot: brown, black, sand (work boot)
];
// accessory bits (instance mask, vertex attribute aInfo.w holds the bit a part belongs to; 0 = always drawn)
export const BIT = { cap: 1, crop: 2, long: 4, bun: 8, tail: 16, afro: 32, locs: 64, pack: 128, hood: 256, skirt: 512, sneaker: 1024, dress: 2048, boot: 4096 };
const SHOE_BITS = [BIT.sneaker, BIT.dress, BIT.boot];   // the three B shoes (people-b.js): which one a person wears is a mask bit, like the hair
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

/** everything a person is made of that crowd.js doesn't decide: gender, build, hair, outfit, shoes (deterministic per index).
 *  `prev` (B people only): the traits of the person before, so that two neighbours never share a body type, and never an outfit except two hooded people in a row (the hood forces the hoodie). */
export function traitsFor(m, i, bodyVariants = 1, heightByGender = true, prev = null) {
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
  const table = fem ? OUTFIT_F : OUTFIT_M;
  let o = pick(table, h(7));
  if (m.acc & ACC.hood) o = 3;
  else if (prev && prev.outfit === o) { o = pick(table, h(15)); if (o === prev.outfit) o = table[(table.findIndex((e) => e[0] === o) + 1) % table.length][0]; }   // (a neighbour never dresses the same)
  const O = OUTFITS[o];
  if (O.hood) mask |= BIT.hood;
  if (O.skirt) mask |= BIT.skirt;
  let variant = 0;
  if (bodyVariants > 1) {
    const nBt = Math.ceil(bodyVariants / 2), vOf = (bt) => Math.min(bodyVariants - 1, (fem ? 0 : 1) + 2 * bt);
    let bt = (h(8) * nBt) | 0;
    if (prev && prev.variant === vOf(bt)) bt = (bt + 1 + (h(14) < 0.5 ? 0 : 1)) % nBt;      // (a neighbour never has the same body type)
    variant = vOf(bt);
  }
  let hairOut = hairCol;
  if (bodyVariants > 4 && variant >= 4) hairOut = h(11) < 0.75 ? 10 : 11;                // the two older bodies: grey hair
  // shoes. A draws its own (the colour index is all it uses); B wears one of three real shoes: sneakers on most people, dress shoes and boots more on the
  // older bodies and the business jackets, and with dresses and skirts
  let shoe = (h(9) * SHOE.length) | 0;
  if (bodyVariants > 1) {
    const old = variant >= 4, biz = o === 4, g = h(12);
    const kind = old || biz ? (g < 0.35 ? 0 : g < 0.75 ? 1 : 2)
      : o === 5 || o === 6 ? (g < 0.5 ? 0 : g < 0.7 ? 1 : 2)
      : fem ? (g < 0.78 ? 0 : g < 0.86 ? 1 : 2)
      : (g < 0.68 ? 0 : g < 0.84 ? 1 : 2);
    shoe = pick(SHOE_COLOURS[kind], h(13));
    mask |= SHOE_BITS[kind];
  }
  return {
    fem, masc, mask, variant, style, outfit: o,
    pal: m.pal,                                              // skin, top, bottoms, accent (crowd.js's own roll)
    hair: hairOut, shoe, belly: Math.pow(h(10), 2),
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
varying vec3 vRest; varying vec4 vReg; varying float vArmS; varying vec2 vShoeHF;
flat varying vec4 vInfo; flat varying vec4 vPal; flat varying vec4 vHair; flat varying vec4 vOut; flat varying float vVar; flat varying float vShoeT;
bool pedHidden() { return aInfo.w > 0.5 && mod(floor(iAnim.z / aInfo.w + 0.001), 2.0) < 0.5; }
mat3 pedRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 pedRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
`;
const PAINT_SET_V = /* glsl */`
vRest = pedRest; vReg = aReg; vArmS = aReg2.x; vInfo = aInfo; vPal = iPal; vHair = iHair; vOut = iOut; vVar = iPose.z;
vShoeHF = aReg2.yz;   // a shoe vertex: height above the sole, distance forward of the heel (m)
{ float sb = floor(iAnim.z / 1024.0 + 0.001); vShoeT = mod(sb, 2.0) > 0.5 ? 0.0 : (mod(floor(sb / 2.0), 2.0) > 0.5 ? 1.0 : 2.0); }   // which shoe (mask bits 1024 / 2048 / 4096): sneaker, dress shoe, boot
`;
const SHOE_GLSL = /* glsl */`
#define SHOE_CUFF_SNEAKER 0.112
#define SHOE_CUFF_DRESS 0.118
#define SOLE_SNEAKER 0.030
#define SOLE_DRESS 0.016
#define SOLE_BOOT 0.024
`;
const PAINT_FRAG = /* glsl */`
varying vec3 vRest; varying vec4 vReg; varying float vArmS; varying vec2 vShoeHF;
flat varying vec4 vInfo; flat varying vec4 vPal; flat varying vec4 vHair; flat varying vec4 vOut; flat varying float vVar; flat varying float vShoeT;
uniform vec3 uSkin[${SKIN.length}]; uniform vec3 uTop[${TOPS.length}]; uniform vec3 uBot[${BOTTOMS.length}]; uniform vec3 uAcc[${ACCENT.length}];
uniform float uSole; uniform vec3 uHair[${HAIR.length}]; uniform vec3 uShoe[${SHOE.length}];
uniform vec4 uFace[8];   // per body variant: eye height, half eye spacing, mouth height, head front z (all as fractions of standing height)
float pedEllipse(vec2 d, vec2 r) { return 1.0 - smoothstep(0.55, 1.0, length(d / r)); }
float pedMatte;   // 1 = chalky matte (canvas, rubber, socks): no specular highlight
float pedGloss;   // how shiny this fragment is (polished leather), set by pedColor and read after it by the roughness
// B's real shoes (slot 6): h above the sole and f forward of the heel, both in metres, from the geometry (baked in build_people.py), so the paint is crisp at any triangle count.
// vShoeT: 0 sneaker, 1 dress shoe, 2 boot. Above the shoe's collar the geometry is a sock (shorts, skirts, tights) or the trouser leg falling over the shoe (long trousers).
vec3 pedShoe(vec3 shoe, vec3 bot, float cover, float dress) {
  float h = vShoeHF.x, f = vShoeHF.y, t = vShoeT;
  float cuff = t < 0.5 ? SHOE_CUFF_SNEAKER : t < 1.5 ? SHOE_CUFF_DRESS : 9.0;
  if (h > cuff) {
    pedMatte = 1.0;
    if (cover > 0.9 && dress < 0.5) return bot * (h > cuff + 0.004 ? 1.0 : 0.82);
    return dot(shoe, vec3(0.333)) < 0.1 ? vec3(0.10) : vec3(0.38);                // sock: dark with dark shoes, white otherwise
  }
  if (t > 1.5 && h > 0.15 && cover > 0.9 && dress < 0.5) return bot;                // boot-cut: the trouser leg hangs over the top of the boot
  vec3 c = shoe;
  float lx = f * 90.0, lw = fwidth(lx);                                              // lace stripes (1.1 cm): a soft-edged triangle wave that fades to its mean once a stripe is about a pixel, so it can't shimmer at a distance
  float lace = mix(smoothstep(0.5 - lw, 0.5 + lw, abs(fract(lx) - 0.5) * 2.0), 0.5, smoothstep(0.25, 0.6, lw));
  if (t < 0.5) {                                                                      // sneaker: white rubber sole with a grey outsole, toe cap, laces, heel tab
    if (h < SOLE_SNEAKER) { pedMatte = 1.0; return h < 0.008 ? vec3(0.17) : vec3(0.36); }
    if (f > 0.205 && h < 0.07) c = mix(c, vec3(0.36), 0.65);
    if (f < 0.04 && h > 0.05) c *= 0.62;
    if (f > 0.09 && f < 0.16 && h > 0.07) c = mix(c, vec3(0.36), 0.5 * lace + 0.1);
    pedMatte = 1.0;
  } else if (t < 1.5) {                                                               // dress shoe: thin dark sole, polished leather, laces
    if (h < SOLE_DRESS) { pedGloss = 0.3; return h < 0.005 ? vec3(0.025) : vec3(0.07, 0.055, 0.05); }
    pedGloss = 0.7;
    if (f > 0.085 && f < 0.15 && h > 0.05) c *= 1.0 - 0.4 * lace;
  } else {                                                                            // boot: dark rubber sole, a lighter welt, leather
    if (h < SOLE_BOOT) return h < 0.012 ? vec3(0.05) : vec3(0.09, 0.08, 0.07);
    if (h < SOLE_BOOT + 0.004) return vec3(0.42, 0.30, 0.18);
    pedGloss = 0.25;
    if (h > 0.185) c *= 0.78;
  }
  return min(c * 0.74, vec3(0.36));   // nothing on a shoe is brighter than 0.36 albedo (measured: 0.5 still saturated the lit top of a toe to flat white under the sun): the sun on an up-facing white surface would otherwise cross the bloom threshold
}
vec3 pedColor() {
  pedGloss = 0.0; pedMatte = 0.0;
  vec3 skin = uSkin[int(vPal.x + 0.5)], top = uTop[int(vPal.y + 0.5)], bot = uBot[int(vPal.z + 0.5)], acc = uAcc[int(vPal.w + 0.5)];
  vec3 hair = uHair[int(vHair.x + 0.5)], shoe = uShoe[int(vHair.y + 0.5)];
  float slot = vInfo.x, sleeve = vOut.x, cover = vOut.y, jacket = vOut.z, tight = vOut.w, dress = vHair.w;
  vec3 p = vRest;
  if (slot > 0.5) {
    if (slot < 1.5) return hair;                                   // hair
    if (slot < 2.5) return acc;                                    // cap
    if (slot < 3.5) return uAcc[int(mod(vPal.w + 3.0, 8.0))] * 0.9; // backpack
    if (slot < 4.5) return top * 0.92;                             // hood
    if (slot < 5.5) return dress > 0.5 ? top : bot;                // skirt / dress
    return pedShoe(shoe, bot, cover, dress);                       // B's shoes
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
  const call = 'vec3 pedP = vec3(0.0, 1.1, 0.0), pedN = vec3(0.0, 1.0, 0.0), pedRest = vec3(0.0);\nif (!pedHidden()) pedPose(pedP, pedN, pedRest);   // an unworn part is collapsed to a point and never pays for the pose reads\n';
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
      .replace('#include <common>', '#include <common>\n' + SHOE_GLSL + PAINT_FRAG)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= pedColor();')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32, pedGloss);\nroughnessFactor = mix(roughnessFactor, 1.0, pedMatte);');
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
  constructor(o) {
    withoutRandom(() => this.init(o));
    // The old crowd made one InstancedMesh here, whose id takes 4 draws from the shared stream; take the same 4 so everything after the crowd (traffic,
    // behaviour) draws the same numbers as with ?people=none.
    for (let i = 0; i < 4; i++) Math.random();
  }
  init({ crowd, variants, variant, scene, mobile }) {
    this.crowd = crowd; this.vs = variants || [variant]; this.variant = this.vs[0];
    const people = crowd.people, NV = this.vs.length;
    this.vi = people.map((m, i) => (NV > 1 ? i % NV : 0));
    // static per-person traits, as flat arrays
    const lastB = {};   // the person before, per kind: B people (bodies > 1) avoid their neighbour's body type and outfit
    this.tr = people.map((m, i) => { const v = this.vs[this.vi[i]], t = traitsFor(m, i, v.bodies, v.hf !== false, v.bodies > 1 ? lastB[v.name] : null); lastB[v.name] = t; return t; });
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
        Object.assign(mesh, { name: 'crowd_' + name + (vx ? '_' + variant.name : ''), frustumCulled: false, castShadow: !mobile, receiveShadow: true, customDepthMaterial: depth, count: 0, renderOrder: crowd.blob ? 2 : 0 });   // (after the contact blobs, so people paint over them)
        shadowSplit(mesh);
        scene.add(mesh);
        this.lods.push({ mesh, attr, name, vx, uniforms: def.uniforms });
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
    const SB = M0.castShadow && car ? cr.shadowBox : null, cp = SB ? (cr.focus || r.at(car.s, car.d)) : null;
    let ax, ay, lim;
    if (SB) { const zA = new THREE.Vector3().copy(SB.dir).normalize(); ax = new THREE.Vector3(0, 1, 0).cross(zA).normalize(); ay = zA.clone().cross(ax); lim = SB.half() + 25; }
    const lo = this.lods.map(() => 0), hi = this.lods.map(() => 0), BL = cr.blob;
    if (BL) BL.begin();
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
      if (BL) BL.add(m, far);   // phones: the contact shadow under every person drawn, either kind, either level of detail (contact.js)
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
    if (BL) BL.end();
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
