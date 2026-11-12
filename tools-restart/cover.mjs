// node tools-restart/cover.mjs <url ?qa&fly> <out.json> [dt]: step the flyover every dt s (0.1) and, from the camera, cast a grid of rays at the visible meshes: for each frame the share of the screen
// taken by the single biggest object (within 15 m, and at any range), the biggest ground/road share is reported by name. Also min camera clearance above ground.
import fs from 'fs'; import { launch } from './lib.mjs';
const [url, out, dtArg] = process.argv.slice(2); const dt = +(dtArg || 0.1);
const { b, p, errs } = await launch();
await p.goto(url);
await p.waitForFunction(() => window.__drive && window.__drive.tick && window.__drive.foot, null, { timeout: 900000 });
await p.evaluate(() => { window.__drive.manual = true; });
const rows = [];
for (let i = 0; i < 80; i++) {
  const r = await p.evaluate((dt) => {
    const d = window.__drive, T = d.three, THREE = T.THREE, f = d.fly; if (!f) return null;
    d.tick(dt); const t = f.t; const cam = T.camera; cam.updateMatrixWorld(true);
    const meshes = []; const walk = (o) => { if (!o.visible) return; if ((o.isMesh || o.isInstancedMesh) && !/animal|people|ped|bird|crowd|dog/i.test(o.name + (o.parent?.name || ''))) meshes.push(o); for (const c of o.children) walk(c); }; walk(T.scene);
    const rc = new THREE.Raycaster(); rc.camera = cam; const NX = 9, NY = 16; const hits15 = {}, hitsAll = {}; let n = 0, sky = 0;
    for (let a = 0; a < NX; a++) for (let c = 0; c < NY; c++) {
      rc.setFromCamera({ x: -0.9 + 1.8 * a / (NX - 1), y: -0.9 + 1.8 * c / (NY - 1) }, cam); rc.far = 400; n++;
      const h = rc.intersectObjects(meshes, false)[0]; if (!h) { sky++; continue; }
      const q = h.point, nm = (h.object.name || h.object.parent?.name || h.object.type) + '#' + h.object.id + '@' + Math.floor(q.x / 25) + ',' + Math.floor(q.z / 25) + (/walls|roofs|ground|route_road|deck/.test(h.object.name) ? ',' + Math.floor(q.y / 15) : '');
      hitsAll[nm] = (hitsAll[nm] || 0) + 1; if (h.distance < 15) hits15[nm] = (hits15[nm] || 0) + 1;
    }
    const top = (o) => Object.entries(o).sort((x, y) => y[1] - x[1])[0] || ['-', 0];
    const ta = top(hitsAll), t15 = top(hits15);
    return { t: +t.toFixed(2), all: [ta[0], +(ta[1] / n).toFixed(2)], near15: [t15[0], +(t15[1] / n).toFixed(2)], sky: +(sky / n).toFixed(2), camY: +cam.position.y.toFixed(1), pitch: +(Math.asin(-new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).y) * 180 / Math.PI).toFixed(0) };
  }, dt);
  if (!r) break; rows.push(r);
}
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(rows.map((r) => `${r.t} all=${r.all[1]}(${r.all[0]}) n15=${r.near15[1]}(${r.near15[0]}) sky=${r.sky} y=${r.camY} pitch=${r.pitch}`).join('\n')); console.log(errs);
await b.close();
