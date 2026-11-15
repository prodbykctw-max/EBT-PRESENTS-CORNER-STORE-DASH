/**
 * Pre-compressed (brotli, quality 11) copies of the drive's big binary files, written next to them as `<file>.br`.
 *
 * Why: Cloudflare compresses at the edge only a fixed list of content types (text, json, js, svg, fonts, wasm...).
 * `.glb`, `.bin`, `.cars` and `.wav` are not on it, so they went out raw: people2.bin 2.50 MB, animals.bin 0.95 MB,
 * props.glb 0.92 MB, car.glb 0.80 MB... The Worker (worker/index.js `driveBinary`) answers a request for one of them with
 * the `.br` copy and `content-encoding: br` when the browser accepts br, so the phone downloads ~3.5 MB less.
 * Only files that shrink by at least MIN_SAVING are written (hero.glb and bc.cars are already compressed: ~5 %).
 * Lossless: the browser decodes it back to the exact same bytes (tests/worker.test.mjs checks every .br against its source).
 *
 *   node scripts/compress-drive.mjs          write / refresh the .br files (npm run build:standalone does this)
 *   import { driveBinaries, brotli } from './compress-drive.mjs'
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as Z } from 'node:zlib';

export const DRIVE_DIR = resolve(fileURLToPath(new URL('../public/drive/', import.meta.url)));
export const EXTS = new Set(['.glb', '.bin', '.cars', '.wav']);
// not served to anyone any more: people.bin is kept only for old cached pages' sake (nothing in the current code asks for it)
export const SKIP = new Set(['people-real/people.bin']);
export const MIN_SAVING = 0.10, MIN_BYTES = 8192;

export function driveBinaries(dir = DRIVE_DIR) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...driveBinaries(f));
    else if (EXTS.has(extname(n)) && !SKIP.has(f.slice(dir === DRIVE_DIR ? DRIVE_DIR.length : 0))) out.push(f);
  }
  return out.sort();
}
export const brotli = (buf) => brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_LGWIN]: 24, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length } });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let before = 0, after = 0;
  for (const f of driveBinaries()) {
    const src = readFileSync(f), br = f + '.br';
    // reuse the existing .br if it still decodes to this file (brotli q11 on 2.5 MB takes seconds)
    let keep = null;
    if (existsSync(br)) { try { const { brotliDecompressSync } = await import('node:zlib'); if (brotliDecompressSync(readFileSync(br)).equals(src)) keep = readFileSync(br); } catch {} }
    const c = keep || brotli(src);
    if (src.length >= MIN_BYTES && c.length <= src.length * (1 - MIN_SAVING)) {
      if (!keep) writeFileSync(br, c);
      before += src.length; after += c.length;
      console.log(`${keep ? 'kept ' : 'wrote'} ${f.slice(DRIVE_DIR.length)}.br  ${src.length} -> ${c.length}`);
    } else if (existsSync(br)) unlinkSync(br);
  }
  console.log(`total ${before} -> ${after} bytes (${((1 - after / before) * 100).toFixed(0)}% less)`);
}
