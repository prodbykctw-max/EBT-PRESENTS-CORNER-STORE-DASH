// The realistic look ("?look=real"), loaded only when it is asked for. The comic look (look.js, the ink pass, the Neutral
// tone map, the flat comic light) is the default and nothing here runs for it.
//
// What this file does, in the order drive.js calls it:
//   loadTextures   the CC0 scans (public/drive/tex/CREDITS.txt), 1K WebP, two images per set: albedo, and normal + roughness
//   install        registers the prop material / prop geometry hooks (mode.js) BEFORE the city and the traffic are built
//   shadows        one tightened sun shadow (and placeSun: it follows the car, snapped to whole shadow texels)
//   tuneWeather    the sun, the hemisphere light, the sky's environment and the haze, retuned for physically based shading
//   upgradeCity    PBR facades with real glass, roads with worn roughness and tyre lines, curbs and sidewalk concrete,
//                  roofs, lit trees with translucency, bloom for the signals
//   upgradeCar     the player car: clearcoat paint, real glass, rubber, metals (its glTF palette textures are kept)
// Every shader patch is chained onto the one already on the material (like roads.js withCutaway) and gets its own
// customProgramCacheKey, so nothing the comic look relies on is replaced.
import * as THREE from './vendor/three.module.min.js';
import { hooks } from './mode.js';
export { RealLook } from './real-post.js';

const W = new THREE.Vector3(0.2126, 0.7152, 0.0722);

// ------------------------------------------------------------------ textures
const SETS = { brickD: 'brick_d', brickN: 'brick_n', concD: 'conc_d', concN: 'conc_n', curtD: 'curt_d', curtN: 'curt_n', paveD: 'pave_d', paveN: 'pave_n', asphR: 'asph_r', peel: 'peel' };
const SRGB = new Set(['brickD', 'concD', 'curtD', 'paveD']);

export async function loadTextures(base, { mobile = false } = {}) {
  const loader = new THREE.TextureLoader(), T = {};
  await Promise.all(Object.entries(SETS).map(async ([k, f]) => {
    const t = await loader.loadAsync(new URL(`tex/real/${f}.webp`, base).href);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = mobile ? 4 : 8;
    t.colorSpace = SRGB.has(k) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    T[k] = t;
  }));
  // average linear brightness of each albedo: the shaders scale the building's own tint by (texel / average), so a
  // facade keeps its colour family while the scan supplies the detail
  T.mean = {};
  for (const k of ['brickD', 'concD', 'curtD', 'paveD']) {
    const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.drawImage(T[k].image, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data; let s = 0;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    T.mean[k] = Math.max(0.02, s / (d.length / 4));
  }
  return T;
}

// ------------------------------------------------------------------ small helpers
/** chain a shader patch onto whatever the material already has, and key the program so it never collides with the plain one */
function chain(m, patch, tag) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r); patch(sh, r); };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : prev ? String(prev) : '') + '|real:' + tag;
  m.needsUpdate = true;
}
/** swap the patch altogether (the facade shader replaces the comic one: both declare the same attributes) */
function swap(m, patch, tag) { m.onBeforeCompile = (sh, r) => patch(sh, r); m.customProgramCacheKey = () => 'real:' + tag; m.needsUpdate = true; }
const rep = (src, token, add, where = 'after') => {
  if (!src.includes(token)) throw new Error('real.js: shader chunk not found: ' + token);
  return src.replace(token, where === 'after' ? token + '\n' + add : where === 'before' ? add + '\n' + token : add);
};

