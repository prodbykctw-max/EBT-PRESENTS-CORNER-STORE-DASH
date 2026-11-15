import * as THREE from '../public/drive/vendor/three.module.min.js';
import { standOn } from '../public/drive/levels.js';
const ground = (x, y) => 0.12 * x + 0.07 * y + 0.4 * Math.sin(x * 0.7) * Math.sin(y * 0.5);
let worst = 0, worstLift = 0;
const clearRoad = (st, z, pitch, roll, hl, hw) => { const sp = hl * Math.sin(pitch), sr = hw * Math.sin(roll) * Math.cos(pitch);
  return Math.max(0, st.fl - (z + sp - sr), st.fr - (z + sp + sr), st.bl - (z - sp - sr), st.br - (z - sp + sr)); };
for (let i = 0; i < 2000; i++) {
  const x = Math.random() * 50, y = Math.random() * 50, a = Math.random() * 6.28, hl = 1.35, hw = 0.77;
  const st = standOn(ground, x, y, a, hl, hw);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, st.z, -y), new THREE.Quaternion().setFromEuler(new THREE.Euler(st.pitch, a - Math.PI / 2, st.roll, 'YXZ')), new THREE.Vector3(1, 1, 1));
  // rendered wheel contact points vs the road under them
  let w = 1e9;
  for (const [px, pz] of [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl]]) { const v = new THREE.Vector3(px, 0, pz).applyMatrix4(m); w = Math.min(w, v.y - ground(v.x, -v.z)); }
  worst = Math.min(worst, w); worstLift = Math.max(worstLift, clearRoad(st, st.z, st.pitch, st.roll, hl, hw));
}
console.log('rendered wheel vs road, worst (negative = under):', worst.toFixed(4), ' | clearRoad lift on the unsmoothed pose, max:', worstLift.toFixed(4));
{
  const x = 10, y = 20, a = 0.7, hl = 1.35, hw = 0.77; const st = standOn(ground, x, y, a, hl, hw);
  const sp = hl * Math.sin(st.pitch), sr = hw * Math.sin(st.roll) * Math.cos(st.pitch);
  console.log('st', JSON.stringify(st));
  console.log('plane corners fl fr bl br', (st.z+sp-sr).toFixed(3), (st.z+sp+sr).toFixed(3), (st.z-sp-sr).toFixed(3), (st.z-sp+sr).toFixed(3));
}
