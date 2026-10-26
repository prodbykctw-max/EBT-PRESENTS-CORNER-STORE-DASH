// The two people of the chase in 3D: you and the bully. Both are the store's own character (the rigged Tripo model,
// exported from the commercial's Blender scene by drive/tools/export_character.py) with its walk and a run made from it.
// The bully is the same model recoloured in the shader the way the store's sprite sheet is recoloured
// (standalone/tools/compose_sheets.py): white tee -> red hoodie, denim -> charcoal, red kicks -> black, and he is drawn
// bigger, so he reads as the heavier kid.
import * as THREE from './vendor/three.module.min.js';

export const MODEL_H = 0.982;          // the model's own height in character.glb (feet at 0)
export const PLAYER_H = 1.70;          // you: about 5'7"
export const BULLY_H = 1.88;           // the bully: the heavier, taller kid (the store draws him 96 px against your 84)

/** the bully's look: the player's texture, recoloured by body height (object-space y: feet at 0, top of the cap at MODEL_H) */
export function makeBullyMaterial(src) {
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vBodyY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vBodyY;
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10;
  return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{ vec3 c = diffuseColor.rgb; vec3 srgb = pow(max(c, vec3(0.0)), vec3(1.0/2.2)); vec3 hsv = rgb2hsv(srgb);
  float fy = 1.0 - clamp(vBodyY / ${MODEL_H.toFixed(3)}, 0.0, 1.0);                    // 0 at the top of the cap, 1 at the soles
  if (fy > 0.2 && fy < 0.64 && hsv.y < 0.2 && hsv.z > 0.55) { float k = pow(hsv.z, 1.2); srgb = vec3(0.784, 0.125, 0.149) * k; }
  else if (hsv.x >= 0.52 && hsv.x <= 0.72 && hsv.y > 0.18) { float gv = hsv.z * 0.42; srgb = vec3(gv, gv, gv * 1.06); }
  else if (fy > 0.86 && (hsv.x < 0.04 || hsv.x > 0.93) && hsv.y > 0.45) { float gv = hsv.z * 0.22; srgb = vec3(gv); }
  diffuseColor.rgb = pow(srgb, vec3(2.2)); }`);
  };
  m.customProgramCacheKey = () => 'bully-recolour';
  return m;
}

/** A run made from the walk: every joint swings further around its own average pose (legs and arms most), the elbows
 *  bend, the body leans into it and the hips bob more. Built here from the sampled walk, so it always matches the rig. */
export function makeRunClip(walk) {
  const AMP = [[/Thigh(?!Twist)/, 1.75], [/Calf(?!Twist)/, 1.9], [/_Foot/, 1.5], [/Upperarm(?!Twist)/, 2.0], [/Forearm(?!Twist)/, 1.5], [/Clavicle/, 1.3], [/Pelvis|Waist|Spine/, 1.25]];
  const tracks = [];
  const q = new THREE.Quaternion(), mean = new THREE.Quaternion(), d = new THREE.Quaternion(), tmp = new THREE.Quaternion();
  for (const tr of walk.tracks) {
    const bone = tr.name.split('.')[0], t = tr.clone();
    if (t.name.endsWith('.quaternion')) {
      const k = (AMP.find(([re]) => re.test(bone)) || [0, 1])[1], v = t.values, n = v.length / 4;
      // mean pose: sign-aligned average of the samples
      let mx = 0, my = 0, mz = 0, mw = 0;
      for (let i = 0; i < n; i++) { const s = (v[i * 4] * v[0] + v[i * 4 + 1] * v[1] + v[i * 4 + 2] * v[2] + v[i * 4 + 3] * v[3]) < 0 ? -1 : 1; mx += s * v[i * 4]; my += s * v[i * 4 + 1]; mz += s * v[i * 4 + 2]; mw += s * v[i * 4 + 3]; }
      mean.set(mx, my, mz, mw).normalize();
      const inv = mean.clone().invert();
      for (let i = 0; i < n; i++) {
        q.fromArray(v, i * 4); d.multiplyQuaternions(inv, q); if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
        tmp.identity().slerp(d, k);                                        // k > 1: slerp extrapolates past the sample
        q.multiplyQuaternions(mean, tmp); q.toArray(v, i * 4);
      }
    } else if (t.name.endsWith('.position') && /^Hip$/.test(bone)) {
      const v = t.values, n = v.length / 3; let my = 0; for (let i = 0; i < n; i++) my += v[i * 3 + 1]; my /= n;
      for (let i = 0; i < n; i++) v[i * 3 + 1] = my + (v[i * 3 + 1] - my) * 1.8;
    }
    tracks.push(t);
  }
  return new THREE.AnimationClip('run', walk.duration, tracks);
}
