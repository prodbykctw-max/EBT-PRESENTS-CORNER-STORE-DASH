// The realistic look's full-screen passes. The scene renders (MSAA, half-float HDR, with a depth texture) exactly as it does
// for the comic look; then, from that one picture and its depth:
//   1. ambient occlusion, computed from the depth buffer alone (view position and normal rebuilt from depth), at half
//      resolution on phones and full resolution on desktops, then smoothed with a depth-aware blur;
//   2. bloom: bright HDR pixels (tail lights, signals, the sun on paint) through a down/up mip chain;
//   3. one final pass: AO (depth-aware upsample), aerial haze from depth, bloom, then the tone map (Neutral, chosen by the
//      renderer's toneMapping: three's own Neutral map, the comic look's custom map is not installed), sRGB output, then a light colour grade.
// Depth is the main pass's own depthTexture, so the overpass cutaway, the near-tree cut, leaf alpha and wind and the
// crowd's vertex animation are all in it already: no second geometry pass.
import * as THREE from './vendor/three.module.min.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const DEPTH_GLSL = `
  uniform float uNear, uFar; uniform mat4 uInvProj, uProj;
  float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
  vec3 viewPosAt(vec2 uv, float d) { vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
`;

const mkMat = (frag, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, ...extra });

// ---- ambient occlusion: a normal-oriented hemisphere of samples around each pixel's view-space point ----
const AO_FRAG = `
  uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uRadius, uBias, uPower, uFade; uniform int uSamples; uniform vec3 uKernel[16];
  varying vec2 vUv;
  ${DEPTH_GLSL}
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    float d0 = texture2D(tDepth, vUv).x;
    if (d0 >= 0.99999) { gl_FragColor = vec4(1.0, uFar, 0.0, 1.0); return; }
    vec3 P = viewPosAt(vUv, d0);
    // the normal from the nearer neighbour on each axis: no smearing across a silhouette
    vec3 Pr = viewPosAt(vUv + vec2(uTexel.x, 0.0), texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).x), Pl = viewPosAt(vUv - vec2(uTexel.x, 0.0), texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).x);
    vec3 Pu = viewPosAt(vUv + vec2(0.0, uTexel.y), texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).x), Pd = viewPosAt(vUv - vec2(0.0, uTexel.y), texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).x);
    vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl, dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
    vec3 N = normalize(cross(dx, dy)); if (dot(N, P) > 0.0) N = -N;
    float dist = -P.z, fade = 1.0 - smoothstep(uFade * 0.5, uFade, dist);
    if (fade <= 0.0) { gl_FragColor = vec4(1.0, dist, 0.0, 1.0); return; }
    float ang = ign(gl_FragCoord.xy) * 6.2831853;
    vec3 rv = vec3(cos(ang), sin(ang), 0.0), T = normalize(rv - N * dot(rv, N)), B = cross(N, T);
    float occ = 0.0;
    for (int i = 0; i < 16; i++) {
      if (i >= uSamples) break;
      vec3 sp = P + (T * uKernel[i].x + B * uKernel[i].y + N * uKernel[i].z) * uRadius;
      vec4 q = uProj * vec4(sp, 1.0); vec2 suv = q.xy / q.w * 0.5 + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
      float sz = -linZ(texture2D(tDepth, suv).x);                         // view-space z of what is actually there
      float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sz), 1e-3));   // an occluder far in front of the point (an overpass deck) doesn't count
      occ += (sz >= sp.z + uBias ? 1.0 : 0.0) * range;
    }
    float ao = 1.0 - occ / float(uSamples);
    gl_FragColor = vec4(mix(1.0, pow(ao, uPower), fade), dist, 0.0, 1.0);
  }`;
// 3x3 depth-aware blur (the AO target's green channel is the view distance)
const BLUR_FRAG = `
  uniform sampler2D tAO; uniform vec2 uTexel; varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tAO, vUv); float sum = c.r, wsum = 1.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec4 s = texture2D(tAO, vUv + vec2(float(i), float(j)) * uTexel);
      float w = 1.0 / (1.0 + abs(s.g - c.g) / (0.04 * c.g + 0.05) * 6.0);
      sum += s.r * w; wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, c.g, 0.0, 1.0);
  }`;
// ---- bloom ----
const PRE_FRAG = `
  uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThreshold, uKnee; varying vec2 vUv;
  vec3 pick(vec2 uv) {
    vec3 c = min(texture2D(tColor, uv).rgb, vec3(64.0));
    float br = max(max(c.r, c.g), c.b), soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee); soft = soft * soft / (4.0 * uKnee + 1e-4);
    return c * (max(soft, br - uThreshold) / max(br, 1e-4));
  }
  void main() {
    vec3 a = pick(vUv + uTexel * vec2(-0.5, -0.5)), b = pick(vUv + uTexel * vec2(0.5, -0.5)), c = pick(vUv + uTexel * vec2(-0.5, 0.5)), d = pick(vUv + uTexel * vec2(0.5, 0.5));
    // Karis average: one blinding pixel can't turn into a flickering blob
    float wa = 1.0 / (1.0 + dot(a, vec3(0.333))), wb = 1.0 / (1.0 + dot(b, vec3(0.333))), wc = 1.0 / (1.0 + dot(c, vec3(0.333))), wd = 1.0 / (1.0 + dot(d, vec3(0.333)));
    gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
  }`;
const DOWN_FRAG = `
  uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tSrc, vUv).rgb * 0.5;
    s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125; s += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb * 0.125;
    s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 0.125;  s += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb * 0.125;
    gl_FragColor = vec4(s, 1.0);
  }`;
const UP_FRAG = `
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uMix; varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
    s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0; s += texture2D(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
    s += texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0; s += texture2D(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
    s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb; s += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
    s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;  s += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    gl_FragColor = vec4(s / 16.0 * uMix, 1.0);
  }`;
// ---- the final pass ----
const FINAL_FRAG = `
  uniform sampler2D tColor, tDepth, tAO, tBloom; uniform vec2 uAoSize; uniform float uAoOn, uAoMix, uBloomOn, uBloom, uHazeOn, uHazeK, uHazeMix, uGrade, uSat, uContrast, uTime;
  uniform vec3 uHaze, uSunCol, uSunView, uTint;
  varying vec2 vUv;
  ${DEPTH_GLSL}
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;
    float dep = texture2D(tDepth, vUv).x;
    if (dep < 0.99999) {
      float zc = linZ(dep);
      if (uAoOn > 0.5) {
        // depth-aware upsample of the AO: the four nearest AO texels, weighted by how close their distance is to this pixel's
        vec2 hp = vUv * uAoSize - 0.5; ivec2 i0 = ivec2(floor(hp)); vec2 f = hp - vec2(i0);
        float sa = 0.0, sw = 0.0;
        for (int j = 0; j < 4; j++) {
          ivec2 o = ivec2(j & 1, j >> 1); vec4 s = texelFetch(tAO, clamp(i0 + o, ivec2(0), ivec2(uAoSize) - 1), 0);
          float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y) + 1e-4;
          w *= 1.0 / (1.0 + abs(s.g - zc) / (0.03 * zc + 0.05) * 8.0);
          sa += s.r * w; sw += w;
        }
        col *= mix(1.0, sa / sw, uAoMix);
      }
      if (uHazeOn > 0.5) {
        vec3 vp = viewPosAt(vUv, dep); float dist = length(vp);
        float h = (1.0 - exp(-dist * uHazeK)) * uHazeMix;
        float toSun = pow(max(dot(vp / dist, uSunView), 0.0), 6.0);   // looking toward the sun: the haze glows
        col = mix(col, uHaze + uSunCol * toSun * 0.35, h);
      }
    }
    if (uBloomOn > 0.5) col += texture2D(tBloom, vUv).rgb * uBloom;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // light grade, on the display values (after the sRGB conversion, so the S-curve pivots at the display's mid-grey): saturation,
    // contrast, a warm tint in the lights
    vec3 g = gl_FragColor.rgb;
    float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
    g = mix(vec3(l), g, uSat);
    g = mix(g, g * g * (3.0 - 2.0 * g), uContrast);
    g *= mix(vec3(1.0), uTint, smoothstep(0.25, 1.0, l));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, clamp(g, 0.0, 1.0), uGrade);
    gl_FragColor.rgb += (ign(gl_FragCoord.xy + uTime) - 0.5) / 255.0;   // breaks up banding in the sky gradient
  }`;

function kernel(n) {
  // cosine-ish distributed hemisphere samples, denser near the centre
  const out = []; let s = 7;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, z = Math.sqrt(r()), rr = Math.sqrt(1 - z * z), k = 0.25 + 0.75 * ((i + 1) / n) ** 2;
    out.push(new THREE.Vector3(Math.cos(a) * rr * k, Math.sin(a) * rr * k, Math.max(0.12, z * k)));
  }
  while (out.length < 16) out.push(new THREE.Vector3(0, 0, 0.5));
  return out;
}

export class RealLook {
  /** tier: { mobile, ao: 'half' | 'full', aoSamples, bloomLevels, bloom, msaa } */
  constructor(renderer, scene, camera, { mobile = false, sun = null } = {}) {
    Object.assign(this, { renderer, scene, camera, sun, mobile });
    this.tier = { aoScale: mobile ? 0.5 : 1, aoSamples: mobile ? 8 : 14, bloomLevels: mobile ? 4 : 5, bloom: mobile ? 0.55 : 0.7 };
    this.fx = { ao: true, bloom: true, haze: true, grade: true };
    this.aoActive = true;       // drive.js's adaptive resolution drops this first (setAO)
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    this.target.depthTexture.type = THREE.UnsignedIntType;
    const half = (w = 1, h = 1) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.aoA = half(); this.aoB = half();
    for (const t of [this.aoA, this.aoB]) { t.texture.minFilter = t.texture.magFilter = THREE.NearestFilter; }
    this.mips = Array.from({ length: this.tier.bloomLevels }, () => half());
    const depthU = () => ({ tDepth: { value: this.target.depthTexture }, uNear: { value: camera.near }, uFar: { value: camera.far }, uInvProj: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() } });
    this.m = {
      ao: mkMat(AO_FRAG, { ...depthU(), uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.15 }, uBias: { value: 0.05 }, uPower: { value: 1.6 }, uFade: { value: 90 }, uSamples: { value: this.tier.aoSamples }, uKernel: { value: kernel(16) } }),
      blur: mkMat(BLUR_FRAG, { tAO: { value: null }, uTexel: { value: new THREE.Vector2() } }),
      pre: mkMat(PRE_FRAG, { tColor: { value: this.target.texture }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.9 }, uKnee: { value: 0.4 } }),
      down: mkMat(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }),
      up: mkMat(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } }, { blending: THREE.AdditiveBlending, transparent: true }),
      fin: mkMat(FINAL_FRAG, {
        ...depthU(), tColor: { value: this.target.texture }, tAO: { value: null }, tBloom: { value: null }, uAoSize: { value: new THREE.Vector2(1, 1) },
        uAoOn: { value: 1 }, uAoMix: { value: 0.85 }, uBloomOn: { value: 1 }, uBloom: { value: this.tier.bloom }, uHazeOn: { value: 1 }, uHazeK: { value: 0.00085 }, uHazeMix: { value: 0.7 },
        uHaze: { value: new THREE.Color(0xc9dcef) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.7) }, uSunView: { value: new THREE.Vector3(0, 1, 0) },
        uGrade: { value: 1 }, uSat: { value: 1.0 }, uContrast: { value: 0.12 }, uTint: { value: new THREE.Color(1.03, 1.0, 0.95) }, uTime: { value: 0 },
      }, { toneMapped: true }),
    };
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.m.fin); this.quad.frustumCulled = false;
    this.post = new THREE.Scene(); this.post.add(this.quad);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.size = new THREE.Vector2(1, 1);
    this.resize();
  }
  /** weather: the haze colour (the horizon), the sun's colour and direction (world) for the glow toward the sun, how thick the air is */
  setAtmosphere({ haze, sunColor, sunDir, k = 0.00085, mix = 0.7, exposure } = {}) {
    const u = this.m.fin.uniforms;
    if (haze) u.uHaze.value.copy(haze); if (sunColor) u.uSunCol.value.copy(sunColor); if (sunDir) this.sunDir = sunDir.clone().normalize();
    u.uHazeK.value = k; u.uHazeMix.value = mix;
  }
  setAO(on) { this.aoActive = !!on; }
  resize() {
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.size.copy(v);
    this.target.setSize(v.x, v.y);
    const aw = Math.max(1, Math.round(v.x * this.tier.aoScale)), ah = Math.max(1, Math.round(v.y * this.tier.aoScale));
    this.aoA.setSize(aw, ah); this.aoB.setSize(aw, ah);
    this.m.ao.uniforms.uTexel.value.set(1 / aw, 1 / ah); this.m.blur.uniforms.uTexel.value.set(1 / aw, 1 / ah);
    this.m.fin.uniforms.uAoSize.value.set(aw, ah);
    let w = Math.max(1, v.x >> 1), h = Math.max(1, v.y >> 1);
    for (const m of this.mips) { m.setSize(w, h); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
    this.m.pre.uniforms.uTexel.value.set(1 / v.x, 1 / v.y);
  }
  _pass(mat, rt) { this.quad.material = mat; this.renderer.setRenderTarget(rt); this.renderer.render(this.post, this.ortho); }
  render() {
    const r = this.renderer, cam = this.camera, fx = this.fx;
    for (const m of [this.m.ao, this.m.fin]) { const u = m.uniforms; u.uNear.value = cam.near; u.uFar.value = cam.far; u.uInvProj.value.copy(cam.projectionMatrixInverse); u.uProj.value.copy(cam.projectionMatrix); }
    r.setRenderTarget(this.target); r.render(this.scene, cam);
    const fin = this.m.fin.uniforms, ao = fx.ao && this.aoActive;
    if (ao) {
      this._pass(this.m.ao, this.aoA);
      this.m.blur.uniforms.tAO.value = this.aoA.texture; this._pass(this.m.blur, this.aoB);
      fin.tAO.value = this.aoB.texture;
    }
    fin.uAoOn.value = ao ? 1 : 0;
    const bloom = fx.bloom && this.m.fin.uniforms.uBloom.value > 0;
    if (bloom) {
      const L = this.mips, ac = r.autoClear;
      this._pass(this.m.pre, L[0]);
      for (let i = 1; i < L.length; i++) { this.m.down.uniforms.tSrc.value = L[i - 1].texture; this.m.down.uniforms.uTexel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height); this._pass(this.m.down, L[i]); }
      r.autoClear = false;
      for (let i = L.length - 2; i >= 0; i--) { this.m.up.uniforms.tSrc.value = L[i + 1].texture; this.m.up.uniforms.uTexel.value.set(1 / L[i + 1].width, 1 / L[i + 1].height); this._pass(this.m.up, L[i]); }
      r.autoClear = ac;
      fin.tBloom.value = L[0].texture;
    }
    fin.uBloomOn.value = bloom ? 1 : 0; fin.uHazeOn.value = fx.haze ? 1 : 0; fin.uGrade.value = fx.grade ? 1 : 0;
    if (this.sunDir) fin.uSunView.value.copy(this.sunDir).transformDirection(cam.matrixWorldInverse);
    fin.uTime.value = (fin.uTime.value + 1.7) % 100;
    this.quad.material = this.m.fin; r.setRenderTarget(null); r.render(this.post, this.ortho);
  }
}
