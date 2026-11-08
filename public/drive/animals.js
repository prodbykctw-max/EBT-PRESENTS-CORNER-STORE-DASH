// The realistic look's animals: the stray dogs (runner.js) and the pigeons (birds.js). Only imported by the realistic look, after real.js has loaded (drive.js:
// the comic look and a failed realistic look never fetch any of it; a failure or a late load costs only these animals: the old props.glb ones are drawn).
//
// Data (animals/animals.json + animals.bin + three .webp textures) is made offline by drive/tools/animals/build_animals.py from two CC-BY 4.0 models (animals/CREDITS.txt).
// Nothing is skinned on the CPU or by a SkinnedMesh: every pose of every clip is baked into a bone-matrix texture (a row per frame, three texels per joint) and the
// vertex shader skins each instance from two frames of one clip (or four frames when it is fading from one clip into another). So a dog or a pigeon is one
// InstancedMesh instance with a few numbers (which frames, how far between them), exactly like the pedestrians (people-b.js).
//
// Everything three.js makes here (geometry, material, texture, mesh: each draws Math.random for its id) is made under a private generator: the crowd,
// the traffic and the planner share Math.random, and a run must not depend on whether the animals loaded (see withoutRandom).
import * as THREE from './vendor/three.module.min.js';

let isoState = 0x2545f491;
const isoRandom = () => { isoState ^= isoState << 13; isoState ^= isoState >>> 17; isoState ^= isoState << 5; return (isoState >>> 0) / 4294967296; };
export function withoutRandom(fn) { const real = Math.random; Math.random = isoRandom; try { return fn(); } finally { Math.random = real; } }

const BASE = new URL('./animals/', import.meta.url);

/** fetch the data and the textures (no three.js objects are made here: the caller builds them under withoutRandom) */
export async function loadAnimalData(mobile = false) {
  const [meta, buf] = await Promise.all([fetch(new URL('animals.json', BASE)).then((r) => { if (!r.ok) throw new Error('animals.json ' + r.status); return r.json(); }),
    fetch(new URL('animals.bin', BASE)).then((r) => { if (!r.ok) throw new Error('animals.bin ' + r.status); return r.arrayBuffer(); })]);
  if (meta.version !== 1) throw new Error('animals data: version ' + meta.version);
  let end = 0; const walk = (o) => { if (o && typeof o === 'object') { if ('offset' in o && 'length' in o) end = Math.max(end, o.offset + o.length); else for (const v of Object.values(o)) walk(v); } };
  walk(meta); if (buf.byteLength < end) throw new Error('animals data: animals.bin is short');
  const img = async (f) => { const r = await fetch(new URL(f, BASE)); if (!r.ok) throw new Error(f + ' ' + r.status); return createImageBitmap(await r.blob()); };
  const want = []; for (const k of ['dog', 'pigeon']) if (meta[k]) for (const [n, f] of Object.entries(meta[k].textures)) want.push([k + '.' + n, f]);
  const bitmaps = {}; await Promise.all(want.map(async ([k, f]) => { bitmaps[k] = await img(f); }));
  return { meta, buf, bitmaps, mobile };
}

// ------------------------------------------------------------------ the skinning shader (shared by the lit material and the shadow's depth material)
const SKIN_DECL = /* glsl */`
attribute vec4 aJoint; attribute vec4 aWeight; attribute vec4 iA; attribute vec4 iB;   // iA: frame, next frame, how far between; and how much of iB's pose to fade in. iB: the same for the other clip
uniform highp sampler2D tBones;
vec4 boneRow(int j, int r, vec4 f) { return mix(texelFetch(tBones, ivec2(j * 3 + r, int(f.x)), 0), texelFetch(tBones, ivec2(j * 3 + r, int(f.y)), 0), f.z); }
void animSkin(vec3 p, vec3 n, out vec3 po, out vec3 no) {
  vec4 p4 = vec4(p, 1.0); po = vec3(0.0); no = vec3(0.0); bool two = iA.w > 0.001;
  for (int k = 0; k < 4; k++) {
    float w = aWeight[k]; if (w <= 0.0) continue;
    int j = int(aJoint[k] + 0.5);
    vec4 r0 = boneRow(j, 0, iA), r1 = boneRow(j, 1, iA), r2 = boneRow(j, 2, iA);
    if (two) { r0 = mix(r0, boneRow(j, 0, iB), iA.w); r1 = mix(r1, boneRow(j, 1, iB), iA.w); r2 = mix(r2, boneRow(j, 2, iB), iA.w); }
    po += w * vec3(dot(r0, p4), dot(r1, p4), dot(r2, p4));
    no += w * vec3(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n));
  }
}
`;

