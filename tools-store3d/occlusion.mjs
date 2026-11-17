// node tools-store3d/occlusion.mjs  (no browser)
// How much of a character can the store hide at the game camera (45 degrees, looking north, close to orthographic)?
// For every walkable spot of the mask (12 px grid) a column the height of the player (1.70 m) and of the bully (1.88 m) is sampled
// (12 heights x 3 across); a sample is hidden when the ray from it toward the camera hits any box of the store (structure.js, every
// shelf, counter, wall, sign, overstock case; products sit inside the shelf boxes). Reports how much of each character is hidden at
// worst, and how many spots hide more than half / nearly all of them. Decides whether the see-through silhouette is needed.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { buildStructure, m } from '../public/store3d/structure.js'; import { useAtlas } from '../public/store3d/products.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/store3d/layout.json'), 'utf8'));
useAtlas({ cell: () => [0, 0, 1, 1] });
const S = buildStructure(L, {}), boxes = S.builder.boxes.slice();
for (const s of S.info.signs) boxes.push([s.x - s.w / 2, s.y - s.h / 2, s.z - 0.03, s.x + s.w / 2, s.y + s.h / 2, s.z + 0.03]);
const dir = [0, Math.SQRT1_2, Math.SQRT1_2];
const hit = (p) => { for (const b of boxes) { let t0 = 0, t1 = 1e9; for (let a = 0; a < 3; a++) { if (Math.abs(dir[a]) < 1e-9) { if (p[a] < b[a] || p[a] > b[a + 3]) { t0 = 2e9; break; } continue; } let u = (b[a] - p[a]) / dir[a], v = (b[a + 3] - p[a]) / dir[a]; if (u > v) [u, v] = [v, u]; t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) break; } if (t0 <= t1 && t1 > 1e-4) return true; } return false; };
const res = {};
for (const [who, H] of [['player', 1.70], ['bully', 1.88]]) {
  let n = 0, worst = 0, worstAt = null, over50 = 0, over90 = 0, headHidden = 0; const hist = new Array(11).fill(0);
  for (let by = 100; by < 1632; by += 12) for (let bx = 4; bx < L.board.w; bx += 12) {
    const cx = Math.floor(bx / 4), cy = Math.floor(by / 4); if (L.field[cy][cx] !== '1') continue; n++;
    let hid = 0, tot = 0, head = 0;
    for (let k = 0; k < 12; k++) for (const dx of [-0.18, 0, 0.18]) { const y = 0.05 + (H - 0.1) * k / 11, h = hit([m(bx) + dx, y, m(by)]); tot++; if (h) { hid++; if (k >= 10) head++; } }
    const f = hid / tot; hist[Math.floor(f * 10)]++; if (f > worst) { worst = f; worstAt = [bx, by]; } if (f > 0.5) over50++; if (f > 0.9) over90++; if (head === 6) headHidden++;
  }
  res[who] = { spots: n, worstHiddenFraction: +worst.toFixed(3), worstAt, spotsOver50pct: over50, spotsOver90pct: over90, spotsHeadHidden: headHidden, histogramTenths: hist };
}
console.log(JSON.stringify(res, null, 1));
