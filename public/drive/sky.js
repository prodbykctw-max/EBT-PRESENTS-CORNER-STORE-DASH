// Sky dome + image-based lighting generated at runtime (no HDRI download): a gradient sky with a sun glow is
// rendered once into a PMREM environment map, so glass towers and car paint reflect a real sky instead of black.
import * as THREE from './vendor/three.module.min.js';

export function buildSky(renderer, scene, { zenith, horizon, sunDir, cloud = 0 }) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(zenith) }, uHorizon: { value: new THREE.Color(horizon) },
      uGround: { value: new THREE.Color(0x6b6862) }, uSun: { value: sunDir.clone().normalize() }, uCloud: { value: cloud },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uZenith, uHorizon, uGround, uSun; uniform float uCloud; varying vec3 vDir;
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
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  scene.background = null;
  scene.add(dome);
  return { dome, env, follow: (camera) => dome.position.copy(camera.position) };
}
