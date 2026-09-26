// Ground and everything that stands on it: solid terrain (extended past the playable area so there is never a
// void at the edge), parks / lawns / parking / pitches draped on the terrain, contact shadows around every
// building, and the streetscape (trees, cobra-head lamps, signal masts, benches, bins, hydrants, bus shelters).
import * as THREE from './vendor/three.module.min.js';
import { LEVEL } from './levels.js';
import { bakedGeometry, propMaterial } from './runner.js';

const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };
let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // deterministic scatter

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polyArea = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
/** mown-lawn texture: noisy greens with faint mowing stripes */
function grassTexture() {
  return canvasTex(256, (g, s) => {
    const img = g.createImageData(s, s), d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4, n = Math.random(), stripe = ((x >> 5) & 1) ? 1.06 : 0.95;
      d[i] = (62 + n * 38) * stripe; d[i + 1] = (104 + n * 52) * stripe; d[i + 2] = (42 + n * 22) * stripe; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < 90; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,70,25' : '140,150,70'},0.12)`; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 3 + Math.random() * 14, 0, 7); g.fill(); }
  });
}

// ------------------------------------------------------------------ terrain
export function buildTerrain(W, tex, ground) {
  // exactly the triangles ground() interpolates (see makeGround), extended 400 m past the data on every side
  // so the city sits on solid ground to the horizon
  const { x0, y0, step, nx, ny, H } = ground.grid, r = nx + 1;
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3), uv = new Float32Array((nx + 1) * (ny + 1) * 2), idx = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const k = j * r + i, x = x0 + i * step, y = y0 + j * step;
    pos.set([x, H[k] + LEVEL.TERRAIN, -y], k * 3); uv.set([x / 3, y / 3], k * 2);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * r + i, b = a + 1, c = a + r + 1, d = a + r;   // diagonal a–c, same split as ground()
    idx.push(a, c, b, a, d, c);                                   // wound to face up in three space (z = -y)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex.sidewalk, color: 0xc4c1ba, roughness: 0.95 }));
  mesh.receiveShadow = true; mesh.name = 'ground';
  return mesh;
}