// tangent frame from screen-space derivatives (the same maths three.js uses for a normal map, for any uv we choose)
const GLSL_TBN = `
mat3 rTBN(vec3 p, vec3 n, vec2 uv) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p); vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, n), dp1perp = cross(n, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x, B = dp2perp * duv1.y + dp1perp * duv2.y;
  float det = max(dot(T, T), dot(B, B)); float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * sc, B * sc, n);
}
vec3 rNormal(vec2 nrg, float k) { vec2 xy = (nrg * 2.0 - 1.0) * k; return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0001))); }
float rLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// ------------------------------------------------------------------ the traffic cars' material (the shared prop material)
// One material for every prop (runner.js propMaterial): cars are told apart per vertex by their palette colour, baked once
// into the aProp attribute (x = which part, y = baked ambient occlusion). 0 plain, 1 paint (tinted per car), 2 glass,
// 3 rubber, 4 headlamp, 5 tail lamp, 6 chrome / bright metal, 7 body paint with its own colour, 8 satin trim, 9 light-bar lens.
const CAR_PARTS = {
  ffffff: 1, '010102': 2, '010101': 3, ffe29a: 4, '850101': 5,
  '73767d': 6, '737a82': 6, '7a828a': 6, cacaca: 6, '9aa8b5': 6,
  e2e7e9: 7, '020203': 7, d8dee2: 7, dee2e9: 7, '001b3c': 7,
  '43464c': 8, '08080a': 8, '060608': 8, '0d0d0f': 8, '030303': 8, '000000': 8,
  b10101: 9, '0108e2': 9,
};
const VEHICLES = new Set(['prop_sedan', 'prop_suv', 'prop_police', 'prop_robotaxi', 'prop_bus', 'prop_tram_end', 'prop_tram_mid']);

function propGeo(g, name) {
  const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, n = P.count, out = new Float32Array(n * 2);
  g.computeBoundingBox(); const top = g.boundingBox.max.y, low = g.boundingBox.min.y, car = VEHICLES.has(name);
  const hex = (i) => [0, 1, 2].map((q) => Math.round(C.getComponent(i, q) * 255).toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < n; i++) {
    const y = P.getY(i) - low, ny = N ? N.getY(i) : 0;
    // baked occlusion: the underside, the wheel arches and the foot of everything are darker (no light gets in there)
    const ref = car ? 0.7 : Math.min(0.5, 0.25 * (top - low));
    let ao = 0.55 + 0.45 * THREE.MathUtils.smoothstep(y, 0, ref);
    if (ny < -0.3) ao *= 0.6;
    out[i * 2] = car ? (CAR_PARTS[hex(i)] ?? 0) : 0; out[i * 2 + 1] = ao;
  }
  g.setAttribute('aProp', new THREE.BufferAttribute(out, 2));
}

function propMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05 });
  chain(m, (sh) => {
    sh.vertexShader = rep(rep(sh.vertexShader, '#include <common>', 'attribute vec2 aProp; varying vec2 vProp;'),
      '#include <color_vertex>', `vProp = aProp;
      #ifdef USE_INSTANCING_COLOR
        // undo the blanket tint and re-apply it only to "paint" (white) vertices (as runner.js does for the comic look)
        vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, step(0.985, min(color.r, min(color.g, color.b))));
      #endif`);
    let f = rep(sh.fragmentShader, '#include <common>', 'varying vec2 vProp;');
    f = rep(f, '#include <metalnessmap_fragment>', `
      int pc = int(vProp.x + 0.5); float pAO = vProp.y > 0.001 ? vProp.y : 1.0;
      float pCoat = 0.0, pCoatR = 0.05; vec3 pEmit = vec3(0.0);
      if (pc == 1 || pc == 7) {                       // car paint: a coloured base under a hard clear coat
        roughnessFactor = 0.3; metalnessFactor = 0.05; pCoat = 1.0; pCoatR = 0.02;
        diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.025));
      } else if (pc == 2) {                           // glass: nearly black, and a clear coat gives it its sky reflection
        diffuseColor.rgb = vec3(0.012, 0.016, 0.02); roughnessFactor = 0.05; metalnessFactor = 0.0; pCoat = 1.0; pCoatR = 0.02;
      } else if (pc == 3) {                           // rubber
        diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.03)); roughnessFactor = 0.85; metalnessFactor = 0.0;
      } else if (pc == 4) {                           // headlamp
        diffuseColor.rgb = vec3(0.9, 0.88, 0.8); roughnessFactor = 0.12; metalnessFactor = 0.0; pCoat = 1.0; pCoatR = 0.02; pEmit = vec3(2.4, 2.25, 1.9);
      } else if (pc == 5) {                           // tail lamp
        roughnessFactor = 0.15; metalnessFactor = 0.0; pCoat = 1.0; pCoatR = 0.03; pEmit = vec3(2.6, 0.06, 0.03);
      } else if (pc == 6) {                           // chrome and bright metal
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72), 0.6); roughnessFactor = 0.26; metalnessFactor = 0.95;
      } else if (pc == 8) {                           // satin trim
        diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.02)); roughnessFactor = 0.5; metalnessFactor = 0.1;
      } else if (pc == 9) {                           // light-bar lens
        roughnessFactor = 0.2; metalnessFactor = 0.0; pCoat = 1.0; pCoatR = 0.03; pEmit = diffuseColor.rgb * 1.6;
      } else { roughnessFactor = 0.62; metalnessFactor = 0.04; }`);
    f = rep(f, '#include <lights_physical_fragment>', 'material.clearcoat = pCoat; material.clearcoatRoughness = min(1.0, pCoatR + geometryRoughness);');
    f = rep(f, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += pEmit;');
    f = rep(f, '#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= pAO; reflectedLight.indirectSpecular *= mix(1.0, pAO, 0.5);', 'replace');
    sh.fragmentShader = f;
  }, 'prop');
  return m;
}

