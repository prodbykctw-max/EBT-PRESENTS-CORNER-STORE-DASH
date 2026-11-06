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
      // the hips bob more. Which component is "up" is the one the hip's height lives in (the rig is Z-up under a Root
      // bone turned -90 deg about X, so it is z here). The first version scaled y, which in this rig is forward/back:
      // the run surged the hips 0.2 m back and forth every stride instead of bobbing them.
      const v = t.values, n = v.length / 3, mean = [0, 0, 0];
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += v[i * 3 + c] / n;
      const up = mean.reduce((b, m, c) => Math.abs(m) > Math.abs(mean[b]) ? c : b, 0);
      for (let i = 0; i < n; i++) v[i * 3 + up] = mean[up] + (v[i * 3 + up] - mean[up]) * 1.8;
    }
    tracks.push(t);
  }
  return new THREE.AnimationClip('run', walk.duration, tracks);
}

/** Standing still: every joint at its average pose over the walk (arms down, legs under you), the same rig and the
 *  same length as the walk, so it blends with the walk and the run by weight when you slow to a stop (instead of the
 *  run freezing mid-stride). */
export function makeStandClip(walk) {
  const tracks = [];
  for (const tr of walk.tracks) {
    const isQ = tr.name.endsWith('.quaternion'), k = isQ ? 4 : tr.values.length / tr.times.length, v = tr.values, n = v.length / k;
    const mean = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const sg = isQ && (v[i * 4] * v[0] + v[i * 4 + 1] * v[1] + v[i * 4 + 2] * v[2] + v[i * 4 + 3] * v[3]) < 0 ? -1 : 1;
      for (let c = 0; c < k; c++) mean[c] += sg * v[i * k + c];
    }
    if (isQ) { const q = new THREE.Quaternion().fromArray(mean).normalize(); q.toArray(mean); } else for (let c = 0; c < k; c++) mean[c] /= n;
    const Track = tr.constructor;
    tracks.push(new Track(tr.name, [0, walk.duration], [...mean, ...mean]));
  }
  return new THREE.AnimationClip('stand', walk.duration, tracks);
}

/** Arm swing on top of a clip. The character's own walk barely moves the arms: the upper arms stay at the sides (seen
 *  from behind, the way the chase camera sees you, they did not move at all), so each arm is turned about the
 *  shoulder, forward when the opposite foot is forward, and the elbow bends further on the forward swing (a run
 *  pumps the arms with the elbows bent). `swing`: degrees each way at the shoulder; `bend` + `pump`: extra elbow bend,
 *  `bend` always and `pump` more at the front of the swing; `out`: degrees the arm is held away from the body (negative:
 *  tucked in; -2 keeps the swinging arms within ~1 cm of the old reach, so BODY in drive.js still holds); `shoulder`: the share of the swing the shoulder (clavicle) rolls forward and back with the
 *  arm, so the T-shirt sleeve, which is skinned partly to the shoulder, goes with the arm instead of stretching into a
 *  white wedge. Phase comes from the clip's own feet, so it always matches the legs. Returns a new clip. */
