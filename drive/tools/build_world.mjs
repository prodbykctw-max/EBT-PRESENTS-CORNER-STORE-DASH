// OSM extract + elevation grid → drive/cache/world.json (local metres).
// One source of truth for both the Blender build and the game engine.
//   node drive/tools/build_world.mjs
// Frame: origin = store front, +x east, +y north, z up (metres above the store's ground).
import fs from 'fs';

const here = (p) => new URL(p, import.meta.url);
const OSM = JSON.parse(fs.readFileSync(here('../osm/auburn.json'), 'utf8'));
const CACHE = here('../cache/');
fs.mkdirSync(CACHE, { recursive: true });

// Storefront row on the SOUTH side of Auburn Ave between Fort St and Hilliard St, facing north.
// (The north side of this block is the SCLC HQ / Prince Hall Masonic Building: a landmark we don't build over.)
// Seen from the street (looking south), the row runs left→right in the intro's order: Susie's Hair Care,
// Laundromat, EBT Corner Store, JJ's Fish & Chicken, then the "FORT ST / AUBURN AVE" corner sign.
// Shop x values are in the ROW frame (+x = viewer's right); facing north means row frame = world rotated 180°.
const CORNER = { lat: 33.75552, lon: -84.37797 };         // Auburn Ave & Fort St
const SHOP_W = 14;                                        // metres of frontage per shop
const CORNER_LOCAL_X = SHOP_W * 1.5 + 2;                  // corner sits just past JJ's
const ORIGIN = {                                          // EBT Corner Store, 12.2 m south of Auburn's centreline
  lat: CORNER.lat - 12.2 / 110540,
  lon: CORNER.lon + CORNER_LOCAL_X / (111320 * Math.cos(33.7556 * Math.PI / 180)),
};
// Start on Luckie St ~1.0 km out: a good player makes it with a few seconds spare, an expert banks ~20 s.
// (Tuned from speed-profile lap times; Centennial Olympic Park at 1.5 km was too tight for 60 s.)
const START = { lat: 33.75667, lon: -84.38890 };
const KX = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180), KY = 110540;
const toXY = (n) => [(n.lon - ORIGIN.lon) * KX, (n.lat - ORIGIN.lat) * KY];

// Play area = route bbox + margin; skyline = tall buildings anywhere in the extract.
const PLAY = { s: 33.7520, n: 33.7640, w: -84.3965, e: -84.3735 };
const SKYLINE_MIN_H = 40;