const FRAG_COAT = /* glsl */`
// the coat: the texture's fur (grey, nearly no chroma) is recoloured by the instance colour, keeping its light and dark; white markings stay white; skin, nose, tongue and eyes keep their own colour
vec3 al = diffuseColor.rgb;
float lum = dot(al, vec3(0.2126, 0.7152, 0.0722)), chroma = max(al.r, max(al.g, al.b)) - min(al.r, min(al.g, al.b));
float fur = 1.0 - smoothstep(uFur.y, uFur.y * 2.4, chroma), mark = smoothstep(uFur.z, uFur.z * 2.2, lum);
vec3 tinted = vColor.rgb * clamp(lum / uFur.x, 0.35, 2.6);
diffuseColor.rgb = mix(al, mix(tinted, al, mark), fur);
`;
const FRAG_TINT = /* glsl */`diffuseColor.rgb *= vColor.rgb;`;

function litMaterial(tBones, map, normalMap, kind, fur) {
  const m = new THREE.MeshStandardMaterial({ map, normalMap, roughness: kind === 'dog' ? 0.78 : 0.86, metalness: 0, side: THREE.FrontSide });
  if (normalMap) m.normalScale.set(1, 1);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tBones = { value: tBones }; if (kind === 'dog') sh.uniforms.uFur = { value: new THREE.Vector3(...fur) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SKIN_DECL)
      .replace('#include <beginnormal_vertex>', 'vec3 animP, objectNormal; animSkin(position, normal, animP, objectNormal); objectNormal = normalize(objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = animP;');
    sh.fragmentShader = (kind === 'dog' ? sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uFur;') : sh.fragmentShader)
      .replace('#include <color_fragment>', kind === 'dog' ? FRAG_COAT : FRAG_TINT);
  };
  m.customProgramCacheKey = () => 'animals-' + kind;
  return m;
}
function depthMaterial(tBones, kind) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tBones = { value: tBones };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SKIN_DECL)
      .replace('#include <begin_vertex>', 'vec3 animN, transformed; animSkin(position, normal, transformed, animN);');
  };
  m.customProgramCacheKey = () => 'animals-depth-' + kind;
  return m;
}