// ------------------------------------------------------------------ land cover
// color: tint over the procedural fallback texture; real: tint over the real lawn photo (CC0 Poly Haven leafy_grass)
const COVER = {
  park: { tex: 'grass', color: 0xd7e6c4, real: 0xffffff }, grass: { tex: 'grass', color: 0xe6efd6, real: 0xf4f6ea }, wood: { tex: 'grass', color: 0x9fb887, real: 0xb9c9a2 },
  pitch: { tex: 'grass', color: 0xc6e8a8, real: 0xe4fbd2 }, playground: { tex: null, color: 0xb85a3c }, parking: { tex: 'asphalt', color: 0x8d8c8a },
  construction: { tex: null, color: 0x8a7458 },
};
/** lawns never look tiled: a low-frequency world-space noise lays lusher and drier patches over the texture */
function lawnVariation(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLawn;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLawn = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vLawn;
      float lawnN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
        float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      // the scan is a leaf-littered autumn lawn: grade it to a late-summer Atlanta green, keeping its detail
      float lawnL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      diffuseColor.rgb = mix(diffuseColor.rgb, lawnL * vec3(0.74, 1.2, 0.5), 0.62);
      float lush = lawnN(vLawn * 0.045) * 0.65 + lawnN(vLawn * 0.17) * 0.35, dry = smoothstep(0.62, 0.9, lawnN(vLawn * 0.021 + 7.3));
      diffuseColor.rgb *= mix(0.8, 1.1, lush);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.05, 0.72), dry * 0.4);`);
  };
}

/** triangulate a polygon, split big triangles, and drape every vertex on the terrain */
function drapedPolygon(pts, ground, z, into, onRoad) {
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const push = (a, b, c, depth) => {
    const L = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    // the terrain is piecewise-flat on an 8 m grid: a triangle spanning a crease sags under it. Measure the sag at
    // its centre and edge midpoints; split coarse (>4 m) or sagging triangles, so the cover follows the ground
    // exactly where it bends and stays light where it's flat
    const za = ground(a[0], a[1]), zb = ground(b[0], b[1]), zc = ground(c[0], c[1]);
    let sag = 0;
    for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) {
      const x = a[0] * wa + b[0] * wb + c[0] * wc, y = a[1] * wa + b[1] * wb + c[1] * wc;
      sag = Math.max(sag, ground(x, y) - (za * wa + zb * wb + zc * wc));
    }
    if ((L > 4 || (sag > 0.012 && L > 1.2)) && depth < 10) {
      const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
      push(a, ab, ca, depth + 1); push(ab, b, bc, depth + 1); push(ca, bc, c, depth + 1); push(ab, bc, ca, depth + 1); return;
    }
    const lift = Math.max(0, sag + 0.005);                                  // whatever's left is a few mm
    const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
    for (const q of up ? [a, b, c] : [a, c, b]) { into.pos.push(q[0], ground(q[0], q[1]) + z + lift, -q[1]); into.uv.push(q[0] / 4, q[1] / 4); }
  };
  for (const t of tris) push(pts[t[0]], pts[t[1]], pts[t[2]], 0);
}
export function buildCover(W, ground, tex, streets) {
  const onRoad = (x, y) => !!streets.index.covering(x, y, null, 0.3);
  // one mesh per cover kind per 200 m tile, so the camera and the shadow pass skip every tile they can't see
  const byKind = {};
  for (const a of W.areas || []) {
    const cx = a.pts.reduce((t, p) => t + p[0], 0) / a.pts.length, cy = a.pts.reduce((t, p) => t + p[1], 0) / a.pts.length;
    const key = a.kind + '|' + Math.floor(cx / 200) + ',' + Math.floor(cy / 200);
    const d = byKind[key] || (byKind[key] = { kind: a.kind, pos: [], uv: [] });
    // stack cover kinds a hair apart so overlapping lots never z-fight
    drapedPolygon(a.pts, ground, LEVEL.AREA + (a.kind === 'parking' ? 0.012 : a.kind === 'pitch' || a.kind === 'playground' ? 0.02 : 0.006), d, onRoad);
  }
  const grass = tex.grass || grassTexture(), group = new THREE.Group(), mats = {}; group.name = 'cover';
  for (const d of Object.values(byKind)) {
    const kind = d.kind;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    g.computeVertexNormals();
    const c = COVER[kind] || COVER.grass;
    const isGrass = c.tex === 'grass' && !!tex.grass;
    const m = mats[kind] || (mats[kind] = new THREE.MeshStandardMaterial({ color: isGrass ? c.real : c.color, roughness: 0.95, map: c.tex === 'grass' ? grass : c.tex === 'asphalt' ? tex.asphalt : null,
      normalMap: isGrass ? tex.grassNor : null, normalScale: new THREE.Vector2(0.9, 0.9),
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    if (isGrass && !m.onBeforeCompile.lawn) { lawnVariation(m); m.onBeforeCompile.lawn = true; }
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.name = 'cover_' + kind; group.add(mesh);
  }
  return group;
}

// ------------------------------------------------------------------ grass tufts
/** real grass standing up out of the lawns near the drive: crossed cards from the CC0 grass scans (make_grass_atlas.py,
 * 4 strips of plants, bases on the ground line), instanced in 100 m tiles. They sway with the trees' wind and sink
 * into the lawn texture 40–55 m out, so the far lawn costs nothing and nothing pops. */
export function buildGrass(W, ground, route, streets, isFree, tex) {
  const group = new THREE.Group(); group.name = 'grass';
  if (!tex.tuft) return group;
  const phone = matchMedia('(pointer: coarse)').matches, step = phone ? 1.3 : 0.95, NEAR = 55, CAP = phone ? 16000 : 36000;
  const onRoad = (x, y) => !!streets.index.covering(x, y, null, 0.8);
  const pts = [];
  for (const a of W.areas || []) {
    if (!/park|grass|wood/.test(a.kind)) continue;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [x, y] of a.pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    if (route.distTo((minX + maxX) / 2, (minY + maxY) / 2) - Math.hypot(maxX - minX, maxY - minY) / 2 > NEAR) continue;
    for (let y = minY; y < maxY; y += step) for (let x = minX; x < maxX; x += step) {
      const h = hash(Math.floor(x * 7.1) * 7919 + Math.floor(y * 3.3)), px = x + (h - 0.5) * step, py = y + (hash(h * 1e6) - 0.5) * step;
      if (route.distTo(px, py) > NEAR || !pointInPoly(px, py, a.pts) || onRoad(px, py) || !isFree(px, py)) continue;
      pts.push([px, py, h]);
    }
  }
  if (pts.length > CAP) pts.length = CAP;
  // one tuft: two crossed 1×1 cards, base at y 0; normals point up so the blades light like the lawn under them
  const pos = [], uv = [], nor = [], idx = [];
  for (const yaw of [0, Math.PI / 2]) {
    const c = Math.cos(yaw) / 2, s = Math.sin(yaw) / 2, b = pos.length / 3;
    pos.push(-c, 0, -s, c, 0, s, c, 1, s, -c, 1, -s); uv.push(0, 0, 1, 0, 1, 1, 0, 1); nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ map: tex.tuft, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, color: 0xf2f6e6 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = WIND;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 gp = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float row = floor(fract(sin(dot(gp.xz, vec2(12.99, 78.23))) * 43758.5) * 4.0);
        vMapUv.y = (vMapUv.y * 0.97 + 0.015 + row) / 4.0;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 gw = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        transformed.y *= 1.0 - smoothstep(40.0, 55.0, distance(cameraPosition.xz, gw.xz));   // sinks into the lawn far out
        transformed.x += sin(uWind * 1.9 + gw.x * 0.31 + gw.z * 0.17) * 0.06 * position.y;
        transformed.z += cos(uWind * 1.5 + gw.x * 0.13) * 0.04 * position.y;`);
    // both faces of a card light as the lawn does (DoubleSide would flip the back face's normal into the ground)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => 'grass_tuft';
  const tiles = new Map(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const p of pts) { const k = Math.floor(p[0] / 100) + ',' + Math.floor(p[1] / 100); (tiles.get(k) || tiles.set(k, []).get(k)).push(p); }
  for (const chunk of tiles.values()) {
    const im = new THREE.InstancedMesh(geo, mat, chunk.length);
    chunk.forEach(([x, y, h], i) => {
      const w = 1.0 + h * 0.7;
      im.setMatrixAt(i, m4.compose(v.set(x, ground(x, y) + LEVEL.AREA, -y), q.setFromEuler(e.set(0, h * 40, 0)), sc.set(w, 0.3 + hash(h * 7e5) * 0.25, w)));
    });
    im.receiveShadow = true; im.computeBoundingSphere(); im.name = 'grass_tufts'; group.add(im);
  }
  group.userData.count = pts.length;
  return group;
}

