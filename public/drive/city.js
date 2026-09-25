// Runtime city: builds terrain, roads and every OSM building from world.json (0.4 MB) instead of shipping
// a heavy city model. Only the hand-made hero row comes from a glTF.
// Frames: world.json is metres, +x east, +y north, z up. three.js is X = x, Y = z, Z = -y.
import * as THREE from './vendor/three.module.min.js';

export const toV3 = (x, y, z = 0) => new THREE.Vector3(x, z, -y);

export function makeGround(W) {
  const E = W.elevation;
  return (x, y) => {
    const fx = Math.min(Math.max((x - E.x0) / E.step, 0), E.gx - 1.001);
    const fy = Math.min(Math.max((y - E.y0) / E.step, 0), E.gy - 1.001);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, Z = (a, b) => E.z[b * E.gx + a];
    return (Z(i, j) * (1 - u) + Z(i + 1, j) * u) * (1 - v) + (Z(i, j + 1) * (1 - u) + Z(i + 1, j + 1) * u) * v;
  };
}

// Deterministic per-building randomness, so the city looks the same every run.
const hash = (n) => { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; };

// Hero row footprint in world coords (row frame x∈[-35,21], y∈[-4,12], rotated 180° → world).
export const HERO_BOX = { x0: -21, x1: 35, y0: -12, y1: 4 };
const inHero = (x, y) => x > HERO_BOX.x0 - 4 && x < HERO_BOX.x1 + 4 && y > HERO_BOX.y0 - 6 && y < HERO_BOX.y1 + 2;

