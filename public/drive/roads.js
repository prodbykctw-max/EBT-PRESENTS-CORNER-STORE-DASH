// Street network: road surfaces (markings in the shader), the drive route's own road, curbs, crosswalks,
// and the elevated freeway structure (decks with fascia, jersey barriers, underside and pier bents).
// Heights follow levels.js; world.json frame (x east, y north) → three (x, z, -y).
import * as THREE from './vendor/three.module.min.js';
import { LEVEL, deckTop } from './levels.js';
import { TopSurface } from './surface.js';

const DRIVABLE = /^(primary|secondary|tertiary|residential|unclassified|living_street|trunk|motorway)(_link)?$|^service$/;
const CURBED = /^(primary|secondary|tertiary|residential|unclassified|living_street)(_link)?$/;
const RANK = { motorway: 6, trunk: 6, primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 2, living_street: 1, service: 0 };
const rankOf = (cls) => RANK[cls.replace('_link', '')] ?? 1;

/** Resample a polyline and drape it on the terrain, carrying the deck height h. Sampling is ADAPTIVE: 4 m on
 *  smooth ground, down to 1 m where the terrain bends (creases of the 8 m height grid, the rail gulch), so the
 *  road's flat triangles can never dip under a terrain crease. */
function drape(rd, ground, step = 4) {
  const out = [], P = rd.pts, H = rd.h;
  const bend = (x, y) => { // how far the terrain departs from a straight line over ±2 m, in both directions
    const g = ground(x, y);
    return Math.max(Math.abs((ground(x + 2, y) + ground(x - 2, y)) / 2 - g), Math.abs((ground(x, y + 2) + ground(x, y - 2)) / 2 - g));
  };
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1], L = Math.hypot(bx - ax, by - ay);
    let t = 0;
    while (t < L) {
      const f = t / L, x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
      out.push([x, y, ground(x, y), H ? H[i] + (H[i + 1] - H[i]) * f : 0]);
      t += bend(x, y) > 0.02 ? 1 : step;
    }
  }
  const [x, y] = P.at(-1); out.push([x, y, ground(x, y), H ? H.at(-1) : 0]);
  return out;
}
/** unit normal (left) at each sample */
function normals(p) {
  return p.map((_, i) => {
    const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1;
    return [-dy / L, dx / L];
  });
}

class SegIndex { // spatial grid of road centre-line segments: "is this point on some other road?"
  constructor(cell = 30) { this.cell = cell; this.g = new Map(); }
  add(ax, ay, bx, by, hw, id) {
    const c = this.cell, s = [ax, ay, bx, by, hw, id];
    for (let gx = Math.floor(Math.min(ax, bx) / c) - 1; gx <= Math.floor(Math.max(ax, bx) / c) + 1; gx++)
      for (let gy = Math.floor(Math.min(ay, by) / c) - 1; gy <= Math.floor(Math.max(ay, by) / c) + 1; gy++) {
        const k = gx + ',' + gy; if (!this.g.has(k)) this.g.set(k, []); this.g.get(k).push(s);
      }
  }
  /** nearest segment whose ribbon contains (x, y), ignoring road `skip` */
  covering(x, y, skip, margin = 0) {
    const segs = this.g.get(Math.floor(x / this.cell) + ',' + Math.floor(y / this.cell)) || [];
    for (const [ax, ay, bx, by, hw, id] of segs) {
      if (id === skip) continue;
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < hw + margin) return { ax, ay, bx, by, hw, id };
    }
    return null;
  }
  nearest(x, y, maxD, filter) {
    let best = null, bd = maxD;
    for (const s of this.g.get(Math.floor(x / this.cell) + ',' + Math.floor(y / this.cell)) || []) {
      if (filter && !filter(s)) continue;
      const [ax, ay, bx, by] = s, dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy); if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
}

