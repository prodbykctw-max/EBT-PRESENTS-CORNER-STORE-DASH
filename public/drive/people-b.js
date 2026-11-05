// Option B: MakeHuman (CC0) bodies with the walk baked into vertex-animation textures. The bodies, the walk frames, the phone and hands-up poses
// and the parts a person may wear (hair, cap, backpack, hood, skirt) are all made offline by drive/tools/people/build_people.py into
// people-real/people.json + people.bin. Here the vertex shader only reads them:
//   tStand  the standing pose of each body (float16 position and normal per vertex)
//   tAnim   every other frame of each body as an 8-bit delta from the standing pose (12 walk frames, the phone pose, the hands-up pose)
// A person's phase picks two walk frames to blend, their stride scales the walk's delta (a standing person gets none), the phone and the startle
// add the arm pose; so it is still one instanced draw per level of detail, with no skeleton on the CPU or the GPU.
import * as THREE from './vendor/three.module.min.js';

const BASE = new URL('./people-real/', import.meta.url);

const DECL = (m) => /* glsl */`
#define RPF ${m.rowsPerFrame}
#define WALK ${m.walk}
#define VFR ${m.walk + 2}
uniform highp sampler2D tStand; uniform highp sampler2D tAnim; uniform vec2 uDmax[8]; uniform float uH[8];
ivec2 vatS(int v, int t) { return ivec2(t & 2047, v * RPF + (t >> 11)); }
ivec2 vatA(int v, int f, int t) { return ivec2(t & 2047, (v * VFR + f) * RPF + (t >> 11)); }
vec3 vatD(vec4 q) { return (q.xyz - 0.50196078) * 2.007874; }   // (byte - 128) / 127
void pedPose(out vec3 pos, out vec3 nrm, out vec3 pedRest) {
  int v = int(iPose.z + 0.5), t = gl_VertexID * 2;
  vec3 P0 = texelFetch(tStand, vatS(v, t), 0).xyz, N0 = texelFetch(tStand, vatS(v, t + 1), 0).xyz;
  float amp = clamp(iAnim.y, 0.0, 1.15), f = fract(iAnim.x * 0.15915494) * float(WALK);
  int a = int(f), b = a + 1 >= WALK ? 0 : a + 1; float w = f - float(a);
  vec2 dm = uDmax[v];
  vec3 dP = mix(vatD(texelFetch(tAnim, vatA(v, a, t), 0)), vatD(texelFetch(tAnim, vatA(v, b, t), 0)), w) * dm.x;
  vec3 dN = mix(vatD(texelFetch(tAnim, vatA(v, a, t + 1), 0)), vatD(texelFetch(tAnim, vatA(v, b, t + 1), 0)), w) * 2.0;
  float phone = iPose.x, startle = iPose.y;
  float armR = aReg.x * step(P0.x, 0.0);                                  // (the right arm is at x < 0)
  float keep = 1.0 - clamp(max(startle * aReg.x, phone * armR), 0.0, 1.0); // an arm that is posed stops swinging
  pos = P0 + dP * (amp * keep); nrm = N0 + dN * (amp * keep);
  if (phone > 0.001) { pos += vatD(texelFetch(tAnim, vatA(v, WALK, t), 0)) * dm.y * phone; nrm += vatD(texelFetch(tAnim, vatA(v, WALK, t + 1), 0)) * 2.0 * phone; }
  if (startle > 0.001) { pos += vatD(texelFetch(tAnim, vatA(v, WALK + 1, t), 0)) * dm.y * startle; nrm += vatD(texelFetch(tAnim, vatA(v, WALK + 1, t + 1), 0)) * 2.0 * startle; }
  nrm = normalize(nrm);
  pedRest = P0 / uH[v];
  pos.z += pos.y * iAnim.w;                                                // lean
}
`;

export async function makeB(withoutRandom = (f) => f()) {
  const [meta, buf] = await Promise.all([fetch(new URL('people.json', BASE)).then((r) => r.json()), fetch(new URL('people.bin', BASE)).then((r) => r.arrayBuffer())]);
  return withoutRandom(() => build(meta, buf));
}

function build(meta, buf) {
  const NV = meta.variants.length, FRM = meta.frames;
  const lods = meta.lods.map((m) => {
    const u16 = (s) => new Uint16Array(buf, s.offset, s.length / 2), f32 = (s) => new Float32Array(buf, s.offset, s.length / 4), u8 = (s) => new Uint8Array(buf, s.offset, s.length);
    const nv = m.verts, stand = u16(m.stand), W = m.texWidth;
    // the geometry: the first body's standing pose (position and normal are only placeholders: the shader reads the textures)
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) for (let c = 0; c < 3; c++) { pos[i * 3 + c] = THREE.DataUtils.fromHalfFloat(stand[(2 * i) * 4 + c]); nor[i * 3 + c] = THREE.DataUtils.fromHalfFloat(stand[(2 * i + 1) * 4 + c]); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(f32(m.info).slice(), 4));
    g.setAttribute('aReg', new THREE.BufferAttribute(f32(m.reg).slice(), 4));
    const r2 = f32(m.reg2), a2 = new Float32Array(nv * 4);
    for (let i = 0; i < nv; i++) a2[i * 4] = r2[i];
    g.setAttribute('aReg2', new THREE.BufferAttribute(a2, 4));
    g.setIndex(new THREE.BufferAttribute(u16(m.index).slice(), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.2);
    const tex = (data, w, h, type) => { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, type); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
    const tStand = tex(stand.slice(), W, NV * m.rowsPerFrame, THREE.HalfFloatType);
    const tAnim = tex(u8(m.anim).slice(), W, NV * (FRM.perVariant - 1) * m.rowsPerFrame, THREE.UnsignedByteType);
    const uniforms = {
      tStand: { value: tStand }, tAnim: { value: tAnim },
      uDmax: { value: Array.from({ length: 8 }, (_, i) => new THREE.Vector2(...(m.dmax[Math.min(i, NV - 1)]))) },
      uH: { value: Array.from({ length: 8 }, (_, i) => meta.variants[Math.min(i, NV - 1)].H) },
    };
    return { geo: g, uniforms, decl: DECL({ rowsPerFrame: m.rowsPerFrame, walk: FRM.walk }) };
  });
  const face = Array.from({ length: 8 }, (_, i) => new THREE.Vector4(...meta.variants[Math.min(i, NV - 1)].face));
  return { name: 'B', lods, face, bodies: NV, hf: false, sole: 0.3, meta };
}