const dataTexture = (u16, w, h) => { const t = new THREE.DataTexture(u16, w, h, THREE.RGBAFormat, THREE.HalfFloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
const imgTexture = (bm, srgb) => { const t = new THREE.Texture(bm); t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; return t; };

function geometry(buf, e) {
  const g = new THREE.BufferGeometry();
  const view = (s, T) => new T(buf, s.offset, s.count);
  g.setAttribute('position', new THREE.BufferAttribute(view(e.pos, Float32Array).slice(), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(view(e.nor, Int8Array).slice(), 4, true));   // (x, y, z, pad): the shader reads xyz
  g.setAttribute('uv', new THREE.BufferAttribute(view(e.uv, Float32Array).slice(), 2));
  g.setAttribute('aJoint', new THREE.BufferAttribute(new Float32Array(view(e.joint, Uint8Array)), 4));
  g.setAttribute('aWeight', new THREE.BufferAttribute(new Float32Array(view(e.weight, Uint8Array)).map((v) => v / 255), 4));
  g.setIndex(new THREE.BufferAttribute(view(e.index, Uint16Array).slice(), 1));
  return g;
}

/** one InstancedMesh of one animal at one level of detail */
class Herd {
  constructor(scene, name, geo, mat, depth, cap, { cast = true, order = 0 } = {}) {
    this.cap = cap; this.n = 0;
    const inst = (k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k).fill(0), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.iA = inst(4); this.iB = inst(4); geo.setAttribute('iA', this.iA); geo.setAttribute('iB', this.iB);
    const im = this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    Object.assign(im, { name, frustumCulled: false, castShadow: cast, receiveShadow: true, count: 0, customDepthMaterial: depth, renderOrder: order });
    scene.add(im);
  }
  begin() { this.n = 0; }
  /** the next free slot, or -1 */
  next() { return this.n < this.cap ? this.n++ : -1; }
  end() {
    const im = this.mesh, n = this.n; im.count = n;
    if (n) for (const a of [im.instanceMatrix, im.instanceColor, this.iA, this.iB]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
  }
}

const PIGEON_NEAR_CAP = 56, PIGEON_FAR_CAP = 160;   // (the near level of detail is for birds within 16 m of the camera, 11 m on a phone)
const frameAt = (clip, u) => { const x = (u - Math.floor(u)) * clip.n, i = Math.floor(x); return [clip.start + i, clip.start + (i + 1) % clip.n, x - i]; };   // (a loop: the last frame leads into the first)

export class Animals {
  constructor(pack, scene, { mobile = false } = {}) {
    this.mobile = mobile; this.t = 0; this.nearR2 = (mobile ? 11 : 16) ** 2;
    withoutRandom(() => this.init(pack, scene));
  }
  init({ meta, buf, bitmaps }, scene) {
    this.dogMeta = meta.dog || null; this.pigeonMeta = meta.pigeon || null;
    if (meta.dog) {
      const d = meta.dog, F = d.frames;
      const bones = dataTexture(new Uint16Array(buf, F.data.offset, F.data.count).slice(), F.width, F.count);
      const albedo = imgTexture(bitmaps['dog.albedo'], true), normal = imgTexture(bitmaps['dog.normal'], false);
      this.dogs = new Herd(scene, 'animals_dogs', geometry(buf, d.mesh.near), litMaterial(bones, albedo, normal, 'dog', d.fur), depthMaterial(bones, 'dog'), 12);
    }
    if (meta.pigeon) {
      const d = meta.pigeon, F = d.frames;
      const bones = dataTexture(new Uint16Array(buf, F.data.offset, F.data.count).slice(), F.width, F.count);
      const albedo = imgTexture(bitmaps['pigeon.albedo'], true), mat = litMaterial(bones, albedo, null, 'pigeon');
      // two levels of detail (the far one has a seventh of the body's triangles; the wings are the same): near ones cast shadows on desktop
      this.pigeons = [
        new Herd(scene, 'animals_pigeons_near', geometry(buf, d.mesh.near), mat, depthMaterial(bones, 'pigeon'), PIGEON_NEAR_CAP, { cast: !this.mobile }),
        new Herd(scene, 'animals_pigeons_far', geometry(buf, d.mesh.far), mat, null, PIGEON_FAR_CAP, { cast: false }),
      ];
    }
  }

  /** the dog pose for one instance. clip weights: gw 0 = standing (idle, or sniffing when `sniff`), 1 = walking, 2 = running; `dist`: metres walked (so the feet keep pace with the ground: the clips'
   *  stride is their own, measured when they were baked); `scale`: how much bigger than baked it is drawn */
  dog(m4, color, { gw, dist, sniff, id }, scale = 1, t = this.t) {
    const H = this.dogs, i = H.next(); if (i < 0) return;
    const C = this.dogMeta.clips, A = H.iA.array, B = H.iB.array, o = i * 4;
    const rest = sniff ? C.sniff : C.idle, restU = t / rest.dur + id * 0.37;
    const phase = (c) => dist / (c.speed * c.dur * scale);
    let ca, ua, cb, ub, mix;
    if (gw <= 0.001) { ca = rest; ua = restU; mix = 0; }
    else if (gw < 1) { ca = rest; ua = restU; cb = C.walk; ub = phase(C.walk) + id * 0.21; mix = gw; }
    else if (gw === 1) { ca = C.walk; ua = phase(C.walk) + id * 0.21; mix = 0; }
    else if (gw < 2) { ca = C.walk; ua = phase(C.walk) + id * 0.21; cb = C.run; ub = phase(C.run) + id * 0.21; mix = gw - 1; }
    else { ca = C.run; ua = phase(C.run) + id * 0.21; mix = 0; }
    const fa = frameAt(ca, ua); A[o] = fa[0]; A[o + 1] = fa[1]; A[o + 2] = fa[2]; A[o + 3] = mix;
    if (mix > 0) { const fb = frameAt(cb, ub); B[o] = fb[0]; B[o + 1] = fb[1]; B[o + 2] = fb[2]; }
    H.mesh.setMatrixAt(i, m4); H.mesh.setColorAt(i, color);
  }
  beginBirds() { if (this.pigeons) for (const H of this.pigeons) H.begin(); }
  endBirds() { if (this.pigeons) for (const H of this.pigeons) H.end(); }
  /** a pigeon. `x, y, z`: where it is in the scene (the level of detail follows the distance to `cam`). Poses (what the clips are is in build_pigeon.py):
   *   standing: idle, bending over to peck by `dip` (0..1)         { t, ph, dip }
   *   flying:   wings beating at cycle position `u`; `unfold` 0..1 grows the wings out of the standing pose (take-off)
   *   gliding:  the same, wings held out */
  pigeon(m4, color, p, cam) {
    const C = this.pigeonMeta.clips, near = cam ? (m4.elements[12] - cam.x) ** 2 + (m4.elements[13] - cam.y) ** 2 + (m4.elements[14] - cam.z) ** 2 < this.nearR2 : true;
    const H = this.pigeons[near ? 0 : 1], i = H.next(); if (i < 0) return;
    const A = H.iA.array, B = H.iB.array, o = i * 4;
    let fa, mix = 0, fb = null;
    if (p.fly !== undefined) {
      fa = p.glide ? [C.glide.start, C.glide.start, 0] : frameAt(C.fly, p.fly);
      if (p.unfold < 1) { fb = [C.idle.start, C.idle.start, 0]; mix = 1 - p.unfold; }
    } else {
      fa = frameAt(C.idle, p.t / C.idle.dur + p.ph * 0.17);
      if (p.dip > 0.001) { fb = [C.dip.start, C.dip.start, 0]; mix = p.dip; }
    }
    A[o] = fa[0]; A[o + 1] = fa[1]; A[o + 2] = fa[2]; A[o + 3] = mix;
    if (fb) { B[o] = fb[0]; B[o + 1] = fb[1]; B[o + 2] = fb[2]; }
    H.mesh.setMatrixAt(i, m4); H.mesh.setColorAt(i, color);
  }
  beginDogs() { if (this.dogs) this.dogs.begin(); }
  endDogs() { if (this.dogs) this.dogs.end(); }
}
