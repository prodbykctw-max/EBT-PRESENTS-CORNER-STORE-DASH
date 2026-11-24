// The Corner Store's inside, in real-time 3D, in the realistic look of the street (public/drive: real-post.js is the same look pass,
// character.glb + people.js the same two people). It sits exactly on the layout of the painted board (layout.json) and frames it the
// way the 2D camera does (placeView), so the game plays the same. The game drives it (csd.js, ?store=3d): setCamera / setActor /
// setItems / setPay / setHighlight / setLunge every frame, then render().
//
// Cost (why it is cheap): every static thing (shelves, counters, trims, every product, overstock, carts, plants, accent tiles) is merged
// into a few meshes that share ONE material (geobuf.js paintMaterial), in 6 m bands so the off-screen bands are skipped; all signs,
// posters and mats are one more mesh on one atlas. The key light's shadow map covers the whole store and is drawn ONCE (nothing static
// moves); the two characters cast their own soft shadow on the floor each frame through a tiny 128 px render target each.
import * as THREE from '../drive/vendor/three.module.min.js';
import { GLTFLoader } from '../drive/vendor/GLTFLoader.js';
import { MeshoptDecoder } from '../drive/vendor/meshopt_decoder.module.js';
import * as SkeletonUtils from '../drive/vendor/SkeletonUtils.js';
import { RealLook } from '../drive/real-post.js';
import { makeBullyMaterial, makeStandClip, makeRunClip, addArmSwing, ARMS, MODEL_H, PLAYER_H, BULLY_H } from '../drive/people.js';
import * as T from './textures.js';
import { useAtlas, productGeometry } from './products.js';
import { pickupGeometry, PICKUP_KINDS } from './pickups.js';
import { buildStructure, PX, m } from './structure.js';
import { GeoBuf, paintMaterial, withRM } from './geobuf.js';

