// The Corner Store's inside, in real-time 3D, in the realistic look of the street (public/drive: real-post.js is the same look pass,
// character.glb + people.js the same two people). Phase 1: a standalone preview, not linked from the game; it sits exactly on the
// layout of the painted board (layout.json) and frames it the way the 2D camera does (placeView), so the game plays the same.
import * as THREE from '../drive/vendor/three.module.min.js';
import { GLTFLoader } from '../drive/vendor/GLTFLoader.js';
import { MeshoptDecoder } from '../drive/vendor/meshopt_decoder.module.js';
import * as SkeletonUtils from '../drive/vendor/SkeletonUtils.js';
import { RealLook } from '../drive/real-post.js';
import { makeBullyMaterial, makeStandClip, makeRunClip, addArmSwing, ARMS, MODEL_H, PLAYER_H, BULLY_H } from '../drive/people.js';
import * as T from './textures.js';
import { useAtlas, productGeometry } from './products.js';
import { buildStructure, PX, m } from './structure.js';

const ELEV = 45 * Math.PI / 180, DIST = 300, SCALE2D = 0.8;   // camera elevation, distance (a long lens: close to orthographic), 2D zoom (board px -> CSS px)
const FACE_YAW = { U: Math.PI, D: 0, L: -Math.PI / 2, R: Math.PI / 2 };   // character.glb faces +z (the camera) at yaw 0

export class Store3D {
  constructor(canvas, { layout, base = new URL('../drive/', import.meta.url).href, mobile = false, pixelRatio } = {}) {
    this.layout = layout; this.base = base; this.mobile = mobile; this.canvas = canvas; this.t = 0;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(pixelRatio ?? Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0d1020);
    this.camera = new THREE.PerspectiveCamera(10, 1, 1, 1000);
    this.look = new RealLook(r, this.scene, this.camera, { mobile });
    this.look.fx.haze = false; this.look.m.ao.uniforms.uFade.value = 1e6;   // indoors: no aerial haze; the AO must not fade with the long lens's distance
    this.look.m.ao.uniforms.uRadius.value = 0.9; this.look.m.ao.uniforms.uPower.value = 1.5; this.look.m.fin.uniforms.uAoMix.value = 0.9;
    this.look.m.fin.uniforms.uSat.value = 1.04; this.look.m.fin.uniforms.uContrast.value = 0.1;
    this.actors = {}; this.items = []; this.pads = []; this.anim = { player: 0, bully: 0 };
    this.view = { w: 390, h: 844 };
  }