/** call before anything that builds the city, the traffic or the street props */
export function install() {
  hooks.propMaterial = propMaterial;
  hooks.propGeo = propGeo;
}

// ------------------------------------------------------------------ lighting
/** the sun's shadow: one PCF map, tightened around the car (the comic look's +/-110 m box at 1024 px was ~21 cm a texel) */
export function shadows(sun, mobile) {
  const half = mobile ? 62 : 80, size = mobile ? 2048 : 4096;
  sun.shadow.mapSize.set(size, size);
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 460 });
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = mobile ? 0.07 : 0.05;
  sun.userData.texel = (2 * half) / size;   // metres per shadow texel across the light's view
  sun.userData.lead = 16;                   // the box is centred a little ahead of the car: the camera looks ahead
}

/** put the sun (and so its shadow box) round the car, ahead of it, snapped to whole shadow texels so the shadows don't shimmer as it moves */
export function placeSun(sun, carPos, fwd, dir) {
  const texel = sun.userData.texel, t = carPos.clone().addScaledVector(fwd, sun.userData.lead);
  const d = dir.clone().normalize(), r = new THREE.Vector3(0, 1, 0).cross(d).normalize(), u = d.clone().cross(r);
  const a = t.dot(r), b = t.dot(u);
  t.addScaledVector(r, Math.round(a / texel) * texel - a).addScaledVector(u, Math.round(b / texel) * texel - b);
  sun.target.position.copy(t); sun.position.copy(t).addScaledVector(d, 220);
}

/** the comic look's flat light (a strong hemisphere light, a 0.55 environment, exposure bumped under cloud) becomes physical:
 *  a warm sun, a weak hemisphere fill, and the sky's own environment doing most of the ambient and all of the reflections */
export function tuneWeather(w, { scene, renderer, sun, hemi, look }) {
  const cloud = w.cloud / 100, grey = Math.min(1, cloud * 0.85 + w.rain * 0.3);
  sun.intensity = THREE.MathUtils.lerp(6.0, 2.0, grey);                  // a hard sun and a weak fill: deep, cool shadows
  sun.color.set(cloud > 0.7 ? 0xe6edf6 : 0xffeed6);
  hemi.intensity = THREE.MathUtils.lerp(0.2, 0.3, cloud);             // (0.08 left 3-4% of the frame crushed to black)
  scene.environmentIntensity = THREE.MathUtils.lerp(0.9, 1.0, grey);
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
  const fog = w.code === 45 || w.code === 48;
  // aerial haze is the post pass's job (from depth); the linear fog is left only to hide the cull edge (city.cull reads fog.far, so that stays)
  scene.fog.near = scene.fog.far * 0.7;
  // the haze colour: the horizon pulled 30% toward the zenith and darkened, not the pale horizon itself
  const sky = scene.getObjectByName('sky')?.material.uniforms, haze = scene.fog.color.clone();
  if (sky) haze.lerp(sky.uZenith.value, 0.3);
  haze.multiplyScalar(0.8);
  look.setAtmosphere({ haze, sunColor: sun.color, sunDir: sun.userData.dir, k: fog ? 0.006 : THREE.MathUtils.lerp(0.0004, 0.0009, grey), mix: fog ? 0.9 : 0.45 });
}

