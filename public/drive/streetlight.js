// The street's own light for the realistic look: what makes Auburn Avenue glow once the sun is down. Everything is steady (nothing blinks, pulses or
// strobes: the owner has photosensitive epilepsy, WCAG 2.3.1) and driven by the two numbers in daylight.js GLOW (uLit, uLamp), so a day or night is one
// assignment. Phones: no dozens of dynamic lights; the glow is emissive materials plus the existing bloom, cheap additive pools on the ground under
// the lamps (ONE instanced draw), and at most one real light, the player car's headlights.
//   lampPools()  a soft pool of warm light on the road and sidewalk under every street lamp
//   lightHero()  the hand-built storefronts' painted signs and shop windows light up (emissive from their own paint, masked to the sign and the glass)
//   carLights()  the player's headlights: one spot light that exists only while it is dark
// (The windows and shop signs of the other buildings are in real.js wallPatch; the street lamp's lens and the traffic's head and tail lamps are in
// real.js propMaterial.)  Everything three.js makes here is made under a private random generator, so the shared Math.random stream is untouched.
import * as THREE from './vendor/three.module.min.js';
import { GLOW } from './daylight.js';
import { LEVEL } from './levels.js';

let iso = 0x2545f491;
const isoRandom = () => { iso ^= iso << 13; iso ^= iso >>> 17; iso ^= iso << 5; return (iso >>> 0) / 4294967296; };
const quiet = (fn) => { const real = Math.random; Math.random = isoRandom; try { return fn(); } finally { Math.random = real; } };

// the lamp head on prop_lamp (props.glb, after the node transform): 8.6 m up, 2.3 m out along the arm (local -Z), measured from the model's vertices
const HEAD = new THREE.Vector3(0, 8.6, -2.3), UP = new THREE.Vector3(0, 1, 0);
const POOL_R = 8;   // metres: a cobra-head lamp at 9 m lights the road out to about this

/** every street lamp's head: world x, y (three z = -y), the ground under it and the head's height (three y) */
function lampHeads(city) {
  const v = new THREE.Vector3();
  return (city.furniture?.lamp || []).map(([x, y, yaw, , sc]) => {
    v.copy(HEAD).multiplyScalar(sc).applyAxisAngle(UP, yaw - Math.PI / 2);   // (landscape.js instances it at yaw - PI/2)
    const px = x + v.x, py = y - v.z, g = city.ground(px, py);
    return { x: px, y: py, g, h: city.ground(x, y) + v.y };
  });
}

