// Builds the textures for the "real" look (?look=real) from CC0 scans, as WebP:
//   node drive/tools/build_real_tex.mjs [srcDir]      (srcDir defaults to drive/art/real_src; sources are downloaded there)
// Every set is two images, so a facade shader needs only two samplers per material:
//   <name>_d.webp  albedo (RGB), with the scan's ambient occlusion baked in
//   <name>_n.webp  R,G = tangent-space normal (OpenGL, z rebuilt in the shader), B = roughness
// Sources (all CC0, see public/drive/tex/CREDITS.txt): Poly Haven brick_4, concrete_wall_008, concrete_pavement, asphalt_02;
// ambientCG Facade001. peel.webp is generated here (no source): a tileable fine height noise (R) and roughness wobble (G).
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const SRC = path.resolve(process.argv[2] || new URL('../art/real_src/', import.meta.url).pathname);
const OUT = new URL('../../public/drive/tex/real/', import.meta.url).pathname;
fs.mkdirSync(SRC, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const get = async (url, f) => { const p = path.join(SRC, f); if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(await (await fetch(url)).arrayBuffer())); return p; };
const PH = (id, m) => `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_${m}_1k.jpg`;
const raw = async (p, size, ch = 3) => { const { data, info } = await sharp(p).resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, ch: info.channels, size }; };
const write = (buf, size, f, q) => sharp(buf, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: q, effort: 6 }).toFile(path.join(OUT, f)).then((i) => console.log(f, i.size));

async function phSet(id, name, { size = 1024, qd = 80, qn = 88, aoMix = 0.8 } = {}) {
  const [d, n, r, a] = await Promise.all([['diff', 'd'], ['nor_gl', 'n'], ['rough', 'r'], ['ao', 'a']].map(([m, t]) => get(PH(id, m), `${id}_${m}.jpg`).then((p) => raw(p, size))));
  const alb = Buffer.alloc(size * size * 3), nr = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const ao = 1 - aoMix * (1 - a.data[i * a.ch] / 255);
    for (let c = 0; c < 3; c++) alb[i * 3 + c] = Math.round(d.data[i * 3 + c] * ao);
    nr[i * 3] = n.data[i * 3]; nr[i * 3 + 1] = n.data[i * 3 + 1]; nr[i * 3 + 2] = r.data[i * r.ch];
  }
  await write(alb, size, name + '_d.webp', qd); await write(nr, size, name + '_n.webp', qn);
}
await phSet('brick_4', 'brick');
await phSet('concrete_wall_008', 'conc');
await phSet('concrete_pavement', 'pave');

// glass curtain wall: ambientCG Facade001 (colour, NormalGL, Roughness)
{
  const z = path.join(SRC, 'Facade001.zip');
  if (!fs.existsSync(z)) fs.writeFileSync(z, Buffer.from(await (await fetch('https://ambientcg.com/get?file=Facade001_1K-JPG.zip')).arrayBuffer()));
  const { execFileSync } = await import('child_process'); execFileSync('unzip', ['-o', '-q', z, '-d', path.join(SRC, 'Facade001')]);
  const f = (m) => path.join(SRC, 'Facade001', `Facade001_1K-JPG_${m}.jpg`);
  const size = 1024, d = await raw(f('Color'), size), n = await raw(f('NormalGL'), size), r = await raw(f('Roughness'), size);
  const nr = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { nr[i * 3] = n.data[i * 3]; nr[i * 3 + 1] = n.data[i * 3 + 1]; nr[i * 3 + 2] = r.data[i * r.ch]; }
  await write(d.data, size, 'curt_d.webp', 80); await write(nr, size, 'curt_n.webp', 88);
}
// asphalt: roughness (R) and the scan's AO (G), to go with the existing asphalt_diff / asphalt_nor
{
  const size = 512, r = await raw(await get(PH('asphalt_02', 'rough'), 'asphalt_02_rough.jpg'), size), a = await raw(await get(PH('asphalt_02', 'ao'), 'asphalt_02_ao.jpg'), size);
  const b = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { b[i * 3] = r.data[i * r.ch]; b[i * 3 + 1] = a.data[i * a.ch]; b[i * 3 + 2] = r.data[i * r.ch]; }
  await write(b, size, 'asph_r.webp', 82);
}
// peel.webp: a tileable fine noise for car paint and tyres (cheap, so one tiny texture): R = height, G = roughness wobble
{
  const N = 256, H = new Float32Array(N * N), G = new Float32Array(N * N);
  let s = 1234567; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (const [arr, octs] of [[H, [[8, 0.5], [16, 0.3], [32, 0.2]]], [G, [[4, 0.6], [12, 0.4]]]]) {
    for (const [f, w] of octs) {
      const g = new Float32Array(f * f).map(() => rnd());
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {   // tileable value noise, smoothstep-interpolated
        const u = x / N * f, v = y / N * f, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
        const q = (a, b) => g[(b % f) * f + (a % f)];
        arr[y * N + x] += w * ((q(i, j) * (1 - su) + q(i + 1, j) * su) * (1 - sv) + (q(i, j + 1) * (1 - su) + q(i + 1, j + 1) * su) * sv);
      }
    }
  }
  const b = Buffer.alloc(N * N * 3);
  for (let i = 0; i < N * N; i++) { b[i * 3] = Math.round(H[i] * 255); b[i * 3 + 1] = Math.round(G[i] * 255); b[i * 3 + 2] = 128; }
  await write(b, N, 'peel.webp', 92);
}
