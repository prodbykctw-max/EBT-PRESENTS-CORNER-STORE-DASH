// Runtime city: builds the whole of downtown from world.json (≈0.5 MB) instead of shipping a heavy city model.
// This file owns the buildings and orchestrates the rest: streets + freeway (roads.js), terrain, land cover,
// contact shadows and streetscape (landscape.js). Only the hand-made hero row and props come from glTF.
// Frames: world.json is metres, +x east, +y north, z up. three.js is X = x, Y = z, Z = -y.
import * as THREE from './vendor/three.module.min.js';
import { LEVEL } from './levels.js';
import { buildStreets } from './roads.js';
import { buildTerrain, buildCover, buildContactShadows, buildStreetscape, pointInPoly } from './landscape.js';
export { pointInPoly };

export const toV3 = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

/** THE height function of the world. The DEM is resampled onto an 8 m grid (bilinear, once) and ground(x, y)
 *  interpolates that grid with exactly the same two triangles per cell (diagonal i,j → i+1,j+1) that the
 *  terrain mesh is built from. So anything placed at ground(x, y) is ON the rendered terrain — not a smooth
 *  formula that disagrees with the flat triangles by up to half a metre on Atlanta's hills. */
export function makeGround(W, STEP = 8, PAD = 400) {
  const E = W.elevation;
  const bil = (x, y) => {
    const fx = Math.min(Math.max((x - E.x0) / E.step, 0), E.gx - 1.001);
    const fy = Math.min(Math.max((y - E.y0) / E.step, 0), E.gy - 1.001);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, Z = (a, b) => E.z[b * E.gx + a];
    return (Z(i, j) * (1 - u) + Z(i + 1, j) * u) * (1 - v) + (Z(i, j + 1) * (1 - u) + Z(i + 1, j + 1) * u) * v;
  };
  const x0 = E.x0 - PAD, y0 = E.y0 - PAD;
  const nx = Math.ceil(((E.gx - 1) * E.step + 2 * PAD) / STEP), ny = Math.ceil(((E.gy - 1) * E.step + 2 * PAD) / STEP);
  const H = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) H[j * (nx + 1) + i] = bil(x0 + i * STEP, y0 + j * STEP);
  const ground = (x, y) => {
    const fx = Math.min(Math.max((x - x0) / STEP, 0), nx - 1e-6), fy = Math.min(Math.max((y - y0) / STEP, 0), ny - 1e-6);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, r = nx + 1;
    const h00 = H[j * r + i], h10 = H[j * r + i + 1], h01 = H[(j + 1) * r + i], h11 = H[(j + 1) * r + i + 1];
    return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01);
  };
  ground.grid = { x0, y0, step: STEP, nx, ny, H };
  // freeway grade surface: the smooth 40 m DEM. Every deck is "grade + h", so overlapping decks (a ramp
  // merging into the Connector) share one surface instead of each following the bumps under its own centre line
  // blurred over ~120 m (3 passes of a 3×3 box on the 40 m DEM) so decks are near-level across their width
  let Z = Float32Array.from(E.z);
  for (let pass = 0; pass < 3; pass++) {
    const nz = new Float32Array(Z.length);
    for (let j = 0; j < E.gy; j++) for (let i = 0; i < E.gx; i++) {
      let a = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= E.gx || jj >= E.gy) continue; a += Z[jj * E.gx + ii]; c++;
      }
      nz[j * E.gx + i] = a / c;
    }
    Z = nz;
  }
  ground.grade = (x, y) => {
    const fx = Math.min(Math.max((x - E.x0) / E.step, 0), E.gx - 1.001), fy = Math.min(Math.max((y - E.y0) / E.step, 0), E.gy - 1.001);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, q = (a, b) => Z[b * E.gx + a];
    return (q(i, j) * (1 - u) + q(i + 1, j) * u) * (1 - v) + (q(i, j + 1) * (1 - u) + q(i + 1, j + 1) * u) * v;
  };
  return ground;
}

// Deterministic per-building randomness, so the city looks the same every run.
const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };

// Hero row footprint in world coords (row frame x∈[-35,21], y∈[-4,12], rotated 180° → world).
export const HERO_BOX = { x0: -21, x1: 35, y0: -12, y1: 4 };
const inHero = (x, y) => x > HERO_BOX.x0 - 4 && x < HERO_BOX.x1 + 4 && y > HERO_BOX.y0 - 6 && y < HERO_BOX.y1 + 2;

// ---------------- buildings: merged walls with a procedural facade shader + textured roofs ----------------
const PALETTE = { // [r,g,b] wall tints by style
  brick: [[0.55, 0.27, 0.2], [0.48, 0.24, 0.19], [0.62, 0.36, 0.26], [0.42, 0.22, 0.18]],
  stucco: [[0.78, 0.74, 0.66], [0.7, 0.66, 0.58], [0.82, 0.8, 0.74], [0.64, 0.6, 0.55]],
  office: [[0.6, 0.6, 0.6], [0.52, 0.53, 0.55], [0.7, 0.68, 0.64], [0.45, 0.47, 0.5]],
  tower: [[0.3, 0.36, 0.42], [0.26, 0.3, 0.33], [0.36, 0.4, 0.44], [0.22, 0.26, 0.3]],
};