// The night's street light (realistic look, weighted by GLOW.uDark): light that falls on whatever is there, not a painted decal. A top-down map of
// how much lamp light (and shop-window spill) reaches each spot of the city, baked once on the CPU into one small texture; the final pass
// (real-post.js) rebuilds every pixel's world position from the depth buffer, looks it up and brightens that pixel by its own colour (so asphalt
// stays asphalt, lane paint catches more light than the road, and the runner, the bully, cars and cards under a lamp are lit like the road under
// them). No geometry, so no floating plane, no hard edge where a decal cuts into a slope or a curb, nothing that can sit under the camera.
//   R: lamp light (soft: a 6.5 m gaussian core and a wide 16 m gaussian spread out to 34 m, so the street between two lamps is dim, not black), G: shop spill, B: the lamp heads' height (light only falls below
//   the head), A: the ground's height (the spill only lights the first few metres up). Steady: nothing here moves or changes over time.
export const LAMP_LIGHT = { core: 6.5, spread: 16, reach: 34, shop: 0.5 };
export function lampLight(city, spots = []) {
  const heads = lampHeads(city);
  if (!heads.length) return null;
  const R = LAMP_LIGHT.reach + 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, yLo = Infinity, yHi = -Infinity;
  const shops = spots.map(([x, z, w]) => ({ x, y: -z, r: w / 2 + 3, g: city.ground(x, -z) }));
  for (const p of [...heads, ...shops]) { x0 = Math.min(x0, p.x - R); y0 = Math.min(y0, p.y - R); x1 = Math.max(x1, p.x + R); y1 = Math.max(y1, p.y + R); yLo = Math.min(yLo, p.g); yHi = Math.max(yHi, p.h ?? p.g); }
  yLo -= 2; yHi += 2;
  const tx = Math.max(1, Math.max(x1 - x0, y1 - y0) / 1024);   // metres a texel: 1 m, coarser only for a very big city (the light varies over metres, and it is filtered)
  const W = Math.ceil((x1 - x0) / tx) + 1, H = Math.ceil((y1 - y0) / tx) + 1;
  const lamp = new Float32Array(W * H), shop = new Float32Array(W * H), hs = new Float32Array(W * H), gs = new Float32Array(W * H);
  const splat = (p, rad, fn, acc, hv) => {
    const i0 = Math.max(0, Math.floor((p.x - rad - x0) / tx)), i1 = Math.min(W - 1, Math.ceil((p.x + rad - x0) / tx));
    const j0 = Math.max(0, Math.floor((p.y - rad - y0) / tx)), j1 = Math.min(H - 1, Math.ceil((p.y + rad - y0) / tx));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const r = Math.hypot(x0 + i * tx - p.x, y0 + j * tx - p.y); if (r > rad) continue;
      const e = fn(r), k = j * W + i; acc[k] += e; if (hv) { hs[k] += e * hv[0]; gs[k] += e * hv[1]; }
    }
  };
  const { core, spread, reach } = LAMP_LIGHT;
  for (const p of heads) splat(p, reach, (r) => 0.68 * Math.exp(-((r / core) ** 2)) + 0.4 * Math.exp(-((r / spread) ** 2)), lamp, [p.h, p.g]);
  for (const p of shops) splat(p, p.r, (r) => (1 - (r / p.r) ** 2) ** 2, shop, [p.g + 3, p.g]);
  const wsum = new Float32Array(W * H); for (let k = 0; k < W * H; k++) wsum[k] = lamp[k] + shop[k];
  const data = new Uint8Array(W * H * 4), span = yHi - yLo, q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, w = wsum[k], g = w > 1e-4 ? gs[k] / w : city.ground(x0 + i * tx, y0 + j * tx), h = w > 1e-4 ? hs[k] / w : g + HEAD.y;
    data[k * 4] = q(lamp[k]); data[k * 4 + 1] = q(shop[k]); data[k * 4 + 2] = q((h - yLo) / span); data[k * 4 + 3] = q((g - yLo) / span);
  }
  const tex = quiet(() => new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType));   // (quiet: its uuids would draw from the shared Math.random)
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  // box: world x0, y0 and 1 / the map's size in metres; y: the height code's origin and span
  return { tex, box: new THREE.Vector4(x0, y0, 1 / (W * tx), 1 / (H * tx)), y: new THREE.Vector2(yLo, span), lamps: heads.length, size: [W, H], texel: tx };
}

