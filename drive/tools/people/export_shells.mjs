// Prints the optional parts of people-a.js's person (hair, cap, backpack, hood, skirt: every vertex with slot > 0) as JSON, for build_people.py.
//   node export_shells.mjs <lod 0|1>
import { buildPerson } from '../../../public/drive/people-a.js';
const g = buildPerson(Number(process.argv[2] || 0));
const pos = g.attributes.position, info = g.attributes.aInfo, idx = g.index;
const keep = new Map(), P = [], I = [];
for (let i = 0; i < pos.count; i++) if (info.getX(i) > 0) { keep.set(i, P.length / 3); P.push(+pos.getX(i).toFixed(5), +pos.getY(i).toFixed(5), +pos.getZ(i).toFixed(5)); I.push(info.getX(i), info.getY(i), +info.getZ(i).toFixed(4), info.getW(i)); }
const T = [];
for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2); if (keep.has(a) && keep.has(b) && keep.has(c)) T.push(keep.get(a), keep.get(b), keep.get(c)); }
process.stdout.write(JSON.stringify({ pos: P, info: I, idx: T }));