// ------------------------------------------------------------------ contact shadows
/** a soft dark apron around every building footprint: cheap, baked-looking ambient occlusion */
export function buildContactShadows(W, ground, skip) {
  const pos = [], col = [], idx = [];
  for (const b of W.buildings) {
    if (b.canopy || b.minH > 2.5 || b.pts.length < 3 || skip(b)) continue;
    const signed = b.pts.reduce((s, [x, y], i) => { const [u, v] = b.pts[(i + 1) % b.pts.length]; return s + x * v - u * y; }, 0);
    const pts = signed < 0 ? [...b.pts].reverse() : b.pts, w = Math.min(2.2, 0.8 + b.h * 0.04);
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length], L = Math.hypot(bx - ax, by - ay); if (L < 0.2) continue;
      const nx = (by - ay) / L, ny = -(bx - ax) / L; // outward for CCW rings
      const k = pos.length / 3, z = (x, y) => ground(x, y) + LEVEL.TERRAIN + 0.03;
      pos.push(ax, z(ax, ay), -ay, bx, z(bx, by), -by, bx + nx * w, z(bx + nx * w, by + ny * w), -(by + ny * w), ax + nx * w, z(ax + nx * w, ay + ny * w), -(ay + ny * w));
      col.push(0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0);
      idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx);
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const mesh = new THREE.Mesh(g, m); mesh.name = 'contact_shadows'; mesh.renderOrder = 1;
  return mesh;
}

