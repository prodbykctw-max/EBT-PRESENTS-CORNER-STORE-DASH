await L.place(p, { s: 600, v: 0, settle: 60 });
const rows = await p.evaluate(() => { const D = window.__drive, { carRig, camera, THREE } = D.three; carRig.updateMatrixWorld(true); const inv = carRig.matrixWorld.clone().invert(); const o = [];
  carRig.traverse((m) => { if (m.isMesh && m.visible && m.geometry) { m.geometry.boundingBox || m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld.clone().premultiply(inv)); o.push([m.name || m.parent?.name, b.min.toArray().map((x) => +x.toFixed(2)), b.max.toArray().map((x) => +x.toFixed(2))]); } }); return o; });
await L.shot(p, 'out/c1.png');
return rows;