function canvasTexture(size, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function asphaltTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#2b2c2e'; g.fillRect(0, 0, s, s);
    const img = g.getImageData(0, 0, s, s), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < 40; k++) { // patched tar seams and stains
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '15,15,16' : '70,70,72'},${0.08 + Math.random() * 0.1})`;
      g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 4 + Math.random() * 30, 2 + Math.random() * 10, Math.random() * 3, 0, 7); g.fill();
    }
  });
}

// ---------------- roads: ribbons with markings drawn in the shader (no extra geometry) ----------------
// OSM nodes can be 60 m apart; a straight ribbon between them would cut under a hill. Resample every
// 4 m and drape each point on the same ground function the terrain uses (bridges keep their deck line).
function drape(pts, ground, onGround) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 4));
    for (let k = 0; k < n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      out.push([x, y, onGround ? ground(x, y) : az + (bz - az) * t]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function buildRoads(W, tex, ground, { bridges = false } = {}) {
  const pos = [], uv = [], info = [], idx = [];
  const RANK = { motorway: 6, trunk: 6, primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 2, living_street: 1, service: 0 };
  for (const rd of W.roads) {
    if (rd.pts.length < 2 || !!rd.bridge !== bridges) continue;
    const p = drape(rd.pts, ground, !bridges);
    const hw = rd.width / 2, base = pos.length / 3;
    const lift = 0.06 + (rd.bridge ? 7 * (rd.layer || 1) : 0) + (RANK[rd.cls.replace('_link', '')] ?? 1) * 0.004;
    const lanes = Math.max(1, Math.round(rd.width / 3.4));
    const kind = rd.cls.startsWith('service') ? 0 : rd.oneway ? 1 : 2; // 0 plain, 1 one-way lanes, 2 two-way
    let along = 0; const segLen = [];
    for (let i = 0; i + 1 < p.length; i++) segLen.push(Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]));
    const total = segLen.reduce((a, b) => a + b, 0);
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(i - 1, 0)], b = p[Math.min(i + 1, p.length - 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const nx = -dy, ny = dx, z = p[i][2] + lift;
      pos.push(p[i][0] + nx * hw, z, -(p[i][1] + ny * hw), p[i][0] - nx * hw, z, -(p[i][1] - ny * hw));
      uv.push(0, along, 1, along);
      info.push(lanes, kind, total, rd.width, lanes, kind, total, rd.width);
      if (i < segLen.length) along += segLen[i];
    }
    for (let i = 0; i + 1 < p.length; i++) { const k = base + i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(info, 4));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.userData.wet = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = m.userData.wet;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad; varying vec4 vRoad; varying vec2 vRUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad; vRUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet; varying vec4 vRoad; varying vec2 vRUv;')
      .replace('#include <map_fragment>', `
        vec4 texelColor = texture2D(map, vec2(vRUv.x * vRoad.w, vRUv.y) / 6.0);
        diffuseColor *= texelColor;
        float across = vRUv.x, along = vRUv.y, w = vRoad.w;
        float endFade = smoothstep(4.0, 9.0, along) * smoothstep(4.0, 9.0, vRoad.z - along); // keep intersections clean
        float px = fwidth(across * w);
        float line = 0.0; vec3 lineCol = vec3(0.92);
        float edge = (1.0 - smoothstep(0.12, 0.12 + px, abs(across * w - 0.45))) + (1.0 - smoothstep(0.12, 0.12 + px, abs((1.0 - across) * w - 0.45)));
        if (vRoad.y > 1.5) { // two-way: double yellow centre line
          float c = abs(across - 0.5) * w;
          float centre = (1.0 - smoothstep(0.08, 0.08 + px, abs(c - 0.18)));
          float edges = clamp(edge, 0.0, 1.0) * 0.8 * step(9.0, w);
          lineCol = mix(vec3(0.92), vec3(0.95, 0.72, 0.12), step(edges, centre)); // yellow centre, white edges
          line = max(centre, edges);
        } else if (vRoad.y > 0.5) { // one-way: dashed white lane dividers
          float lanes = vRoad.x; float f = fract(across * lanes);
          float dash = step(0.5, fract(along / 9.0));
          line = (1.0 - smoothstep(0.06, 0.06 + px / w * lanes * w, min(f, 1.0 - f) * w / lanes)) * dash * step(1.5, lanes);
          line += edge * 0.8;
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, lineCol, clamp(line, 0.0, 1.0) * 0.85 * endFade);
        diffuseColor.rgb *= mix(1.0, 0.62, uWet);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.18, uWet);');
  };
  if (bridges) m.transparent = true; // decks fade out while you drive underneath (see drive.js)
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.castShadow = bridges; mesh.name = bridges ? 'bridges' : 'roads';
  return mesh;
}

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
    const z0 = b.base - 0.5 + (b.canopy ? b.h - 0.6 : (b.minH || 0)), z1 = b.base + b.h;
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

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function buildTerrain(W, tex, ground) {
  // Re-sample the 40 m elevation grid at 8 m through the SAME bilinear function the roads, buildings and car
  // use, so the ground can never poke up through a road on a slope. Sits 0.25 m low; roads/curbs ride on top.
  const E = W.elevation, STEP = 8;
  const x0 = E.x0, y0 = E.y0, x1 = E.x0 + (E.gx - 1) * E.step, y1 = E.y0 + (E.gy - 1) * E.step;
  const nx = Math.ceil((x1 - x0) / STEP), ny = Math.ceil((y1 - y0) / STEP);
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0, nx, ny);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const k = j * (nx + 1) + i, x = x0 + (i / nx) * (x1 - x0), y = y1 - (j / ny) * (y1 - y0); // rows run north → south
    p.setXYZ(k, x, ground(x, y) - 0.25, -y);
    uv.setXY(k, x / 3, y / 3);
  }
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ map: tex.sidewalk, color: 0xc9c7c1, roughness: 0.95 });
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.name = 'ground';
  return mesh;
}

export function buildCity(W, tex) {
  const ground = makeGround(W);
  const b = buildBuildings(W, tex, ground);
  const group = new THREE.Group();
  const asphalt = asphaltTexture();
  const roads = buildRoads(W, asphalt, ground), bridges = buildRoads(W, asphalt, ground, { bridges: true });
  group.add(buildTerrain(W, tex, ground), roads, bridges, b.group);
  // 2D footprint of every deck, so the drive can tell when the car is underneath one
  const decks = [];
  for (const rd of W.roads) if (rd.bridge) for (let i = 0; i + 1 < rd.pts.length; i++) decks.push([rd.pts[i][0], rd.pts[i][1], rd.pts[i + 1][0], rd.pts[i + 1][1], rd.width / 2 + 3]);
  // hero row blocks the lot it stands on
  b.colliders.push([[HERO_BOX.x0, HERO_BOX.y0], [HERO_BOX.x1, HERO_BOX.y0], [HERO_BOX.x1, HERO_BOX.y1], [HERO_BOX.x0, HERO_BOX.y1]]);
  return { group, colliders: b.colliders, ground, roads: [roads, bridges], bridges, decks };
}