// ------------------------------------------------------------------ trees
export const WIND = { value: 0 };   // seconds; drive.js advances it, the canopies sway with it
function treeMaterials(tex) {
  const bark = new THREE.MeshStandardMaterial({ map: tex.bark, normalMap: tex.barkNor, roughness: 0.95, metalness: 0 });
  const leaves = new THREE.MeshStandardMaterial({ map: tex.leaves, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
  leaves.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = WIND;
    // vertex colour R = height in the canopy (0 low .. 1 top), G = per-card random: the top moves most
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;\nattribute vec4 color;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #endif
        float wh = color.r, wph = color.g * 6.2831 + ip.x * 0.11 + ip.z * 0.07;
        transformed.x += (sin(uWind * 1.4 + wph) * 0.09 + sin(uWind * 0.45 + ip.x * 0.02) * 0.07) * wh;
        transformed.z += cos(uWind * 1.1 + wph * 1.3) * 0.07 * wh;`);
    // late-September Atlanta: still summer green (the scans lean a little autumn)
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vec3(0.84, 1.0, 0.74);');
  };
  leaves.customProgramCacheKey = () => 'tree_leaves';
  return { bark, leaves };
}

// ------------------------------------------------------------------ streetscape
const TREE_GREENS = [0x5f8a3e, 0x4f7a34, 0x6e9446, 0x587f3a, 0x7a9a4c, 0x4a6e30];
export function buildStreetscape(W, ground, route, streets, props, isFree, trees, tex = {}) {
  const put = { tree_round: [], tree_upright: [], lamp: [], signal: [], bench: [], bin: [], hydrant: [], shelter: [] };
  const onRoad = (x, y) => !!streets.index.covering(x, y, null, 0.6);
  // nothing gets planted under an elevated freeway deck
  const underDeck = (x, y) => streets.freeway.decks.some(([ax, ay, bx, by, r]) => {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy) < r;
  });
  const add = (type, x, y, yaw, color = 0xffffff, scale = 1) => {
    if (!isFree(x, y) || underDeck(x, y)) return false;
    put[type].push([x, y, yaw, color, scale]); return true;
  };
  const crossings = (W.points || []).filter((p) => p[0] === 'crossing');
  const nearCrossing = (x, y, r) => crossings.some((c) => Math.abs(c[1] - x) < r && Math.abs(c[2] - y) < r);

  // along the drive: street trees every ~13 m and cobra-head lamps every ~34 m on both sidewalks
  for (const side of [1, -1]) {
    for (let s = 6; s < route.length; s += 13) {
      const hw = route.hw(s), p = route.at(s, side * (hw + 1.7));
      if (onRoad(p.x, p.y) || nearCrossing(p.x, p.y, 6) || hash(s * 7 + side) < 0.22) continue;
      add(hash(s + side * 3) < 0.7 ? 'tree_round' : 'tree_upright', p.x, p.y, hash(s) * 6.28, TREE_GREENS[(hash(s * 3 + side) * 6) | 0], 0.85 + hash(s * 5) * 0.35);
    }
    for (let s = 20 + (side > 0 ? 17 : 0); s < route.length; s += 34) {
      const hw = route.hw(s), p = route.at(s, side * (hw + 0.7));
      if (onRoad(p.x, p.y)) continue;
      add('lamp', p.x, p.y, p.a + (side > 0 ? -Math.PI / 2 : Math.PI / 2));   // arm reaches over the road
    }
  }
  // OSM trees / lamps / furniture everywhere in the play area
  for (const [kind, x, y] of W.points || []) {
    if (kind === 'tree') add(hash(x * 13 + y) < 0.75 ? 'tree_round' : 'tree_upright', x, y, hash(x) * 6.28, TREE_GREENS[(hash(y) * 6) | 0], 0.9 + hash(x + y) * 0.4);
    if (kind === 'bench') add('bench', x, y, hash(x) * 6.28);
    if (kind === 'bin') add('bin', x, y, 0);
    if (kind === 'hydrant') add('hydrant', x, y, 0);
    if (kind === 'lamp' || kind === 'bus_stop') {
      const s = streets.index.nearest(x, y, 25);
      if (!s) continue;
      const [ax, ay, bx, by] = s, t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1);
      const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;                 // closest road point → face it
      const yaw = Math.atan2(cy - y, cx - x);
      if (kind === 'lamp') add('lamp', x, y, yaw); else add('shelter', x, y, yaw + Math.PI);
    }
  }
  // parks get proper tree cover
  for (const a of W.areas || []) {
    if (!/park|wood/.test(a.kind)) continue;
    const A = polyArea(a.pts), n = Math.min(60, Math.floor(A / (a.kind === 'wood' ? 60 : 170)));
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [x, y] of a.pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
      const x = minX + rand() * (maxX - minX), y = minY + rand() * (maxY - minY);
      if (!pointInPoly(x, y, a.pts) || onRoad(x, y)) continue;
      if (add(rand() < 0.8 ? 'tree_round' : 'tree_upright', x, y, rand() * 6.28, TREE_GREENS[(rand() * 6) | 0], 0.8 + rand() * 0.6)) k++;
    }
  }
  // traffic signals: cluster OSM signal nodes into intersections; on the drive, a mast arm on the far-right
  // corner for each direction of travel, reaching over its lanes
  const sig = (W.points || []).filter((p) => p[0] === 'signal' && route.distTo(p[1], p[2]) < 14);
  const done = [], signals = [];              // signals: every signalised intersection on the route and its masts
  for (const [, x, y] of sig) {
    if (done.some(([dx, dy]) => Math.hypot(dx - x, dy - y) < 30)) continue;
    done.push([x, y]);
    const { s } = route.project(x, y), hw = route.hw(s), node = { s, masts: [] };
    for (const dir of [1, -1]) {           // dir 1: our direction of travel; -1: oncoming
      const p = route.at(s + dir * 11, -dir * (hw + 1.1));
      // model: arm +Y, heads face -X. Map +X → travel direction, +Y → across the road (to the travel's left)
      const yaw = p.a + (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      if (!onRoad(p.x, p.y) && add('signal', p.x, p.y, yaw)) node.masts.push({ dir, x: p.x, y: p.y, z: ground(p.x, p.y) + LEVEL.TERRAIN, yaw });
    }
    signals.push(node);
  }

  // instanced meshes (one draw per prop type)
  const mat = propMaterial(), group = new THREE.Group(); group.name = 'streetscape';
  const GEO = { tree_round: 'prop_tree_round', tree_upright: 'prop_tree_upright', lamp: 'prop_lamp', signal: 'prop_signal',
    bench: 'prop_bench', bin: 'prop_bin', hydrant: 'prop_hydrant', shelter: 'prop_shelter' };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const treeMats = trees && tex.leaves ? treeMaterials(tex) : null, white = new THREE.Color(1, 1, 1);
  for (const [type, list] of Object.entries(put)) {
    if (!list.length) continue;
    if (treeMats && /^tree_/.test(type)) {   // real trees: bark trunk + leaf-card canopy (blender_trees.py)
      // in 150 m tiles, so the camera (and the sun's shadow pass) skip every tile it can't see: phones draw a
      // fraction of the ~1900 trees instead of all of them
      const trunkGeo = bakedGeometry(trees, type + '_trunk'), crownGeo = bakedGeometry(trees, type + '_leaves'), tiles = new Map();
      for (const it of list) { const k = Math.floor(it[0] / 150) + ',' + Math.floor(it[1] / 150); (tiles.get(k) || tiles.set(k, []).get(k)).push(it); }
      for (const chunk of tiles.values()) {
        const trunk = new THREE.InstancedMesh(trunkGeo, treeMats.bark, chunk.length), crown = new THREE.InstancedMesh(crownGeo, treeMats.leaves, chunk.length);
        chunk.forEach(([x, y, yaw, color, sc], i) => {
          m4.compose(new THREE.Vector3(x, ground(x, y) + LEVEL.TERRAIN, -y), q.setFromEuler(e.set(0, yaw, 0)), new THREE.Vector3(sc, sc * (0.92 + hash(x + y) * 0.16), sc));
          trunk.setMatrixAt(i, m4); crown.setMatrixAt(i, m4);
          crown.setColorAt(i, c.set(color).lerp(white, 0.62));      // each tree a slightly different green
        });
        for (const im of [trunk, crown]) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); group.add(im); }
        trunk.name = 'street_' + type; crown.name = 'tree_leaves_' + type;
      }
      continue;
    }
    const im = new THREE.InstancedMesh(bakedGeometry(props, GEO[type]), mat, list.length);
    list.forEach(([x, y, yaw, color, sc], i) => {
      im.setMatrixAt(i, m4.compose(new THREE.Vector3(x, ground(x, y) + LEVEL.TERRAIN, -y), q.setFromEuler(e.set(0, yaw - Math.PI / 2, 0)), new THREE.Vector3(sc, sc, sc)));
      im.setColorAt(i, c.set(color));
    });
    im.castShadow = true; im.receiveShadow = true; im.name = 'street_' + type; group.add(im);
  }
  group.userData.counts = Object.fromEntries(Object.entries(put).map(([k, v]) => [k, v.length]));
  group.userData.placed = put;   // positions of every street prop (the crowd walks round them)
  group.userData.signals = signals;   // (signals.js runs them)
  return group;
}