export const ARMS = {
  walk: { swing: 15, bend: 14, pump: 26, out: -2, shoulder: 0.4 },   // a brisk walk: small swing, the forearm pumps up in front
  run: { swing: 30, bend: 42, pump: 18, out: -2, shoulder: 0.4 },    // a run: elbows bent, hand to the chest in front, behind the hip at the back
};
// three.js draws Math.random for the id of everything it makes, and the traffic shares that stream: the posing clone here
// runs on a private generator so adding the swing does not move it (same idea as withoutRandom in people-alt.js)
let armRng = 0x2545f491;
const privateRandom = () => { armRng ^= armRng << 13; armRng ^= armRng >>> 17; armRng ^= armRng << 5; return (armRng >>> 0) / 4294967296; };
export function addArmSwing(clip, root, opt) {
  const real = Math.random; Math.random = privateRandom;
  try { return armSwing(clip, root, opt); } finally { Math.random = real; }
}
function armSwing(clip, root, { swing = 24, bend = 10, pump = 14, out = 4, shoulder = 0.4 } = {}) {
  const o = root.clone(true);     // plain clone: posing only needs the bones, not the skinning
  const mixer = new THREE.AnimationMixer(o); mixer.clipAction(clip).play();
  const get = (n) => o.getObjectByName(n);
  const tracks = clip.tracks.map((t) => t.clone());
  const track = (n) => tracks.find((t) => t.name === n + '.quaternion');
  const D = THREE.MathUtils.DEG2RAD;
  const fwd = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), w = new THREE.Vector3(), w2 = new THREE.Vector3();
  // forward: the way the toes point, measured at the first frame
  mixer.setTime(0); o.updateMatrixWorld(true);
  get('L_ToeBase').getWorldPosition(w); get('L_Foot').getWorldPosition(w2); fwd.subVectors(w, w2).setY(0).normalize();
  side.crossVectors(fwd, up).normalize();                                   // turning +angle about this swings a hanging hand forward
  for (const S of ['L', 'R']) {
    const O = S === 'L' ? 'R' : 'L';
    const tu = track(S + '_Upperarm'), tf = track(S + '_Forearm'), tc0 = track(S + '_Clavicle');
    if (!tu || !tf || !tc0) continue;
    const times = tu.times, n = times.length;
    // the clavicle's own track is a constant (2 keys): resample it on the arm's times so it can move
    const tc = new THREE.QuaternionKeyframeTrack(tc0.name, Array.from(times), new Array(n * 4).fill(0));
    tracks[tracks.indexOf(tc0)] = tc;
    // the opposite foot's distance in front of the hips, per sample, scaled to -1..1
    const ph = [];
    for (let i = 0; i < n; i++) {
      mixer.setTime(times[i]); o.updateMatrixWorld(true);
      get(O + '_Foot').getWorldPosition(w); get('Hip').getWorldPosition(w2); ph.push(w.sub(w2).dot(fwd));
    }
    const mid = (Math.max(...ph) + Math.min(...ph)) / 2, amp = (Math.max(...ph) - Math.min(...ph)) / 2 || 1;
    if (tf.times.length !== n) continue;                                    // both tracks are sampled together
    // which way is "away from the body" for this arm
    mixer.setTime(0); o.updateMatrixWorld(true);
    get(S + '_Hand').getWorldPosition(w); get('Spine02').getWorldPosition(w2);
    const outSign = Math.sign(w.sub(w2).dot(side)) || 1;
    const Ps = new THREE.Quaternion(), Wc = new THREE.Quaternion(), Pc = new THREE.Quaternion(), Pc2 = new THREE.Quaternion(), Lu = new THREE.Quaternion(), Lf = new THREE.Quaternion(), Wu = new THREE.Quaternion(), Wf = new THREE.Quaternion(), R = new THREE.Quaternion(), R2 = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      mixer.setTime(times[i]); o.updateMatrixWorld(true);
      const cl = get(S + '_Clavicle');
      cl.parent.getWorldQuaternion(Ps); cl.getWorldQuaternion(Pc);
      const s = (ph[i] - mid) / amp;                                          // +1: this arm's front of the swing
      Lu.fromArray(tu.values, i * 4); Lf.fromArray(tf.values, i * 4);
      Wu.multiplyQuaternions(Pc, Lu);
      R.setFromAxisAngle(side, swing * D * s); R2.setFromAxisAngle(fwd, -outSign * out * D);
      Wu.premultiply(R).premultiply(R2);
      // the shoulder rolls forward with the arm (about the vertical, its outer end toward the front)
      R.setFromAxisAngle(up, outSign * shoulder * swing * D * s);
      Pc2.copy(Pc).premultiply(R);
      Wc.copy(Ps).invert().multiply(Pc2); Wc.toArray(tc.values, i * 4);
      Lu.copy(Pc2).invert().multiply(Wu); Lu.toArray(tu.values, i * 4);
      Wf.multiplyQuaternions(Wu, Lf);
      R.setFromAxisAngle(side, (bend + pump * Math.max(0, s)) * D);
      Wf.premultiply(R);
      Lf.copy(Wu).invert().multiply(Wf); Lf.toArray(tf.values, i * 4);
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
