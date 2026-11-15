// How long the drive's city build runs between two pauses (CPU only, in node: no browser, no GL). The prepare gives the page a turn at every pause, so the longest chunk is the longest
// the title can freeze for. Prints each chunk over 30 ms (name of the pause that ended it) and the longest.
//   node tools-load/chunks.mjs
import fs from 'fs';
const base = new URL('../public/drive/', import.meta.url), file = (f) => new URL(f, base);
const mkEl = () => { const l = {}; return { style: {}, addEventListener(t, f) { (l[t] ||= []).push(f); }, removeEventListener() {}, set src(v) { this._s = v; setTimeout(() => (l.load || []).forEach((f) => f({})), 0); }, get src() { return this._s; }, getContext: () => ({}) }; };
globalThis.document = { createElementNS: () => mkEl(), createElement: () => mkEl() };
globalThis.self = globalThis; globalThis.matchMedia = () => ({ matches: false }); globalThis.location = { search: '' };
const THREE = await import(file('vendor/three.module.min.js').href);
const { GLTFLoader } = await import(file('vendor/GLTFLoader.js').href);
const { MeshoptDecoder } = await import(file('vendor/meshopt_decoder.module.js').href);
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const parse = (f) => new Promise((ok, no) => { const b = fs.readFileSync(file(f)); loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), file('./').href, ok, no); });
const [hero, props, trees] = await Promise.all(['hero.glb', 'props.glb', 'trees.glb'].map(parse));
const { pace } = await import(file('steps.js').href); pace.slow = true;   // (as a prepared drive before START DRIVE)
const city = await import(file('city.js').href), { RouteFrame } = await import(file('runner.js').href);
const W = JSON.parse(fs.readFileSync(file('world.json'))), ground = city.makeGround(W), route = new RouteFrame(W, ground, 200);
const mk = () => new THREE.Texture();
const tex = { brick: mk(), roof: mk(), concrete: mk(), sidewalk: mk(), map: mk(), normal: mk(), asphalt: mk(), grass: mk(), grassNor: mk(), bark: mk(), barkNor: mk(), leaves: mk(), tuft: mk() };
const it = city.buildCitySteps(W, tex, ground, route, props.scene, trees.scene);
let t = performance.now(), worst = 0, total = 0, n = 0; const big = [];
for (let r = it.next(); ; r = it.next()) {
  const now = performance.now(), d = now - t; total += d; n++; if (d > worst) worst = d; if (d > 30) big.push([r.done ? 'end' : r.value, Math.round(d)]);
  t = performance.now(); if (r.done) break;
}
console.log(JSON.stringify({ chunks: n, totalMs: Math.round(total), longestMs: Math.round(worst), over30: big }));
