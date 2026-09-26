// Blender exports (drive/cache/*_raw.glb) → shipped, compressed assets in public/drive/.
//   node drive/tools/optimize_assets.mjs
// meshopt geometry + WebP textures. KTX2/Basis can replace WebP later without touching the runtime.
import { execFileSync } from 'child_process';
import fs from 'fs';

const cache = new URL('../cache/', import.meta.url), out = new URL('../../public/drive/', import.meta.url);
const path = (u) => decodeURIComponent(u.pathname.replace(/^\/(\w:)/, '$1'));
fs.mkdirSync(out, { recursive: true });

const gt = (...args) => execFileSync('npx', ['--yes', '@gltf-transform/cli@4.5.0', ...args],
  { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
const tmp = (n) => path(new URL(n, cache));

// Tiling PBR sets arrive at 512² from fetch_pbr.mjs (shared with the runtime city);
// the painted facades keep 2048 wide for the street-level arrival shot.
const JOBS = [
  { src: 'hero_raw.glb', dst: 'hero.glb', max: 2048, quality: 80 },
  { src: 'car_raw.glb', dst: 'car.glb', max: 512, quality: 80, keepMeshes: true }, // keeps the *_STEER/*_SPIN wheel pivots
  { src: 'props_raw.glb', dst: 'props.glb', max: 256, quality: 80, keepMeshes: true }, // one mesh per prop (runtime instances them by name)
  { src: 'trees_raw.glb', dst: 'trees.glb', max: 256, quality: 80, keepMeshes: true }, // trunk + leaf-card canopy per tree (textures: tex/)
];
for (const j of JOBS) {
  gt('optimize', tmp(j.src), tmp('_a.glb'), '--compress', 'meshopt', '--texture-compress', 'false', '--simplify', 'false',
    ...(j.keepMeshes ? ['--join', 'false', '--flatten', 'false', '--instance', 'false'] : []));
  gt('resize', tmp('_a.glb'), tmp('_c.glb'), '--width', String(j.max), '--height', String(j.max));
  gt('webp', tmp('_c.glb'), path(new URL(j.dst, out)), '--quality', String(j.quality));
  for (const f of ['_a.glb', '_c.glb']) fs.rmSync(new URL(f, cache), { force: true });
}
// Runtime world data: same file the Blender build reads, minus the elevation grid's cache fields.
const world = JSON.parse(fs.readFileSync(new URL('world.json', cache), 'utf8'));
fs.writeFileSync(new URL('world.json', out), JSON.stringify(world));

let total = 0;
for (const f of fs.readdirSync(out)) {
  const st = fs.statSync(new URL(f, out));
  if (st.isFile()) { total += st.size; console.log(f.padEnd(14), (st.size / 1024).toFixed(0).padStart(6), 'KB'); }
}
console.log('drive assets total', (total / 1048576).toFixed(2), 'MB (budget 8 MB, first chunk 3 MB)');