const ELEV = 45 * Math.PI / 180, DIST = 8000;   // camera elevation, distance (a very long lens: within 0.3 px of orthographic, so the floor lies under the 2D layers everywhere on screen)
const FACE_YAW = { U: Math.PI, D: 0, L: -Math.PI / 2, R: Math.PI / 2 };   // character.glb faces +z (the camera) at yaw 0
// The game shares Math.random (the run's item order, the bully's spawn and lines). Nothing here may draw from it: three.js gives every
// object an id from Math.random, so while the store is being built, any call coming from this code or the three.js it uses is answered
// by a private generator instead (told apart by the call stack, because the build spans many tasks: a texture decode, the people's model),
// and every frame is drawn with the private generator swapped in. The painted and the 3D store therefore play the same run.
let isoS = 0x5eed3d;
function isoRandom() { isoS |= 0; isoS = (isoS + 0x6D2B79F5) | 0; let t = Math.imul(isoS ^ (isoS >>> 15), 1 | isoS); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const OURS = /\/(store3d|drive)\//;
function guardRandom() {
  const real = Math.random;
  const g = function () { const st = (new Error().stack || '').split('\n').slice(2).join('\n'); return OURS.test(st) ? isoRandom() : real.call(Math); };
  Math.random = g; return () => { if (Math.random === g) Math.random = real; };
}
function withoutRandom(fn) { const real = Math.random; Math.random = isoRandom; try { return fn(); } finally { Math.random = real; } }
const yieldNow = () => new Promise((r) => setTimeout(r, 0));
const lap = (o, k) => { const t = performance.now(); o[k] = Math.round(t - (o._t || t)); o._t = t; };   // how long each build step held the page (init().timings)   // init() gives the page back between its big steps (the how-to-play stays responsive)
const KEY_DIR = new THREE.Vector3(-0.3, 1.0, -0.45).normalize();         // toward the key light: high up like the ceiling lights, a little north-west so shadows are shorter than before but clearly there (Nov 23 2026, owner: overhead light with real shadows; was -0.42, 1.0, -0.62: long diagonal shadows)

/** The store's light and colour, one line to edit. key / hemi / env: the ceiling light, the fill and the reflections; ex: exposure (overall
 *  brightness); lm: the light pools baked on the floor; bloom / bt: how much the brightest things glow and how bright they must be to glow;
 *  sat / con: colour richness and contrast. (Before this existed the game never applied the preview's values and ran with the drive's outdoor
 *  bloom, 0.55 at a 0.9 threshold, which washed the cream floor out to white.) */
// (Nov 23 2026: the owner asked for the look of the first 3D sheets he was shown back, in place of the darker, richer grade of Nov 17.
//  These are that preview's values. The bloom stays the store's own, 0.22 over a 1.9 threshold, so the floor does not wash out to white.)
/** the ceiling lamps' shadows on the floor (bakeLampShadows): h = lamp height (m), occ = height of what blocks them (a shelf), reach = how far a lamp lights (m), ambient = light that is not from a lamp (1 = the lamps add about as much again), strength = how dark a full shadow goes (0 none .. 1 black) */
export const LAMP = { h: 3.2, occ: 1.9, reach: 5.5, ambient: 0.8, strength: 0.6 };
export const TUNE = { key: 1.6, hemi: 0.36, env: 0.5, ex: 0.76, lm: 0.85, bloom: 0.22, bt: 1.9, sat: 0.9, con: 0.0 };   // Nov 23 2026: the softer, more pastel 'A' the owner picked (was key 1.9, hemi 0.28, ex 0.85, lm 1.0, sat 1.04, con 0.1)
/** The pickups' size: the pickups' own models (pickups.js) are held to ITEM_W m across; the gold ring is 1.3 m. */
const ITEM_W = 1.05, ITEM_LOAD_MS = 15000;
/**
 * The scanned pickups: for each, its pieces from items/items.glb (glb: the piece's name; real metres, base at y = 0) or a procedural
 * piece kept from buildItems (keep: its index), each scaled by s (a little larger than life, like the shelf-sized shapes before them),
 * turned by rot (x, y, z radians) so its print faces the camera, and placed at (x, y, z) m. Remove an entry and that pickup is
 * procedural again.
 */
const ITEM_MODELS = {
  APPLE: { parts: [{ glb: 'apple', s: 4.9 }] },
  // BREAD: { parts: [{ glb: 'buns', s: 4.9 }] },   // three scanned rolls (in items.glb, ready): off, the bagged loaf stays until the owner picks
  MILK: { parts: [{ glb: 'milk', s: 2.77, rot: [0, 0, 0] }] },
  LEMONADE: { parts: [{ keep: 0 }, { glb: 'lemon', s: 2.6, rot: [0, 0, Math.PI / 2], at: [0.2, 0, 0.12] }] },
  'RICE & BEANS': { parts: [{ keep: 0, at: [-0.22, 0, 0] }, { glb: 'beans', s: 3.04, rot: [0, 0, 0], at: [0.34, 0, 0] }] },
};
export class Store3D {
  constructor(canvas, { layout, base = new URL('../drive/', import.meta.url).href, mobile = false, pixelRatio } = {}) {
    this._unguard = guardRandom();   // until init() is over (see guardRandom)
    try { this._make(canvas, { layout, base, mobile, pixelRatio }); } catch (e) { this._unguard(); throw e; }
  }
  _make(canvas, { layout, base, mobile, pixelRatio }) {
    this.layout = layout; this.base = base; this.mobile = mobile; this.canvas = canvas; this.t = 0;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.info.autoReset = false; r.setPixelRatio(pixelRatio ?? Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 0.85;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0d1020);
    this.camera = new THREE.PerspectiveCamera(10, 1, 1, 1000);
    this.look = new RealLook(r, this.scene, this.camera, { mobile });
    this.look.fx.haze = false; this.look.m.ao.uniforms.uFade.value = 1e6;   // indoors: no aerial haze; the AO must not fade with the long lens's distance
    this.look.m.ao.uniforms.uRadius.value = 0.9; this.look.m.ao.uniforms.uPower.value = 1.5; this.look.m.fin.uniforms.uAoMix.value = 0.9;
    this.look.m.fin.uniforms.uSat.value = 1.04; this.look.m.fin.uniforms.uContrast.value = 0.1;
    this.actors = {}; this.items = []; this.view = { w: 390, h: 844 };
  }

  async init() { try { return await this._init(); } finally { this._unguard(); } }
  async _init() {
    const TM = this.timings = { _t: performance.now() };
    const { layout } = this, aniso = this.mobile ? 4 : 8;
    const loader = new THREE.TextureLoader(), conc = (f, srgb) => loader.loadAsync(new URL('tex/real/' + f, this.base).href).then((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; });
    const [concD, concN] = await Promise.all([conc('conc_d.webp', true), conc('conc_n.webp', false)]);
    lap(TM, 'concrete'); await yieldNow(); const wallT = T.wallTexture(aniso), floorT = T.floorTextures(aniso); lap(TM, 'wallFloorTex'); await yieldNow(); const atlas = T.labelAtlas(aniso); useAtlas(atlas); this.atlas = atlas;
    const white = atlas.cell('white'), whiteUV = [(white[0] + white[2]) / 2, (white[1] + white[3]) / 2];
    lap(TM, 'labelAtlas'); await yieldNow(); const { aoMap, lightMap, lampVis } = this.bakeFloorLight(); lap(TM, 'floorLight'); await yieldNow();
    const mats = this.mats = {
      default: new THREE.MeshStandardMaterial({ color: 0x888888 }),
      paint: paintMaterial(atlas.map, { envMapIntensity: 0.8 }),
      floor: new THREE.MeshPhysicalMaterial({ clearcoat: 0.55, clearcoatRoughness: 0.22, map: floorT.map, normalMap: floorT.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: floorT.roughnessMap, roughness: 1, metalness: 0, aoMap, aoMapIntensity: 1.0, lightMap, lightMapIntensity: 1.0, envMapIntensity: 0.55 }),
      wall: new THREE.MeshStandardMaterial({ map: wallT, normalMap: concN, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.82, metalness: 0 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 2.2 }),
    };
    mats.floor.onBeforeCompile = (sh) => {   // the lamps' shadows (bakeLampShadows) darken the floor's finished colour where a shelf shades it
      sh.uniforms.uLampVis = { value: lampVis };
      sh.fragmentShader = 'uniform sampler2D uLampVis;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight *= texture2D( uLampVis, vAoMapUv ).r;\n#include <opaque_fragment>');
    };
    lap(TM, 'materials'); this.scene.environment = this.makeEnvironment(); this.scene.environmentIntensity = 0.5; lap(TM, 'environment'); await yieldNow();
    const S = this.structure = buildStructure(layout, mats, { white: whiteUV, defer: true }); lap(TM, 'structure');
    { // the stock and the merged meshes, a slice at a time (the page gets a turn at least every ~30 ms)
      let t = performance.now(); const bf = (z) => S.builder.bufFor(z), pause = async () => { if (performance.now() - t > 30) { await yieldNow(); t = performance.now(); } };
      for (let i = 0; i < S.stock.list.length; i += 24) { S.stock.emit(bf, i, i + 24); await pause(); }
      S.root.add(await S.builder.finishAsync(pause));
    }
    lap(TM, 'stock'); this.scene.add(S.root); this.root = S.root;
    // lights: the sky/ground fill and one key light whose shadow map covers the whole store and is drawn once
    const hemi = this.hemi = new THREE.HemisphereLight(0xdfe6ff, 0xa89478, 0.3); this.scene.add(hemi);
    const key = this.key = new THREE.DirectionalLight(0xffe9c8, 2.0); key.castShadow = true; this.scene.add(key, key.target);
    const W = m(layout.board.w), Hh = m(layout.board.h), c = new THREE.Vector3(W / 2, 0, Hh / 2), sz = this.mobile ? 2048 : 4096;
    key.shadow.mapSize.set(sz, sz); Object.assign(key.shadow.camera, { left: -23, right: 23, top: 23, bottom: -23, near: 1, far: 160 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 2; key.shadow.intensity = 1.0;
    key.target.position.copy(c); key.position.copy(c).addScaledVector(KEY_DIR, 70); key.target.updateMatrixWorld(); key.updateMatrixWorld(); key.shadow.camera.updateProjectionMatrix();
    key.shadow.autoUpdate = false; key.shadow.needsUpdate = true;   // static: drawn on the first frame only
    lap(TM, 'structureLights'); await yieldNow(); this.buildSidewalk(concD, concN); lap(TM, 'sidewalk'); this.buildDecals(whiteUV); lap(TM, 'decals'); await yieldNow(); this.buildItems(); this.buildHighlight(); lap(TM, 'items');
    await Promise.all([this.loadPeople(), this.loadItemModels()]); lap(TM, 'people'); await yieldNow();
    this.applyTune();   // the store's light and colour (TUNE): the game uses exactly what the preview page shows
    this.resize(this.view.w, this.view.h);
    return this;
  }

  applyTune(t = TUNE) {
    t = { ...TUNE, ...t };
    this.look.m.fin.uniforms.uSat.value = t.sat; this.look.m.fin.uniforms.uContrast.value = t.con;
    this.key.intensity = t.key; this.hemi.intensity = t.hemi; this.scene.environmentIntensity = t.env; this.renderer.toneMappingExposure = t.ex; this.mats.floor.lightMapIntensity = t.lm;
    this.look.m.fin.uniforms.uBloom.value = t.bloom; this.look.m.pre.uniforms.uThreshold.value = t.bt; this.look.m.pre.uniforms.uKnee.value = 0.5;
  }
  // the floor's baked light: ambient occlusion from the mask (a soft contact shadow where shelves, counters and walls meet the tile)
  // and the soft pools of the ceiling lights (warm, as in the first 3D store the owner was shown)
  bakeFloorLight() {
    // (blurred in plain JS, three box blurs per axis ~ a gaussian: the canvas 'blur()' filter took 2.3 s here on a software-drawn canvas)
    const { board, field } = this.layout, mw = board.mw, mh = board.mh, K = 2, W = mw * K, H = mh * K, src = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) src[y * W + x] = field[(y / K) | 0][(x / K) | 0] === '0' ? 0 : 1;
    const boxBlur = (a, r) => {
      const t = new Float32Array(a.length), o = new Float32Array(a.length), n = 2 * r + 1;
      for (let y = 0; y < H; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += a[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x++) { t[y * W + x] = acc / n; acc += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)]; } }
      for (let x = 0; x < W; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += t[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y++) { o[y * W + x] = acc / n; acc += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x]; } }
      return o;
    };
    const gauss = (a, sigma) => { const r = Math.max(1, Math.round(sigma * 0.93)); return boxBlur(boxBlur(boxBlur(a, r), r), r); };
    const wide = gauss(src, 9), tight = gauss(src, 2.5), b = document.createElement('canvas'); b.width = W; b.height = H;
    const bg = b.getContext('2d'), id = bg.createImageData(W, H), d = id.data;
    for (let i = 0; i < W * H; i++) { const v = wide[i] * tight[i], a = 0.4 + 0.6 * Math.pow(v, 0.9), q = a * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = q; d[i * 4 + 3] = 255; }
    bg.putImageData(id, 0, 0);
    const ao = T.tex(b, { srgb: false, aniso: 1 }); ao.channel = 1;
    const l = document.createElement('canvas'); l.width = 214; l.height = 461; const lg = l.getContext('2d'); lg.fillStyle = '#000'; lg.fillRect(0, 0, 214, 461);
    const sx = 214 / m(board.w), sz = 461 / m(board.h);
    for (let zi = 0; zi < 10; zi++) for (let xi = 0; xi < 4; xi++) {
      const x = 2.6 + xi * 4.5 + (zi % 2) * 2.0, z = 4.5 + zi * 4.2, gr = lg.createRadialGradient(x * sx, z * sz, 0, x * sx, z * sz, 3.4 * sx);
      gr.addColorStop(0, 'rgba(255,226,170,0.62)'); gr.addColorStop(0.55, 'rgba(255,226,170,0.2)'); gr.addColorStop(1, 'rgba(255,238,205,0)'); lg.fillStyle = gr; lg.globalCompositeOperation = 'lighter'; lg.fillRect(0, 0, 214, 461);
    }
    const lt = T.tex(l, { aniso: 1 }); lt.channel = 1;
    return { aoMap: ao, lightMap: lt, lampVis: this.bakeLampShadows() };
  }

  /** The shadows the ceiling lamps throw on the floor (Nov 23 2026, owner: overhead lighting with real shadows). Every lamp of the light pools
   *  above sits LAMP_H up; for each floor texel the ray to the lamp (5 points across the lamp so the edge is soft) is walked over the mask and
   *  is cut where a blocked cell (shelf, counter, wall: OCC_H high) stands in front of it. The texel's light is (ambient + sum of lamp falloff x
   *  how much of the lamp it sees) over (ambient + sum of lamp falloff): 1 in the open, lower in a shelf's shade. Static, so baked once.
   *  Returns a texture (red = 1 lit .. lower = shaded) on the floor's second UV set, multiplied into the floor's colour in the shader. */
  bakeLampShadows() {
    const { board, field } = this.layout, mw = board.mw, mh = board.mh, K = 2, W = mw * K, H = mh * K, bw = m(board.w), bh = m(board.h), LAMP_H = LAMP.h, OCC_H = LAMP.occ, R = LAMP.reach;
    const blocked = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) blocked[y * W + x] = field[(y / K) | 0][(x / K) | 0] === '0' ? 1 : 0;
    const lamps = []; for (let zi = 0; zi < 10; zi++) for (let xi = 0; xi < 4; xi++) lamps.push([2.6 + xi * 4.5 + (zi % 2) * 2.0, 4.5 + zi * 4.2]);
    const E = new Float32Array(W * H), N = new Float32Array(W * H), px = W / bw, pz = H / bh, off = [[0, 0], [0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55]];
    for (const [lx, lz] of lamps) {
      const x0 = Math.max(0, Math.floor((lx - R) * px)), x1 = Math.min(W - 1, Math.ceil((lx + R) * px)), z0 = Math.max(0, Math.floor((lz - R) * pz)), z1 = Math.min(H - 1, Math.ceil((lz + R) * pz));
      for (let zt = z0; zt <= z1; zt++) for (let xt = x0; xt <= x1; xt++) {
        const wx = (xt + 0.5) / px, wz = (zt + 0.5) / pz, d = Math.hypot(wx - lx, wz - lz); if (d >= R) continue;
        const f = 1 - (d / R) * (d / R), w = f * f, i = zt * W + xt; N[i] += w;
        if (blocked[i]) { E[i] += w; continue; }   // under a fixture: not seen, left unshaded
        let vis = 0;
        for (const [ox, oz] of off) {
          const tx = lx + ox, tz = lz + oz, steps = Math.max(4, Math.ceil(Math.hypot(tx - wx, tz - wz) * 6)); let seen = 1;
          for (let k = 1; k < steps; k++) { const t = k / steps; if (t * LAMP_H > OCC_H) break; const cx = Math.floor((wx + (tx - wx) * t) * px), cz = Math.floor((wz + (tz - wz) * t) * pz); if (cx >= 0 && cz >= 0 && cx < W && cz < H && blocked[cz * W + cx]) { seen = 0; break; } }
          vis += seen;
        }
        E[i] += w * vis / off.length;
      }
    }
    const b = document.createElement('canvas'); b.width = W; b.height = H; const bg = b.getContext('2d'), id = bg.createImageData(W, H), d = id.data;
    for (let i = 0; i < W * H; i++) { const lit = N[i] > 0 ? (LAMP.ambient + E[i]) / (LAMP.ambient + N[i]) : 1, q = (1 - LAMP.strength * (1 - lit)) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = q; d[i * 4 + 3] = 255; }
    bg.putImageData(id, 0, 0); const t = T.tex(b, { srgb: false, aniso: 1 }); t.channel = 1; return t;
  }

  makeEnvironment() {
    const room = new THREE.Scene(), box = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: 0xcdd3dc, side: THREE.BackSide })); room.add(box);
    for (let i = -2; i <= 2; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 6.8, 6.4), side: THREE.DoubleSide })); s.rotation.x = Math.PI / 2; s.position.set(i * 5, 5.8, 0); room.add(s); }
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0xcdc0b4 })); fl.rotation.x = -Math.PI / 2; fl.position.y = -5.9; room.add(fl);
    const pm = new THREE.PMREMGenerator(this.renderer), rt = pm.fromScene(room, 0.04); pm.dispose(); return rt.texture;
  }

  /** outside the storefront: a concrete sidewalk in 1.5 m slabs with tooled joints, a granite curb, the gutter and a strip of asphalt */
  buildSidewalk(concD, concN) {
    const L = this.layout, W = m(L.board.w), z0 = this.structure.info.storefront.z + 0.06, zc = z0 + 3.1, zEnd = m(L.board.h) + 0.6;
    const img = concD.image, N = 512, c = document.createElement('canvas'); c.width = N; c.height = N; const g = c.getContext('2d');
    g.filter = 'grayscale(0.85) brightness(1.05)'; g.drawImage(img, 0, 0, N, N); g.filter = 'none'; g.fillStyle = 'rgba(150,152,156,0.3)'; g.fillRect(0, 0, N, N);   // a neutral grey concrete (the source is warm)
    g.strokeStyle = 'rgba(60,56,52,0.75)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, N - 3, N - 3);   // the tooled joint round each slab
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; g.strokeRect(5, 5, N - 10, N - 10);
    const t = T.tex(c, { repeat: true, aniso: 8 });
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(W + 2, zc - z0), new THREE.MeshStandardMaterial({ map: t, normalMap: concN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92, metalness: 0 }));
    walk.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v * (i % 2 ? (zc - z0) / 1.5 : (W + 2) / 1.5); });
    walk.rotation.x = -Math.PI / 2; walk.position.set(W / 2, -0.004, (z0 + zc) / 2); walk.receiveShadow = true; this.root.add(walk);
    const buf = new GeoBuf(), wuv = [0.5, 0.5];
    buf.box(['#b9b6b0', 0.85, 0], -1, -0.004, zc, W + 1, 0.0, zc + 0.3, { skip: 'ny', white: wuv });                     // the curb's top
    buf.box(['#8d8a85', 0.9, 0], -1, -0.16, zc + 0.3, W + 1, 0.0, zc + 0.32, { skip: 'ny', white: wuv });                 // the curb's face
    buf.box(['#6f6c68', 0.9, 0], -1, -0.18, zc + 0.32, W + 1, -0.16, zc + 0.7, { skip: 'ny', white: wuv });               // the gutter
    buf.box(['#2c2e33', 0.95, 0], -1, -0.2, zc + 0.7, W + 1, -0.18, zEnd, { skip: 'ny', white: wuv });                    // asphalt
    buf.box(['#e8d36a', 0.7, 0], -1, -0.18, zc + 1.05, W + 1, -0.177, zc + 1.15, { skip: 'ny', white: wuv });             // the parking line
    const curb = new THREE.Mesh(buf.build(), this.mats.paint); curb.receiveShadow = true; this.root.add(curb);
  }

  /** every sign, poster, plate and mat lettering: one mesh on one atlas (textures.js decalAtlas) */
  buildDecals(whiteUV) {
    const info = this.structure.info, L = this.layout, entries = [];
    info.signs.forEach((s, i) => entries.push({ name: 'sign' + i, w: 768, h: Math.max(64, Math.round(768 * s.h / s.w)), draw: (g, w, h) => T.drawSign(g, w, h, s.text) }));
    entries.push({ name: 'exit', w: 256, h: 96, draw: (g, w, h) => T.drawPlate(g, w, h, 'EXIT', { bg: '#b3202a', fg: '#fff', border: '#f5c518' }) });
    for (const k of ['sale', 'fresh', 'cold', 'eat']) entries.push({ name: 'poster_' + k, w: 256, h: 340, draw: (g, w, h) => T.drawPoster(g, w, h, k) });
    entries.push({ name: 'matEntrance', w: 256, h: 240, draw: (g, w, h) => T.drawPlate(g, w, h, 'ENTRANCE', { bg: '#a82020', fg: '#f3c34a', border: '#f3c34a' }) });
    entries.push({ name: 'matExit', w: 256, h: 240, draw: (g, w, h) => T.drawPlate(g, w, h, 'EXIT', { bg: '#a82020', fg: '#f3c34a', border: '#f3c34a' }) });
    const A = this.decalAtlas = T.decalAtlas(entries, this.mobile ? 4 : 8), wd = A.white, buf = new GeoBuf();
    // header signs: a pink board, the lettered face toward the camera (+z)
    info.signs.forEach((s, i) => buf.box(['#ffffff', 0.4, 0, 0.55], s.x - s.w / 2, s.y - s.h / 2, s.z - 0.03, s.x + s.w / 2, s.y + s.h / 2, s.z + 0.03, { skip: '', white: wd, uv: { pz: A.cell('sign' + i) } }));
    info.signs.forEach((s) => { const p = ['#9a1a4d', 0.5, 0]; buf.box(p, s.x - s.w / 2 - 0.004, s.y - s.h / 2, s.z - 0.031, s.x + s.w / 2 + 0.004, s.y + s.h / 2 + 0.004, s.z + 0.029, { skip: 'pz', white: wd }); });
    // the EXIT sign over the door
    { const ex = info.exit; buf.box(['#ffffff', 0.4, 0, 0.9], ex.x - 0.45, 2.45, ex.z + 0.05, ex.x + 0.45, 2.79, ex.z + 0.13, { skip: '', white: wd, uv: { pz: A.cell('exit') } }); }
    // posters on the north wall (the wall's south face is at board y 100)
    [[1.4, 'sale'], [3.6, 'fresh'], [5.8, 'cold'], [7.6, 'eat']].forEach(([x, k]) => buf.box(['#ffffff', 0.6, 0, 0.12], x - 0.31, 1.94, m(100), x + 0.31, 2.76, m(100) + 0.012, { skip: '', white: wd, uv: { pz: A.cell('poster_' + k) } }));
    // floor lettering: the two door mats' tops (the painted store's ENTRANCE mat in the east lane, by the registers, is left out: there is no door there)
    for (const mt of info.mats) { const [x0, z0, x1, z1, y] = mt.rect, c = A.cell(mt.name), e = 0.05; buf.quad([x0 + e, y, z1 - e], [x1 - e, y, z1 - e], [x1 - e, y, z0 + e], [x0 + e, y, z0 + e], [0, 1, 0], [[c[0], c[1]], [c[2], c[1]], [c[2], c[3]], [c[0], c[3]]], new THREE.Color(1, 1, 1), [0.95, 0, 0]); }
    const mesh = this.decals = new THREE.Mesh(buf.build(), paintMaterial(A.map, { envMapIntensity: 0.6 })); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'decals'; this.root.add(mesh);
    // the PAY markings (shown when the list is done): one mesh, painted on the tile, steady
    const pb = new GeoBuf();
    for (const [x0, y0, x1, y1] of L.PADS) pb.quad([m(x0), 0.008, m(y1)], [m(x1), 0.008, m(y1)], [m(x1), 0.008, m(y0)], [m(x0), 0.008, m(y0)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], new THREE.Color(1, 1, 1), [0.55, 0, 0.12]);
    const padTex = T.padTexture();
    this.padMesh = new THREE.Mesh(pb.build(), paintMaterial(padTex, { transparent: true, alphaTest: 0.02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.padMesh.visible = false; this.padMesh.receiveShadow = true; this.padMesh.renderOrder = 1; this.root.add(this.padMesh);
  }

  buildItems() {
    // the pickups on a soft gold ring, a little larger than life so they read from above. Built here first from procedural shapes
    // (pickups.js: CHIPS, CHICKEN, LEMONADE; products.js: the rest), then loadItemModels() swaps in the scanned models where it can.
    const L = this.layout, glow = this.glow = T.glowTexture(), ring = this.ringTex = T.ringTexture();
    const KINDS = this.ITEM_KINDS = { APPLE: [['apple', { body: '#c8282b' }]], CHIPS: [['chipsBag', {}]], CHICKEN: [['roastChicken', {}]], LEMONADE: [['lemonBottle', {}]], BREAD: [['loaf', { label: 'bread', body: '#c98a3c' }]], MILK: [['jug', { label: 'milk', cap: '#2f6fd6' }]], 'RICE & BEANS': [['sack', { label: 'rice', body: '#f4d27a' }], ['can', { label: 'beans', body: '#b3322b' }]] };
    this.itemGroup = new THREE.Group(); this.root.add(this.itemGroup);
    const ringMat = new THREE.MeshBasicMaterial({ map: ring, color: new THREE.Color(1.5, 1.2, 0.35), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    const shMat = new THREE.MeshBasicMaterial({ map: glow, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
    for (const it of L.items) {
      const g = new THREE.Group(), x = m(it.sx ?? it.x), z = m(it.sy ?? it.y); g.position.set(x, 0, z); g.userData.id = it.id; g.visible = false;
      const inner = new THREE.Group(); g.add(inner);
      (KINDS[it.id] || []).forEach(([k, o], i) => {
        const own = PICKUP_KINDS.includes(k), geo = withRM((own ? pickupGeometry(k, o) : productGeometry(k, o)).clone()); geo.computeBoundingBox();
        const bb = geo.boundingBox, hgt = bb.max.y, tgt = { apple: 0.42, can: 0.45, sack: 0.62 }[k] || 0.66, mesh = new THREE.Mesh(geo, this.mats.paint);
        // the pickups' own models are also held to ITEM_W across (the roast chicken's tray is wide and low)
        mesh.scale.setScalar(own ? Math.min(tgt / hgt, ITEM_W / Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)) : tgt / hgt);
        mesh.position.x = it.id === 'RICE & BEANS' ? (i ? 0.34 : -0.22) : 0; inner.add(mesh);
      });
      const ringM = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), ringMat.clone()); ringM.rotation.x = -Math.PI / 2; ringM.position.y = 0.014; g.add(ringM);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), shMat); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; g.add(shadow);
      g.userData.inner = inner; g.userData.ring = ringM; g.userData.top = Math.max(...inner.children.map((q) => q.scale.y * q.geometry.boundingBox.max.y)); this.itemGroup.add(g); this.items.push(g);
    }
  }
  /**
   * The scanned pickups (items/items.glb, Poly Haven CC0, credits in items/CREDITS.txt): ITEM_MODELS says which pieces make each
   * pickup. A pickup whose pieces all loaded gets them in place of its procedural shape; if the file fails to load (or takes over
   * ITEM_LOAD_MS), or a piece is missing, that pickup simply keeps the shape buildItems() gave it. Never throws.
   */
  async loadItemModels() {
    let gltf;
    try {
      const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
      gltf = await Promise.race([loader.loadAsync(new URL('items/items.glb', import.meta.url).href), new Promise((_, no) => setTimeout(() => no(new Error('items.glb: timed out')), ITEM_LOAD_MS))]);
    } catch (e) { this.itemModels = { error: String(e && e.message || e) }; return; }
    const piece = {}; gltf.scene.traverse((o) => { if (o.isMesh) piece[o.name] = o; });
    const used = [];
    for (const g of this.items) {
      const spec = ITEM_MODELS[g.userData.id]; if (!spec) continue;
      if (!spec.parts.every((p) => !p.glb || piece[p.glb])) continue;
      const model = new THREE.Group();
      for (const p of spec.parts) {
        let o;
        if (p.glb) {   // (its own node transform stays: the meshopt build stores the positions quantized and undoes that there)
          o = piece[p.glb]; o.removeFromParent(); o.castShadow = false; o.receiveShadow = false; o.material.envMapIntensity = 0.8;
        } else {   // a procedural piece kept from buildItems (RICE & BEANS: the rice sack); it keeps its size
          o = g.userData.inner.children[p.keep]; if (!o) continue; o.position.set(0, 0, 0);
        }
        // turn the piece (rot), sit it on the floor centred, then scale (s) and place (at) it
        const spin = new THREE.Group(), holder = new THREE.Group(); spin.add(o); spin.rotation.set(...(p.rot || [0, 0, 0])); holder.add(spin);
        holder.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(spin), c = bb.getCenter(new THREE.Vector3());
        spin.position.set(-c.x, -bb.min.y, -c.z); holder.scale.setScalar(p.s ?? 1); holder.position.set(...(p.at || [0, 0, 0]));
        model.add(holder);
      }
      model.updateMatrixWorld(true); g.userData.top = new THREE.Box3().setFromObject(model).max.y;   // (measured before it is parented: no bob, no grow-in scale)
      const inner = g.userData.inner; inner.clear(); inner.add(model); used.push(g.userData.id);
    }
    this.itemModels = { used };
  }
  /** the shelf highlight (where the active item sits on its shelf) and the lunge cue ring: soft floor-level shapes, steady */
  buildHighlight() {
    const hm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.3), transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, map: this.glow });
    this.hl = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hm); this.hl.visible = false; this.hl.renderOrder = 3; this.root.add(this.hl);
    const lm = new THREE.MeshBasicMaterial({ map: this.ringTex, color: new THREE.Color(0.95, 0.12, 0.14), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.lungeRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lm); this.lungeRing.rotation.x = -Math.PI / 2; this.lungeRing.visible = false; this.lungeRing.renderOrder = 2; this.root.add(this.lungeRing);
  }

  async loadPeople() {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(new URL('character.glb', this.base).href);
    gltf.scene.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial) { o.material.roughness = 0.82; o.material.envMapIntensity = 0.85; } });   // real.js upgradeCharacter
    const walk0 = gltf.animations.find((a) => a.name === 'walk'), clips = { walk: addArmSwing(walk0, gltf.scene, ARMS.walk), run: addArmSwing(makeRunClip(walk0), gltf.scene, ARMS.run), stand: makeStandClip(walk0) };
    this.shadowCam = new THREE.Camera(); this.shadowCam.matrixAutoUpdate = false; this.shadowCam.layers.set(1);
    this.shadowWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mk = (bully) => {
      const o = SkeletonUtils.clone(gltf.scene), h = bully ? BULLY_H : PLAYER_H; o.scale.setScalar(h / MODEL_H);
      o.traverse((q) => { if (q.isMesh) { q.castShadow = false; q.receiveShadow = true; q.frustumCulled = false; q.layers.enable(1); if (bully) q.material = makeBullyMaterial(q.material); } });
      const mixer = new THREE.AnimationMixer(o), act = {}; for (const k of ['stand', 'walk', 'run']) { act[k] = mixer.clipAction(clips[k]); act[k].play(); }
      // A thin outline where the store hides a person (tools-store3d/occlusion.mjs: a few lanes can hide all of them): only the rim of the
      // body, only where it is behind something, in a steady colour. Never a filled shape.
      const xm = new THREE.MeshBasicMaterial({ color: bully ? 0xff6a5a : 0xffd84a, transparent: true, opacity: 0.95, depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false, toneMapped: false });
      xm.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNv;').replace('#include <project_vertex>', '#include <project_vertex>\nvNv = normalize(normalMatrix * objectNormal);\ngl_Position.z -= 0.011 * gl_Position.w;');   // ~0.5 m toward the camera: an arm or leg behind the other is not "hidden"
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vNv;').replace('#include <opaque_fragment>', 'float rim = 1.0 - abs(normalize(vNv).z);\ndiffuseColor.a *= smoothstep(0.72, 0.92, rim);\n#include <opaque_fragment>');
      };
      xm.customProgramCacheKey = () => 'store3d-outline';
      const xr = []; o.traverse((q) => { if (q.isSkinnedMesh) xr.push(q); });
      for (const q of xr) { const x = new THREE.SkinnedMesh(q.geometry, xm); x.bind(q.skeleton, q.bindMatrix); x.frustumCulled = false; x.renderOrder = 20; x.name = 'xray'; q.parent.add(x); }
      const g = new THREE.Group(); g.add(o);
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.glow, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; blob.scale.set(h * 0.5, h * 0.34, 1); g.add(blob);
      // the cast shadow: a 128 px target the body is flattened into along the key light, laid on the floor (see renderShadows)
      const rt = new THREE.WebGLRenderTarget(128, 128, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      const HS = 1.7, sh = new THREE.Mesh(new THREE.PlaneGeometry(HS * 2, HS * 2), new THREE.MeshBasicMaterial({ color: 0x0a0c18, alphaMap: rt.texture, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      sh.rotation.x = -Math.PI / 2; sh.renderOrder = 1; this.root.add(sh);
      this.root.add(g); return { g, o, mixer, act, h, dur: walk0.duration, rt, sh, HS };
    };
    this.actors.player = mk(false); this.actors.bully = mk(true);
  }
  /** flatten each visible person into their shadow target along the key light (only they move, so only they cast live shadows) */
  renderShadows() {
    const r = this.renderer, sc = this.scene, kx = KEY_DIR.x / KEY_DIR.y, kz = KEY_DIR.z / KEY_DIR.y, bg = sc.background, env = sc.environment, ov = sc.overrideMaterial, prevRT = r.getRenderTarget();
    sc.background = null; sc.overrideMaterial = this.shadowWhite; const smOn = r.shadowMap.enabled; r.shadowMap.enabled = false;   // the static shadow map is not touched by this pass
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(); r.setClearColor(0x000000, 1);
    for (const a of Object.values(this.actors)) {
      a.sh.visible = a.g.visible; if (!a.g.visible) continue;
      const cx = a.g.position.x - kx * 0.75, cz = a.g.position.z - kz * 0.75, hs = a.HS;
      a.sh.position.set(cx, 0.011, cz);
      this.shadowCam.projectionMatrix.set(1 / hs, -kx / hs, 0, -cx / hs, 0, kz / hs, -1 / hs, cz / hs, 0, 0, 0, 0, 0, 0, 0, 1);
      for (const b of Object.values(this.actors)) b.g.visible = b === a;   // only this person in this target
      r.setRenderTarget(a.rt); r.clear(); r.render(sc, this.shadowCam);
      for (const b of Object.values(this.actors)) b.g.visible = b.vis !== false;
    }
    sc.background = bg; sc.environment = env; sc.overrideMaterial = ov; r.shadowMap.enabled = smOn; r.setClearColor(cc, ca); r.setRenderTarget(prevRT);
  }

  /** place a person: board px (their feet), facing U/D/L/R or a yaw in radians, moving 0..1 (walk/run mix from speed), phase in seconds */
  setActor(which, bx, by, face = 'D', moving = 0, phase = 0, run = 0.5) {
    const a = this.actors[which]; if (!a) return; a.vis = true; a.g.visible = true; a.g.position.set(m(bx), 0, m(by)); a.o.rotation.y = typeof face === 'number' ? face : (FACE_YAW[face] ?? 0);
    a.act.stand.setEffectiveWeight(1 - moving); a.act.walk.setEffectiveWeight(moving * (1 - run)); a.act.run.setEffectiveWeight(moving * run);
    a.mixer.setTime(((phase % a.dur) + a.dur) % a.dur); a.o.updateMatrixWorld(true);
  }
  setXray(on) { for (const a of Object.values(this.actors)) a.o.traverse((q) => { if (q.name === 'xray') q.visible = !!on; }); }
  hideActor(which) { const a = this.actors[which]; if (a) { a.vis = false; a.g.visible = false; a.sh.visible = false; } }
  /** which pickups to show: 'all', an id, or null; at: the game's own spot for it, board px {x, y} (else where layout.json has it) */
  setItems(which, at = null) { for (const g of this.items) { g.visible = which === 'all' || g.userData.id === which; if (g.visible && at) g.position.set(m(at.x), 0, m(at.y)); } }
  setPay(on) { this.padMesh.visible = !!on; }
  /** a soft gold glow on the shelf edge where the active item came from: board rect {x,y,w,h} or null; k 0..1 its strength */
  setHighlight(rect, k = 1) {
    if (!rect || k <= 0) { this.hl.visible = false; return; }
    const f = this.structure.info.fixtures.find((q) => rect.x + rect.w / 2 >= q.rect[0] && rect.x + rect.w / 2 <= q.rect[2] && rect.y + rect.h / 2 >= q.rect[1] - 40 && rect.y + rect.h / 2 <= q.rect[3] + 40);
    const zf = f ? f.box[3] + 0.02 : m(rect.y + rect.h), x = m(rect.x + rect.w / 2), w = m(rect.w) + 0.5;
    this.hl.visible = true; this.hl.position.set(x, 0.95, zf); this.hl.scale.set(w, 1.4, 1); this.hl.material.opacity = 0.55 * k;
  }
  /**
   * the bully's lunge wind-up cue: a soft red ring on the floor under him. a: how much of it shows, 0..1, which the game EASES in and out
   * (about 0.1 s each way), so it never pops on or off; w: how far the wind-up is, 0..1: the ring draws in a little (no colour or brightness
   * change from it). Steady while it is up: nothing pulses. a <= 0.01 hides it.
   */
  setLunge(bx, by, a, w = 0) {
    if (!(a > 0.01)) { this.lungeRing.visible = false; return; }
    const s = 1.9 - 0.35 * w; this.lungeRing.visible = true; this.lungeRing.position.set(m(bx), 0.016, m(by)); this.lungeRing.scale.set(s, s * 0.62, 1); this.lungeRing.material.opacity = 0.7 * a;
  }
  /** how high the top of a pickup floats (m, above the floor) at time t: for the 2D label over it */
  itemTop(id, t, motion = true) { const g = this.items.find((q) => q.userData.id === id); return g ? 0.32 + (motion ? 0.05 * Math.sin(t * Math.PI * 0.9) : 0) + g.userData.top : 1; }
  /** a newly live pickup grows out of the floor: s 0..1 (the game's REVEAL tween) */
  setItemScale(s) { for (const g of this.items) g.userData.inner.scale.setScalar(Math.max(0.001, s)); }

  /** the 2D camera (placeView) for a player at board (px, py): the board point that sits at the middle of the screen */
  centreFor(px, py, vw = this.view.w, vh = this.view.h) {
    const { board, camera } = this.layout, sc = Math.max(Math.min(vw / board.w, vh / board.h), Math.min(camera.zoomScale, vw / 480)), W = board.w * sc, H = board.h * sc;
    const tx = W <= vw ? (vw - W) / 2 : Math.min(0, Math.max(vw - W, vw / 2 - px * sc)), ty = H <= vh ? (vh - H) / 2 : Math.min(0, Math.max(vh - H, vh * camera.followY - py * sc));
    return { x: (vw / 2 - tx) / sc, y: (vh / 2 - ty) / sc, scale: sc, tx, ty };
  }
  setCamera(px, py) { this.setView(this.centreFor(px, py)); }
  /** the camera from the 2D view itself: screen = board * scale + (tx, ty) (csd.js placeView), so the 3D floor lies exactly under the 2D layers */
  setView(c) {
    if (c.x == null) c = { ...c, x: (this.view.w / 2 - c.tx) / c.scale, y: (this.view.h / 2 - c.ty) / c.scale };
    const T0 = new THREE.Vector3(m(c.x), 0, m(c.y)), cam = this.camera, { w, h } = this.view;
    cam.position.set(T0.x, T0.y + DIST * Math.sin(ELEV), T0.z + DIST * Math.cos(ELEV)); cam.up.set(0, 1, 0); cam.lookAt(T0);
    const n = DIST - 45, f = DIST + 45, a = 2 * (c.scale * PX) * DIST / w, b = a * (w / h) / Math.sin(ELEV);   // floor: c.scale*PX CSS px per metre in x, and the same in z (the 1/sin is the anamorphic stretch)
    cam.near = n; cam.far = f; cam.updateMatrixWorld(true);
    cam.projectionMatrix.set(a, 0, 0, 0, 0, b, 0, 0, 0, 0, -(f + n) / (f - n), -2 * f * n / (f - n), 0, 0, -1, 0); cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.centre = c;
  }
  resize(w, h) {
    this.view = { w, h }; this.renderer.setSize(w, h, false); this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; this.look.resize();
  }
  /** world -> CSS px on screen (for the alignment check and overlays) */
  project(x, y, z) { const v = new THREE.Vector3(x, y, z).project(this.camera); return [(v.x * 0.5 + 0.5) * this.view.w, (-v.y * 0.5 + 0.5) * this.view.h]; }
  /** draw a frame. dt advances the store's own clock; or pass t (the game's clock) to set it, so the 2D layers above can match the bob */
  render(dt = 0, motion = true, t = null) {
    this.t = t == null ? this.t + dt : t;
    // the pickups' ring: a slow smooth swell (0.5 a second, never a hard on/off); the product bobs gently. Reduced motion: both still.
    const sw = motion ? 0.5 + 0.5 * Math.sin(this.t * Math.PI) : 0.5;
    for (const g of this.items) if (g.visible) { g.userData.ring.material.opacity = 0.55 + 0.25 * sw; g.userData.inner.position.y = 0.32 + (motion ? 0.05 * Math.sin(this.t * Math.PI * 0.9) : 0); }
    this.renderer.info.reset();
    withoutRandom(() => { this.renderShadows(); this.look.render(); });
  }
  stats() { const i = this.renderer.info; return { triangles: i.render.triangles, calls: i.render.calls, geometries: i.memory.geometries, textures: i.memory.textures, stock: this.structure.info.stockCount }; }
}