const ROOFS = [[0.34, 0.34, 0.35], [0.46, 0.45, 0.43], [0.93, 0.93, 0.9], [0.86, 0.87, 0.88], [0.52, 0.47, 0.4], [0.28, 0.29, 0.31]];

function styleOf(b, r) {
  if (b.h >= 45) return 3;                                  // glass tower
  if (b.h >= 20 || /office|hotel|university|hospital/.test(b.type)) return 2;
  return r < 0.55 ? 0 : 1;                                  // brick or stucco low-rise (Sweet Auburn)
}

function buildBuildings(W, tex, ground) {
  const wall = { pos: [], uv: [], col: [], info: [], idx: [] }, roof = { pos: [], uv: [], col: [], idx: [] };
  const colliders = [], rtu = [], edges = [];
  for (const b of W.buildings) {
    if (b.pts.length < 3) continue;
    // counter-clockwise rings (seen from above) give outward-facing walls; OSM mixes both
    const signed = b.pts.reduce((s, [x, y], i) => { const [u, v] = b.pts[(i + 1) % b.pts.length]; return s + x * v - u * y; }, 0);
    const pts = signed < 0 ? [...b.pts].reverse() : b.pts;
    let cx = 0, cy = 0; for (const [x, y] of pts) { cx += x; cy += y; } cx /= pts.length; cy /= pts.length;
    if (inHero(cx, cy)) continue;                           // the hand-built row replaces these lots
    const r = hash(b.id % 2147483647), style = styleOf(b, r);
    const tint = Object.values(PALETTE)[style][(r * 4) | 0];
    const z0 = b.base + LEVEL.TERRAIN - 0.6 + (b.canopy ? b.h - 0.6 : (b.minH || 0)), z1 = b.base + b.h; // walls start below grade: never float
    // walls
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const L = Math.hypot(bx - ax, by - ay); if (L < 0.05) continue;
      const k = wall.pos.length / 3;
      wall.pos.push(ax, z0, -ay, bx, z0, -by, bx, z1, -by, ax, z1, -ay);
      wall.uv.push(run, z0 - b.base, run + L, z0 - b.base, run + L, z1 - b.base, run, z1 - b.base);
      for (let q = 0; q < 4; q++) { wall.col.push(...tint); wall.info.push(style, b.h, r); }
      wall.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      run += L;
    }
    // roof (triangulated footprint)
    const contour = pts.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    // commercial roofing reads very differently from pavement: gravel, tar, white TPO membrane, tan
    const k = roof.pos.length / 3, rc = ROOFS[(hash(b.id * 7 + 3) * ROOFS.length) | 0];
    for (const [x, y] of pts) { roof.pos.push(x, z1, -y); roof.uv.push(x / 8, y / 8); roof.col.push(...rc); }
    for (let i = 0; i < pts.length; i++) { // roof outline: crisp building edges from overhead
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      edges.push(ax, z1 + 0.05, -ay, bx, z1 + 0.05, -by);
    }
    for (const t of tris) { // OSM rings wind both ways: make every roof triangle face up (+Y)
      const [a, b, c] = t.map((q) => pts[q]);
      // y-component of (B-A)×(C-A) once mapped to three space (x, z, -y)
      const upY = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      roof.idx.push(...(upY > 0 ? [k + t[0], k + t[1], k + t[2]] : [k + t[0], k + t[2], k + t[1]]));
    }
    // collision: everything solid except drive-under canopies
    if (!b.canopy && !(b.minH > 2.5)) colliders.push(pts); // you can drive under canopies and raised floors
    // rooftop units: the detail a top-down camera actually sees
    if (b.h < 60 && !b.canopy) {
      const area = Math.abs(pts.reduce((s, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return s + x * v - u * y; }, 0)) / 2;
      const n = Math.min(6, Math.floor(area / 180) + (r > 0.5 ? 1 : 0));
      for (let q = 0; q < n; q++) {
        const px = cx + (hash(b.id + q * 7) - 0.5) * Math.sqrt(area) * 0.5, py = cy + (hash(b.id + q * 13) - 0.5) * Math.sqrt(area) * 0.5;
        if (pointInPoly(px, py, pts)) rtu.push([px, py, z1, 1.4 + hash(b.id + q) * 1.6, 1 + hash(b.id * 3 + q) * 1.2, hash(b.id + q * 5) * Math.PI]);
      }
    }
  }
  const geo = (d, extra) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
    if (extra) g.setAttribute('aInfo', new THREE.Float32BufferAttribute(d.info, 3));
    g.setIndex(d.idx); g.computeVertexNormals(); return g;
  };
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  wallMat.onBeforeCompile = (sh) => {
    sh.uniforms.tBrick = { value: tex.brick }; sh.uniforms.tConcrete = { value: tex.concrete };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aInfo; varying vec3 vInfo; varying vec2 vFac;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvInfo = aInfo; vFac = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tBrick; uniform sampler2D tConcrete; varying vec3 vInfo; varying vec2 vFac;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float isGlass = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float style = vInfo.x, height = vInfo.y, seed = vInfo.z;
        vec3 wallTex = style < 0.5 ? texture2D(tBrick, vFac / 2.2).rgb * 1.9 : texture2D(tConcrete, vFac / 4.0).rgb * 1.5;
        diffuseColor.rgb *= wallTex;
        float floorH = style > 2.5 ? 3.9 : 3.6, bay = style > 2.5 ? 1.55 : (style > 1.5 ? 2.4 : 3.0);
        vec2 cell = vec2(fract(vFac.x / bay), fract(vFac.y / floorH));
        vec2 id = vec2(floor(vFac.x / bay), floor(vFac.y / floorH));
        vec2 lo = style > 2.5 ? vec2(0.04, 0.06) : style > 1.5 ? vec2(0.12, 0.22) : vec2(0.22, 0.3);
        vec2 hi = style > 2.5 ? vec2(0.96, 0.94) : style > 1.5 ? vec2(0.88, 0.82) : vec2(0.78, 0.84);
        if (id.y < 0.5 && style < 2.5) { lo = vec2(0.05, 0.08); hi = vec2(0.95, 0.78); } // storefront glass on the ground floor
        vec2 aa = fwidth(vFac / vec2(bay, floorH)) * 1.2;
        float win = smoothstep(lo.x, lo.x + aa.x, cell.x) * (1.0 - smoothstep(hi.x - aa.x, hi.x, cell.x))
                  * smoothstep(lo.y, lo.y + aa.y, cell.y) * (1.0 - smoothstep(hi.y - aa.y, hi.y, cell.y));
        win *= step(0.0, vFac.y) * (1.0 - step(height - 0.9, vFac.y));  // no windows in the parapet
        float rnd = h21(id + seed * 91.0);
        vec3 glass = mix(vec3(0.05, 0.07, 0.09), vec3(0.16, 0.2, 0.25), rnd);
        if (rnd > 0.9) glass = vec3(0.55, 0.47, 0.34);                  // blinds / lit interiors
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, win);
        diffuseColor.rgb *= mix(1.0, 0.8, (1.0 - smoothstep(0.0, 0.25, vFac.y)));  // grime at street level
        isGlass = win;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, isGlass);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.55, isGlass);');
  };
  const walls = new THREE.Mesh(geo(wall, true), wallMat); walls.castShadow = walls.receiveShadow = true; walls.name = 'walls';
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.roof, roughness: 0.9 });
  // keep the texture's grain but let the per-building roof colour lead
  roofMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), 0.5);');
  };
  const roofs = new THREE.Mesh(geo(roof), roofMat); roofs.castShadow = roofs.receiveShadow = true; roofs.name = 'roofs';
  const units = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xa9adb1, roughness: 0.45, metalness: 0.4 }), rtu.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  rtu.forEach(([x, y, z, sx, sy, rot], i) => units.setMatrixAt(i, m4.compose(new THREE.Vector3(x, z + 0.55, -y), q.setFromEuler(e.set(0, rot, 0)), new THREE.Vector3(sx, 1.1, sy))));
  units.castShadow = true; units.name = 'rooftop_units';
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  const outline = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x15171a, transparent: true, opacity: 0.85 }));
  outline.name = 'roof_edges';
  return { group: new THREE.Group().add(walls, roofs, units, outline), colliders };
}