export function lampPools(city, scene) {
  const lamps = city.furniture?.lamp || [];
  if (!lamps.length) return null;
  return quiet(() => {
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLamp: GLOW.uLamp, uPoolK: GLOW.uPoolK, uDark: GLOW.uDark, uCol: { value: new THREE.Color(1.0, 0.7, 0.4) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      // (1 - uDark): these flat decals are the dusk's pools only; from blue hour on the lamps light the street through lampLight() below
      fragmentShader: `uniform float uLamp, uPoolK, uDark; uniform vec3 uCol; varying vec2 vUv;
        void main() { float r = length(vUv - 0.5) * 2.0, a = max(0.0, 1.0 - r * r); a *= a; gl_FragColor = vec4(uCol * a * uLamp * uPoolK * 0.6 * (1.0 - uDark), 1.0); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    });
    const im = new THREE.InstancedMesh(geo, mat, lamps.length), m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion();
    lampHeads(city).forEach(({ x: px, y: py }, i) => {
      m4.compose(v.set(px, city.ground(px, py) + LEVEL.CURB_TOP + 0.04, -py), q.identity(), new THREE.Vector3(POOL_R * 2, 1, POOL_R * 2));
      im.setMatrixAt(i, m4);
    });
    im.name = 'city_pools'; im.frustumCulled = false; im.renderOrder = 3; im.matrixAutoUpdate = false;
    im.visible = GLOW.uLamp.value > 0.01;
    return im;
  });
}

/** storefront spill: each hand-built shop throws a soft warm pool of its window light on the sidewalk in front of it (one more instanced additive decal draw, steady, lit with the shop windows) */
export function shopSpill(root, city) {
  return quiet(() => {
    root.updateMatrixWorld(true);
    const spots = [], box = new THREE.Box3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), seen = new Set();
    root.traverse((o) => {
      if (!o.isMesh || !/^facade_/.test(o.material?.name || '') || !o.geometry.attributes.normal) return;
      const na = o.geometry.attributes.normal; n.set(0, 0, 0);
      for (let i = 0; i < na.count; i += 3) n.x += na.getX(i), n.z += na.getZ(i);   // the face's average direction (the horizontal part)
      nm.getNormalMatrix(o.matrixWorld); n.applyMatrix3(nm); n.y = 0;
      if (n.lengthSq() < 1e-6) return; n.normalize();
      box.setFromObject(o); const c = box.getCenter(new THREE.Vector3()), w = Math.min(14, Math.max(box.max.x - box.min.x, box.max.z - box.min.z));
      const key = Math.round(c.x / 2) + ',' + Math.round(c.z / 2); if (seen.has(key)) return; seen.add(key);
      const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5), reach = Math.abs(n.x) * half.x + Math.abs(n.z) * half.z;   // from the box centre out to the shop front, whatever its depth
      spots.push([c.x + n.x * (reach + 2.4), c.z + n.z * (reach + 2.4), w]);                                                 // 2.4 m out: the middle of the wide sidewalk in front of the shop
    });
    if (!spots.length) return null;
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLit: GLOW.uLit, uPoolK: GLOW.uPoolK, uDark: GLOW.uDark },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uLit, uPoolK, uDark; varying vec2 vUv;
        void main() { float r = length(vUv - 0.5) * 2.0, a = max(0.0, 1.0 - r * r); a *= a; gl_FragColor = vec4(vec3(1.0, 0.78, 0.5) * a * uLit * min(uPoolK, 1.0) * 0.28 * (1.0 - uDark), 1.0); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    });
    const im = new THREE.InstancedMesh(geo, mat, spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
    spots.forEach(([x, z, w], i) => {
      m4.compose(v.set(x, city.ground(x, -z) + LEVEL.CURB_TOP + 0.05, z), q.identity(), new THREE.Vector3(w + 2, 1, w + 2));
      im.setMatrixAt(i, m4);
    });
    im.name = 'shop_spill'; im.frustumCulled = false; im.renderOrder = 3; im.matrixAutoUpdate = false;
    im.userData.spots = spots;   // (lampLight() puts the same spill into the night's light map)
    return im;
  });
}

/** the storefronts' paint is the light: emissive = the facade's own colour, in the sign board (the top third of the image) and the shop window (the lower middle) */
export function lightHero(root, chain) {
  const seen = new Set();
  root.traverse((o) => {
    const m = o.isMesh && o.material;
    if (!m || seen.has(m) || !/^facade_/.test(m.name || '')) return; seen.add(m);
    chain(m, (sh) => {
      sh.uniforms.uLit = GLOW.uLit; sh.uniforms.uDark = GLOW.uDark;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLit, uDark;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 u = vMapUv;   // the facade image: sign board v 0.70-0.98, shop window v 0.10-0.57 (the awning between them stays dark)
          float board = smoothstep(0.68, 0.71, u.y) * (1.0 - smoothstep(0.985, 1.0, u.y)), glass = step(0.1, u.y) * (1.0 - step(0.57, u.y)) * step(0.07, u.x) * (1.0 - step(0.93, u.x));
          totalEmissiveRadiance += diffuseColor.rgb * (board * 1.7 + glass * 1.15) * uLit * (1.0 - 0.3 * uDark) + diffuseColor.rgb * board * 0.05;
        }`);
    }, 'hero_lit');
  });
}

/** the player's headlights: a spot light on the front of the car, there only while it is dark (a light that is off still costs every material a pass, so it is hidden by day) */
export function carLights(carRig) {
  return quiet(() => {
    carRig.updateMatrixWorld(true);
    const box = new THREE.Box3(), tmp = new THREE.Box3(), inv = new THREE.Matrix4().copy(carRig.matrixWorld).invert();
    carRig.traverse((o) => { if (o.userData?.headlamp) { tmp.setFromObject(o); box.union(tmp); } });
    const c = box.isEmpty() ? new THREE.Vector3(0, 0.7, -2.2) : box.getCenter(new THREE.Vector3()).applyMatrix4(inv);
    const fz = Math.sign(c.z) || -1;   // the headlamps are at the front: which way along the rig's Z that is
    const spot = new THREE.SpotLight(0xfff0d8, 0, 48, 0.4, 0.9, 1.6);
    spot.position.set(0, c.y + 0.05, c.z); spot.target.position.set(0, c.y - 0.5, c.z + fz * 26);
    spot.castShadow = false; spot.name = 'car_headlights'; spot.userData.base = 900;
    carRig.add(spot, spot.target);
    // (at night, uDark, a little less: with the street lamps now lighting the street, a full-strength cone was the brightest thing on screen)
    const set = () => { spot.intensity = spot.userData.base * GLOW.uLamp.value * (1 - 0.55 * GLOW.uDark.value); spot.visible = GLOW.uLamp.value > 0.04; };
    set(); spot.userData.refresh = set;
    return spot;
  });
}