// ------------------------------------------------------------------ overpass cutaway
// Top-down games can't let a bridge hide the car. Instead of fading whole decks (which ghosts every
// overlapping lane), cut a soft round hole in anything that is above the car and near it.
export const CUT = { uCutPos: { value: new THREE.Vector3(0, -999, 0) }, uCutR: { value: 11 } };
function cutaway(sh) {
  Object.assign(sh.uniforms, CUT);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 cw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cw = instanceMatrix * cw;
      #endif
      vCutW = (modelMatrix * cw).xyz;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform vec3 uCutPos; uniform float uCutR; varying vec3 vCutW;
      float cutDither(vec2 p){ vec2 q = floor(p * 0.5); return fract(52.9829 * fract(dot(q, vec2(0.06711, 0.00584)))); } // 2px interleaved-gradient noise`)
    .replace('void main() {', `void main() {
      if (vCutW.y > uCutPos.y + 2.2) {
        float d = distance(vCutW.xz, uCutPos.xz) / uCutR;
        if (d < 1.0 && cutDither(gl_FragCoord.xy) > smoothstep(0.78, 1.0, d)) discard;   // dithered soft edge
      }`);
}
export function withCutaway(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => { if (prev) prev.call(material, sh, r); cutaway(sh); };
  material.customProgramCacheKey = () => 'cut' + (prev ? prev.toString().length : 0);
  return material;
}

