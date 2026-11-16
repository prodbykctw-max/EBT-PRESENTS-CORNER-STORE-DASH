// Sidewalk widths, curb to facade, measured from the real city (node, no browser): node tools-walk/widths.mjs [repoRoot]
// For every metre of the route and each side, and for every curbed street near the route, a line is cast from the curb's outer edge straight
// away from the street, and the width is how far it goes before it meets a building wall (the drawn buildings, or the hand-built row's slices).
import { pathToFileURL } from 'url';
const root = process.argv[2] || new URL('..', import.meta.url).pathname;
const { loadCityNode } = await import(pathToFileURL(root + '/tools-roam/node-world.mjs').href);
const { W, route, city, heroWalls, ground } = await loadCityNode();
const segs = []; for (const a of [city.walls, heroWalls]) for (let i = 0; i + 3 < a.length; i += 4) segs.push([a[i], a[i + 1], a[i + 2], a[i + 3]]);
const hit = (x, y, dx, dy, max) => { // nearest wall along the ray, or Infinity
  let best = Infinity;
  for (const [ax, ay, bx, by] of segs) {
    if (Math.min(ax, bx) > x + max || Math.max(ax, bx) < x - max || Math.min(ay, by) > y + max || Math.max(ay, by) < y - max) continue;
    const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - x) * ey - (ay - y) * ex) / den, u = ((ax - x) * dy - (ay - y) * dx) / den;
    if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
  }
  return best;
};
const stat = (v) => { v = v.filter(Number.isFinite).sort((a, b) => a - b); const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))]; return { n: v.length, min: +v[0].toFixed(2), p10: +q(0.1).toFixed(2), median: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), max: +v.at(-1).toFixed(2), mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) }; };
const MAXW = 25;
const out = { route: {}, store: {}, side: {} };
// route: both sides, every metre; only count a ray that meets a wall within MAXW (a gap = open lot / junction / park, not a sidewalk)
const rows = [];
for (let s = 0; s < route.length; s++) for (const side of [1, -1]) {
  const p = route.at(s), hw = route.hw(s), n = [-Math.sin(p.a) * side * -1 * -1, 0];
  const nx = -Math.sin(p.a) * -side * -1, ny = Math.cos(p.a) * side;   // left normal * side  (at(s,d) uses wx = x - sin(a) d, wy = y + cos(a) d: +d is the left)
  const ox = p.x + nx * (hw + 0.3), oy = p.y + ny * (hw + 0.3);
  const t = hit(ox, oy, nx, ny, MAXW);
  rows.push({ s, side, w: t });
}
const closed = rows.filter((r) => r.w <= MAXW).map((r) => r.w);
out.route.all = stat(closed); out.route.openShare = +(1 - closed.length / rows.length).toFixed(3);
// the wall of a building is a footprint edge: also report how many metres are "with a building facing the walk" per side
out.route.left = stat(rows.filter((r) => r.side === 1 && r.w <= MAXW).map((r) => r.w)); out.route.right = stat(rows.filter((r) => r.side === -1 && r.w <= MAXW).map((r) => r.w));
// the corner store: its front, within +-25 m along the street of the store (x 0, y 9 is the parking spot, the store fronts the walk on the +y side?)
const sp = route.project(0, 9.0);
const near = rows.filter((r) => Math.abs(r.s - sp.s) <= 25 && r.w <= MAXW);
out.store.spotS = sp.s; out.store.byWindow = {}; for (const side of [1, -1]) out.store.byWindow[side] = stat(near.filter((r) => r.side === side).map((r) => r.w));
out.store.at = [-14, -7, 0, 7, 14].map((dx) => { const q = route.project(dx, 9); const hw = route.hw(q.s); return { x: dx, s: +q.s.toFixed(1), d: +q.d.toFixed(1), hw: +hw.toFixed(2), left: +hit(...(() => { const p = route.at(q.s); const nx = -Math.sin(p.a), ny = Math.cos(p.a); return [p.x + nx * (hw + 0.3), p.y + ny * (hw + 0.3), nx, ny, MAXW]; })()).toFixed(2), right: +hit(...(() => { const p = route.at(q.s); const nx = Math.sin(p.a), ny = -Math.cos(p.a); return [p.x + nx * (hw + 0.3), p.y + ny * (hw + 0.3), nx, ny, MAXW]; })()).toFixed(2) }; });
// side streets: every curbed street piece within 150 m of the route, every 3 m, both sides
const CURBED = /^(primary|secondary|tertiary|residential|unclassified|living_street)(_link)?$/;
const sw = [];
for (const r of city.streets.runs) {
  if (!CURBED.test(r.cls) || r.id === 'route') continue;
  for (let i = 0; i + 1 < r.p.length; i++) {
    const [ax, ay] = r.p[i], [bx, by] = r.p[i + 1], L = Math.hypot(bx - ax, by - ay); if (L < 1) continue;
    const tx = (bx - ax) / L, ty = (by - ay) / L;
    for (let t = 1.5; t < L; t += 3) {
      const x = ax + tx * t, y = ay + ty * t; if (route.distTo(x, y) > 150 || route.distTo(x, y) < route.hwAt(x, y) + 3) continue;
      for (const sd of [1, -1]) { const nx = -ty * sd, ny = tx * sd, hw = r.width / 2 + 0.3; const w = hit(x + nx * hw, y + ny * hw, nx, ny, MAXW); if (w <= MAXW) sw.push(w); }
    }
  }
}
out.side = stat(sw);
console.log(JSON.stringify(out, null, 1));
