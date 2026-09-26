// Download the CC0 foliage textures (Poly Haven, 1k) the beauty pass builds on. Textures only: Poly Haven's tree
// models are photo-scanned (0.3–17 M triangles), far too heavy for phones, so the trees are built in Blender as
// trunks + branches + leaf cards using these maps (drive/tools/blender_trees.py).
//   node drive/tools/fetch_foliage.mjs   → drive/art/foliage/<asset>/<map>.<ext>
import fs from 'fs';

const WANT = {
  island_tree_02: { leaves_diff: 'jpg', leaves_alpha: 'png', leaves_nor_gl: 'jpg', Diffuse: 'jpg', nor_gl: 'jpg' },   // leaf cards + bark
  grass_bermuda_01: { Diffuse: 'jpg', Alpha: 'png', nor_gl: 'jpg' },                                                    // grass tufts
  leafy_grass: { Diffuse: 'jpg', nor_gl: 'jpg', Rough: 'jpg' },                                                         // lawn ground
};
let total = 0;
for (const [id, maps] of Object.entries(WANT)) {
  const dir = new URL(`../art/foliage/${id}/`, import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  for (const [map, ext] of Object.entries(maps)) {
    const f = files[map]?.['1k']?.[ext] ?? files[map.toLowerCase()]?.['1k']?.[ext];
    if (!f) { console.warn(`${id}: no ${map} 1k ${ext}`); continue; }
    const target = new URL(`${map}.${ext}`, dir);
    if (!fs.existsSync(target)) fs.writeFileSync(target, Buffer.from(await (await fetch(f.url)).arrayBuffer()));
    total += fs.statSync(target).size;
    console.log(`${id}/${map}.${ext}  ${(fs.statSync(target).size / 1e6).toFixed(2)} MB`);
  }
}
console.log(`total ${(total / 1e6).toFixed(1)} MB (CC0, polyhaven.com)`);