const nodes = new Map(OSM.elements.filter((e) => e.type === 'node').map((n) => [n.id, n]));
const ways = OSM.elements.filter((e) => e.type === 'way' && e.tags);
const inPlay = (n) => n.lat >= PLAY.s && n.lat <= PLAY.n && n.lon >= PLAY.w && n.lon <= PLAY.e;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- elevation grid (Open-Meteo, Copernicus DEM ~30-90 m), cached ----------
const STEP = 40; // metres
const [x0, y0] = toXY({ lat: PLAY.s, lon: PLAY.w }), [x1, y1] = toXY({ lat: PLAY.n, lon: PLAY.e });
const gx = Math.ceil((x1 - x0) / STEP) + 1, gy = Math.ceil((y1 - y0) / STEP) + 1;
const elevFile = new URL('elev.json', CACHE);
let elev;
if (fs.existsSync(elevFile) && JSON.parse(fs.readFileSync(elevFile)).gx === gx) {
  elev = JSON.parse(fs.readFileSync(elevFile));
} else {
  const pts = [];
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    pts.push({ lat: ORIGIN.lat + (y0 + j * STEP) / KY, lon: ORIGIN.lon + (x0 + i * STEP) / KX });
  }
  const z = [];
  for (let k = 0; k < pts.length; k += 100) {
    const b = pts.slice(k, k + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${b.map((p) => p.lat.toFixed(6))}&longitude=${b.map((p) => p.lon.toFixed(6))}`;
    let res;
    for (let tries = 0; tries < 8; tries++) { // free tier rate-limits bursts; back off on 429
      res = await fetch(url);
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 5000 * (tries + 1)));
    }
    if (!res.ok) throw new Error(`elevation ${res.status}`);
    z.push(...(await res.json()).elevation);
    await new Promise((r) => setTimeout(r, 1200));
  }
  elev = { x0, y0, step: STEP, gx, gy, z };
  fs.writeFileSync(elevFile, JSON.stringify(elev));
}
const zAt = (x, y) => {
  const fx = Math.min(Math.max((x - elev.x0) / elev.step, 0), elev.gx - 1.001);
  const fy = Math.min(Math.max((y - elev.y0) / elev.step, 0), elev.gy - 1.001);
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, Z = (a, b) => elev.z[b * elev.gx + a];
  return (Z(i, j) * (1 - u) + Z(i + 1, j) * u) * (1 - v) + (Z(i, j + 1) * (1 - u) + Z(i + 1, j + 1) * u) * v;
};
const Z0 = zAt(0, 0);
const ground = (x, y) => zAt(x, y) - Z0;

// ---------- buildings ----------
const num = (s) => { const m = /-?[\d.]+/.exec(s || ''); return m ? parseFloat(m[0]) : NaN; };
function heightOf(t, area) {
  let h = num(t.height);
  if (isNaN(h) && t['building:levels']) h = num(t['building:levels']) * 3.4 + 1.2;
  if (!isNaN(h)) return { h, est: false };
  // Untagged: estimate from footprint. Sweet Auburn is mostly 1-3 storey brick.
  return { h: area < 150 ? 6.5 : area < 600 ? 9 : area < 3000 ? 13 : 18, est: true };
}
const polyArea = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;

// Buildings under freeway viaducts (e.g. the streetcar yard under the Connector) must clear the deck.
const decks = [];
for (const w of ways) {
  if (!/^(motorway|trunk)/.test(w.tags.highway || '') || !w.tags.bridge || w.tags.bridge === 'no') continue;
  const ps = w.nodes.map((id) => nodes.get(id)).filter(Boolean).map(toXY);
  for (let i = 0; i + 1 < ps.length; i++) decks.push([ps[i], ps[i + 1]]);
}
const segDist = ([px, py], [[ax, ay], [bx, by]]) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const underDeck = (pts) => pts.some((p) => decks.some((d) => segDist(p, d) < 8));
const DECK_CLEAR = 5.5;

const buildings = [];
for (const w of ways) {
  if (!w.tags.building || w.nodes.length < 4 || w.tags.building === 'bridge') continue; // bridge decks come from the road layer
  const ns = w.nodes.map((id) => nodes.get(id)).filter(Boolean);
  if (ns.length < 4) continue;
  const pts = ns.slice(0, -1).map(toXY); // closed ring, drop duplicate
  const area = polyArea(pts);
  let { h, est } = heightOf(w.tags, area);
  const capped = underDeck(pts) && h > DECK_CLEAR;
  if (capped) h = DECK_CLEAR;
  const play = ns.some(inPlay);
  if (!play && h < SKYLINE_MIN_H) continue;
  const base = Math.min(...pts.map(([x, y]) => ground(x, y)));
  buildings.push({
    id: w.id, kind: play ? 'play' : 'skyline', name: w.tags.name || undefined,
    type: w.tags.building, h: r2(h), est: est || undefined, base: r2(base), capped: capped || undefined,
    canopy: w.tags.building === 'roof' || undefined, // open-sided roof: slab only, drive-under
    minH: num(w.tags.min_height) || undefined, pts: pts.map(([x, y]) => [r2(x), r2(y)]),
  });
}

// ---------- roads ----------
const WIDTH = { motorway: 11, trunk: 10, primary: 12, secondary: 11, tertiary: 9, residential: 7, unclassified: 7,
  living_street: 6, service: 4.5, motorway_link: 6, trunk_link: 6, primary_link: 6.5, secondary_link: 6, tertiary_link: 6 };
const roads = [];
for (const w of ways) {
  const cls = w.tags.highway, wd = WIDTH[cls];
  if (!wd || w.tags.area === 'yes' || (cls === 'service' && w.tags.service === 'parking_aisle')) continue;
  const ns = w.nodes.map((id) => nodes.get(id)).filter(Boolean);
  if (!ns.some(inPlay)) continue;
  const lanes = num(w.tags.lanes);
  const bridge = w.tags.bridge && w.tags.bridge !== 'no', tunnel = w.tags.tunnel && w.tags.tunnel !== 'no';
  const layer = num(w.tags.layer) || (bridge ? 1 : 0);
  roads.push({
    id: w.id, cls, name: w.tags.name || w.tags.ref || undefined,
    width: r2(!isNaN(lanes) ? Math.max(lanes * 3.4, 5) + (cls.includes('link') ? 1 : 2) : wd),
    oneway: ['yes', 'true', '1', '-1'].includes(w.tags.oneway) || undefined,
    bridge: bridge || undefined, tunnel: tunnel || undefined, layer: layer || undefined,
    pts: ns.map((n) => { const [x, y] = toXY(n); return [r2(x), r2(y), r2(ground(x, y))]; }),
  });
}

// ---------- route (Dijkstra on drivable, one-way aware) ----------
const DRIVE = /^(primary|secondary|tertiary|residential|unclassified|primary_link|secondary_link|tertiary_link|trunk|trunk_link|living_street)$/;
const dist = (a, b) => Math.hypot((a.lat - b.lat) * KY, (a.lon - b.lon) * KX);
const G = new Map(), add = (a, b) => { if (!G.has(a)) G.set(a, []); G.get(a).push([b, dist(nodes.get(a), nodes.get(b))]); };
for (const w of ways) {
  if (!DRIVE.test(w.tags.highway || '')) continue;
  const ow = w.tags.oneway;
  for (let i = 0; i + 1 < w.nodes.length; i++) {
    const a = w.nodes[i], b = w.nodes[i + 1];
    if (!nodes.get(a) || !nodes.get(b)) continue;
    if (ow === '-1') add(b, a); else { add(a, b); if (!['yes', 'true', '1'].includes(ow)) add(b, a); }
  }
}
const nearest = (p) => { let best, bd = Infinity; for (const id of G.keys()) { const d = dist(nodes.get(id), p); if (d < bd) { bd = d; best = id; } } return best; };
const s = nearest(START), t = nearest(ORIGIN), D = new Map([[s, 0]]), prev = new Map(), Q = [[0, s]];
while (Q.length) {
  Q.sort((a, b) => a[0] - b[0]);
  const [d, u] = Q.shift();
  if (u === t) break;
  if (d > D.get(u)) continue;
  for (const [v, l] of G.get(u) || []) if (d + l < (D.get(v) ?? Infinity)) { D.set(v, d + l); prev.set(v, u); Q.push([d + l, v]); }
}
const route = [];
for (let u = t; u !== undefined; u = prev.get(u)) { const [x, y] = toXY(nodes.get(u)); route.unshift([r2(x), r2(y), r2(ground(x, y))]); }

// ---------- landmarks ----------
const landmarks = OSM.elements
  .filter((e) => e.tags?.name && (e.tags.tourism || e.tags.historic || e.tags.amenity === 'place_of_worship'))
  .map((e) => { const c = e.center || e; return c.lat && inPlay(c) ? { name: e.tags.name, pos: toXY(c).map(r2) } : null; })
  .filter(Boolean);

const world = {
  version: 1, generated: new Date().toISOString(), origin: ORIGIN, groundZ0: r2(Z0),
  frame: 'metres; origin = store front; +x east, +y north, z up relative to store ground',
  attribution: 'Map data © OpenStreetMap contributors (ODbL); elevation Copernicus DEM via Open-Meteo',
  store: { pos: [0, 0, 0], street: 'Auburn Ave NE', between: ['Fort St', 'Hilliard St'], side: 'south', facing: 'north' },
  // Hero row replaces whatever OSM buildings sit on these lots. x = frontage centre in the ROW frame (m).
  shops: ["Susie's Hair Care", 'Laundromat', 'EBT Corner Store', "JJ's Fish & Chicken"].map((name, i) => ({ name, x: r2((i - 2) * SHOP_W), width: SHOP_W })),
  cornerSign: { text: ['FORT ST', 'AUBURN AVE'], pos: toXY(CORNER).map(r2).concat(0) }, // world frame; kept from the intro
  route: { length: Math.round(D.get(t)), pts: route },
  elevation: { ...elev, z: elev.z.map((v) => r2(v - Z0)) },
  buildings, roads, landmarks,
};
fs.writeFileSync(new URL('world.json', CACHE), JSON.stringify(world));
const tall = buildings.filter((b) => b.kind === 'play').sort((a, b) => b.h - a.h).slice(0, 5);
console.log(`world.json: ${buildings.filter((b) => b.kind === 'play').length} play + ${buildings.filter((b) => b.kind === 'skyline').length} skyline buildings, ${roads.length} roads, route ${world.route.length} m, relief ${r2(Math.min(...world.elevation.z))}..${r2(Math.max(...world.elevation.z))} m`);
console.log('tallest in play area:', tall.map((b) => `${b.name || b.id} ${b.h}m`).join(', '));
console.log('size', (fs.statSync(new URL('world.json', CACHE)).size / 1e6).toFixed(2), 'MB');
