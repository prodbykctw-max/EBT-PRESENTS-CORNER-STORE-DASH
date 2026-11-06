// Phones: a cheap contact shadow under every pedestrian drawn (ContactBlobs). The crowd casts no sun shadow there (castShadow is !mobile: the shadow map is the
// budget), so without this people look pasted onto the pavement. One InstancedMesh of flat quads (2 triangles each) with a radial-fade texture, drawn after the ground but BEFORE the people (opaque queue, renderOrder 1; the crowd meshes get 2), so the people paint over it, without writing depth: no shadow-map cost, one extra draw call. It is fed by whoever draws the people (people-alt.js render, or crowd.js
// render for the old box people), from the same ground height the feet use (m.z), so it follows slopes and curbs. Realistic look + phones only (drive.js).
import * as THREE from './vendor/three.module.min.js';
import { uploadUsed } from './runner.js';

// three.js draws Math.random for the id of every object, material and texture it makes; the crowd, traffic and planner share that stream, so building this
// must not move it (same idea as withoutRandom in people-alt.js, kept private here because ?people=none never loads people-alt.js)
let st = 0x7f4a7c15;
const iso = () => { st ^= st << 13; st ^= st >>> 17; st ^= st << 5; return (st >>> 0) / 4294967296; };
const LIFT = 0.10;   // m above the person's ground height
const FADE0 = 40, FADE1 = 70;   // m from the camera: the blob shrinks to nothing between these (beyond that a person is a few pixels and the patch is invisible)

export class ContactBlobs {
  constructor(scene, cap) {
    const real = Math.random; Math.random = iso;
    try {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(0,0,0,0.9)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      const geo = new THREE.PlaneGeometry(1.35, 1.35); geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: false, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      Object.assign(this.mesh, { name: 'crowd_contact', frustumCulled: false, castShadow: false, receiveShadow: false, count: 0, renderOrder: 1 });
      scene.add(this.mesh);
      this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.pos = new THREE.Vector3(); this.sc = new THREE.Vector3();
    } finally { Math.random = real; }
    this.n = 0; this.cap = Math.max(1, cap);
  }
  begin() { this.n = 0; }
  /** a person at (x, z = ground height, -y) of width w, `dist` m from the camera */
  add(m, dist) {
    if (this.n >= this.cap || dist >= FADE1) return;
    const k = dist <= FADE0 ? 1 : (FADE1 - dist) / (FADE1 - FADE0);
    this.m4.compose(this.pos.set(m.x, m.z + LIFT, -m.y), this.q.identity(), this.sc.set(m.w * k, 1, m.w * k));   // (10 cm up: the drawn slabs rise above the walked height in places, and at 4 cm they hid the blob along their seams as a hard straight edge; measured with a cluster at 3.7 m)
    this.mesh.setMatrixAt(this.n++, this.m4);
  }
  end() {
    this.mesh.count = this.n;
    uploadUsed(this.mesh.instanceMatrix, this.n);
  }
}
