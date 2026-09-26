// Download the CC0 PBR texture sets the drive uses from Poly Haven (1k is plenty for a top-down camera).
//   node drive/tools/fetch_pbr.mjs   → drive/art/pbr/<id>/{diff,nor,rough}.jpg
import fs from 'fs';

const SETS = {
  red_brick_03: 'side and back walls of the hero row',
  concrete_pavement: 'sidewalks',
  asphalt_02: 'roads',
  rough_concrete: 'flat commercial roofs',
};
const MAPS = { diff: ['Diffuse'], nor: ['nor_gl'], rough: ['Rough', 'rough'] };
const RES = '1k'; // downscaled to 512 after download (see below): tiles are tiny from a top-down camera

for (const id of Object.keys(SETS)) {
  const dir = new URL(`../art/pbr/${id}/`, import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  for (const [out, keys] of Object.entries(MAPS)) {
    const key = keys.find((k) => files[k]);
    const url = key && files[key][RES]?.jpg?.url;
    if (!url) { console.warn(`${id}: no ${out}`); continue; }
    const target = new URL(`${out}.jpg`, dir);
    if (!fs.existsSync(target)) fs.writeFileSync(target, Buffer.from(await (await fetch(url)).arrayBuffer()));
  }
  console.log(`${id} → ${SETS[id]}`);
}
// Downscale to 512² in place. From a top-down camera 512 px tiles are indistinguishable from 1k, and
// they are shared by the hero row and the runtime city.
import { execFileSync } from 'child_process';
execFileSync('python', ['-c', `
import glob
from PIL import Image
for f in glob.glob(r'${new URL('../art/pbr/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')}*/*.jpg'):
    im = Image.open(f)
    if im.width > 512: im.resize((512, 512), Image.LANCZOS).save(f, quality=90)
`], { stdio: 'inherit' });