// ------------------------------------------------------------------ road surface material
function roadMaterial(tex, offset, fade) {
  const m = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.9, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset, transparent: !!fade });
  m.userData.wet = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = m.userData.wet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad; attribute float aMark; attribute float aPark; varying vec4 vRoad; varying vec2 vRUv; varying float vMark; varying float vPark;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad; vRUv = uv; vMark = aMark; vPark = aPark;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet; varying vec4 vRoad; varying vec2 vRUv; varying float vMark; varying float vPark;')
      .replace('#include <map_fragment>', `
        vec2 tuv = vec2(vRUv.x * vRoad.w, vRUv.y) / 5.0;
        diffuseColor *= texture2D(map, tuv);
        float across = vRUv.x, along = vRUv.y, w = vRoad.w;
        float endFade = smoothstep(3.0, 7.0, along) * smoothstep(3.0, 7.0, vRoad.z - along) * smoothstep(0.5, 1.0, vMark);
        float px = fwidth(across * w) * 1.5;
        float line = 0.0; vec3 lineCol = vec3(0.93);
        // edge line: 0.4 m in from the curb, or out at the parking lane where the street has one
        float eo = vPark > 0.5 ? vPark : 0.4;
        float edge = max(1.0 - smoothstep(0.1, 0.1 + px, abs(across * w - eo)), 1.0 - smoothstep(0.1, 0.1 + px, abs((1.0 - across) * w - eo)));
        if (vRoad.y > 1.5) {                              // two-way: double yellow centre, white edges on wide streets
          float c = abs(across - 0.5) * w;
          float centre = 1.0 - smoothstep(0.075, 0.075 + px, abs(c - 0.17));
          float edges = edge * step(8.5, w);
          lineCol = centre > edges ? vec3(0.96, 0.74, 0.14) : vec3(0.93);
          line = max(centre, edges);
        } else if (vRoad.y > 0.5) {                       // one-way: dashed white lane dividers, solid edges
          float lanes = vRoad.x, f = fract(across * lanes), dash = step(0.45, fract(along / 12.0));
          line = max((1.0 - smoothstep(0.06, 0.06 + px, min(f, 1.0 - f) * w / lanes)) * dash * step(1.5, lanes), edge);
        }
        // wear: lines are a little broken up by the asphalt texture, like real paint
        line *= 0.75 + 0.25 * smoothstep(0.2, 0.5, texture2D(map, tuv * 3.1).r);
        diffuseColor.rgb = mix(diffuseColor.rgb, lineCol, clamp(line, 0.0, 1.0) * 0.9 * endFade);
        diffuseColor.rgb *= mix(1.0, 0.6, uWet);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, uWet);');
  };
  return m;
}

/** Road surface mesh. Every vertex is placed on the terrain AT ITS OWN POSITION (columns every ≤2.2 m across
 *  the road, rows every ≤4 m along it), so the surface follows cross-slope and the car, traffic and props —
 *  which also stand on ground(x, y) + level — always sit exactly on it. Elevated freeway pieces are flat
 *  decks at centre height; wherever a deck would dip into rising terrain the terrain wins (max()). */
function ribbonMesh(list, tex, { offset = -2, fade = false, name, ground }) {
  const pos = [], uv = [], info = [], mark = [], park = [], idx = [];
  for (const r of list) {
    const p = r.p, n = normals(p);
    const lanes = Math.max(1, Math.round(r.width / 3.4)), kind = r.cls === 'service' ? 0 : r.oneway ? 1 : 2;
    let along = 0; const total = p.reduce((a, q, i) => a + (i ? Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
    const maxW = r.widths ? Math.max(...r.widths) : r.width, K = Math.max(3, Math.ceil(maxW / 1.5) + 1); // ≤1.5 m columns
    const base = pos.length / 3;
    for (let i = 0; i < p.length; i++) {
      if (i) along += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      const w = r.widths ? r.widths[i] : r.width, hw = w / 2;
      const mk = r.marks ? r.marks[i] : 1, pk = r.parks ? r.parks[i] : 0;
      for (let j = 0; j < K; j++) {
        const f = j / (K - 1), o = hw * (1 - 2 * f), x = p[i][0] + n[i][0] * o, y = p[i][1] + n[i][1] * o;
        // highest terrain within 0.4 m: ~2 cm on normal streets, keeps the road on top along near-cliff DEM slopes
        let gz = Math.max(ground(x, y), ground(x + 0.4, y), ground(x - 0.4, y), ground(x, y + 0.4), ground(x, y - 0.4));
        if (gz - ground(x, y) > 0.16) gz = Math.max(gz, ground(x + 0.9, y), ground(x - 0.9, y), ground(x, y + 0.9), ground(x, y - 0.9)); // >40 % slope
        const z = p[i][3] > 0.05 ? Math.max(deckTop(ground, x, y, p[i][3]), gz) + r.lift : gz + r.lift;
        pos.push(x, z, -y); uv.push(f, along); info.push(lanes, kind, total, w); mark.push(mk); park.push(pk);
      }
    }
    for (let i = 0; i + 1 < p.length; i++) for (let j = 0; j + 1 < K; j++) {
      const a0 = base + i * K + j, b0 = a0 + 1, c0 = a0 + K, d0 = c0 + 1;
      idx.push(a0, b0, c0, b0, d0, c0);
    }
  }
  // safety pass: the terrain mesh IS ground()+TERRAIN, so test every triangle exactly at its centre and edge
  // midpoints and raise any triangle that dips under it (only ever raises; two passes settle shared vertices)
  for (let pass = 0; pass < 2; pass++) {
    const raise = new Float32Array(pos.length / 3);
    for (let t = 0; t < idx.length; t += 3) {
      const A = idx[t] * 3, B = idx[t + 1] * 3, C = idx[t + 2] * 3;
      for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) {
        const x = pos[A] * wa + pos[B] * wb + pos[C] * wc, zz = pos[A + 2] * wa + pos[B + 2] * wb + pos[C + 2] * wc;
        const chord = pos[A + 1] * wa + pos[B + 1] * wb + pos[C + 1] * wc, need = ground(x, -zz) + LEVEL.TERRAIN + 0.06 - chord;
        if (need > 0) for (const v of [A, B, C]) raise[v / 3] = Math.max(raise[v / 3], need);
      }
    }
    for (let v = 0; v < raise.length; v++) pos[v * 3 + 1] += raise[v];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('aMark', new THREE.Float32BufferAttribute(mark, 1));
  g.setAttribute('aPark', new THREE.Float32BufferAttribute(park, 1));
  g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, roadMaterial(tex, offset, fade));
  mesh.receiveShadow = true; mesh.name = name;
  return mesh;
}

// ------------------------------------------------------------------ build everything
export function buildStreets(W, ground, route, tex) {
  const index = new SegIndex();
  const runs = [];         // at-grade road pieces that get drawn (after route suppression)
  const corners = [];      // sharp bends where a piece was split: filled with a pad
  const elevated = [];     // freeway pieces that get a deck + structure
  const concrete = { pos: [], nor: [], uv: [], idx: [] };

  // 1) OSM roads → draped samples; drop the stretches the route road already covers
  W.roads.forEach((rd, id) => {
    if (!DRIVABLE.test(rd.cls) || rd.pts.length < 2) return;
    const p = drape(rd, ground), maxH = Math.max(...p.map((q) => q[3]));
    const base = { id, cls: rd.cls, width: rd.width, oneway: rd.oneway, lift: LEVEL.ROAD + rankOf(rd.cls) * 0.004 };
    if (maxH > 0.3) { elevated.push({ ...base, p, lift: base.lift - (/_link/.test(rd.cls) ? 0.015 : 0) }); return; }
    let run = [];
    const flush = () => { if (run.length > 1) runs.push({ ...base, p: run }); run = []; };
    for (let i = 0; i < p.length; i++) {
      const [x, y] = p[i], j = Math.min(p.length - 1, i + 1), k = Math.max(0, i - 1);
      const on = route.distTo(x, y) < route.hwAt(x, y) - 0.5;
      const pr = on ? route.project(x, y) : null;
      const parallel = pr && Math.abs(Math.cos(Math.atan2(p[j][1] - p[k][1], p[j][0] - p[k][0]) - route.at(pr.s).a)) > 0.85;
      if (on && parallel) { flush(); continue; }
      run.push(p[i]);
      // a hard corner folds a ribbon over itself on the inside of the turn: end the piece here, start the next
      // one from the same point, and let a corner pad fill the elbow
      if (i > 0 && i + 1 < p.length) {
        const a1 = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]), a2 = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]);
        if (Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))) > 0.6) { flush(); run.push(p[i]); corners.push([x, y, rd.width / 2]); }
      }
    }
    flush();
  });
  for (const r of runs) for (let i = 0; i + 1 < r.p.length; i++) index.add(r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r.width / 2, r.id);

  // 2) the route's own road, with the centre line broken across intersections and crosswalks
  const R = { id: 'route', cls: 'primary', oneway: false, lift: LEVEL.ROUTE, p: [], widths: [], marks: [], parks: [] };
  const crossings = (W.points || []).filter((q) => q[0] === 'crossing');
  for (let s = 0; s <= route.length; s += 1) {
    const q = route.at(s), hw = route.hw(s);
    const cross = index.covering(q.x, q.y, null, 1.0);                      // another street meets us here
    const zebra = crossings.some((c) => Math.abs(c[1] - q.x) < 5 && Math.abs(c[2] - q.y) < 5 && Math.hypot(c[1] - q.x, c[2] - q.y) < 3);
    R.p.push([q.x, q.y, ground(q.x, q.y), 0]); R.widths.push(hw * 2); R.marks.push(cross || zebra ? 0 : 1); R.parks.push(route.parkD(s, 1) ? route.park(s) : 0);
  }
  R.width = R.widths[0];
  // widen the "no paint" zones a little and index the route road for curbs/crosswalks
  const m0 = [...R.marks]; for (let i = 0; i < m0.length; i++) if (!m0[i]) for (let k = -4; k <= 4; k++) if (R.marks[i + k] !== undefined) R.marks[i + k] = 0;
  for (let i = 0; i + 1 < R.p.length; i++) index.add(R.p[i][0], R.p[i][1], R.p[i + 1][0], R.p[i + 1][1], R.widths[i] / 2, 'route');

  const roadsMesh = ribbonMesh(runs, tex, { name: 'roads', ground });
  const junctions = junctionPads(W, runs, R, ground, tex, corners);
  const routeMesh = ribbonMesh([R], tex, { offset: -4, name: 'route_road', ground });

  // 3) curbs along every city street and the route; they stop wherever another street joins
  const curb = { pos: [], col: [], idx: [] };
  const curbRuns = [...runs.filter((r) => CURBED.test(r.cls)), { ...R, cls: 'primary' }];
  for (const r of curbRuns) {
    const n = normals(r.p);
    for (const side of [1, -1]) {
      let strip = [];
      const emit = () => {
        if (strip.length > 1) {
          const b = curb.pos.length / 3;
          for (const [ix, iy, ox, oy, zr, zti, zto, zg] of strip) {
            // inner-bottom (tucked under the road edge), inner-top, outer-top, outer-bottom (under the sidewalk)
            curb.pos.push(ix, zr, -iy, ix, zti, -iy, ox, zto, -oy, ox, zg, -oy);
            curb.col.push(0.55, 0.55, 0.54, 0.8, 0.79, 0.76, 0.8, 0.79, 0.76, 0.6, 0.6, 0.58);
          }
          for (let i = 0; i + 1 < strip.length; i++) {
            const a = b + i * 4, c = a + 4;
            // face winding flips with the side so faces point away from the road centre / up
            const quads = [[a, a + 1, c + 1, c], [a + 1, a + 2, c + 2, c + 1], [a + 2, a + 3, c + 3, c + 2]];
            for (const [q0, q1, q2, q3] of quads) side > 0 ? curb.idx.push(q0, q2, q1, q0, q3, q2) : curb.idx.push(q0, q1, q2, q0, q2, q3);
          }
        }
        strip = [];
      };
      for (let i = 0; i < r.p.length; i++) {
        const hw = (r.widths ? r.widths[i] : r.width) / 2, [x, y, g] = r.p[i];
        const ix = x + n[i][0] * hw * side, iy = y + n[i][1] * hw * side, ox = ix + n[i][0] * 0.3 * side, oy = iy + n[i][1] * 0.3 * side;
        if (index.covering(ox, oy, r.id, 0.3)) { emit(); continue; }        // an intersection / driveway: no curb
        const gi = ground(ix, iy), go = ground(ox, oy);
        strip.push([ix, iy, ox, oy, gi + r.lift - 0.03, gi + LEVEL.CURB_TOP, go + LEVEL.CURB_TOP, go + LEVEL.TERRAIN - 0.03]);
      }
      emit();
    }
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(curb.pos, 3));
  cg.setAttribute('color', new THREE.Float32BufferAttribute(curb.col, 3));
  cg.setIndex(curb.idx); cg.computeVertexNormals();
  const curbs = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: tex.concrete }));
  curbs.receiveShadow = true; curbs.name = 'curbs';

  // 4) continental crosswalks at OSM crossing points near the drive
  const paint = { pos: [], idx: [] };
  for (const [, cx, cy] of crossings) {
    if (route.distTo(cx, cy) > 260) continue;
    const s = index.nearest(cx, cy, 4, (sg) => sg[5] === 'route' || CURBED.test(runs.find((r) => r.id === sg[5])?.cls || ''));
    if (!s) continue;
    const [ax, ay, bx, by, hw] = s, L = Math.hypot(bx - ax, by - ay) || 1, tx = (bx - ax) / L, ty = (by - ay) / L, nx = -ty, ny = tx;
    const lift = (s[5] === 'route' ? LEVEL.ROUTE : LEVEL.ROAD + 0.03) + 0.015;
    for (let o = -hw + 0.7; o <= hw - 0.6; o += 1.25) {
      const px = cx + nx * o, py = cy + ny * o, b = paint.pos.length / 3;
      for (const [a, c] of [[-1.5, -0.3], [1.5, -0.3], [1.5, 0.3], [-1.5, 0.3]]) {
        const x = px + tx * a + nx * c, y = py + ty * a + ny * c; paint.pos.push(x, ground(x, y) + lift, -y);
      }
      paint.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(paint.pos, 3)); pg.setIndex(paint.idx); pg.computeVertexNormals();
  // double-sided: stripe winding depends on the street direction; the paint is only ever seen from above
  const crosswalks = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0xe9e8e2, roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
  crosswalks.receiveShadow = true; crosswalks.name = 'crosswalks';

  // 5) elevated freeway: deck + structure
  const fw = buildFreeway(elevated, ground, tex);

  const group = new THREE.Group(); group.add(junctions, roadsMesh, routeMesh, curbs, crosswalks);
  return { group, roadsMesh, routeMesh, junctions, freeway: fw, index, runs, routeMarks: R.marks, surfaces: [roadsMesh, routeMesh, fw.deck],
    drivable: [roadsMesh, routeMesh, junctions, fw.deck] }; // every surface a wheel can touch
}

// ------------------------------------------------------------------ intersections
/** Where streets meet, ribbons alone leave wedge-shaped gaps (angled junctions, offset ends). Fill every
 *  junction with a draped asphalt pad just under the road surfaces, sized to the widest street there. */
function junctionPads(W, runs, R, ground, tex, corners = []) {
  const key = (x, y) => Math.round(x * 2) + ',' + Math.round(y * 2);
  const meet = new Map(); // node → { x, y, roads:Set, hw }
  const touch = (x, y, id, hw) => {
    const k = key(x, y); let m = meet.get(k); if (!m) meet.set(k, (m = { x, y, roads: new Set(), hw: 0 }));
    m.roads.add(id); m.hw = Math.max(m.hw, hw);
  };
  W.roads.forEach((rd, id) => { if (DRIVABLE.test(rd.cls) && !rd.h) for (const [x, y] of rd.pts) touch(x, y, id, rd.width / 2); });
  for (const [x, y, hw] of corners) { const k = key(x, y); if (!meet.has(k)) meet.set(k, { x, y, roads: new Set(['corner', 'bend']), hw }); }
  const pos = [], uv = [], idx = [];
  for (const m of meet.values()) {
    if (m.roads.size < 2) continue;
    const r = m.hw * 1.15 + 0.4, N = 20, c = pos.length / 3;
    const zc = (x, y) => ground(x, y) + LEVEL.ROAD - 0.012;
    pos.push(m.x, zc(m.x, m.y), -m.y); uv.push(m.x / 5, m.y / 5);
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2, x = m.x + Math.cos(a) * r, y = m.y + Math.sin(a) * r;
      pos.push(x, zc(x, y), -y); uv.push(x / 5, y / 5);
      idx.push(c, c + 1 + ((k + 1) % N), c + 1 + k);  // CCW seen from above in three space
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  mesh.receiveShadow = true; mesh.name = 'junctions';
  return mesh;
}

// ------------------------------------------------------------------ freeway structure
function buildFreeway(list, ground, tex) {
  const c = { pos: [], uv: [], idx: [] };
  const quad = (a, b, cc, d, ua = 0, ub = 1, va = 0, vb = 1) => { // a,b,c,d: [x,y,z] world (z up), CCW seen from outside
    const k = c.pos.length / 3;
    for (const [x, y, z] of [a, b, cc, d]) c.pos.push(x, z, -y);
    c.uv.push(ua, va, ub, va, ub, vb, ua, vb);
    c.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const piers = [], caps = [], decks = [];
  for (const r of list) {
    const p = r.p, n = normals(p), hw = r.width / 2;
    let run = 0, nextPier = 12;
    for (let i = 0; i < p.length; i++) {
      if (i) run += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (i + 1 < p.length && p[i][3] > 2.5) decks.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], hw + 3]);
      if (i + 1 >= p.length) continue;
      const A = p[i], B = p[i + 1];
      for (const side of [1, -1]) {
        const e = (q, j, off) => [q[0] + n[j][0] * (hw + off) * side, q[1] + n[j][1] * (hw + off) * side];
        const surf = (q, x, y) => deckTop(ground, x, y, q[3]) + r.lift; // = deck mesh rule
        const [eax, eay] = e(A, i, 0), [ebx, eby] = e(B, i + 1, 0);
        const [iax, iay] = e(A, i, -0.4), [ibx, iby] = e(B, i + 1, -0.4);
        const ta = surf(A, iax, iay), tb = surf(B, ibx, iby);
        // soffit depth: 1.3 m slab when truly elevated; low ramps become solid retaining walls to the ground
        const bot = (q, x, y) => (q[3] > 1.7 ? surf(q, x, y) - 1.3 : ground(x, y) + LEVEL.TERRAIN - 0.2);
        const oriented = (a, b, cc, d, ...uv) => (side > 0 ? quad(a, b, cc, d, ...uv) : quad(b, a, d, cc, ...uv));
        // jersey barrier: inner face, top, outer face down to the soffit (fascia)
        oriented([ibx, iby, tb], [iax, iay, ta], [iax, iay, ta + 0.9], [ibx, iby, tb + 0.9], run / 4, (run + 4) / 4, 0, 0.25);
        oriented([iax, iay, ta + 0.9], [ibx, iby, tb + 0.9], [ebx, eby, tb + 0.9], [eax, eay, ta + 0.9]);
        oriented([eax, eay, bot(A, eax, eay)], [ebx, eby, bot(B, ebx, eby)], [ebx, eby, tb + 0.9], [eax, eay, ta + 0.9], run / 4, (run + 4) / 4, 0, 0.6);
      }
      // underside of the slab
      if (A[3] > 1.7) {
        const L = (q, j) => [q[0] + n[j][0] * hw, q[1] + n[j][1] * hw], Rr = (q, j) => [q[0] - n[j][0] * hw, q[1] - n[j][1] * hw];
        const zA = deckTop(ground, A[0], A[1], A[3]) + r.lift - 1.3, zB = deckTop(ground, B[0], B[1], B[3]) + r.lift - 1.3;
        quad([...Rr(A, i), zA], [...L(A, i), zA], [...L(B, i + 1), zB], [...Rr(B, i + 1), zB]);
      }
      // pier bents: two round columns + a cap beam, every ~26 m where the deck is high enough to walk under
      if (A[3] > 3 && run >= nextPier) {
        nextPier = run + 26;
        const a = Math.atan2(B[1] - A[1], B[0] - A[0]), zTop = deckTop(ground, A[0], A[1], A[3]) + r.lift - 1.3;
        const cols = hw > 5 ? [-(hw - 1.6), hw - 1.6] : [0];
        for (const o of cols) {
          const x = A[0] + n[i][0] * o, y = A[1] + n[i][1] * o, g = ground(x, y) + LEVEL.TERRAIN;
          piers.push([x, y, g, zTop - 1.0 - g]);
        }
        caps.push([A[0], A[1], zTop - 1.0, a, hw * 2 - 0.8]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
  g.setIndex(c.idx); g.computeVertexNormals();
  const concMat = withCutaway(new THREE.MeshStandardMaterial({ color: 0xc9c5bc, map: tex.concrete, roughness: 0.92, side: THREE.DoubleSide }));
  const structure = new THREE.Mesh(g, concMat); structure.castShadow = structure.receiveShadow = true; structure.name = 'freeway_structure';
  const colGeo = new THREE.CylinderGeometry(0.55, 0.6, 1, 14); colGeo.translate(0, 0.5, 0);
  const columns = new THREE.InstancedMesh(colGeo, concMat, piers.length);
  const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), concMat, caps.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  piers.forEach(([x, y, z, h], i) => columns.setMatrixAt(i, m4.compose(new THREE.Vector3(x, z, -y), q.identity(), new THREE.Vector3(1, Math.max(0.1, h), 1))));
  caps.forEach(([x, y, z, a, w], i) => capMesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, z + 0.5, -y), q.setFromEuler(e.set(0, a, 0)), new THREE.Vector3(1.4, 1.0, w))));
  columns.castShadow = capMesh.castShadow = true; columns.receiveShadow = capMesh.receiveShadow = true;
  const deck = ribbonMesh(list, tex, { name: 'freeway_deck', ground }); withCutaway(deck.material);
  // merges: where a ramp's deck overlaps another deck less than 2 m above it (a ramp joining the Connector),
  // real roads become ONE surface — lift the lower deck onto the upper so they never cut into each other
  {
    const P = deck.geometry.attributes.position, S = new TopSurface([deck]);
    const lifted = [];
    for (let v = 0; v < P.count; v++) {
      const x = P.getX(v), y = P.getY(v), z = P.getZ(v), up = S.top(x, z, y + 2.0);
      if (up && up.y > y + 0.02) lifted.push([v, up.y - 0.012]);
    }
    for (const [v, ny] of lifted) P.setY(v, ny);
    P.needsUpdate = true; deck.geometry.computeVertexNormals();
  }
  deck.castShadow = true;
  const group = new THREE.Group(); group.name = 'freeway'; group.add(deck, structure, columns, capMesh);
  return { group, deck, decks };
}