  async init() {
    const { layout } = this, aniso = this.mobile ? 4 : 8;
    // ---- textures and materials
    const loader = new THREE.TextureLoader(), conc = (f, srgb) => loader.loadAsync(new URL('tex/real/' + f, this.base).href).then((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; });
    const [concD, concN] = await Promise.all([conc('conc_d.webp', true), conc('conc_n.webp', false)]);
    const floorT = T.floorTextures(aniso), atlas = T.labelAtlas(aniso); useAtlas(atlas); this.atlas = atlas;
    const { aoMap, lightMap } = this.bakeFloorLight();
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const mats = this.mats = {
      default: std({ color: 0x888888 }),
      floor: std({ map: floorT.map, normalMap: floorT.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: floorT.roughnessMap, roughness: 1, metalness: 0, aoMap, aoMapIntensity: 1.0, lightMap, lightMapIntensity: 1.0, envMapIntensity: 0.55 }),
      wall: std({ map: concD, normalMap: concN, normalScale: new THREE.Vector2(0.6, 0.6), color: new THREE.Color(0.28, 0.33, 0.62), roughness: 0.9, metalness: 0 }),
      rail: std({ color: 0x3a3d4a, roughness: 0.7, metalness: 0.2 }),
      base: std({ color: 0x1d2140, roughness: 0.55, metalness: 0.15 }),
      steel: std({ color: 0x353b61, roughness: 0.42, metalness: 0.55 }),
      cooler: std({ color: 0xe3e9ef, roughness: 0.34, metalness: 0.25 }),
      coolerbase: std({ color: 0x9fb0c2, roughness: 0.4, metalness: 0.2 }),
      back: std({ color: 0x4a527d, roughness: 0.7, metalness: 0.1 }),
      plank: std({ color: 0xcfd4de, roughness: 0.38, metalness: 0.35 }),
      wood: std({ color: 0xb78a55, roughness: 0.78, metalness: 0 }),
      lip: std({ color: 0xf6efc0, roughness: 0.5, metalness: 0 }),
      trimBlue: std({ color: 0x2f6fd6, roughness: 0.35, metalness: 0.2 }), trimRed: std({ color: 0xc1272d, roughness: 0.35, metalness: 0.2 }), trimGold: std({ color: 0xf5c518, roughness: 0.3, metalness: 0.6 }),
      chrome: std({ color: 0xcfd4da, roughness: 0.22, metalness: 1.0, envMapIntensity: 1.2 }),
      lam: std({ color: 0x232b57, roughness: 0.42, metalness: 0.1 }), top: std({ color: 0xdfe3ea, roughness: 0.3, metalness: 0.05 }),
      belt: std({ color: 0x17181c, roughness: 0.85, metalness: 0 }), dark: std({ color: 0x15171d, roughness: 0.5, metalness: 0.3 }),
      screen: std({ color: 0x0a1a38, emissive: 0x2a72d6, emissiveIntensity: 1.6, roughness: 0.2 }), lamp: std({ color: 0x103018, emissive: 0x35d070, emissiveIntensity: 1.8, roughness: 0.3 }),
      door: std({ color: 0x24160f, roughness: 0.6, metalness: 0.1 }), doorframe: std({ color: 0xe0a01c, roughness: 0.4, metalness: 0.4 }), bar: std({ color: 0xcfd4da, roughness: 0.25, metalness: 1 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xd6ecf6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.13, depthWrite: false, envMapIntensity: 1.6 }),
      products: std({ map: atlas.map, vertexColors: true, roughness: 0.52, metalness: 0.0, envMapIntensity: 0.7 }),
    };
    // ---- the interior environment: a soft white room with ceiling light strips (reflections on tile, plastic, chrome)
    this.scene.environment = this.makeEnvironment(); this.scene.environmentIntensity = 0.85;
    // ---- the structure from the layout
    const S = this.structure = buildStructure(layout, mats); this.scene.add(S.root);
    this.root = S.root;
    // ---- lights: one soft key light with the only shadow map, and the sky/ground fill
    const hemi = new THREE.HemisphereLight(0xeaf0ff, 0xb9a98c, 0.9); this.scene.add(hemi);
    const key = this.key = new THREE.DirectionalLight(0xfff1dc, 2.6); key.castShadow = true; this.scene.add(key, key.target);
    const half = 15, sz = this.mobile ? 2048 : 4096; key.shadow.mapSize.set(sz, sz); Object.assign(key.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 120 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.035; key.shadow.radius = 3; key.userData.dir = new THREE.Vector3(-0.42, 1.0, -0.62).normalize();
    this.buildSigns(); this.buildDecals(); this.buildCarts(); this.buildItems();
    await this.loadPeople();
    this.resize(this.view.w, this.view.h);
    return this;
  }

  // the floor's baked light: ambient occlusion from the mask (a soft contact shadow where shelves, counters and walls meet the tile)
  // and the pools of the ceiling lights
  bakeFloorLight() {
    const { board, field } = this.layout, mw = board.mw, mh = board.mh, K = 2, c = document.createElement('canvas'); c.width = mw * K; c.height = mh * K;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (field[y][x] === '0') g.fillRect(x * K, y * K, K, K);
    const b = document.createElement('canvas'); b.width = c.width; b.height = c.height; const bg = b.getContext('2d'); bg.fillStyle = '#fff'; bg.fillRect(0, 0, b.width, b.height);
    bg.filter = 'blur(9px)'; bg.drawImage(c, 0, 0); bg.filter = 'blur(2.5px)'; bg.globalCompositeOperation = 'multiply'; bg.drawImage(c, 0, 0); bg.filter = 'none';   // wide soft + tight contact
    // remap: white stays 1, shadowed down to ~0.35
    const id = bg.getImageData(0, 0, b.width, b.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const v = d[i] / 255, a = 0.38 + 0.62 * Math.pow(v, 0.9); d[i] = d[i + 1] = d[i + 2] = a * 255; } bg.putImageData(id, 0, 0);
    const ao = T.tex(b, { srgb: false, aniso: 1 }); ao.channel = 1;
    // the pools of light: ceiling fixtures on a 4 m grid
    const l = document.createElement('canvas'); l.width = 214; l.height = 461; const lg = l.getContext('2d'); lg.fillStyle = '#000'; lg.fillRect(0, 0, 214, 461);
    const sx = 214 / m(board.w), sz = 461 / m(board.h);
    for (let zi = 0; zi < 10; zi++) for (let xi = 0; xi < 4; xi++) {
      const x = 2.6 + xi * 4.5 + (zi % 2) * 2.0, z = 4.5 + zi * 4.2, gr = lg.createRadialGradient(x * sx, z * sz, 0, x * sx, z * sz, 3.4 * sx);
      gr.addColorStop(0, 'rgba(255,238,205,0.34)'); gr.addColorStop(0.6, 'rgba(255,238,205,0.12)'); gr.addColorStop(1, 'rgba(255,238,205,0)'); lg.fillStyle = gr; lg.globalCompositeOperation = 'lighter'; lg.fillRect(0, 0, 214, 461);
    }
    const lt = T.tex(l, { aniso: 1 }); lt.channel = 1; return { aoMap: ao, lightMap: lt };
  }

  makeEnvironment() {
    const room = new THREE.Scene(), box = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: 0xcdd3dc, side: THREE.BackSide })); room.add(box);
    for (let i = -2; i <= 2; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 6.6, 5.8), side: THREE.DoubleSide })); s.rotation.x = Math.PI / 2; s.position.set(i * 5, 5.8, 0); room.add(s); }
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0xcdbfa6 })); fl.rotation.x = -Math.PI / 2; fl.position.y = -5.9; room.add(fl);
    const pm = new THREE.PMREMGenerator(this.renderer), rt = pm.fromScene(room, 0.04); pm.dispose(); return rt.texture;
  }

  buildSigns() {
    this.signMeshes = [];
    for (const s of this.structure.info.signs) {
      const tex = T.signTexture(s.text, 768, Math.round(768 * s.h / s.w) < 64 ? 64 : Math.round(768 * s.h / s.w)), mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0 });
      const board = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, 0.06), [new THREE.MeshStandardMaterial({ color: 0x9a1a4d }), new THREE.MeshStandardMaterial({ color: 0x9a1a4d }), new THREE.MeshStandardMaterial({ color: 0x9a1a4d }), new THREE.MeshStandardMaterial({ color: 0x9a1a4d }), mat, new THREE.MeshStandardMaterial({ color: 0x4a1030 })]);
      board.position.set(s.x, s.y, s.z); board.castShadow = true; board.receiveShadow = true; this.root.add(board); this.signMeshes.push(board);
    }
    // the EXIT sign over the door
    const ex = this.structure.info.exit, et = T.plateTexture('EXIT', { w: 256, h: 96, bg: '#b3202a', fg: '#fff', border: '#f5c518' });
    const em = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.34, 0.08), [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: 0x600c12 })).concat([new THREE.MeshStandardMaterial({ map: et, emissiveMap: et, emissive: 0xffffff, emissiveIntensity: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x300 })]));
    em.position.set(ex.x, 2.62, ex.z + 0.09); this.root.add(em);
  }

  buildDecals() {
    const L = this.layout, glow = T.glowTexture(), ring = T.ringTexture();
    this.glow = glow; this.ringTex = ring;
    // the welcome mat and the entrance mat (floor decals: walkable)
    const mat = (rect, text, o, rot) => {
      const [x0, y0, x1, y1] = rect, w = m(x1 - x0), h = m(y1 - y0), tex = T.plateTexture(text, o), mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
      mesh.rotation.x = -Math.PI / 2; if (rot) mesh.rotation.z = Math.PI / 2; mesh.position.set(m((x0 + x1) / 2), 0.006, m((y0 + y1) / 2)); mesh.receiveShadow = true; this.root.add(mesh); return mesh;
    };
    mat([335, 1562, 490, 1630], 'WELCOME', { w: 512, h: 240, bg: '#a82020', fg: '#f3c34a', border: '#f3c34a' });
    { const [x0, y0, x1, y1] = [734, 610, 790, 850], tex = T.plateTexture('ENTRANCE', { w: 1024, h: 240, bg: '#c2255c', fg: '#f5c518', border: '#f5c518' });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(m(y1 - y0), m(x1 - x0)), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })); mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = -Math.PI / 2; mesh.position.set(m((x0 + x1) / 2), 0.006, m((y0 + y1) / 2)); this.root.add(mesh); }
    // pay pads (shown when the list is done): a green soft pad with PAY and a slow ring
    this.padGroup = new THREE.Group(); this.padGroup.visible = false; this.root.add(this.padGroup);
    L.PADS.forEach((p) => {
      const [x0, y0, x1, y1] = p, w = m(x1 - x0), h = m(y1 - y0), cx = m((x0 + x1) / 2), cz = m((y0 + y1) / 2);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 1.1, 0.5), transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false })); pad.rotation.x = -Math.PI / 2; pad.position.set(cx, 0.012, cz);
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.1, h + 0.1), new THREE.MeshBasicMaterial({ map: ring, color: new THREE.Color(0.3, 1.4, 0.7), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })); edge.rotation.x = -Math.PI / 2; edge.position.set(cx, 0.013, cz);
      const txt = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.36), new THREE.MeshBasicMaterial({ map: T.plateTexture('PAY', { w: 256, h: 100, bg: 'rgba(0,0,0,0)', fg: '#3adb76', border: 'rgba(0,0,0,0)' }), transparent: true, depthWrite: false, toneMapped: false })); txt.rotation.x = -Math.PI / 2; txt.rotation.z = Math.PI / 2; txt.position.set(cx, 0.014, cz);
      this.padGroup.add(pad, edge, txt); this.pads.push({ pad, edge });
    });
  }

  buildCarts() {
    const geo = (() => { const g = []; const add = (b, x, y, z) => { b.translate(x, y, z); g.push(b); const n = b.index ? b.toNonIndexed() : b; return n; };
      const parts = [new THREE.BoxGeometry(0.58, 0.04, 0.95).translate(0, 0.28, 0), new THREE.BoxGeometry(0.58, 0.34, 0.025).translate(0, 0.47, -0.46), new THREE.BoxGeometry(0.025, 0.34, 0.95).translate(-0.29, 0.47, 0), new THREE.BoxGeometry(0.025, 0.34, 0.95).translate(0.29, 0.47, 0), new THREE.BoxGeometry(0.58, 0.025, 0.025).translate(0, 0.66, 0.47), new THREE.BoxGeometry(0.58, 0.03, 0.03).translate(0, 0.92, -0.5), new THREE.BoxGeometry(0.4, 0.04, 0.7).translate(0, 0.1, 0)];
      const ng = parts.map((p) => { p = p.index ? p.toNonIndexed() : p; return p; }); return ng.length ? mergeList(ng) : null; })();
    this.cartGeo = geo;
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8cdd4, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.2 });
    const carts = new THREE.Group(); this.root.add(carts);
    (this.structure.info.corrals || []).forEach(([x0, z0, x1, z1]) => {
      const n = Math.floor((x1 - x0 - 0.3) / 0.62), im = new THREE.InstancedMesh(geo, mat, n * 2), mm = new THREE.Matrix4(); let k = 0;
      for (let row = 0; row < 2; row++) for (let i = 0; i < n; i++) { mm.makeRotationY(Math.PI / 2 * 0).setPosition(x0 + 0.45 + i * 0.62, 0, z0 + 0.45 + row * 1.2); im.setMatrixAt(k++, mm); }
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; carts.add(im);
    });
  }

  buildItems() {
    // the pickups: real products on a soft gold ring, a little larger than on the shelf so they read from above. (RICE & BEANS: a sack and a can.)
    const L = this.layout, KINDS = { APPLE: [['apple', { body: '#c8282b' }, 2.6]], CHIPS: [['chips', { label: 'chips', body: '#e8a42b' }, 1.7]], CHICKEN: [['drumsticks', {}, 2.2]], LEMONADE: [['bottle', { label: 'lemonade', body: '#f0d23a' }, 2.0]], BREAD: [['loaf', { label: 'bread', body: '#c98a3c' }, 1.8]], MILK: [['jug', { label: 'milk', cap: '#2f6fd6' }, 1.8]], 'RICE & BEANS': [['sack', { label: 'rice', body: '#f4d27a' }, 1.5], ['can', { label: 'beans', body: '#b3322b' }, 2.4]] };
    const std = this.mats.products; this.itemGroup = new THREE.Group(); this.root.add(this.itemGroup);
    for (const it of L.items) {
      const g = new THREE.Group(), x = m(it.sx ?? it.x), z = m(it.sy ?? it.y); g.position.set(x, 0, z); g.userData.id = it.id;
      const inner = new THREE.Group(); g.add(inner);
      (KINDS[it.id] || []).forEach(([k, o, s], i) => { const mesh = new THREE.Mesh(productGeometry(k, o), std); mesh.scale.setScalar(s); mesh.position.x = it.id === 'RICE & BEANS' ? (i ? 0.3 : -0.2) : 0; mesh.castShadow = true; inner.add(mesh); });
      const ringM = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: this.ringTex, color: new THREE.Color(1.5, 1.2, 0.35), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      ringM.rotation.x = -Math.PI / 2; ringM.position.y = 0.014; g.add(ringM);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: this.glow, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; g.add(shadow);
      g.userData.inner = inner; g.userData.ring = ringM; this.itemGroup.add(g); this.items.push(g);
    }
  }

  async loadPeople() {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(new URL('character.glb', this.base).href);
    gltf.scene.traverse((o) => { if (o.isMesh && o.material?.isMeshStandardMaterial) { o.material.roughness = 0.82; o.material.envMapIntensity = 0.85; } });   // real.js upgradeCharacter
    const walk0 = gltf.animations.find((a) => a.name === 'walk'), clips = { walk: addArmSwing(walk0, gltf.scene, ARMS.walk), run: addArmSwing(makeRunClip(walk0), gltf.scene, ARMS.run), stand: makeStandClip(walk0) };
    const mk = (bully) => {
      const o = SkeletonUtils.clone(gltf.scene), h = bully ? BULLY_H : PLAYER_H; o.scale.setScalar(h / MODEL_H);
      o.traverse((q) => { if (q.isMesh) { q.castShadow = true; q.receiveShadow = true; q.frustumCulled = false; if (bully) q.material = makeBullyMaterial(q.material); } });
      const mixer = new THREE.AnimationMixer(o), act = {}; for (const k of ['stand', 'walk', 'run']) { act[k] = mixer.clipAction(clips[k]); act[k].play(); }
      const g = new THREE.Group(); g.add(o);
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.glow, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; blob.scale.set(h * 0.62, h * 0.4, 1); g.add(blob);
      this.root.add(g); return { g, o, mixer, act, h, dur: walk0.duration };
    };
    this.actors.player = mk(false); this.actors.bully = mk(true);
  }

  /** place a person: board px (their feet), facing U/D/L/R, moving 0..1 (walk phase from `phase` seconds) */
  setActor(which, bx, by, face = 'D', moving = 0, phase = 0) {
    const a = this.actors[which]; if (!a) return; a.g.visible = true; a.g.position.set(m(bx), 0, m(by)); a.o.rotation.y = FACE_YAW[face] ?? 0;
    a.act.stand.setEffectiveWeight(1 - moving); a.act.walk.setEffectiveWeight(moving * 0.5); a.act.run.setEffectiveWeight(moving * 0.5);
    a.mixer.setTime(((phase % a.dur) + a.dur) % a.dur); a.o.updateMatrixWorld(true);
  }
  hideActor(which) { if (this.actors[which]) this.actors[which].g.visible = false; }
  /** which pickups to show: 'all', an id, or null; pay: show the pay pads */
  setItems(which) { for (const g of this.items) g.visible = which === 'all' || g.userData.id === which; }
  setPay(on) { this.padGroup.visible = !!on; }

  /** the 2D camera (placeView) for a player at board (px, py): the board point that sits at the middle of the screen */
  centreFor(px, py, vw = this.view.w, vh = this.view.h) {
    const { board, camera } = this.layout, sc = Math.max(Math.min(vw / board.w, vh / board.h), Math.min(camera.zoomScale, vw / 480)), W = board.w * sc, H = board.h * sc;
    const tx = W <= vw ? (vw - W) / 2 : Math.min(0, Math.max(vw - W, vw / 2 - px * sc)), ty = H <= vh ? (vh - H) / 2 : Math.min(0, Math.max(vh - H, vh * camera.followY - py * sc));
    return { x: (vw / 2 - tx) / sc, y: (vh / 2 - ty) / sc, scale: sc, tx, ty };
  }
  setCamera(px, py) {
    const c = this.centreFor(px, py), T0 = new THREE.Vector3(m(c.x), 0, m(c.y)), cam = this.camera, { w, h } = this.view;
    cam.position.set(T0.x, T0.y + DIST * Math.sin(ELEV), T0.z + DIST * Math.cos(ELEV)); cam.up.set(0, 1, 0); cam.lookAt(T0);
    const n = DIST - 45, f = DIST + 45, a = 2 * (c.scale * PX) * DIST / w, b = a * (w / h) / Math.sin(ELEV);   // floor: c.scale*PX CSS px per metre in x, and the same in z (the 1/sin is the anamorphic stretch)
    cam.near = n; cam.far = f; cam.updateMatrixWorld(true);
    cam.projectionMatrix.set(a, 0, 0, 0, 0, b, 0, 0, 0, 0, -(f + n) / (f - n), -2 * f * n / (f - n), 0, 0, -1, 0); cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.centre = c;
    // the key light and its shadow box follow the view, snapped to whole texels
    const key = this.key, d = key.userData.dir, texel = 30 / key.shadow.mapSize.x, sx = Math.round(T0.x / texel) * texel, sz = Math.round(T0.z / texel) * texel;
    key.target.position.set(sx, 0, sz); key.position.set(sx + d.x * 60, d.y * 60, sz + d.z * 60); key.target.updateMatrixWorld(); key.updateMatrixWorld();
  }
  resize(w, h) {
    this.view = { w, h }; this.renderer.setSize(w, h, false); this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; this.look.resize();
  }
  /** world -> CSS px on screen (for the alignment check and overlays) */
  project(x, y, z) { const v = new THREE.Vector3(x, y, z).project(this.camera); return [(v.x * 0.5 + 0.5) * this.view.w, (-v.y * 0.5 + 0.5) * this.view.h]; }
  render(dt = 0) {
    this.t += dt;
    // the pickups' ring and bob: a slow smooth swell (0.5 a second, never a hard on/off)
    const sw = 0.5 + 0.5 * Math.sin(this.t * Math.PI), s2 = 0.5 + 0.5 * Math.sin(this.t * Math.PI);
    for (const g of this.items) { g.userData.ring.material.opacity = 0.45 + 0.4 * sw; g.userData.inner.position.y = 0.32 + 0.05 * Math.sin(this.t * Math.PI * 0.9); }
    for (const p of this.pads) p.edge.material.opacity = 0.45 + 0.4 * s2;
    this.look.render();
  }
  stats() { const i = this.renderer.info; return { triangles: i.render.triangles, calls: i.render.calls, geometries: i.memory.geometries, textures: i.memory.textures, stock: this.structure.info.stockCount }; }
}
function mergeList(list) { let n = 0; for (const g of list) n += g.attributes.position.count; const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2); let o = 0; for (const g of list) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); U.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; } const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.BufferAttribute(P, 3)); r.setAttribute('normal', new THREE.BufferAttribute(N, 3)); r.setAttribute('uv', new THREE.BufferAttribute(U, 2)); return r; }
