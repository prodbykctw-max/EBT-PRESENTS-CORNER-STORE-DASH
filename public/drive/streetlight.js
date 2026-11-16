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
const POOL_R = 9;   // metres: a cobra-head lamp at 9 m lights the road out to about this

export function lampPools(city, scene) {
  const lamps = city.furniture?.lamp || [];
  if (!lamps.length) return null;
  return quiet(() => {
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLamp: GLOW.uLamp, uPoolK: GLOW.uPoolK, uCol: { value: new THREE.Color(1.0, 0.66, 0.34) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uLamp, uPoolK; uniform vec3 uCol; varying vec2 vUv;
        void main() { float r = length(vUv - 0.5) * 2.0, a = max(0.0, 1.0 - r * r); a *= a; gl_FragColor = vec4(uCol * a * uLamp * uPoolK * 0.85, 1.0); }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    });
    const im = new THREE.InstancedMesh(geo, mat, lamps.length), m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion();
    lamps.forEach(([x, y, yaw, , sc], i) => {
      v.copy(HEAD).multiplyScalar(sc).applyAxisAngle(UP, yaw - Math.PI / 2);   // (landscape.js instances it at yaw - PI/2)
      const px = x + v.x, py = y - v.z;                                          // world x, y (three z = -y)
      m4.compose(v.set(px, city.ground(px, py) + LEVEL.CURB_TOP + 0.04, -py), q.identity(), new THREE.Vector3(POOL_R * 2, 1, POOL_R * 2));
      im.setMatrixAt(i, m4);
    });
    im.name = 'city_pools'; im.frustumCulled = false; im.renderOrder = 3; im.matrixAutoUpdate = false;
    im.visible = GLOW.uLamp.value > 0.01;
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
      sh.uniforms.uLit = GLOW.uLit;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLit;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 u = vMapUv;   // the facade image: sign board v 0.70-0.98, shop window v 0.10-0.57 (the awning between them stays dark)
          float board = smoothstep(0.68, 0.71, u.y) * (1.0 - smoothstep(0.985, 1.0, u.y)), glass = step(0.1, u.y) * (1.0 - step(0.57, u.y)) * step(0.07, u.x) * (1.0 - step(0.93, u.x));
          totalEmissiveRadiance += diffuseColor.rgb * (board * 1.7 + glass * 1.15) * uLit + diffuseColor.rgb * board * 0.05;
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
    spot.castShadow = false; spot.name = 'car_headlights'; spot.userData.base = 380;
    carRig.add(spot, spot.target);
    const set = () => { spot.intensity = spot.userData.base * GLOW.uLamp.value; spot.visible = GLOW.uLamp.value > 0.04; };
    set(); spot.userData.refresh = set;
    return spot;
  });
}
