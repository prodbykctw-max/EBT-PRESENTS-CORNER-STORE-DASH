// Dev-only, no browser: runs the game's own buildMasks()/fieldAt()/boxFree() from standalone/csd.js (sliced out of the file
// and evaluated in a vm) over the board's pixels (an RGBA dump of board.b64: node tools-store3d/mask-node.mjs board.rgba).
// Used to iterate while the headless browser is busy, and to cross-check tools-store3d/extract.mjs (the browser, __csd).
import fs from 'fs'; import vm from 'vm'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'standalone/csd.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('slice ' + a); return src.slice(i, j); };
const code = [cut('var IW=853', 'var PAL='), cut('var SPAWN_P=', '/* Bully speed'), cut('var walk=null', 'var scale=1;'), cut('var CLIP_CY0', '/* ---------- BFS path')].join('\n');
export function build(rgbaPath) {
  const data = fs.readFileSync(rgbaPath);
  const ctx = { canvas: null, getContext() { return { getImageData: () => ({ data }) }; } };
  const sb = {}; vm.createContext(sb);
  vm.runInContext(code + '\nthis.__r={build:buildMasks,fieldAt:fieldAt,boxFree:boxFree,snap:snapToField,MASKINFO:MASKINFO,get field(){return field;},MW:MW,MH:MH,SPAWN_P:SPAWN_P};', sb);
  sb.__r.build(ctx); return sb.__r;
}
if (process.argv[1].endsWith('mask-node.mjs')) { const r = build(process.argv[2]); let n = 0; for (const v of r.field) n += v; console.log('field cells', n, 'of', r.MW * r.MH, r.MASKINFO.shadowCells); }
