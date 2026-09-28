// The GTA Chinatown Wars look for the whole world, as one full-screen pass after the scene renders:
//   - bold ink outlines wherever depth jumps (silhouettes of cars, buildings, trees, people, curbs, the skyline),
//     from a 3x3 Sobel on linear depth, scaled by distance so lines stay about the same weight near and far;
//   - flatter, comic shading: the brightness is gently pulled toward a few bands, so light reads as cel shading;
//   - then the renderer's own tone map (the saturated CustomToneMapping set up in drive.js) and sRGB output.
// The scene renders into a multisampled HDR target (MSAA stays on), so edges and colours stay clean.
import * as THREE from './vendor/three.module.min.js';

export class Look {
  constructor(renderer, scene, camera, { mobile = false } = {}) {
    Object.assign(this, { renderer, scene, camera });
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 });
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    this.target.depthTexture.type = THREE.UnsignedIntType;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture }, tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2(1, 1) }, uNear: { value: camera.near }, uFar: { value: camera.far },
        uInk: { value: 0.85 }, uBands: { value: 0.08 }, uCrease: { value: 0.8 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tColor, tDepth; uniform vec2 uTexel; uniform float uNear, uFar, uInk, uBands, uCrease;
        varying vec2 vUv;
        float lin(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main() {
          vec4 col = texture2D(tColor, vUv);
          float c = lin(vUv);
          // Sobel on linear depth, relative to the centre depth: a jump of a few % of the distance is an edge
          float tl = lin(vUv + uTexel * vec2(-1.0, 1.0)), t = lin(vUv + uTexel * vec2(0.0, 1.0)), tr = lin(vUv + uTexel * vec2(1.0, 1.0));
          float l = lin(vUv + uTexel * vec2(-1.0, 0.0)), r = lin(vUv + uTexel * vec2(1.0, 0.0));
          float bl = lin(vUv + uTexel * vec2(-1.0, -1.0)), b = lin(vUv + uTexel * vec2(0.0, -1.0)), br = lin(vUv + uTexel * vec2(1.0, -1.0));
          float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl), gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
          float g = sqrt(gx * gx + gy * gy) / max(c, 0.001);
          // creases: where a surface bends (building corners, roof lines, car panels, curbs) even with no depth jump.
          // 1/depth is linear across any flat surface on screen, so its Laplacian is zero on flats and spikes at folds
          float wc = 1.0 / c;
          float crease = (abs(1.0 / l + 1.0 / r - 2.0 * wc) + abs(1.0 / t + 1.0 / b - 2.0 * wc)) / wc;
          float edge = max(smoothstep(0.05, 0.12, g), smoothstep(0.03, 0.07, crease) * uCrease) * (1.0 - smoothstep(0.93, 1.0, c / uFar));   // (sky has no ink)
          // comic shading: pull the brightness toward 5 bands, keeping the hue
          vec3 rgb = col.rgb * 1.16;                         // sunny, like the DS/iPhone game: bright and open
          rgb += (1.0 - rgb) * 0.035;                         // lifted shadows: flat comic light, never murky
          float lum = max(max(rgb.r, rgb.g), rgb.b);
          if (lum > 0.0001) {
            float q = (floor(lum * 5.0) + 0.5) / 5.0;
            rgb *= mix(1.0, q / lum, uBands);
          }
          rgb = mix(rgb, rgb * 0.08, edge * uInk);
          gl_FragColor = vec4(rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, toneMapped: true,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); this.quad.frustumCulled = false;
    this.post = new THREE.Scene(); this.post.add(this.quad);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.resize();
  }
  resize() {
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(v.x, v.y);
    this.mat.uniforms.uTexel.value.set(1 / v.x, 1 / v.y);
  }
  render() {
    const r = this.renderer, u = this.mat.uniforms;
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    r.setRenderTarget(this.target); r.render(this.scene, this.camera);
    r.setRenderTarget(null); r.render(this.post, this.ortho);
  }
}
