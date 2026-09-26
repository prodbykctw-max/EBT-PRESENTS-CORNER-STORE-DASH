// World integrity scanner (QA only; loaded by the test harness with ?qa&scan). Fires rays straight down and
// reports anything that isn't physically solid: terrain poking through roads, wheels sunk into or floating
// above the road, props hovering or buried, ramps that don't meet the street.
import * as THREE from './vendor/three.module.min.js';
import { TopSurface } from './surface.js';
import { deckTop } from './levels.js';

const TOL = { wheel: 0.1, prop: 0.12 };

export function scanWorld(api) {
  const { scene, carRig } = api.three;
  scene.updateMatrixWorld(true);
  const byName = (re) => { const out = []; scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && re.test(o.name)) out.push(o); }); return out; };
  const ALL = api._surf || (api._surf = new TopSurface(byName(/^(roads|route_road|junctions|freeway_deck|ground|cover_.*)$/)));
  const GROUND = api._gnd || (api._gnd = new TopSurface(byName(/^(ground|cover_.*)$/)));
  const report = { roadVsTerrain: { samples: 0, fail: [] }, wheels: { samples: 0, fail: [] }, props: { samples: 0, fail: [] } };
  const ROADS = /^(route_road|roads|junctions|freeway_deck)$/;

  // 1) inside the route's road the road must be the top-most surface everywhere
  const route = api.route;
  for (let s = 1; s < route.length - 1; s += 1) {
    const hw = route.hw(s);
    for (const f of [-0.95, -0.6, -0.25, 0, 0.25, 0.6, 0.95]) {
      const p = route.at(s, f * hw), h = ALL.top(p.x, -p.y);
      report.roadVsTerrain.samples++;
      if (!h || !ROADS.test(h.name)) report.roadVsTerrain.fail.push({ where: `route s=${s} d=${(f * hw).toFixed(1)}`, top: h?.name });
    }
  }
  // …and on the city streets (sampled at triangle centres of the street mesh)
  const rm = byName(/^roads$/)[0];
  if (rm) {
    const P = rm.geometry.attributes.position, I = rm.geometry.index.array;
    for (let t = 0; t < I.length; t += 3 * 5) {
      const cx = (P.getX(I[t]) + P.getX(I[t + 1]) + P.getX(I[t + 2])) / 3, cz = (P.getZ(I[t]) + P.getZ(I[t + 1]) + P.getZ(I[t + 2])) / 3;
      const h = ALL.top(cx, cz); report.roadVsTerrain.samples++;
      if (h && !ROADS.test(h.name)) report.roadVsTerrain.fail.push({ where: `street @${cx.toFixed(0)},${(-cz).toFixed(0)}`, top: h.name });
    }
  }

  // 2) wheels: every vehicle's four contact points vs. the surface directly under them
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  const checkWheels = (label, matrix, wheels) => {
    for (const [wx, wz] of wheels) {
      v.set(wx, 0, wz).applyMatrix4(matrix);
      const h = ALL.top(v.x, v.z, v.y + 2.5);  // ignore decks overhead
      report.wheels.samples++;
      if (!h) { report.wheels.fail.push({ who: label, gap: 'no surface' }); continue; }
      const gap = v.y - h.y;
      // never below the road; above it, allow suspension travel (a 12 m bus resting on a crest hangs a wheel pair)
      if (gap < -TOL.wheel || gap > (label.startsWith('bus') ? 0.2 : TOL.wheel)) report.wheels.fail.push({ who: label, gap: +gap.toFixed(3), on: h.name, at: [+v.x.toFixed(0), +(-v.z).toFixed(0)] });
    }
  };
  carRig.updateMatrixWorld(true);
  checkWheels('player', carRig.matrixWorld, [[0.86, 1.45], [-0.86, 1.45], [0.86, -1.5], [-0.86, -1.5]]);
  for (const [type, [hw, hl]] of Object.entries({ sedan: [0.8, 1.36], suv: [0.86, 1.42], bus: [1.15, 3.6] })) {
    const im = api.world.meshes[type]; if (!im) continue;
    for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m4); checkWheels(`${type}#${i}`, m4, [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl]]); }
  }

  // 2b) obstacles standing in the street: cones, barricades, panhandlers, work signs on the road surface
  const tumbling = api.world.ents.some((e) => e.flying);   // a knocked cone mid-air is supposed to be in the air
  for (const type of tumbling ? [] : ['cone', 'barricade', 'panhandler']) {
    const im = api.world.meshes[type]; if (!im) continue;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m4); v.setFromMatrixPosition(m4);
      const h = ALL.top(v.x, v.z, v.y + 1.0); report.wheels.samples++;
      if (!h || v.y - h.y > 0.06 || v.y - h.y < -0.06) report.wheels.fail.push({ who: `${type}#${i}`, gap: h ? +(v.y - h.y).toFixed(3) : 'no surface', on: h?.name, at: [+v.x.toFixed(0), +(-v.z).toFixed(0)] });
    }
  }
  // 2c) the crowd: every drawn person's feet on the sidewalk / crosswalk under them
  const crowd = api.world.crowd?.mesh;
  if (crowd) for (let i = 0; i < crowd.count; i++) {
    crowd.getMatrixAt(i, m4); v.setFromMatrixPosition(m4);
    const h = ALL.top(v.x, v.z, v.y + 1.0); report.props.samples++;
    // lawns sit a few cm above the sidewalk plane; nobody may float or sink further than that
    if (!h || v.y - h.y > 0.05 || v.y - h.y < -0.12) report.props.fail.push({ who: `person#${i}`, gap: h ? +(v.y - h.y).toFixed(3) : 'no surface', on: h?.name, at: [+v.x.toFixed(0), +(-v.z).toFixed(0)] });
  }
  // 3) props: bases on the ground
  scene.traverse((o) => {
    if (!o.isInstancedMesh || !/^street_/.test(o.name)) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4); v.setFromMatrixPosition(m4);
      const h = GROUND.top(v.x, v.z); report.props.samples++;
      // fail on anything hovering, or buried deeper than a trunk/pole footing would be
      if (h && (v.y - h.y > 0.05 || v.y - h.y < -0.3)) report.props.fail.push({ who: `${o.name}#${i}`, gap: +(v.y - h.y).toFixed(3), at: [+v.x.toFixed(0), +(-v.z).toFixed(0)] });
    }
  });

  // 4) traffic lanes, deterministically: walk every road traffic can use, put a bus at the extreme lane offsets
  //    it can be given, and require a drivable surface under all four wheels (no hanging off a ramp edge)
  report.lanes = { samples: 0, fail: [] };
  const g = api.route.ground, ROADSURF = api._roads || (api._roads = new TopSurface(byName(/^(roads|route_road|junctions|freeway_deck)$/)));
  for (const rd of api.world.crossRoads || []) {
    const vhw = rd.h ? 0.86 : 1.15;   // freeway: cars/SUVs only; streets: buses too
    const room = Math.max(0, rd.width / 2 - vhw - (rd.h ? 0.9 : 0.35)), lanes = rd.oneway ? [-room, room] : [-Math.min(rd.width / 4, room)];
    for (let i = 0; i + 1 < rd.pts.length; i++) {
      const [ax, ay] = rd.pts[i], [bx, by] = rd.pts[i + 1], L = Math.hypot(bx - ax, by - ay), c = (bx - ax) / L, sn = (by - ay) / L;
      for (let t = 4; t < L - 4; t += 8) for (const lane of lanes) {
        const f = t / L, h = rd.h ? rd.h[i] + (rd.h[i + 1] - rd.h[i]) * f : 0, x = ax + (bx - ax) * f - sn * lane, y = ay + (by - ay) * f + c * lane;
        const hlw = rd.h ? 1.42 : 3.6;
        for (const [fl, fw] of [[hlw, vhw], [hlw, -vhw], [-hlw, vhw], [-hlw, -vhw]]) {
          const wx = x + c * fl + sn * fw, wy = y + sn * fl - c * fw;
          const expect = deckTop(g, wx, wy, h) + 0.1;
          const top = ROADSURF.top(wx, -wy, expect + (h > 0.05 ? 2.1 : 1.2)); report.lanes.samples++;
          if (!top || expect - top.y > 0.4) report.lanes.fail.push   // below expected = hanging over a drop({ road: rd.name || rd.cls, at: [+wx.toFixed(0), +wy.toFixed(0)], lane: +lane.toFixed(1), h: +h.toFixed(1), got: top ? +top.y.toFixed(1) : null, expect: +expect.toFixed(1) });
        }
      }
    }
  }
  return {
    summary: Object.fromEntries(Object.entries(report).map(([k, r]) => [k, `${r.samples - r.fail.length}/${r.samples} ok`])),
    worst: Object.fromEntries(Object.entries(report).map(([k, r]) => [k, r.fail.slice(0, 8)])),
  };
}
