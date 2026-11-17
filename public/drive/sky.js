/** the realistic sky's extra uniforms from daylight.js's lightFor(): five gradient stops, the cloud tint, the night's stars and moon, the sun's glow */
function realUniforms(L) {
  const g = L.horizon.clone().multiplyScalar(0.55).add(new THREE.Color(0.01, 0.01, 0.012));
  return {
    uS0: { value: L.sky[0].clone() }, uS1: { value: L.sky[1].clone() }, uS2: { value: L.sky[2].clone() }, uS3: { value: L.sky[3].clone() }, uS4: { value: L.sky[4].clone() },
    uGround: { value: g }, uEnvGround: { value: g.clone().multiplyScalar(1.15) }, uMoon: { value: new THREE.Vector3(0.5, 0.62, 0.6).normalize() }, uCloudTint: { value: L.cloudTint.clone() },
    uGlow: { value: L.sunColor.clone().lerp(new THREE.Color(1, 0.82, 0.58), 0.4) }, uGlowK: { value: 1 + 1.4 * (1 - Math.min(1, Math.max(0, (L.el + 3) / 12))) },
    uNight: { value: L.night }, uEnvSat: { value: L.envSat },
  };
}

// Sky dome + image-based lighting generated at runtime (no HDRI download): a gradient sky with a sun glow is
// rendered once into a PMREM environment map, so glass towers and car paint reflect a real sky instead of black.
import * as THREE from './vendor/three.module.min.js';

// The realistic look's sky: the same dome and the same environment pipeline, but with cumulus clouds, a warm glow round the
// sun, a hot sun disc and a hazy horizon, so paint, glass and wet roads reflect a sky with something in it.
const REAL_FRAG = `uniform vec3 uS0, uS1, uS2, uS3, uS4, uGround, uEnvGround, uSun, uMoon, uCloudTint, uGlow; uniform float uCloud, uNight, uEnvSat, uGlowK; varying vec3 vDir;
  float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hsh3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
  // the sky's five stops (uS0 zenith .. uS4 horizon) at heights 1, 0.45, 0.2, 0.08, 0 (daylight.js picks them from the sun's elevation)
  vec3 grad(float h) {
    h = clamp(h, 0.0, 1.0);
    vec3 c = mix(uS4, uS3, smoothstep(0.0, 0.08, h));
    c = mix(c, uS2, smoothstep(0.08, 0.2, h)); c = mix(c, uS1, smoothstep(0.2, 0.45, h)); return mix(c, uS0, smoothstep(0.45, 1.0, h));
  }
  void main() {
    float h = vDir.y, mu = max(dot(vDir, uSun), 0.0);
    vec3 sky = grad(h);
    sky = mix(sky, uS4 * 1.05, (1.0 - smoothstep(0.0, 0.08, h)) * 0.2);
    sky += uGlow * (pow(mu, 6.0) * 0.16 + pow(mu, 48.0) * 0.5) * uGlowK * (1.0 - 0.6 * uCloud);
    sky += vec3(1.0, 0.95, 0.85) * pow(mu, 1800.0) * 60.0 * (1.0 - uCloud) * (1.0 - uNight);
    if (uNight > 0.0 && h > 0.0) {
      // a few steady stars (never twinkling), the moon, and the city's own glow on the horizon
      vec3 p = vDir * 60.0, id = floor(p), f = fract(p) - 0.5; float st = 0.0;
      if (hsh3(id) > 0.994) { vec3 o = (vec3(hsh(id.xy + 1.7), hsh(id.yz + 3.1), hsh(id.zx + 5.3)) - 0.5) * 0.5; st = smoothstep(0.16, 0.0, length(f - o)) * (0.5 + 0.5 * hsh(id.xz)); }
      float mm = dot(vDir, uMoon);
      vec3 night = vec3(0.9, 0.93, 1.0) * st * 3.0 * smoothstep(0.03, 0.25, h) + vec3(0.82, 0.88, 1.0) * (smoothstep(0.99962, 0.99985, mm) * 4.0 + pow(max(mm, 0.0), 220.0) * 0.12);
      sky += night * uNight * (1.0 - uCloud * 0.85) + vec3(0.5, 0.28, 0.12) * 0.07 * uNight * (1.0 - smoothstep(0.0, 0.3, h));
    }
    if (h > 0.0) {
      vec2 cp = vDir.xz / (h + 0.28) * 1.6;
      float c = fbm(cp + 3.1), cov = smoothstep(0.72 - uCloud * 0.5, 0.95 - uCloud * 0.3, c) * smoothstep(0.0, 0.14, h);
      vec3 lit = mix(vec3(1.02, 1.0, 0.97), vec3(0.62, 0.65, 0.7), uCloud) * uCloudTint, shade = mix(vec3(0.84, 0.88, 0.95), vec3(0.42, 0.45, 0.5), uCloud) * uCloudTint;
      vec3 cc = mix(shade, lit, smoothstep(0.35, 0.8, fbm(cp * 1.7 + 9.0)) * 0.7 + 0.3 * pow(mu, 2.0));
      sky = mix(sky, cc, cov);
    }
#ifdef ENVMAP
    sky = mix(vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722))), sky, uEnvSat);   // the light and the reflections: a calmer sky than the one you see (at dusk it keeps more of its colour)
    vec3 col = h < 0.0 ? uEnvGround : sky;          // what the paint reflects: the sky over a warm ground bounce, with a crisp horizon line between them
#else
    // below the horizon the dome is only ever seen through a gap in the ground: plain pavement grey (well under the bloom threshold), blending to the
    // horizon colour only in the last degree or two, where the real terrain's far edge meets it
    vec3 col = h < 0.0 ? mix(uGround, uS4 * 0.9, 1.0 - smoothstep(0.0, 0.03, -h)) : sky;
#endif
    gl_FragColor = vec4(col, 1.0);
  }`;

export function buildSky(renderer, scene, { zenith, horizon, sunDir, cloud = 0, real = false, light = null }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(zenith) }, uHorizon: { value: new THREE.Color(horizon) },
      uGround: { value: new THREE.Color(0x6b6862) }, uEnvGround: { value: new THREE.Color(0x7a746a) }, uSun: { value: sunDir.clone().normalize() }, uCloud: { value: cloud },
      ...(real && light ? realUniforms(light) : {}),
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: real ? REAL_FRAG : `uniform vec3 uZenith, uHorizon, uGround, uSun; uniform float uCloud; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
        float sun = max(dot(vDir, uSun), 0.0);
        sky += vec3(1.0, 0.93, 0.8) * (pow(sun, 900.0) * 8.0 * (1.0 - uCloud) + pow(sun, 12.0) * 0.25);
        vec3 col = h < 0.0 ? mix(uHorizon * 0.85, uGround, clamp(-h * 6.0, 0.0, 1.0)) : sky;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat);
  dome.name = 'sky'; dome.frustumCulled = false; dome.renderOrder = -1;

  // environment for reflections / ambient: render the dome alone through PMREM
  const envScene = new THREE.Scene(); let envMat = mat;
  if (real) { envMat = mat.clone(); envMat.defines = { ENVMAP: '' }; envMat.needsUpdate = true; }   // the realistic look's reflections get a dark ground
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), envMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  scene.background = null;
  scene.add(dome);
  const out = { dome, env, follow: (camera) => out.dome.position.copy(camera.position) };   // (out.dome: a relight swaps the dome, the loop keeps this object)
  return out;
}
