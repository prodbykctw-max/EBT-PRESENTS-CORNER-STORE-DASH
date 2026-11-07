// Loads the real city in node (no browser, no GL): world.json, the hero row / props / trees glTFs (geometry only: textures are stubbed), the route, the streets, the
// buildings and the street furniture, exactly as drive.js builds them, so the roam collision world can be built and tested without a headless browser.
import fs from 'fs';
const base = new URL('../public/drive/', import.meta.url);
const file = (f) => new URL(f, base);
export async function loadCityNode() {
  const mkEl = () => { const l = {}; return { style: {}, addEventListener(t, f) { (l[t] ||= []).push(f); }, removeEventListener() {}, set src(v) { this._s = v; setTimeout(() => (l.load || []).forEach((f) => f({})), 0); }, get src() { return this._s; }, width: 1, height: 1, getContext() { return { drawImage() {} }; } }; };
  globalThis.document = { createElementNS: () => mkEl(), createElement: () => mkEl() };
  globalThis.self = globalThis; globalThis.matchMedia = () => ({ matches: false }); globalThis.location = { search: '' };
  const THREE = await import(file('vendor/three.module.min.js').href);
  const { GLTFLoader } = await import(file('vendor/GLTFLoader.js').href);
  const { MeshoptDecoder } = await import(file('vendor/meshopt_decoder.module.js').href);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const parse = (f) => new Promise((ok, no) => { const b = fs.readFileSync(file(f)); loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), file('./').href, ok, no); });
  const [hero, props, trees] = await Promise.all(['hero.glb', 'props.glb', 'trees.glb'].map(parse));
  const city = await import(file('city.js').href);
  const { RouteFrame } = await import(file('runner.js').href);
  const { heroSegments } = await import(file('corral.js').href);
  const roam = await import(file('roam.js').href);
  const W = JSON.parse(fs.readFileSync(file('world.json')));
  const ground = city.makeGround(W);
  const route = new RouteFrame(W, ground, 200);
  const mk = () => new THREE.Texture();
  const tex = { brick: mk(), roof: mk(), concrete: mk(), sidewalk: mk(), map: mk(), normal: mk(), asphalt: mk(), grass: mk(), grassNor: mk(), bark: mk(), barkNor: mk(), leaves: mk(), tuft: mk() };
  const C = city.buildCity(W, tex, ground, route, props.scene, trees.scene);
  const SPOT = { x: 0, y: 9.0 };
  const heroWalls = heroSegments(hero.scene, ground(SPOT.x, SPOT.y));
  const walk = roam.walkWorldFor({ city: C, heroWalls, W });
  return { THREE, W, ground, route, city: C, heroWalls, walk, roam, SPOT };
}