// ------------------------------------------------------------------ the world
function wallPatch(T) {
  return (sh) => {
    Object.assign(sh.uniforms, {
      rBrickD: { value: T.brickD }, rBrickN: { value: T.brickN }, rConcD: { value: T.concD }, rConcN: { value: T.concN }, rCurtD: { value: T.curtD }, rCurtN: { value: T.curtN },
      rMean: { value: new THREE.Vector3(T.mean.brickD, T.mean.concD, T.mean.curtD) },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aInfo; varying vec3 vInfo; varying vec2 vFac;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvInfo = aInfo; vFac = uv;');
    let f = sh.fragmentShader;
    f = rep(f, '#include <common>', `
      uniform sampler2D rBrickD, rBrickN, rConcD, rConcN, rCurtD, rCurtN; uniform vec3 rMean; varying vec3 vInfo; varying vec2 vFac;
      ${GLSL_TBN}
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wRough = 0.8, wMetal = 0.0, wAO = 1.0; vec3 wNr = vec3(0.5, 0.5, 1.0); vec2 wTilt = vec2(0.0), wUv = vec2(0.0);`);
    f = rep(f, '#include <color_fragment>', `
      float style = vInfo.x, height = vInfo.y, seed = vInfo.z;
      vec3 tint = diffuseColor.rgb;
      tint = mix(vec3(rLum(tint)), tint, 0.85);     // the comic palette is candy: pull it toward real brick, stucco and glass, same colour family
      bool isBrick = style < 0.5, isTower = style > 2.5;
      vec2 uvB = vFac / 1.9, uvC = vFac / 2.7, uvG = vFac / vec2(21.7, 35.0);     // tile sizes in metres (the scans' real sizes)
      wUv = isBrick ? uvB : (isTower ? uvG : uvC);
      vec2 gx = dFdx(wUv), gy = dFdy(wUv);
      vec3 alb, nr;
      if (isBrick) { alb = textureGrad(rBrickD, uvB, gx, gy).rgb; nr = textureGrad(rBrickN, uvB, gx, gy).rgb; }
      else if (isTower) { alb = textureGrad(rCurtD, uvG, gx, gy).rgb; nr = textureGrad(rCurtN, uvG, gx, gy).rgb; }
      else { alb = textureGrad(rConcD, uvC, gx, gy).rgb; nr = textureGrad(rConcN, uvC, gx, gy).rgb; }
      float mean = isBrick ? rMean.x : (isTower ? rMean.z : rMean.y), al = rLum(alb);
      vec3 wallCol = tint * (al / mean) * mix(vec3(1.0), alb / max(al, 1e-3), 0.35);
      wRough = nr.b; wNr = nr; wAO = mix(0.55, 1.0, smoothstep(0.0, 3.2, vFac.y));   // baked ground-contact occlusion
      if (isTower) {
        // glass curtain wall: the scan gives the panels and mullions; panels are reflective tinted glass, a spandrel band marks each floor slab
        float pm = smoothstep(0.01, 0.05, al), fy = fract(vFac.y / 3.9), band = 1.0 - smoothstep(0.17, 0.21, fy);
        vec3 panel = tint * 1.25 * (al / mean) * vec3(0.9, 1.0, 1.1);
        diffuseColor.rgb = mix(wallCol * 0.35, panel, pm);
        diffuseColor.rgb = mix(diffuseColor.rgb, tint * 0.5, band);
        wRough = mix(0.5, clamp(nr.b * 0.5 + 0.03, 0.03, 0.4), pm * (1.0 - band)); wMetal = pm * (1.0 - band) * 0.8;
        wAO *= 1.0 - 0.15 * band;
      } else {
        float bay = isTower ? 1.55 : (style > 1.5 ? 2.4 : 3.0), floorH = style > 2.5 ? 3.9 : 3.6;
        vec2 cell = vec2(fract(vFac.x / bay), fract(vFac.y / floorH)), id = vec2(floor(vFac.x / bay), floor(vFac.y / floorH));
        vec2 lo = style > 1.5 ? vec2(0.12, 0.22) : vec2(0.22, 0.3), hi = style > 1.5 ? vec2(0.88, 0.82) : vec2(0.78, 0.84);
        if (id.y < 0.5) { lo = vec2(0.05, 0.08); hi = vec2(0.95, 0.78); }           // storefront glass on the ground floor
        vec2 aa = fwidth(vFac / vec2(bay, floorH)) * 1.2;
        float win = smoothstep(lo.x, lo.x + aa.x, cell.x) * (1.0 - smoothstep(hi.x - aa.x, hi.x, cell.x)) * smoothstep(lo.y, lo.y + aa.y, cell.y) * (1.0 - smoothstep(hi.y - aa.y, hi.y, cell.y));
        win *= step(0.0, vFac.y) * (1.0 - step(height - 0.9, vFac.y));              // no windows in the parapet
        float rnd = h21(id + seed * 91.0), blind = step(0.9, rnd);
        vec2 sz = vec2(bay, floorH), a = (cell - lo) * sz, b = (hi - cell) * sz;     // metres inside the opening to its left/bottom and right/top edges
        float rim = 1.0 - smoothstep(0.06, 0.13, min(min(a.x, a.y), min(b.x, b.y)));  // the window frame (dark, satin metal)
        vec3 glass = (style > 1.5 ? vec3(0.17, 0.22, 0.27) : vec3(0.03, 0.036, 0.045)) * mix(0.7, 1.3, rnd);
        glass = mix(glass, vec3(0.34, 0.27, 0.18), blind);                          // blinds and lit interiors
        vec3 frame = vec3(0.045, 0.045, 0.05);
        vec3 pane = mix(glass, frame, rim);
        diffuseColor.rgb = mix(wallCol, pane, win);
        wRough = mix(nr.b, mix(mix(0.05, 0.7, blind), 0.45, rim), win);
        wMetal = win * mix(style > 1.5 ? 0.75 : 0.0, 0.6, rim) * (1.0 - blind);
        // the reveal: window edges tilt the surface inward, so the sun and sky catch them and the glass reads as set back
        vec2 t0 = vec2(1.0) - smoothstep(vec2(0.0), vec2(0.12), a), t1 = vec2(1.0) - smoothstep(vec2(0.0), vec2(0.12), b);
        wTilt = (t0 - t1) * win * 0.9;
        wNr.xy = mix(nr.xy, vec2(0.5), win * (1.0 - rim));
        wAO *= (1.0 - 0.3 * rim * win) * mix(1.0, 0.82, win);
      }
      diffuseColor.rgb *= mix(1.0, 0.8, 1.0 - smoothstep(0.0, 0.25, vFac.y));       // street grime`);
    f = rep(f, '#include <roughnessmap_fragment>', 'roughnessFactor = wRough;');
    f = rep(f, '#include <metalnessmap_fragment>', 'metalnessFactor = wMetal;');
    f = rep(f, '#include <normal_fragment_maps>', `{ vec3 mN = rNormal(wNr.xy, 1.0); mN.xy += wTilt; mN = normalize(mN); normal = normalize(rTBN(-vViewPosition, normal, wUv) * mN); }`, 'replace');
    f = rep(f, '#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= wAO; reflectedLight.indirectSpecular *= mix(1.0, wAO, 0.6);', 'replace');
    sh.fragmentShader = f;
  };
}

/** concrete sidewalk: a tiled albedo + normal + roughness through whatever uv the surface offers */
function paveSnippet() { return `
  uniform sampler2D rPaveD, rPaveN; uniform float rPaveMean; ${GLSL_TBN}
  float pRough = 0.85; vec3 pNr = vec3(0.5, 0.5, 1.0); vec2 pUv = vec2(0.0);`; }
const paveUniforms = (sh, T) => Object.assign(sh.uniforms, { rPaveD: { value: T.paveD }, rPaveN: { value: T.paveN }, rPaveMean: { value: T.mean.paveD } });
const paveShade = (f, uvExpr, tint) => {
  f = rep(f, '#include <map_fragment>', `
    pUv = ${uvExpr};
    { vec4 pd = texture2D(rPaveD, pUv); vec3 pn = texture2D(rPaveN, pUv).rgb;
      diffuseColor.rgb = ${tint} * (rLum(pd.rgb) / rPaveMean) * mix(vec3(1.0), pd.rgb / max(rLum(pd.rgb), 1e-3), 0.3); pNr = pn; pRough = pn.b; }`, 'replace');
  f = rep(f, '#include <roughnessmap_fragment>', 'roughnessFactor = pRough;');
  f = rep(f, '#include <normal_fragment_maps>', 'normal = normalize(rTBN(-vViewPosition, normal, pUv) * rNormal(pNr.xy, 1.0));', 'replace');
  return f;
};

function groundPatch(T) {   // the terrain / sidewalk mesh: uv = metres / 3
  return (sh) => {
    paveUniforms(sh, T);
    let f = rep(sh.fragmentShader, '#include <common>', paveSnippet());
    sh.fragmentShader = paveShade(f, 'vMapUv * (3.0 / 1.8)', 'diffuseColor.rgb * 0.82');
  };
}
function curbPatch(T) {     // curbs have no uv at all: project the concrete in world space (top faces on x,z; sides along the curb and up)
  return (sh) => {
    paveUniforms(sh, T);
    sh.vertexShader = rep(rep(sh.vertexShader, '#include <common>', 'varying vec3 vWP; varying vec3 vWN;'), '#include <project_vertex>',
      'vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    let f = rep(sh.fragmentShader, '#include <common>', 'varying vec3 vWP; varying vec3 vWN;\n' + paveSnippet());
    sh.fragmentShader = paveShade(f, '(abs(vWN.y) > 0.6 ? vWP.xz : vec2(dot(vWP.xz, vec2(-vWN.z, vWN.x)), vWP.y)) / 1.8', 'diffuseColor.rgb * 0.9');
  };
}
function roofPatch(T) {
  return (sh) => {
    paveUniforms(sh, T);
    let f = rep(sh.fragmentShader, '#include <common>', paveSnippet());
    // the comic roof patch (city.js) washes the roof texture halfway to white after map_fragment: not in the realistic look
    f = f.replace('diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.5);', '');
    f = rep(f, '#include <map_fragment>', 'pUv = vMapUv * (8.0 / 1.8); { vec3 pn = texture2D(rPaveN, pUv).rgb; pNr = pn; pRough = 0.9; }');
    f = rep(f, '#include <roughnessmap_fragment>', 'roughnessFactor = 0.9;');
    sh.fragmentShader = rep(f, '#include <normal_fragment_maps>', 'normal = normalize(rTBN(-vViewPosition, normal, pUv) * rNormal(pNr.xy, 0.7));', 'replace');
  };
}

/** worn asphalt: roughness from the scan with patchy wear, darker polished tyre tracks down each lane */
function roadPatch(T) {
  return (sh) => {
    sh.uniforms.rAsphR = { value: T.asphR };
    let f = rep(sh.fragmentShader, '#include <common>', 'uniform sampler2D rAsphR;');
    f = f.replace('roughnessFactor = mix(roughnessFactor, 0.16, uWet);', `
      float rr = texture2D(rAsphR, tuv).r, rr2 = texture2D(rAsphR, tuv * 0.23 + 0.37).r;
      roughnessFactor = clamp(mix(rr, rr2, 0.4) * 1.05, 0.5, 1.0);
      float twoWay = step(1.5, vRoad.y), nLane = twoWay > 0.5 ? max(1.0, floor(vRoad.x * 0.5 + 0.5)) : max(1.0, vRoad.x);
      float lanePos = twoWay > 0.5 ? fract(across * 2.0) : across, laneW = w * (twoWay > 0.5 ? 0.5 : 1.0) / nLane;
      float off = (fract(lanePos * nLane) - 0.5) * laneW;
      float track = max(exp(-pow((off - 0.78) / 0.3, 2.0)), exp(-pow((off + 0.78) / 0.3, 2.0)));
      float parkM = vPark > 0.5 ? clamp(step(across * w, vPark) + step((1.0 - across) * w, vPark), 0.0, 1.0) : 0.0;
      track *= (1.0 - parkM) * smoothstep(0.0, 1.0, vMark);
      diffuseColor.rgb *= 1.0 - 0.2 * track; roughnessFactor *= 1.0 - 0.18 * track;
      float wear = smoothstep(0.35, 0.8, texture2D(rAsphR, tuv * 0.071 + 0.6).g); diffuseColor.rgb *= 1.0 - 0.1 * wear;
      roughnessFactor = mix(roughnessFactor, 0.16, uWet);`);
    sh.fragmentShader = f;
  };
}

/** the street trees: proper lighting. The leaf cards' own normals (all flat, all pointing one way per card) are replaced by
 *  a rounded canopy normal, so the crown shades like a volume; backlit leaves let the sun through; the low canopy is darker */
function leafPatch() {
  return (sh) => {
    sh.vertexShader = rep(rep(sh.vertexShader, '#include <common>', 'varying float vLeafH;'), '#include <begin_vertex>', 'vLeafH = color.r;');
    sh.vertexShader = rep(sh.vertexShader, '#include <beginnormal_vertex>', `{ float lh = color.r; vec3 rn = vec3(position.x, (lh - 0.45) * (length(position.xz) + 0.8) * 1.4, position.z);
        objectNormal = normalize(mix(objectNormal, normalize(rn), 0.75)); }`);
    let f = rep(sh.fragmentShader, '#include <common>', 'varying float vLeafH;');
    f = rep(f, '#include <normal_fragment_begin>', 'normal = normalize(vNormal); nonPerturbedNormal = normal;       // the rounded canopy normal, on both sides of a card');
    f = rep(f, '#include <emissivemap_fragment>', `
      #if NUM_DIR_LIGHTS > 0
        float lt = pow(clamp(-dot(directionalLights[0].direction, normalize(vViewPosition)), 0.0, 1.0), 2.0);
        totalEmissiveRadiance += diffuseColor.rgb * directionalLights[0].color * lt * 0.32 * mix(0.5, 1.0, vLeafH);   // sun through the leaves
      #endif`);
    f = rep(f, '#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= mix(0.45, 1.0, vLeafH); reflectedLight.indirectSpecular *= mix(0.6, 1.0, vLeafH);', 'replace');
    sh.fragmentShader = f;
  };
}

/** change the city's materials after it is built and before anything is drawn or compiled */
export function upgradeCity({ city, T, scene }) {
  const seen = new Set(), once = (m, tag, fn) => { if (seen.has(m)) return; seen.add(m); (tag === 'walls' ? swap : chain)(m, fn, tag); };
  city.group.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (o.name === 'walls' || o.name === 'walls_tile') once(m, 'walls', wallPatch(T));
    else if (o.name === 'roofs' || o.name === 'roofs_tile') once(m, 'roofs', roofPatch(T));
    else if (o.name === 'ground' || o.name === 'ground_tile') once(m, 'ground', groundPatch(T));
    else if (o.name === 'curbs' || o.name === 'curbs_tile') once(m, 'curbs', curbPatch(T));
    else if (/^tree_leaves_/.test(o.name)) once(m, 'leaves', leafPatch());
    if (m.userData?.wet) once(m, 'road', roadPatch(T));
  });
  // roads that aren't flagged by name above (the route road, the junctions) are found by their wet-road uniform
  for (const s of city.surfaces || []) if (s.material?.userData?.wet) once(s.material, 'road', roadPatch(T));
  // the signals: lit lamps pushed above 1 so they bloom
  scene.traverse((o) => { if (o.name === 'signal_lamps') o.material.color.setScalar(o.material.transparent ? 1.6 : 3.4); });
}

// ------------------------------------------------------------------ the player's car
/** car.glb is one mesh per material (named "<n>_•_<Name>"): paint gets a clear coat and a fine orange-peel, glass and rubber become
 *  what they are. Its palette textures (colour, roughness, metalness) are kept, so every colour stays exactly the car's. */
export function upgradeCar(carModel, T) {
  const peel = T.peel;
  const phys = (src, over) => {
    const m = new THREE.MeshPhysicalMaterial({ map: src.map, roughnessMap: src.roughnessMap, metalnessMap: src.metalnessMap, side: src.side, color: src.color, roughness: src.roughness, metalness: src.metalness, ...over });
    m.name = src.name; return m;
  };
  const detail = (m, kind) => chain(m, (sh) => {
    sh.uniforms.rPeel = { value: peel };
    sh.vertexShader = rep(rep(sh.vertexShader, '#include <common>', 'varying vec3 vOP; varying vec3 vON;'), '#include <begin_vertex>', 'vOP = position; vON = normal;');
    let f = rep(sh.fragmentShader, '#include <common>', 'uniform sampler2D rPeel; varying vec3 vOP; varying vec3 vON;');
    // one sample from the plane the surface faces most (object space), as a bump on the normal and a wobble on the roughness
    f = rep(f, '#include <normal_fragment_maps>', `{
      vec3 an = abs(vON); vec2 pu = an.y > max(an.x, an.z) ? vOP.xz : (an.x > an.z ? vOP.zy : vOP.xy);
      vec2 pk = texture2D(rPeel, pu * ${kind === 'paint' ? '2.5' : '5.0'}).rg;
      // paint is smooth glass-like clear coat: a screen-derivative bump on a fine texture aliased into sparkle, so only the rubber gets one, gently
      ${kind === 'paint' ? '' : `float hh = pk.r - 0.5; vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
      vec2 dh = clamp(vec2(dFdx(hh), dFdy(hh)), -0.08, 0.08) * 0.25;
      vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
      normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));`}
      roughnessFactor = clamp(roughnessFactor + (pk.g - 0.5) * ${kind === 'paint' ? '0.08' : '0.14'}, 0.02, 1.0);
    }`, 'before');
    sh.fragmentShader = f;
  }, 'carpeel_' + kind);
  carModel.traverse((o) => {
    if (!o.isMesh) return;
    const k = /_\|_(\d\d)_/.exec(o.name)?.[1], src = o.material;
    if (k === '01') { o.material = phys(src, { clearcoat: 1, clearcoatRoughness: 0.02, roughness: 0.28, metalness: 0.05, envMapIntensity: 1.0 }); detail(o.material, 'paint'); }
    else if (k === '05') o.material = phys(src, { color: new THREE.Color(0.03, 0.04, 0.05), roughnessMap: null, metalnessMap: null, map: null, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.5 });
    else if (k === '04') { o.material = phys(src, { roughness: 0.85, metalness: 0, roughnessMap: null, metalnessMap: null, color: new THREE.Color(0.9, 0.9, 0.9) }); detail(o.material, 'rubber'); }
    else if (k === '06' || k === '07') o.material = phys(src, { envMapIntensity: 1.2 });
    else if (k === '02' || k === '03' || k === '08') o.material = phys(src, { clearcoat: k === '08' ? 1 : 0, clearcoatRoughness: 0.08 });
    // 09 (headlamp), 10 (tail lamp) and 11 (marker) keep their own materials: drive.js finds the brake lamps by their emissive
  });
}

/** the bully is made from the player's material by cloning it (drive.js makePerson), so anything the player's look needs goes here, first */
export function upgradeCharacter(root) {
  root.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial) { o.material.roughness = 0.82; o.material.envMapIntensity = 0.85; } });
}