/** footprint grid: "is this spot inside a building?" (for placing trees, lamps, benches) */
function footprintIndex(W) {
  const cell = 40, g = new Map();
  for (const b of W.buildings) {
    if (b.canopy) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of b.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
      const k = gx + ',' + gy; if (!g.has(k)) g.set(k, []); g.get(k).push(b.pts);
    }
  }
  return (x, y) => !(g.get(Math.floor(x / cell) + ',' + Math.floor(y / cell)) || []).some((p) => pointInPoly(x, y, p));
}

export function buildCity(W, tex, ground, route, props) {
  const b = buildBuildings(W, tex, ground);
  const streets = buildStreets(W, ground, route, tex);
  const outside = footprintIndex(W);
  const isFree = (x, y) => outside(x, y) && !inHero(x, y);
  const streetscape = buildStreetscape(W, ground, route, streets, props, isFree);
  const group = new THREE.Group();
  group.add(
    buildTerrain(W, tex, ground),
    buildCover(W, ground, tex, streets),
    buildContactShadows(W, ground, (bd) => { let cx = 0, cy = 0; for (const [x, y] of bd.pts) { cx += x; cy += y; } return inHero(cx / bd.pts.length, cy / bd.pts.length); }),
    streets.group, streets.freeway.group, b.group,
    streetscape,
  );
  return { group, ground, streets, freeway: streets.freeway, surfaces: streets.surfaces, isFree, furniture: streetscape.userData.placed };
}
