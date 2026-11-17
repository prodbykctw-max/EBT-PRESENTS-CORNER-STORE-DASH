// Builds public/store3d/items/items.glb: the scanned pickups for the 3D store, from Poly Haven's CC0 models (credits:
// public/store3d/items/CREDITS.txt). One file, one mesh and one material per piece, every piece's base at y = 0 and centred on x/z,
// in real metres (store3d.js scales each to its pickup size):
//   apple  Food Apple 01            (one apple)
//   buns   Hamburger Buns           (the three rolls, pushed together into a cluster: two behind, one in front)
//   milk   Long Life Food: the carton   } one shared texture, retouched by retouch_pantry.py (brand marks painted out, the
//   beans  Long Life Food: the can      } tomato and sardine labels dropped)
//   lemon  Lemon                    (leans on the lemonade bottle)
// Meshes are simplified (meshoptimizer) to the triangle budgets below, textures resized to <= 512 px WebP, geometry meshopt-compressed
// (store3d.js's GLTFLoader already has the MeshoptDecoder).
//
// Inputs: the Poly Haven 1k glTF folders (api.polyhaven.com/files/<id>, "gltf" -> "1k") and retouch_pantry.py's output.
//   GT_DIR=<folder with @gltf-transform/core@4, /functions@4, /extensions@4, meshoptimizer, sharp installed>
//   node tools-store3d/items/build_items.mjs <polyhaven dir holding food_apple_01/ hamburger_buns/ long_life_food/ lemon/> <retouch out dir>
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'; import { fileURLToPath } from 'url';
const req = createRequire(path.join(process.env.GT_DIR || '.', 'package.json'));
const { NodeIO, Document } = req('@gltf-transform/core');
const { ALL_EXTENSIONS, EXTMeshoptCompression } = req('@gltf-transform/extensions');
const { simplify, weld, dedup, prune, textureCompress, meshopt, mergeDocuments, unpartition } = req('@gltf-transform/functions');
const { MeshoptSimplifier, MeshoptEncoder } = req('meshoptimizer');
const sharp = req('sharp');
const [phDir, retouchDir] = process.argv.slice(2);
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/store3d/items/items.glb');
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// piece: [source asset, source node names, output name, triangle budget, layout offsets per source node (x, z) or null]
const PIECES = [
  ['food_apple_01', ['food_apple_01'], 'apple', 2400, null],
  ['hamburger_buns', ['hamburger_buns_01', 'hamburger_buns_02', 'hamburger_buns_03'], 'buns', 4800, [[-0.054, -0.036], [0.054, -0.036], [0, 0.056]]],
  ['long_life_food', ['long_life_food_milk'], 'milk', 1000, null],
  ['long_life_food', ['long_life_food_beans'], 'beans', 1600, null],
  ['lemon', ['lemon'], 'lemon', 1800, null],
];
const tris = (prim) => (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;

const docs = [];
for (const [asset, nodes, name, budget, offs] of PIECES) {
  const doc = await io.read(path.join(phDir, asset, `${asset}_1k.gltf`));
  const root = doc.getRoot(), scene = root.listScenes()[0];
  // keep only this piece's nodes; bake each node's transform (plus the layout offset) into its vertices
  for (const n of root.listNodes()) if (!nodes.includes(n.getName())) n.dispose();
  const keep = nodes.map((nm) => root.listNodes().find((n) => n.getName() === nm));
  keep.forEach((n, i) => {
    const t = n.getTranslation(), o = offs ? offs[i] : [0, 0];
    for (const prim of n.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), a = pos.getArray().slice();
      for (let k = 0; k < a.length; k += 3) { a[k] += (offs ? 0 : t[0]) + o[0]; a[k + 1] += t[1]; a[k + 2] += (offs ? 0 : t[2]) + o[1]; }
      // a laid-out piece keeps its own centre (offs replace the source row's spacing): centre the source on its own x/z first
      if (offs) { let mx = 0, mz = 0; const c = a.length / 3; for (let k = 0; k < a.length; k += 3) { mx += a[k] - o[0]; mz += a[k + 2] - o[1]; } mx /= c; mz /= c; for (let k = 0; k < a.length; k += 3) { a[k] -= mx; a[k + 2] -= mz; } }
      pos.setArray(a);
    }
    n.setTranslation([0, 0, 0]);
  });
  // one mesh: merge the nodes' primitives (they share one material)
  const mesh = keep[0].getMesh();
  for (const n of keep.slice(1)) { for (const p of n.getMesh().listPrimitives()) { mesh.addPrimitive(p); } n.getMesh().dispose(); n.dispose(); }
  keep[0].setName(name); mesh.setName(name);
  if (!scene.listChildren().includes(keep[0])) scene.addChild(keep[0]);
  for (const mat of root.listMaterials()) { mat.setDoubleSided(false); mat.setName(name); }
  // the retouched pantry atlas
  if (asset === 'long_life_food') {
    const mat = root.listMaterials()[0], swap = (tex, f) => tex && tex.setImage(fs.readFileSync(path.join(retouchDir, f))).setMimeType('image/png');
    swap(mat.getBaseColorTexture(), 'pantry_diff.png'); swap(mat.getNormalTexture(), 'pantry_nor.png'); swap(mat.getMetallicRoughnessTexture(), 'pantry_arm.png');
    if (mat.getOcclusionTexture()) swap(mat.getOcclusionTexture(), 'pantry_arm.png');
  }
  await doc.transform(prune(), weld());
  // simplify to the budget (meshoptimizer; the error bound grows until the budget is met)
  let have = mesh.listPrimitives().reduce((s, p) => s + tris(p), 0);
  if (have > budget) {
    for (const err of [0.002, 0.005, 0.01, 0.02, 0.04]) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: budget / have, error: err, lockBorder: false }));
      have = mesh.listPrimitives().reduce((s, p) => s + tris(p), 0); if (have <= budget * 1.05) break;
    }
  }
  // base at y = 0, centred on x/z
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of mesh.listPrimitives()) { const a = p.getAttribute('POSITION').getArray(); for (let k = 0; k < a.length; k += 3) for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], a[k + j]); mx[j] = Math.max(mx[j], a[k + j]); } }
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  for (const p of mesh.listPrimitives()) { const pos = p.getAttribute('POSITION'), a = pos.getArray().slice(); for (let k = 0; k < a.length; k += 3) { a[k] -= cx; a[k + 1] -= mn[1]; a[k + 2] -= cz; } pos.setArray(a); }
  console.log(name, 'tris', have, 'size m', (mx[0] - mn[0]).toFixed(3), (mx[1] - mn[1]).toFixed(3), (mx[2] - mn[2]).toFixed(3));
  docs.push(doc);
}
// one document, deduplicated (the milk and the beans share their atlas), textures to WebP <= 512 px (normal maps 256)
const out = docs[0];
for (const d of docs.slice(1)) { const map = mergeDocuments(out, d); const sc = out.getRoot().listScenes(); const s0 = sc[0]; for (const s of sc.slice(1)) { for (const c of s.listChildren()) s0.addChild(c); s.dispose(); } void map; }
for (const m of out.getRoot().listMeshes()) if (m.listPrimitives().length > 1) {
  // primitives of one mesh with one material become one primitive: one draw call per piece
  const prims = m.listPrimitives(), mats = new Set(prims.map((p) => p.getMaterial()));
  if (mats.size === 1) { const { joinPrimitives } = req('@gltf-transform/functions'); const j = joinPrimitives(prims); for (const p of prims) { m.removePrimitive(p); p.dispose(); } m.addPrimitive(j); }
}
await out.transform(
  dedup(), unpartition(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 82, slots: /^(?!normal)/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 88, slots: /^normal/ }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, out);
console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes;', out.getRoot().listMeshes().map((m) => m.getName() + ':' + m.listPrimitives().length).join(' '), '; textures', out.getRoot().listTextures().map((t) => t.getMimeType() + ' ' + (t.getSize() || []).join('x')).join(', '));
