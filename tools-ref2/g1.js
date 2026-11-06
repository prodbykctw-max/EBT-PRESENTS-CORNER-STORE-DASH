// the start of the drive (just after getting in): what is close to the camera, and a 390 shot
const which = '@WHICH@';
await L.ticks(p, 90); await p.waitForTimeout(1500);
await p.evaluate(() => { const F = window.__drive.foot; F.me.s = F.doorS; F.me.d = F.doorD; F.me.ps = F.me.s; F.me.pd = F.me.d; });
await L.ticks(p, 150);
await p.evaluate(() => { const D = window.__drive; D.ui.setHint(''); });
await p.addStyleTag({ content: '.drive-root.real .drive-rbar > *, .drive-root.real .drive-row2 > * { opacity: 1 !important; transform: none !important; }' });
await L.ticks(p, 6);
const out = await p.evaluate(() => {
  const D = window.__drive, { camera, scene, THREE } = D.three; camera.updateMatrixWorld(true);
  const cp = camera.position, fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const res = { state: D.state, carS: Math.round(D.car.s), cam: cp.toArray().map((x) => +x.toFixed(2)), near: [] };
  const v = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.visible) return;
    let p = o; let hidden = false; while (p) { if (p.visible === false) { hidden = true; break; } p = p.parent; } if (hidden) return;
    if (o.isInstancedMesh) {
      const n = o.count; let best = [];
      for (let i = 0; i < n; i++) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); v.setFromMatrixPosition(m); const d = v.distanceTo(cp); q.copy(v).sub(cp); const front = q.dot(fwd); if (d < 25 && front > -1) best.push({ i, d: +d.toFixed(1), front: +front.toFixed(1), y: +(v.y - cp.y).toFixed(1) }); }
      if (best.length) res.near.push({ name: o.name || o.geometry.type, kind: 'instanced', mat: o.material.type + (o.material.blending === 2 ? ' ADDITIVE' : ''), count: n, hits: best.slice(0, 6) });
    } else if (o.isMesh || o.isSprite || o.isPoints) {
      if (!o.geometry) return; o.geometry.boundingSphere || o.geometry.computeBoundingSphere(); const bs = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld); const d = bs.center.distanceTo(cp) - bs.radius; q.copy(bs.center).sub(cp); const front = q.dot(fwd);
      if (d < 12 && front > -bs.radius && bs.radius < 30) res.near.push({ name: o.name || o.geometry.type, kind: o.type, mat: o.material?.type, r: +bs.radius.toFixed(2), d: +d.toFixed(1), front: +front.toFixed(1), y: +(bs.center.y - cp.y).toFixed(1), parent: o.parent?.name });
    }
  });
  res.near.sort((a, b) => (a.d ?? a.hits[0].d) - (b.d ?? b.hits[0].d));
  res.near = res.near.slice(0, 30);
  return res;
});
await L.shot(p, `out/${which}_start_390.png`);
return out;
