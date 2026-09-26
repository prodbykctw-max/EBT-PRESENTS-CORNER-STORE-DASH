// Impact effects: sparks (additive, cooling from white-hot to red), tumbling debris in the colour of what you
// hit, and a puff of smoke on big hits. Pooled and GPU-cheap: one Points draw, one InstancedMesh, a few sprites.
import * as THREE from './vendor/three.module.min.js';

const MAX_SPARKS = 600, MAX_DEBRIS = 120, MAX_SMOKE = 16, G = 14;
const rnd = (a, b) => a + Math.random() * (b - a);

export class ImpactFX {
  constructor(scene) {
    // ---- sparks: one Points cloud; per-particle life drives size and colour in the shader ----
    this.sp = { pos: new Float32Array(MAX_SPARKS * 3), vel: new Float32Array(MAX_SPARKS * 3), life: new Float32Array(MAX_SPARKS), max: new Float32Array(MAX_SPARKS), floor: new Float32Array(MAX_SPARKS), n: 0 };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lifeAttr = new THREE.BufferAttribute(new Float32Array(MAX_SPARKS), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aLife', this.lifeAttr);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `attribute float aLife; varying float vLife; uniform float uScale;
        void main(){ vLife = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aLife <= 0.0 ? 0.0 : (0.3 + 0.5 * aLife) * uScale / -mv.z;   // metres → pixels
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vLife;
        void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c); if (r > 0.5) discard;
          float core = smoothstep(0.5, 0.0, r);
          vec3 hot = mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.75, 0.25), smoothstep(0.1, 0.5, vLife));
          hot = mix(hot, vec3(1.0, 0.97, 0.85), smoothstep(0.6, 1.0, vLife));
          gl_FragColor = vec4(hot * core * (0.6 + vLife), core); }`,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; scene.add(this.points);
    this.sparkMat = m;
    // streaks: each spark also draws a short line back along its velocity — reads as motion in daylight
    this.streak = new Float32Array(MAX_SPARKS * 6); this.streakCol = new Float32Array(MAX_SPARKS * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.streak, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.streakCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.lines.frustumCulled = false; scene.add(this.lines);

    // ---- debris ----
    this.debris = [];
    this.debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }), MAX_DEBRIS);
    this.debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3);
    this.debrisMesh.count = 0; this.debrisMesh.frustumCulled = false; this.debrisMesh.castShadow = true; scene.add(this.debrisMesh);

    // ---- smoke ----
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
    const smokeTex = new THREE.CanvasTexture(c);
    this.smoke = Array.from({ length: MAX_SMOKE }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x9a9a9a, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; scene.add(s); return { s, life: 0, v: new THREE.Vector3() };
    });
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.col = new THREE.Color();
  }

  /** at: contact point (three coords); fwd: car direction (unit, three coords); kind: 'metal' | 'plastic' */
  burst(at, fwd, { power = 1, kind = 'metal', color = 0x888888 } = {}) {
    const floor = at.y - 0.55;
    if (kind === 'metal') {
      const n = Math.round(70 + 90 * power);
      for (let k = 0; k < n; k++) {
        const i = this.sp.n++ % MAX_SPARKS, sp = rnd(4, 13) * (0.6 + power * 0.6);
        // sprayed forward and sideways off the impact, a few straight up
        const a = Math.atan2(fwd.z, fwd.x) + rnd(-1.4, 1.4), up = rnd(0.5, 5.5);
        this.sp.pos.set([at.x + rnd(-0.3, 0.3), at.y + rnd(-0.2, 0.3), at.z + rnd(-0.3, 0.3)], i * 3);
        this.sp.vel.set([Math.cos(a) * sp, up, Math.sin(a) * sp], i * 3);
        this.sp.max[i] = this.sp.life[i] = rnd(0.35, 0.9); this.sp.floor[i] = floor;
      }
    }
    const nd = kind === 'metal' ? Math.round(6 + 10 * power) : 10;
    for (let k = 0; k < nd && this.debris.length < MAX_DEBRIS; k++) {
      const a = Math.atan2(fwd.z, fwd.x) + rnd(-1.2, 1.2), sp = rnd(3, 9) * (0.5 + power * 0.5);
      this.debris.push({
        p: new THREE.Vector3(at.x, at.y, at.z), v: new THREE.Vector3(Math.cos(a) * sp, rnd(2, 6), Math.sin(a) * sp),
        r: new THREE.Vector3(rnd(0, 6), rnd(0, 6), rnd(0, 6)), w: new THREE.Vector3(rnd(-14, 14), rnd(-14, 14), rnd(-14, 14)),
        s: kind === 'metal' ? rnd(0.08, 0.22) : rnd(0.1, 0.2), life: rnd(1.2, 2), floor,
        c: kind === 'plastic' ? 0xff6a10 : (Math.random() < 0.6 ? color : 0x2a2a2e),
      });
    }
    if (power > 0.8) for (let k = 0; k < 4; k++) {
      const sm = this.smoke.find((o) => o.life <= 0); if (!sm) break;
      sm.life = 1; sm.s.visible = true; sm.s.position.set(at.x + rnd(-0.5, 0.5), at.y, at.z + rnd(-0.5, 0.5));
      sm.v.set(rnd(-0.8, 0.8), rnd(0.8, 1.6), rnd(-0.8, 0.8)); sm.s.scale.setScalar(1);
    }
  }

  update(dt, camera, renderer) {
    // sparks
    const P = this.sp.pos, V = this.sp.vel, L = this.lifeAttr.array;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sp.life[i] <= 0) { L[i] = 0; this.streakCol.fill(0, i * 6, i * 6 + 6); continue; }
      this.sp.life[i] -= dt; const k = i * 3;
      V[k + 1] -= G * dt; V[k] *= 1 - dt * 1.5; V[k + 2] *= 1 - dt * 1.5;
      P[k] += V[k] * dt; P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
      if (P[k + 1] < this.sp.floor[i]) { P[k + 1] = this.sp.floor[i]; V[k + 1] *= -0.35; V[k] *= 0.6; V[k + 2] *= 0.6; }
      L[i] = Math.max(0, this.sp.life[i] / this.sp.max[i]);
      const j = i * 6, tail = 0.045;
      this.streak[j] = P[k]; this.streak[j + 1] = P[k + 1]; this.streak[j + 2] = P[k + 2];
      this.streak[j + 3] = P[k] - V[k] * tail; this.streak[j + 4] = P[k + 1] - V[k + 1] * tail; this.streak[j + 5] = P[k + 2] - V[k + 2] * tail;
      const b = L[i];
      this.streakCol.set([1.6 * b, 1.1 * b * b, 0.4 * b * b * b, 0.9 * b, 0.25 * b, 0.02], j); // hot head, red tail
    }
    this.lines.geometry.attributes.position.needsUpdate = true; this.lines.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.position.needsUpdate = true; this.lifeAttr.needsUpdate = true;
    this.sparkMat.uniforms.uScale.value = renderer.domElement.height * 0.55; // point size in world-ish units
    // debris
    let n = 0;
    for (const d of this.debris) {
      d.life -= dt; if (d.life <= 0) continue;
      d.v.y -= G * dt; d.p.addScaledVector(d.v, dt); d.r.addScaledVector(d.w, dt);
      if (d.p.y < d.floor + d.s / 2) { d.p.y = d.floor + d.s / 2; d.v.y *= -0.3; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.6); }
      const sc = d.s * Math.min(1, d.life * 2);
      this.m4.compose(d.p, this.q.setFromEuler(this.e.set(d.r.x, d.r.y, d.r.z)), new THREE.Vector3(sc, sc * 0.5, sc));
      this.debrisMesh.setMatrixAt(n, this.m4); this.debrisMesh.setColorAt(n, this.col.set(d.c)); n++;
    }
    this.debris = this.debris.filter((d) => d.life > 0);
    this.debrisMesh.count = n; this.debrisMesh.instanceMatrix.needsUpdate = true; if (n) this.debrisMesh.instanceColor.needsUpdate = true;
    // smoke
    for (const sm of this.smoke) {
      if (sm.life <= 0) continue;
      sm.life -= dt * 0.8; sm.s.position.addScaledVector(sm.v, dt);
      sm.s.scale.setScalar(1 + (1 - sm.life) * 4); sm.s.material.opacity = Math.max(0, sm.life) * 0.45;
      if (sm.life <= 0) sm.s.visible = false;
    }
  }
}
