// "Get to the Store": a 60-second auto-drive runner (Temple Run with cars) down Luckie St and Auburn Ave,
// loaded on demand by the main game.
//   const { startDrive } = await import('./drive/drive.js');
//   startDrive({ mount: document.body, muted, onDone: (result) => { /* start the store level */ } });
// result = { arrived, parked, timeLeft, cleanPark, hits, tokens, nearMisses, bonus, busted }
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { buildCity, makeGround, toV3, rayTargets } from './city.js';
import { LEVEL, standOn } from './levels.js';
import { CUT } from './roads.js';
import { TopSurface } from './surface.js';
import { RouteFrame, RunnerCar, World } from './runner.js';
import { DriveAudio } from './audio.js';
import { Crowd } from './crowd.js';
import { Streetcars } from './tram.js';
import { Signals } from './signals.js';
import { Birds } from './birds.js';
import { haptic, HAP, tapHaptic } from './haptics.js';
import { Look } from './look.js';
import { WIND, NEAR_CUT } from './landscape.js';
import { ImpactFX } from './fx.js';
import { fetchWeather, applyWeather } from './weather.js';
import * as SkeletonUtils from './vendor/SkeletonUtils.js';
import { makeBullyMaterial, makeRunClip, MODEL_H, PLAYER_H, BULLY_H } from './people.js';

const BASE = new URL('./', import.meta.url);
const TIME_LIMIT = 70;   // real traffic (an oncoming stream, queues at work zones) costs ~10 s of waiting on a clean run
const REAR_AXLE = 1.45; // car.glb origin sits on the rear axle; the runner tracks the car's centre
// Curbside parking space in front of the EBT Corner Store (world frame; the row faces north onto Auburn).
const SPOT = { x: 0, y: 9.0, heading: Math.PI, len: 7.0, wid: 3.0 };
// ?qa drives the loop from a timer: hidden tabs/panes pause requestAnimationFrame, which would freeze automated tests.
const QA = new URLSearchParams(location.search).has('qa');
// ?qa&skipfoot: start in the car with the old 3-2-1 (tests that are about the drive, not the chase on foot)
const SKIPFOOT = QA && new URLSearchParams(location.search).has('skipfoot');
// The chase (Kema's opening). On foot: you run up the block to your car with the bully on your heels; he shoves you
// if he catches you (it costs time, it doesn't end anything). Then the race: he jumps in his own ride and comes after
// you, shown only on the bar at the top. Whatever lead you have when you park is how long you get in the store before
// he walks in; if he's on your tail, he follows you straight in.
// (he runs a touch slower than you: a clean run up the sidewalk gets away, but every person you run into lets him close)
const FOOT = { run: 5.6, back: 2.2, bully: 5.3, bullyGo: 0.8, start: 14, carAhead: 30, bullyBehind: 8, stun: 0.9, reach: 0.9, pause: 1.1 };
const RACE = { pace: 17, accel: 3.4, hop: 1.6, tail: 4.5, shake: 60, maxLead: 30 };   // 17 m/s: a good run beats him by ~6 s; an average one gets caught late
const nextFrame = QA ? (f) => setTimeout(f, 16) : requestAnimationFrame;
// screen-to-screen fades (the loader lifting, the fade to black at the end): the store page's SCREEN_FADE, one pace
const SCREEN_FADE = 0.3;
const cancelFrame = QA ? clearTimeout : cancelAnimationFrame;

export async function startDrive({ mount = document.body, muted = false, onDone = () => {}, onProgress = () => {} } = {}) {
  // ---------- load (the game has no loader of its own, so the drive shows one) ----------
  if (!document.querySelector('link[data-drive-css]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('drive.css', BASE).href; l.dataset.driveCss = '';
    document.head.appendChild(l);
  }
  const root = document.createElement('div');
  root.className = 'drive-root';
  // iOS ignores the CSS on some held elements: stop the long-press menu and text selection outright
  for (const ev of ['contextmenu', 'selectstart']) root.addEventListener(ev, (e) => e.preventDefault());
  // a held finger is driving, never a long-press menu, magnifier or text selection (iOS ignores CSS alone for
  // these on a long hold): claim every touch except on the two tap-to-click buttons (skip, drive again)
  root.addEventListener('touchstart', (e) => { if (!e.target.closest?.('[data-skip], [data-pause], .drive-paused button, .drive-busted button, .dp')) e.preventDefault(); }, { passive: false });   // (buttons: a real tap, so iOS plays its switch haptic)
  root.innerHTML = '<div class="drive-loading"><b>AUBURN AVE</b><span>Get to the corner store</span><i></i></div>';
  mount.appendChild(root);
  const bar = root.querySelector('.drive-loading i');
  const progress = (p, label) => { bar.style.width = p * 100 + '%'; onProgress(p, label); };
  progress(0.05, 'Loading Auburn Ave');
  const audio = new DriveAudio({ muted });
  audio.unlock(); // still inside the START tap's user activation on most browsers
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  // motion (GSAP): the store page already carries it; on its own (/drive/index.html) the drive loads the same
  // vendored copy. Phones set to reduce motion, or no GSAP at all, keep the plain CSS behaviour.
  const gsapReady = window.gsap ? Promise.resolve(window.gsap) : new Promise((ok) => {
    const s = document.createElement('script'); s.src = new URL('vendor/gsap.min.js', BASE).href;
    s.onload = () => ok(window.gsap || null); s.onerror = () => ok(null); document.head.appendChild(s);
  });
  const [W, hero, carGltf, props, trees, weather, gsapLib, charGltf] = await Promise.all([
    fetch(new URL('world.json', BASE)).then((r) => r.json()),
    loader.loadAsync(new URL('hero.glb', BASE).href),
    loader.loadAsync(new URL('car.glb', BASE).href),
    loader.loadAsync(new URL('props.glb', BASE).href),
    loader.loadAsync(new URL('trees.glb', BASE).href),
    fetchWeather(),
    gsapReady,
    loader.loadAsync(new URL('character.glb', BASE).href),   // you and the bully on foot (people.js)
  ]);
  const G = gsapLib && !matchMedia('(prefers-reduced-motion: reduce)').matches ? gsapLib : null;
  if (G) root.classList.add('gs');   // drive.css: GSAP, not CSS transitions, moves the messages and pop-ups
  progress(0.7, 'Building the city');

  // ---------- renderer / scene ----------
  root.insertAdjacentHTML('beforeend', HUD_HTML);
  // antialias off on the CANVAS only: the scene is drawn (with MSAA) into the look pass's own target (look.js), and
  // the canvas only ever receives one full-screen quad, which multisampling can't change by a single pixel. A
  // multisampled canvas just cost a full-screen MSAA buffer and a resolve every frame.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  const MOBILE = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2)); // phones: fill-rate is the budget
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  // The look: GTA Chinatown Wars colour, not a washed-out film grade. A hue-true filmic shoulder (Khronos
  // Neutral), then saturation and a touch of contrast on top, in the same pass (no post-processing cost on phones).
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    `vec3 CustomToneMapping( vec3 color ) {
      vec3 c = NeutralToneMapping( color );
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c = max( vec3( 0.0 ), mix( vec3( l ), c, 1.4 ) );
      c = pow( c, vec3( 1.1 ) ) * 1.08;
      return clamp( c, 0.0, 1.0 );
    }`);
  renderer.toneMapping = THREE.CustomToneMapping; renderer.toneMappingExposure = 1.0;
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  // near 2 m: as close as the chase camera ever gets to the ground (measured along the whole route: the road at the
  // bottom of the screen stays >= 2.62 m away with the camera's 2.5 m ground clearance below). The overhead camera
  // used 4 m, but a chase camera ~3 m off the road had the road at the bottom of the screen nearer than 4 m on 81% of
  // the route (phone upright), and it wasn't drawn: the sky dome showed through as a flat grey slab. 2 m keeps the
  // ink pass's depth precision at half the old value, not an eighth; the tightest layer gap (3 cm, levels.js) stays
  // clean out to ~1 km.
  const camera = new THREE.PerspectiveCamera(42, 1, 2, 3000);
  const comic = new Look(renderer, scene, camera, { mobile: MOBILE });   // GTA Chinatown Wars ink + comic shading

  // shared tiling textures come from the hero glTF materials, so they download once
  const tex = {};
  hero.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material; o.castShadow = o.receiveShadow = true;
    if (/brick/.test(m.name)) tex.brick = m.map;
    if (/roof/.test(m.name)) tex.roof = tex.concrete = m.map;
    if (/sidewalk/.test(m.name)) tex.sidewalk = m.map;
  });
  // real asphalt (CC0 Poly Haven "asphalt_02"), shared by every road surface and parking lot
  const tl = new THREE.TextureLoader();
  const [asphalt, asphaltNor, grass, grassNor, bark, barkNor, leaves, tuft] = await Promise.all(['tex/asphalt_diff.webp', 'tex/asphalt_nor.webp',
    'tex/grass_diff.webp', 'tex/grass_nor.webp', 'tex/bark.webp', 'tex/bark_nor.webp', 'tex/leaves.webp', 'tex/grass_tuft.webp'].map((f) => tl.loadAsync(new URL(f, BASE).href)));
  for (const t of [grass, bark, leaves, tuft]) t.colorSpace = THREE.SRGBColorSpace;   // CC0 Poly Haven: leafy_grass, island_tree_02, grass_bermuda_01
  Object.assign(tex, { grass, grassNor, bark, barkNor, leaves, tuft });
  asphalt.colorSpace = THREE.SRGBColorSpace;
  Object.assign(tex, { map: asphalt, normal: asphaltNor, asphalt });
  for (const t of Object.values(tex)) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  const ground = makeGround(W);
  const route = new RouteFrame(W, ground, 200); // road continues 200 m past the store: traffic drives on out of view
  const city = buildCity(W, tex, ground, route, props.scene, trees.scene);
  scene.add(city.group, hero.scene);
  // the city and the storefront row never move: their matrices are worked out once here, instead of three.js
  // recomposing every one of their hundreds of objects every frame (and again for the shadow pass)
  scene.matrixAutoUpdate = false;
  for (const g of [city.group, hero.scene]) { g.updateMatrixWorld(true); g.traverse((o) => { o.matrixAutoUpdate = false; }); }

  // lights: the sun follows the car so its shadow map stays sharp where you are
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x7a6a55, 1.2);   // warm bounce: flat, sunny comic light
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true; sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 600 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);
  const sky = applyWeather(weather, { scene, renderer, sun, hemi, roads: city.surfaces });
  // wheels read the height of the actual road triangles under them (never a formula that could disagree)
  const roadSurface = new TopSurface(city.streets.drivable);
  const surfAt = (x, y, below) => { const h = roadSurface.top(x, -y, below); return h ? h.y : null; };
  // ---------- the run, the car ----------
  // parking space: in front of the store, in the curbside parking lane (or at the right curb if there isn't one)
  const spotS = route.project(SPOT.x, SPOT.y).s;
  const spot = { s: spotS, d: route.parkD(spotS, -1) ?? route.lane(spotS, 0) - 0.35 };
  const world = new World({ route, props: props.scene, scene, W, sEnd: spot.s, audio, surfAt, camera, marks: city.streets.routeMarks });
  // the sun's shadow box, so the props that can't cast a shadow into it skip the shadow pass (World.render)
  world.shadowBox = { dir: sun.userData.dir || new THREE.Vector3(-0.5, 0.8, 0.35), half: () => Math.max(sun.shadow.camera.right, sun.shadow.camera.top) };
  const car = new RunnerCar(route, 4);
  const signals = world.signals = new Signals({ route, nodes: city.signals, marks: city.streets.routeMarks, scene });
  const trams = world.trams = new Streetcars({ W, route, ground, surfAt, scene, props: props.scene, world, audio });
  const crowd = world.crowd = new Crowd({
    route, ground, surfAt, scene, camera, spot, mobile: MOBILE, isFree: city.isFree,
    furniture: { ...city.furniture, shelter: [...(city.furniture.shelter || []), ...trams.shelters] },   // riders wait at streetcar platforms too
    onRoute: (x, y) => roadSurface.top(x, -y, ground(x, y) + 1.2)?.name === 'route_road',
    visible: (x, y, z, r) => world.visible(x, y, z, r),
  });
  crowd.shadowBox = world.shadowBox;
  world.planCorners(signals);   // water sellers and panhandlers working the red lights
  // flocks fly over the roofs: height of whatever is under a point (roofs, freeway decks, landmarks), by a ray from above
  // (rayTargets: the same roofs, freeway and storefronts cut into small tiles, so a ray tests only what's under it)
  const roofRay = new THREE.Raycaster(), roofHits = rayTargets([city.group.getObjectByName('roofs'), city.freeway.group, hero.scene].filter(Boolean)), down = new THREE.Vector3(0, -1, 0);
  const roofAt = (x, y) => { roofRay.set(toV3(x, y, 400), down); const h = roofRay.intersectObjects(roofHits, true)[0]; return h ? h.point.y : ground(x, y); };
  const groundAt = (x, y) => Math.max(surfAt(x, y, ground(x, y) + 1.2) ?? -Infinity, ground(x, y) + LEVEL.TERRAIN);
  const birds = world.birds = new Birds({ scene, props: props.scene, route, roofAt, groundAt, isFree: city.isFree, sEnd: spot.s,
    trees: [...(city.furniture.tree_round || []), ...(city.furniture.tree_upright || [])],
    occupied: (s, d) => world.ents.some((e) => e.alive && Math.abs(e.s - s) < 7 && Math.abs(e.d - d) < 2.5), visible: (x, y, z, r) => world.visible(x, y, z, r), mobile: MOBILE });
  const carModel = carGltf.scene;
  carModel.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // brake lights: the tail-lamp material flares when you're on the brakes
  // (the asset optimiser renames materials, so find it by its glow: the purest red emissive on the car)
  const glowing = new Set(); carModel.traverse((o) => { if (o.isMesh && o.material?.emissive && o.material.emissive.r > 0.3) glowing.add(o.material); });
  const redness = (m) => (m.emissive.g + m.emissive.b) / m.emissive.r;
  const tail = [...glowing].sort((a, b) => redness(a) - redness(b))[0];
  const tailLamps = new Set(tail && redness(tail) < 0.2 ? [tail] : []);
  for (const m of tailLamps) m.userData.base = { color: m.emissive.clone(), k: m.emissiveIntensity };
  const BRAKE_GLOW = new THREE.Color(1, 0.06, 0.03);
  const carRig = new THREE.Group(); carRig.add(carModel); carModel.position.z = REAR_AXLE;
  // wheel pivots from the car model: *_SPIN roll about their axle (local X), the front *_STEER turn about up (local Y)
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), dq = new THREE.Quaternion();
  const pivot = (re) => { const out = []; carModel.traverse((o) => { if (!o.isMesh && re.test(o.name)) out.push({ o, q0: o.quaternion.clone() }); }); return out; };
  const wheelSpin = pivot(/^[FR][LR]_SPIN$/), wheelSteer = pivot(/^F[LR]_STEER$/), TYRE_R = 0.407;
  let wheelRoll = 0;
  scene.add(carRig);
  const fx = new ImpactFX(scene);

  // ---------- parking space (painted box + beacon, the drop-off marker) ----------
  const spotGroup = new THREE.Group();
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const addLine = (w, h, ox, oy) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat); m.rotation.x = -Math.PI / 2; m.position.set(ox, 0.25, oy); m.renderOrder = 2; spotGroup.add(m); };
  const spotW = Math.min(SPOT.wid, Math.max(2.3, route.park(spot.s) - 0.2));   // fits the parking lane
  addLine(SPOT.len, 0.18, 0, spotW / 2); addLine(SPOT.len, 0.18, 0, -spotW / 2); addLine(0.18, spotW, SPOT.len / 2, 0); addLine(0.18, spotW, -SPOT.len / 2, 0);
  const pLetter = makeLabel('P', '#ffd400'); pLetter.rotation.x = -Math.PI / 2; pLetter.position.set(0, 0.26, 0); pLetter.material.polygonOffset = true; pLetter.material.polygonOffsetFactor = -6; pLetter.renderOrder = 2; pLetter.scale.set(2.4, 2.4, 1); spotGroup.add(pLetter);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  beacon.position.y = 20; spotGroup.add(beacon);
  const sp = route.at(spot.s, spot.d);
  spotGroup.position.copy(toV3(sp.x, sp.y, ground(sp.x, sp.y))); spotGroup.rotation.y = sp.a;   // box runs along the curb
  scene.add(spotGroup);

  // ---------- input: you drive it (GTA Chinatown Wars layout) ----------
  // Phone: ◀ ▶ change lanes (bottom left), GAS, BRAKE (hold at a stop to reverse) and HORN (bottom right), all held
  // buttons. Keys: ↑/W gas, ↓/S brake / reverse, ←/→ or A/D one lane per press, Space/H horn.
  const keys = new Set();
  let hornT = 0;
  const honk = () => { if (hornT <= 0) { audio.horn(); hornT = 0.6; } };
  // ---------- pause ----------
  let paused = false;
  const setPaused = (p) => {
    if (p && !(state === 'driving' || state === 'countdown' || state === 'onfoot')) return;   // nothing to pause at the finish
    paused = p; keys.clear();                                                     // no stuck gas / steering on resume
    for (const b of root.querySelectorAll('[data-k].on')) b.classList.remove('on');
    const panel = root.querySelector('.drive-paused');
    panel.hidden = !p;
    if (p && G) {   // the pause panel fades up and its buttons pop in; resuming is instant (no waiting to drive)
      G.fromTo(panel, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out' });
      G.fromTo(panel.children, { y: 14, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.35, stagger: 0.06, ease: 'back.out(1.8)', clearProps: 'transform,opacity' });
    }
    root.classList.toggle('is-paused', p);
    try { p ? audio.ctx?.suspend() : audio.ctx?.resume(); } catch {}
    last = performance.now();                                                     // resume without a time jump
  };
  const kd = (e) => {
    if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); setPaused(!paused); return; }
    audio.unlock();
    const k = KEYMAP[e.code]; if (!k) return; e.preventDefault();
    if (k === 'horn') honk();
    if ((k === 'left' || k === 'right') && !e.repeat) tapLane(k);   // a held key's auto-repeat is not another press
    keys.add(k);
  };
  const ku = (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); };
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  // the four lanes (your parking lane, your lane, the oncoming lane, the far parking lane, where the street has them):
  // used for the haptic tick each time you cross into a lane, and as the edges of the road you can drive on
  const laneCentres = (s) => [route.parkD(s, -1), route.lane(s, 0), route.lane(s, 1), route.parkD(s, 1)].filter((v) => v !== null);
  // ?bot: the QA autopilot (autopilot.js) steers by writing car.targetD itself, 20 times a second, along any line
  // it likes. The player's lane steering below must stand aside for it, or followLane() would overwrite the bot's
  // line every frame and it could never dodge anything.
  const BOT = new URLSearchParams(location.search).has('bot');
  let laneWas = null;
  const steerFeel = () => {                                       // a haptic tick each time you cross into a new lane
    const cs = laneCentres(car.s), i = cs.reduce((b, c, k) => Math.abs(c - car.d) < Math.abs(cs[b] - car.d) ? k : b, 0);
    if (laneWas !== null && i !== laneWas) haptic(HAP.lane, 90);
    laneWas = i;
    if (car.scrape > 0) { haptic(HAP.edge, 400); car.scrape = 0; }
  };
  // ◀ ▶ move the car the instant they're pressed, from the press itself, not whenever the next frame looks at the
  // held keys: a quick tap (finger down and up between two frames, easy on a phone drawing the city at 30 fps) used
  // to be missed entirely. One lane per press; holding does nothing more.
  const tapLane = (k) => {
    if (state === 'onfoot' && !paused) { footLane = k === 'left' ? 0 : 1; haptic(HAP.lane); return; }   // on foot: your line on the sidewalk
    if (state !== 'driving' || BOT || paused) return;
    laneShift(k === 'left' ? 1 : -1); followLane();
  };
  for (const b of root.querySelectorAll('[data-k]')) {
    // held buttons. Touch drives them from raw touch events (what iOS always delivers, even with the page's
    // long-press guard on), each button tracking its own finger(s), so GAS + steer + HORN work together; a mouse
    // or pen uses pointer events with capture.
    const k = b.dataset.k, fingers = new Set();
    const press = () => {
      if (!keys.has(k)) { audio.unlock(); if (k === 'horn') honk(); if (k === 'left' || k === 'right') tapLane(k); haptic(HAP.tap); }
      keys.add(k); b.classList.add('on');
    };
    const release = () => { keys.delete(k); b.classList.remove('on'); };
    b.addEventListener('touchstart', (e) => { for (const t of e.changedTouches) fingers.add(t.identifier); press(); }, { passive: true });
    const lift = (e) => { for (const t of e.changedTouches) fingers.delete(t.identifier); if (!fingers.size) release(); };
    b.addEventListener('touchend', lift); b.addEventListener('touchcancel', lift);
    tapHaptic(b);
    b.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') return; press(); try { b.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); });
    const up = (e) => { if (e.pointerType !== 'touch') release(); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  }

  // ---------- HUD ----------
  const $ = (s) => root.querySelector(s);
  // a HUD line is only rewritten when its text changes: replacing an element's text, even with the same text, makes
  // the browser redo style and layout for it, and the HUD used to do that ~8 times every frame
  const setText = (el, txt) => { if (el.textContent !== txt) el.textContent = txt; };
  const hud = { light: $('.drive-light'), lightDist: $('.drive-light b'), time: $('.drive-time'), speed: $('.drive-speed'), dist: $('.drive-dist'), tokens: $('.drive-tokens'), msg: $('.drive-msg'), hint: $('.drive-hint'), pop: $('.drive-pop') };
  // the big centre message (3-2-1-GO!, CLEAN PARK!, −1s, TOO LATE, BUSTED) punches in big and settles, then fades
  const msgIn = () => { if (G) { G.killTweensOf(hud.msg); G.fromTo(hud.msg, { opacity: 0, scale: 1.7 }, { opacity: 1, scale: 1, duration: 0.34, ease: 'back.out(2.4)' }); } else hud.msg.classList.add('on'); };
  const msgOut = () => { if (G) G.to(hud.msg, { opacity: 0, scale: 1.08, duration: 0.22, ease: 'power1.in' }); else hud.msg.classList.remove('on'); };
  const flash = (text, ms = 1200) => { hud.msg.textContent = text; msgIn(); clearTimeout(flash.t); flash.t = setTimeout(msgOut, ms); };
  // +25 / NEAR MISS +50: pops out, then floats up and fades (0.9 s, as before)
  const pop = (text) => {
    const el = document.createElement('b'); el.textContent = text; hud.pop.appendChild(el);
    if (G) G.timeline({ onComplete: () => el.remove() })
      .fromTo(el, { opacity: 0, y: 8, scale: 0.6 }, { opacity: 1, y: 0, scale: 1.15, duration: 0.16, ease: 'back.out(3)' })
      .to(el, { y: -44, scale: 1, opacity: 0, duration: 0.74, ease: 'power2.out' });
    else setTimeout(() => el.remove(), 900);
  };
  // a HUD box gives a springy bump (the EBT count when you grab a token, the clock in the last ten seconds)
  const bump = (el, s = 1.18) => { if (G && el) G.fromTo(el, { scale: s }, { scale: 1, duration: 0.5, ease: 'elastic.out(1,0.5)', overwrite: 'auto' }); };
  const tokBox = hud.tokens.closest('.drive-box'), timeBox = hud.time.closest('.drive-box');
  let lowSec = null;
  // the hint line under the car fades up whenever it changes
  const setHint = (txt) => { if (hud.hint.textContent === txt) return; hud.hint.textContent = txt; if (G && txt) G.fromTo(hud.hint, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }); };
  setHint(`${weather.label} in the ATL`);

  const coarse = MOBILE;
  let sized = '';
  const resize = () => {
    const w = root.clientWidth, h = root.clientHeight; if (!w || !h) return;
    sized = w + 'x' + h; renderer.setSize(w, h, false); comic.resize(); camera.aspect = w / h;
    camera.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(26)) / camera.aspect)), 44, 70);
    if (coarse) camera.setViewOffset(w, h, 0, h * 0.1, w, h); else camera.clearViewOffset(); // car clears the buttons
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize); resize();
  // ---------- adaptive resolution (phones that can't keep up) ----------
  // The picture is drawn at the sharpest pixel ratio set above. If frames keep coming slower than 60 a second (on
  // average over ~10 frames, longer than 21.7 ms) for 1.5 s, a phone's GPU is falling behind (or throttling as it warms
  // up): the resolution steps down a notch (never below 1 pixel per CSS pixel, so a screen that is already 1:1 never
  // changes), and back up after a while once frames are fast again. It only keeps a step down that actually helps: if
  // frames aren't at least 10% faster 2 s later (the phone is held back by something else, e.g. iOS Low Power Mode
  // capping it at 30 fps), it goes straight back to full sharpness and waits before trying again (twice as long each
  // time). Off in tests (?qa, or ?fixedres) so screenshots and measurements stay at one size.
  const PR_MAX = renderer.getPixelRatio(), PR_MIN = Math.min(PR_MAX, 1), PR_STEP = 0.25, SLOW_MS = 1000 / 60 * 1.3, FAST_MS = 18;
  const ADAPT = !QA && !new URLSearchParams(location.search).has('fixedres') && PR_MAX > PR_MIN;
  const res = { on: ADAPT, last: 0, ema: 0, slow: 0, fast: 0, trial: null, lockDown: 0, lockUp: 0, upAt: -1e9, bounces: 0, fails: 0, clock: 0 };
  const setPR = (pr) => { renderer.setPixelRatio(pr); sized = ''; resize(); };   // resize() re-sizes the look pass too
  function adaptRes(now) {
    const iv = now - res.last; res.last = now;
    if (!res.on || paused || iv <= 0 || iv > 250) return;            // first frame, after a pause or a hidden tab: no signal
    res.ema = res.ema ? res.ema + (iv - res.ema) * 0.1 : iv;
    const sec = iv / 1000, pr = renderer.getPixelRatio();
    res.clock += sec;
    res.slow = res.ema > SLOW_MS ? res.slow + sec : 0;              // dropping frames
    res.fast = res.ema < FAST_MS ? res.fast + sec : 0;              // keeping up
    res.lockDown = Math.max(0, res.lockDown - sec); res.lockUp = Math.max(0, res.lockUp - sec);
    if (res.trial) {
      if ((res.trial.t -= sec) > 0) return;                         // judge the last step down after 2 s at it
      if (res.ema > res.trial.ema * 0.9) { setPR(res.trial.from); res.lockDown = Math.min(300, 30 * 2 ** res.fails++); }   // didn't help: undo
      else res.lockUp = Math.min(240, 30 * 2 ** res.bounces);       // it helped: stay there a while (longer each time it bounces)
      res.trial = null; res.slow = res.fast = 0; return;
    }
    if (res.slow > 1.5 && !res.lockDown && pr > PR_MIN) {
      if (res.clock - res.upAt < 10) res.bounces++;                  // the last step up didn't hold
      res.trial = { from: pr, ema: res.ema, t: 2 }; setPR(Math.max(PR_MIN, pr - PR_STEP)); res.slow = 0; return;
    }
    if (res.fast > 6 && !res.lockUp && pr < PR_MAX) { setPR(Math.min(PR_MAX, pr + PR_STEP)); res.fast = 0; res.upAt = res.clock; }
  }
  // phones rotate before they report the new size (iOS especially): also re-check on orientation / visual-viewport
  // changes, and every frame (cheap string compare), so the picture is never left squashed or stretched
  addEventListener('orientationchange', () => { setTimeout(resize, 60); setTimeout(resize, 400); });
  window.visualViewport?.addEventListener('resize', resize);

  const api = { camOverride: null }; // test hooks (filled in below)
  // ---------- state ----------
  let t = TIME_LIMIT, drove = 0, hits = 0, tokens = 0, nearMisses = 0, state = SKIPFOOT ? 'countdown' : 'onfoot', countdown = 3, shake = 0, endT = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  // ---------- stiff lane steering ----------
  // The car sits in one of four lanes, right to left: 0 the right parking lane, 1 your lane, 2 the oncoming lane,
  // 3 the left parking lane (d grows to the left, so that is also smallest d to largest). ◀ ▶ move it one lane.
  // The lane is remembered by WHICH lane it is, not by a distance in metres, because both of these change along
  // the route: lanes widen and narrow with the street (route.travel), and parking lanes only exist where the
  // street has room for one (route.parkD is null otherwise). followLane() re-reads the lane's centre every frame,
  // so the car stays centred in its lane through every width change, and if a parking lane runs out under you
  // the car moves to the travel lane beside it instead of grinding the kerb where the lane used to be.
  const laneAt = (s, k) => k === 0 ? route.parkD(s, -1) : k === 1 ? route.lane(s, 0) : k === 2 ? route.lane(s, 1) : route.parkD(s, 1);
  let laneK = 1;                                                  // start in your own lane
  /** one lane across: dir +1 = left, -1 = right. Skips a parking lane that doesn't exist here. */
  function laneShift(dir) {
    let k = laneK + dir;
    while (k >= 0 && k <= 3 && laneAt(car.s, k) === null) k += dir;
    if (k < 0 || k > 3) return;                                     // already in the outermost lane on that side
    laneK = k;
  }
  /** aim at the centre of the chosen lane as it is HERE, every frame */
  function followLane() {
    if (laneAt(car.s, laneK) === null) laneK = laneK === 0 ? 1 : 2; // that parking lane ended: step onto the road
    car.targetD = laneAt(car.s, laneK);
  }
  let camA = route.at(0).a, arrivalFrom = null;
  const result = { arrived: false, parked: false, timeLeft: 0, cleanPark: false, hits: 0, tokens: 0, nearMisses: 0, bonus: 0 };

  function park() {
    state = 'parked';
    Object.assign(result, { arrived: true, parked: true, timeLeft: Math.max(0, t), hits, tokens, nearMisses });
    result.cleanPark = Math.abs(car.d - spot.d) < 0.8;
    result.bonus = Math.round(result.timeLeft * 50 + tokens * 25 + nearMisses * 50 + (result.cleanPark ? 500 : 0) + (hits === 0 ? 300 : 0));
    result.bully = raceResult();
    flash(result.cleanPark ? 'CLEAN PARK! 🅿️' : 'PARKED 🅿️', 2600);
    // then the race result, while the camera swings down to the store (the hint line is cleared while parked, so it's the big message)
    if (result.bully) setTimeout(() => { if (root.isConnected) flash(result.bully.caughtUp ? 'HE’S RIGHT BEHIND YOU!' : `${result.bully.lead.toFixed(1)}s AHEAD`, 2200); }, 1300);
    audio.chime(); endT = 0; haptic(HAP.parked);
  }

  // ---------- BUSTED: hit a police car and the run is over ----------
  // the cruiser you hit lights up and stops; backup rolls in behind you, lights and siren; then it's jail
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const beacons = [], busted = {};
  const poseOf = (e) => () => {
    if (e.cross) return { x: e.cross.x, y: e.cross.y, z: e.cross.zAbs + LEVEL.ROAD, a: e.cross.h };
    const p = route.at(e.s, e.d), z = surfAt(p.x, p.y, p.z + 1.2) ?? p.z + LEVEL.ROUTE;
    return { x: p.x, y: p.y, z, a: p.a + (e.dir === -1 ? Math.PI : 0) };
  };
  function lightsOn(pose) {
    const mk = (col) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    const red = mk(0xff1a1a), blue = mk(0x2a5cff), g = new THREE.Group(); g.add(red, blue); scene.add(g);
    beacons.push({ g, red, blue, pose });
  }
  function updateBeacons(now) {
    const ph = Math.floor(now / 110) % 6;   // red-red, blue-blue, both
    for (const b of beacons) {
      const p = b.pose(), lx = -Math.sin(p.a) * 0.42, ly = Math.cos(p.a) * 0.42;   // across the light bar
      b.g.position.copy(toV3(p.x, p.y, p.z + 1.72));
      b.red.position.set(lx, 0, -ly); b.blue.position.set(-lx, 0, ly);
      const r = ph < 2 || ph === 4, bl = (ph >= 2 && ph < 4) || ph === 4;
      b.red.scale.setScalar(r ? 2.2 : 0.5); b.blue.scale.setScalar(bl ? 2.2 : 0.5);
      b.red.material.opacity = r ? 1 : 0.25; b.blue.material.opacity = bl ? 1 : 0.25;
    }
  }
  function bust(e) {
    state = 'busted'; endT = 0;
    Object.assign(result, { hits, tokens, nearMisses, busted: true, bonus: 0 });
    hud.msg.classList.add('busted'); flash('BUSTED', 600000); setHint('');
    if (e.cross) e.cross.v = 0; else Object.assign(e, { v: 0, v0: 0, cruise: 0 });   // the cruiser you hit stops
    lightsOn(poseOf(e));
    const backup = world.add('police', { s: Math.max(-15, car.s - 60), d: car.d, v: 18, cruise: 18, dir: 1, color: 0xffffff, backup: true });
    lightsOn(poseOf(backup)); busted.backup = backup;
    audio.siren(); haptic(HAP.busted);
  }
  function showBusted() {
    if (root.querySelector('.drive-busted')) return;
    msgOut();
    const card = document.createElement('div'); card.className = 'drive-busted';
    card.innerHTML = '<h2>BUSTED</h2><p>You hit a police car. You’re going to jail.</p><button type="button">Drive again</button>';
    card.querySelector('button').addEventListener('click', () => { haptic(HAP.tap); finish(); }, { once: true });
    tapHaptic(card.querySelector('button'));
    root.appendChild(card);
    if (G) G.timeline()   // the jail card: dims in, BUSTED slams down, then the line and the button rise
      .from(card, { opacity: 0, duration: 0.3, ease: 'power1.out' })
      .from(card.querySelector('h2'), { scale: 2.4, opacity: 0, duration: 0.5, ease: 'back.out(2.5)' }, 0.05)
      .from(card.querySelectorAll('p, button'), { y: 18, opacity: 0, duration: 0.35, stagger: 0.1, ease: 'power2.out' }, 0.3);
    if (QA && window.__botReport) setTimeout(() => { if (root.isConnected) finish(); }, 2500);   // the autopilot doesn't wait for a tap
  }

  // ---------- the chase on foot: run to your car with the bully behind you ----------
  // Your car is parked at the right curb a short run up the block, in a stretch of parking lane long enough for it,
  // hazards flashing so you can pick it out of the parked cars. (No parking lane there: it's pulled over in the lane.)
  let homeS = null;
  const firstS = FOOT.start + FOOT.carAhead;
  // ...and on level enough ground that it sits square (Luckie St is steep: on its cross-slope a car rolls ~10°)
  const roadTop = (x, y) => surfAt(x, y, ground(x, y) + 1.2) ?? ground(x, y) + LEVEL.ROUTE;
  const lie = (s, d) => { const q = route.at(s, d), st = standOn(roadTop, q.x, q.y, q.a, 1.47, 0.82); return Math.abs(st.roll) + 0.5 * Math.abs(st.pitch); };
  let bestLie = Infinity, bestS = null;
  for (let s = firstS; s < firstS + 70; s += 1) {
    let ok = true; for (let k = -4; k <= 4 && ok; k++) if (route.parkD(s + k, -1) === null) ok = false;
    if (!ok) continue;
    const l = lie(s, route.parkD(s, -1));
    if (l < 0.035) { homeS = s; break; }
    if (l < bestLie) { bestLie = l; bestS = s; }
  }
  if (homeS === null && bestS !== null && bestLie < 0.09) homeS = bestS;
  const inParkLane = homeS !== null;
  if (!inParkLane) homeS = firstS + 10;
  const homeD = inParkLane ? route.parkD(homeS, -1) : route.lane(homeS, 0);
  const doorS = homeS + 0.25, doorD = homeD + 1.15;            // the driver's door: the street side of the car
  // nobody else is parked in your space
  for (const e of world.ents) if (e.parked && e.d < 0 && Math.abs(e.s - homeS) < 7.5) e.alive = false;
  world.ents = world.ents.filter((e) => e.alive);
  if (!SKIPFOOT) { car.s = homeS; car.d = car.targetD = homeD; laneK = inParkLane ? 0 : 1; }
  // hazard lamps on the four corners of your car (children of the car, so they sit on it wherever it is)
  const hazardMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffa21a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const hazards = new THREE.Group();
  for (const [x, z] of [[-0.82, 2.15], [0.82, 2.15], [-0.8, -2.2], [0.8, -2.2]]) { const sp = new THREE.Sprite(hazardMat); sp.position.set(x, 0.78, z); sp.scale.setScalar(0.9); hazards.add(sp); }
  carRig.add(hazards); hazards.visible = !SKIPFOOT;
  const youMarker = makeLabel('▼', '#ffd400'); youMarker.material.depthTest = false; youMarker.renderOrder = 5;
  const markerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: youMarker.material.map, transparent: true, depthTest: false, toneMapped: false }));
  markerSprite.scale.set(1.3, 1.3, 1); markerSprite.position.set(0, 2.9, 0); markerSprite.renderOrder = 5; carRig.add(markerSprite); markerSprite.visible = !SKIPFOOT;

  // you and the bully: the store's character in 3D (people.js), with a walk and a run
  const clips = { walk: charGltf.animations.find((a) => a.name === 'walk') }; clips.run = makeRunClip(clips.walk);
  // how far one run cycle carries you, measured off the clip (a foot's sweep front to back, twice per cycle), so the
  // feet don't skate at any speed
  const strideOf = (h) => {
    const o = SkeletonUtils.clone(charGltf.scene), mx = new THREE.AnimationMixer(o), act = mx.clipAction(clips.run); act.play();
    const foot = o.getObjectByName('L_Foot'), hip = o.getObjectByName('Hip'), a = new THREE.Vector3(), b = new THREE.Vector3();
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 40; i++) { mx.setTime(clips.run.duration * i / 40); o.updateMatrixWorld(true); foot.getWorldPosition(a); hip.getWorldPosition(b); lo = Math.min(lo, a.z - b.z); hi = Math.max(hi, a.z - b.z); }
    return 2 * (hi - lo) * h / MODEL_H;
  };
  function makePerson(bully) {
    const o = SkeletonUtils.clone(charGltf.scene), h = bully ? BULLY_H : PLAYER_H;
    o.scale.setScalar(h / MODEL_H);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; if (bully) m.material = makeBullyMaterial(m.material); } });
    const mixer = new THREE.AnimationMixer(o), run = mixer.clipAction(clips.run); run.play();
    scene.add(o);
    return { o, mixer, run, stride: strideOf(h), s: 0, d: 0, v: 0, z: 0, stun: 0, pause: 0, phase: 0 };
  }
  const me = makePerson(false), him = makePerson(true);
  const sidewalk = (s) => { const [lo, hi] = crowd.bandAt(-1, s); return -(lo + (hi - lo) * 0.3); };
  let footLane = 0;                                                // 0 the curb side of the sidewalk, 1 the building side
  const footLineD = (s) => { const [lo, hi] = crowd.bandAt(-1, s); return -(lo + (hi - lo) * (footLane ? 0.78 : 0.22)); };
  Object.assign(me, { s: FOOT.start, d: sidewalk(FOOT.start) });
  Object.assign(him, { s: FOOT.start - FOOT.bullyBehind, d: sidewalk(FOOT.start - FOOT.bullyBehind) });
  me.o.visible = him.o.visible = !SKIPFOOT;
  let footT = 0, found = false, race = null, tauntK = 0;
  const TAUNTS = ['HEY! YOU!', 'GET BACK HERE!', 'THOSE ARE MINE!', 'GIMME THAT!'];
  const footZ = (s, d) => { const p = route.at(s, d), gz = ground(p.x, p.y); return { p, z: Math.max(surfAt(p.x, p.y, gz + 1.2) ?? -Infinity, gz + LEVEL.TERRAIN) }; };
  function placePerson(m, dt, yawFwd = true) {
    const { p, z } = footZ(m.s, m.d); m.z = z;
    m.o.position.copy(toV3(p.x, p.y, z));
    const a = route.at(m.s).a + (yawFwd ? 0 : Math.PI);
    m.o.rotation.set(0, a + Math.PI / 2, 0);
    // the run plays at the speed you're actually covering ground; standing still holds a mid-stride pose
    const sp = Math.abs(m.v);
    m.run.timeScale = sp > 0.2 ? sp / m.stride * clips.run.duration : 0;
    m.mixer.update(dt);
  }
  function getIn() {
    state = 'driving'; me.o.visible = false; hazards.visible = false; markerSprite.visible = false;
    // you peel out: the car swings straight into the travel lane (the parking lane ahead is full of parked cars)
    laneK = 1; followLane(); if (BOT) car.targetD = route.lane(car.s, 0);
    hud.pop.replaceChildren();   // a taunt still floating up would sit on top of GO! GO! GO!
    flash('GO! GO! GO!', 900); setHint(''); haptic(HAP.go); audio.chime();
    // he runs for his own ride (just behind where he's standing), then he's coming
    race = { s: him.s - 2, v: 0, hop: RACE.hop + Math.max(0, him.pause), tail: false, shookAt: 0 };
    raceBar.hidden = false;
  }
  function updateFoot(dt) {
    footT += dt;
    // you: hold GAS to run up the block, BRAKE to back up if you overshoot; you cut over to the driver's door yourself
    const want = me.stun > 0 ? 0 : (keys.has('gas') || BOT) ? FOOT.run : keys.has('down') ? -FOOT.back : 0;
    me.stun = Math.max(0, me.stun - dt);
    me.v += THREE.MathUtils.clamp(want - me.v, -16 * dt, 10 * dt);
    me.s += me.v * dt;
    const toCar = doorS - me.s, k = THREE.MathUtils.clamp((9 - Math.abs(toCar)) / 6, 0, 1);
    // ◀ ▶ pick your line on the sidewalk (◀ the curb side, ▶ the building side) to get round people; near the car you
    // cut over to its door
    const dWant = THREE.MathUtils.lerp(footLineD(me.s), doorD, k);
    me.d += THREE.MathUtils.clamp(dWant - me.d, -4.2 * dt, 4.2 * dt);
    // run into someone and you stumble (the bully just shoves through them)
    for (const q of crowd.people) {
      if (q.g.side !== -1 || Math.abs(q.s - me.s) > 3) continue;
      const qd = -q.d;
      if (Math.abs(q.s - me.s) < 0.55 && Math.abs(qd - me.d) < 0.5 && me.stun <= 0 && (q.bumped || 0) < footT) {
        q.bumped = footT + 2; q.startle = 1; me.v *= 0.2; me.stun = 0.35; shake = 0.35;
        pop('WATCH IT!'); audio.crash(0.15); haptic(HAP.bump); tauntK = Math.max(tauntK, 1);
      }
      if (Math.abs(q.s - him.s) < 0.7 && Math.abs(qd - him.d) < 0.6) q.startle = 1;
    }
    if (!found && footT > 2.2 && footT < 2.4) setHint('Hold GAS — run to your car');
    if (!found && toCar < 14) { found = true; audio.token(); setHint('That’s your ride — get in!'); }
    // the bully: a beat to clock you, then he runs you down; catching you is a shove, not the end
    him.pause = Math.max(0, him.pause - dt);
    const go = footT > FOOT.bullyGo && him.pause <= 0;
    him.v += THREE.MathUtils.clamp((go ? FOOT.bully : 0) - him.v, -12 * dt, 7 * dt);
    him.s = Math.min(him.s + him.v * dt, me.s - 0.7);
    him.d += THREE.MathUtils.clamp(me.d - him.d, -2.8 * dt, 2.8 * dt);
    if (go && me.s - him.s < FOOT.reach && Math.abs(me.d - him.d) < 1 && me.stun <= 0) {
      me.stun = FOOT.stun; me.v = 0; him.v = 0; him.pause = FOOT.pause; shake = 0.7;
      flash('SHOVED!', 800); audio.crash(0.35); haptic(HAP.crash); tauntK = 1.6;   // no taunt on top of SHOVED!
    }
    tauntK -= dt;
    if (go && tauntK <= 0 && me.stun <= 0 && me.s - him.s < 9) { tauntK = 2.6; pop(TAUNTS[(Math.random() * TAUNTS.length) | 0]); }
    if (Math.abs(me.s - doorS) < 1.4 && Math.abs(me.d - doorD) < 0.6 && me.stun <= 0) getIn();
    hud.dist.textContent = Math.max(0, Math.round(doorS - me.s)) + ' m';
  }
  // after you drive off he's still out there for a moment, running for his ride, until he's behind the camera
  function updateHimLeft(dt) {
    if (!him.o.visible) return;
    him.v += THREE.MathUtils.clamp(FOOT.bully * 0.7 - him.v, -8 * dt, 6 * dt); him.s += him.v * dt;
    if (car.s - him.s > 25) him.o.visible = false;
    placePerson(him, dt);
  }
  // ---------- the race (the bar at the top) ----------
  function updateRace(dt) {
    if (!race) return;
    if (race.hop > 0) race.hop -= dt;
    else { race.v = Math.min(RACE.pace, race.v + RACE.accel * dt); race.s += race.v * dt; }
    const gap = car.s - race.s;
    if (!race.tail && gap < RACE.tail && state === 'driving') {
      race.tail = true; flash('HE CAUGHT UP!', 1300); haptic(HAP.crash); audio.air();
    }
    if (race.tail) {
      race.s = Math.min(race.s, car.s - RACE.tail * 0.8);                 // on your bumper: he can't get past you
      if (car.s - race.s > RACE.shake) { race.tail = false; flash('YOU SHOOK HIM!', 1200); haptic(HAP.nearMiss); }
    }
  }
  function raceResult() {
    if (!race) return null;
    const lead = race.tail ? 0 : Math.max(0, (spot.s - race.s) / RACE.pace + Math.max(0, race.hop));
    return { lead: Math.round(Math.min(RACE.maxLead, lead) * 10) / 10, caughtUp: race.tail };
  }
  const raceBar = root.querySelector('.drive-race'), rYou = raceBar.querySelector('.you'), rHim = raceBar.querySelector('.him'), rGap = raceBar.querySelector('.gap');
  raceBar.hidden = SKIPFOOT;
  const raceFrom = Math.min(him.s, me.s) - 2;
  function drawRaceBar() {
    if (raceBar.hidden) return;
    const span = spot.s - raceFrom, at = (s) => THREE.MathUtils.clamp((s - raceFrom) / span, 0, 1) * 100 + '%';
    const youS = state === 'onfoot' ? me.s : car.s, himS = race ? race.s : him.s;
    const lx = at(youS), hx = at(himS);
    if (rYou.style.left !== lx) rYou.style.left = lx;
    if (rHim.style.left !== hx) rHim.style.left = hx;
    const gapS = race ? (race.tail ? 0 : (youS - himS) / Math.max(6, race.v || RACE.pace)) : (me.s - him.s) / FOOT.bully;
    raceBar.classList.toggle('hot', gapS < 2.5);
    setText(rGap, race && race.tail ? 'ON YOUR TAIL!' : state === 'onfoot' ? 'RUN!' : `+${gapS.toFixed(1)}s`);
  }

  // ---------- loop ----------
  let last = performance.now(), raf = 0, acc = 0;
  let holding = false;   // the first picture is up under the loader; nothing moves until the loader has faded off it
  const FIXED = 1 / 120;
  // The physics runs in fixed 1/120 s steps, but frames don't land on step boundaries (a phone's frame times wobble,
  // and many screens aren't 60 or 120 Hz), so drawing the car exactly where the last step left it showed it up to
  // a step behind on some frames and not others: a hitch, most visible in a quick lane change. The car (and the
  // camera following it) is drawn between the last two steps instead, acc / FIXED of the way.
  let prevS = car.s, prevD = car.d;
  function frame(ts) {
    raf = nextFrame(frame);
    if (root.clientWidth + 'x' + root.clientHeight !== sized) resize();
    // the time of THIS frame on screen (requestAnimationFrame's timestamp: the same for everything drawn in it), not
    // whenever this callback happened to start: the start wanders by a few ms frame to frame on a busy phone, and
    // stepping the world by that wandering amount made motion judder even at a steady frame rate
    const now = typeof ts === 'number' ? ts : performance.now(), dt = Math.max(0, Math.min((now - last) / 1000, 0.05)); last = now;
    adaptRes(now);
    if (paused || api.pause || holding) { comic.render(); return; }   // paused (or QA freeze-frame): the world holds still   // QA: freeze-frame for look-dev
    hornT -= dt;
    if (state === 'countdown') {
      countdown -= dt;
      const cd = countdown > 0 ? String(Math.ceil(countdown)) : 'GO!';
      if (cd !== hud.msg.textContent) { hud.msg.textContent = cd; msgIn(); }   // each number punches in as it changes
      if (countdown <= 0) { state = 'driving'; flash('GO!', 700); setHint(''); haptic(HAP.go); }
    }
    if (state === 'onfoot') {
      updateFoot(dt);
      if (state === 'onfoot') placePerson(me, dt);   // (getIn() may have just put you in the car)
      placePerson(him, dt);
      hazardMat.opacity = Math.floor(now / 380) % 2 ? 1 : 0.12;
      markerSprite.position.y = 2.9 + Math.sin(now / 180) * 0.15;
    } else if (race) updateHimLeft(dt);
    if (race && state === 'driving') updateRace(dt);
    drawRaceBar();
    setText(hud.dist.previousElementSibling, state === 'onfoot' ? 'YOUR CAR' : 'STORE');
    const braking = keys.has('down');
    // Stiff lane steering: each press of ◀ ▶ moves the whole car exactly one lane (tapLane, the moment it's
    // pressed); holding does nothing further. The car never turns: runner.js pins yaw to zero on the lateral path,
    // and the front wheels and body lean are held still below, so the car slides across parallel to the road.
    // Here: keep aiming at the chosen lane's centre as the street widens and narrows.
    if (state === 'driving' && !BOT) followLane();
    if (state === 'driving') steerFeel();
    const approaching = car.s > spot.s - 95;
    if (state === 'driving' || state === 'parked' || state === 'late' || state === 'busted') {
      acc += dt;
      while (acc >= FIXED) {
        acc -= FIXED;
        prevS = car.s; prevD = car.d;   // where the car was one physics step ago, to draw it between steps
        car.step(FIXED, {
          // once the run is over (parked / late / busted) the brake holds the car where it stopped: without `hold`,
          // a held brake at a standstill is reverse, and the car used to back out of the spot during the arrival shot
          targetD: car.targetD, brake: braking || state !== 'driving', hold: state !== 'driving', gas: state === 'driving' && keys.has('gas') ? 1 : 0,
          stopAt: approaching ? spot.s : undefined, lanes: laneCentres(car.s),
          // steer omitted on purpose: that selects runner.js's lateral path,
          // which springs d toward targetD and never touches yaw.
        });
      }
    }
    if (state === 'driving') {
      if (!api.freezeClock) t -= dt; drove += dt;   // QA: freezeClock holds the timer for look-dev
      trams.update(dt, car);
      const ev = world.update(dt, car, drove, hornT > 0 ? 1 : 0);
      for (const h of ev.hits) {
        hits++; car.v *= 1 - 0.65 * h.power; car.stun = 0.5 * h.power; car.invuln = 1.0; shake = Math.min(1, 0.4 + h.power * 0.6);
        if (h.power > 0.9) { t -= 1; flash('−1s  ' + h.label, 700); } else if (h.label) flash(h.label, 700);
        audio.crash(h.power); haptic(h.power > 0.9 ? HAP.crash : HAP.bump);
        if (h.e.type !== 'panhandler') { // sparks where the metal meets; plastic chips off cones and barricades
          const cp = car.pose, ep = route.at(h.e.s, h.e.d);
          const at = toV3((cp.x + ep.x) / 2, (cp.y + ep.y) / 2, (cp.z + ep.z) / 2 + 0.6);
          fx.burst(at, new THREE.Vector3(Math.cos(cp.a), 0, -Math.sin(cp.a)), { power: h.power, kind: h.e.solid < 0.8 ? 'plastic' : 'metal', color: h.e.color });
        }
        if (h.busted) { bust(h.e); break; }
      }
      if (ev.nearMiss) { nearMisses += ev.nearMiss; pop('NEAR MISS +50'); audio.whoosh(); haptic(HAP.nearMiss); }
      if (ev.tokens) { tokens += ev.tokens; pop('+' + ev.tokens * 25); audio.token(); haptic(HAP.token, 60); bump(tokBox); }
      if (approaching) setHint(Math.abs(car.d - spot.d) < 0.8 ? 'Nice — hold the curb' : 'Pull right to the curb ▸');
      if (state === 'driving' && approaching && car.v < 0.3 && Math.abs(car.s - spot.s) < 2) park();
      if (state === 'driving' && t <= 0) { t = 0; state = 'late'; Object.assign(result, { hits, tokens, nearMisses, bully: raceResult() }); flash('TOO LATE — walk it in', 2600); endT = 0; }
    } else if (state === 'busted') {   // the street carries on around you while the police pull up
      trams.update(dt, car); world.update(dt, car, drove, 0);
      endT += dt;
      // once backup has pulled up, an officer gets out and walks up to your door
      const b = busted, bk = b.backup;
      if (!b.officer && bk && bk.v < 0.3 && car.s - bk.s < 16) b.officer = world.add('officer', { s: bk.s + 1.2, d: bk.d + 1.2, scenery: true, color: 0x1c2740, hd: 0 });
      if (b.officer) {
        const o = b.officer, ts = car.s - 0.4, td = car.d + 1.35, ds = ts - o.s, dd = td - o.d, L = Math.hypot(ds, dd);
        if (L > 0.1) { const k = Math.min(1, 1.5 * dt / L); o.s += ds * k; o.d += dd * k; o.hd = Math.atan2(dd, ds); }
        else { o.hd = -Math.PI / 2; b.at = (b.at || 0) + dt; }   // at the driver's window
      }
      if (endT > 9 || b.at > 0.9) showBusted();
    } else {
      world.update(0, car, drove, 0);
    }
    if (state === 'parked' || state === 'late') {
      endT += dt; setHint('');
      if (endT > 4.2) { finish(); return; } // 2.4 s camera swing + a beat on the storefronts
    }

    // car transform
    if (Math.abs(car.s - prevS) > 2 || Math.abs(car.d - prevD) > 2) { prevS = car.s; prevD = car.d; }   // put there by a test hook (?demo), not driven: no in-between
    const along = Math.min(1, acc / FIXED), drawS = prevS + (car.s - prevS) * along, drawD = prevD + (car.d - prevD) * along;
    const p = route.at(drawS, drawD); p.a += car.yaw || 0;   // = car.pose, drawn between physics steps (see FIXED)
    // all four wheels on the road: height, pitch and roll from the ground under the axles and both sides
    const onRoad = (x, y) => surfAt(x, y, ground(x, y) + 1.2) ?? ground(x, y) + LEVEL.ROUTE;
    const st = standOn(onRoad, p.x, p.y, p.a, 1.47, 0.82);
    carRig.position.copy(toV3(p.x, p.y, st.z));
    carRig.rotation.set(st.pitch, p.a - Math.PI / 2, st.roll, 'YXZ');
    carModel.rotation.z = 0;   // stiff: no lean into a lane change, the car moves as one block
    carModel.visible = car.invuln <= 0 || Math.floor(car.invuln * 12) % 2 === 0; // blink while recovering
    const lit = keys.has('down') || car.accel < -4;
    for (const m of tailLamps) { m.emissive.copy(lit ? BRAKE_GLOW : m.userData.base.color); m.emissiveIntensity = lit ? 4 : m.userData.base.k; }
    wheelRoll = (wheelRoll + car.v * dt / TYRE_R) % (Math.PI * 2);
    for (const w of wheelSpin) w.o.quaternion.copy(w.q0).multiply(dq.setFromAxisAngle(X, wheelRoll));
    // front wheels stay straight: a lane change is a sideways slide of the whole car, not a steer
    for (const w of wheelSteer) w.o.quaternion.copy(w.q0);
    world.render(car, drove);
    signals.update(dt); WIND.value += dt;   // traffic lights; the tree canopies sway
    if (state !== 'driving') { world.updateFrustum(); trams.render(); }   // (world.update keeps the frustum current while driving)
    crowd.update(dt, car, hornT);
    birds.update(dt, car, drove, hornT > 0 ? 1 : 0); updateBeacons(now);
    fx.update(dt, camera, renderer);
    beacon.material.opacity = 0.12 + 0.08 * Math.sin(now / 250);
    spotGroup.visible = state === 'driving' || state === 'countdown';
    // overpass cutaway follows the car (a soft hole in anything above it). Still needed from behind: the Connector's
    // deck underside is only ~2.1 m above the route around s=1056 m, so the chase camera passes through the slab, and
    // without the hole the deck walls off the view ahead (checked in the running game, same frame with and without).
    // The shader cuts freeway concrete more than 2.2 m above uCutPos (roads.js:92); that was set for the overhead
    // camera. At the bottom of the deck's dip (s~1051-1059) the underside is only 1.81 m above the car (measured by
    // ray-cast in the game), so it stayed solid and hid the car completely from the chase camera. Placing uCutPos
    // 0.75 m below the car starts the cut at 1.45 m: just above the roof. Compared frame for frame: the car is clear
    // at 1056 m, and at 1050 / 1063 m it changes 0.4% / 1% of the screen (the low end of a ramp slab near the car).
    // Radius: 11 m (the original) reaches the camera when parked (8 m back), but at speed the camera trails 12-14 m
    // back, inside the slab and outside the circle, and the screen filled with concrete (car hidden on 10 of 41
    // frames at 46 mph). So the circle grows to reach 3 m past the camera. Tried against a circle centred between
    // camera and car: both kept the car in view on every frame, but that one's soft edge dithered across the deck
    // overhead; this one's edge falls behind the camera. Capped at 25 m so a camera that isn't placed yet (first
    // frame) or is mid-swing can't wipe the whole freeway for a frame.
    const camGap = Math.hypot(camera.position.x - carRig.position.x, camera.position.z - carRig.position.z);
    CUT.uCutPos.value.copy(carRig.position);
    CUT.uCutPos.value.y -= 0.75;
    CUT.uCutR.value = Math.min(25, Math.max(11, camGap + 3));

    // camera: rear third-person chase view, low and close behind the car, anchored on the car's own position so it
    // follows every lane change.
    // Sized to the CAR, not the street. The overhead camera sized its distance to fit the whole street across the
    // screen, which is right when looking down; behind the car, that same distance put the camera ~37 m back and the
    // car shrank to a speck (measured in the running game: 34.7 m behind at 19 mph, ~35 px wide on a phone with the
    // 70 deg portrait lens). Instead: 8 m behind and 3 m up at a standstill, easing back and up with speed so you see
    // further ahead when you're going fast. 8 m keeps the rear bumper well past the camera's 4 m near plane (line 86),
    // so the car is never sliced.
    const v = Math.max(0, car.v);
    const back = 8 + v * 0.12, h = 3 + v * 0.03;
    // aim at a point ahead of the car and a little above the road, so the car sits in the lower part of the frame, the
    // street ahead (obstacles!) fills the middle and the horizon sits high; more lead in landscape, where the screen
    // is short
    const ahead = (camera.aspect > 1 ? 18 : 14) + v * 0.5;
    camA += Math.atan2(Math.sin(route.at(car.s + 6).a - camA), Math.cos(route.at(car.s + 6).a - camA)) * Math.min(1, dt * 3);
    const look = route.at(drawS + ahead, drawD * 0.35);
    let targetPos, targetLook;
    if (state === 'parked' || state === 'late') {
      // arrival: swing down to the street-level view of the storefronts (the intro's framing)
      const k = Math.min(1, endT / 2.4), e = k * k * (3 - 2 * k);
      const high = arrivalFrom || (arrivalFrom = camPos.clone()), street = toV3(-3, 21, ground(-3, 21) + 2.6);
      targetPos = high.clone().lerp(street, e);
      targetLook = toV3(p.x, p.y, p.z).lerp(toV3(-3, 0, ground(-3, 0) + 4.2), e);
    } else if (state === 'onfoot') {
      // on foot: high behind you, a little to the street side, looking up the block. High enough to see over the
      // bully on your heels and past the poles at the curb: from 3 m up and 6 m back (the first version) a signal
      // pole beside the camera hid you completely at the start, and the bully, once close, stood between you and the
      // camera (both checked in the running game). From here you, him and the sidewalk ahead are all in frame.
      const cp = route.at(me.s - 10, me.d + 0.6);
      targetPos = toV3(cp.x, cp.y, Math.max(me.z + 6.0, ground(cp.x, cp.y) + 1.8));
      const lk = route.at(me.s + 7, me.d + 0.3);
      targetLook = toV3(lk.x, lk.y, me.z + 0.9);
      NEAR_CUT.value = 8;   // trees within 8 m of this camera are not drawn (landscape.js); you are ~12 m away
    } else {
      NEAR_CUT.value = 0;   // the driving camera keeps every tree
      // h is measured from the car, but on a steep street the ground behind the car is higher than the car: on Luckie
      // St (s~48 m) a camera 3 m above the car ended up 0.7 m off the hillside behind it. Keep at least 2.5 m of air
      // under the camera itself.
      const cx = p.x - Math.cos(camA) * back, cy = p.y - Math.sin(camA) * back;
      targetPos = toV3(cx, cy, Math.max(p.z + h, ground(cx, cy) + 2.5));
      targetLook = toV3(look.x, look.y, look.z + 1.2);
    }
    if (!camPos.lengthSq()) { camPos.copy(targetPos); camLook.copy(targetLook); }
    if (state === 'parked' || state === 'late') { camPos.copy(targetPos); camLook.copy(targetLook); }
    else { camPos.lerp(targetPos, Math.min(1, dt * 6)); camLook.lerp(targetLook, Math.min(1, dt * 8)); }
    if (api.camOverride) { camPos.copy(api.camOverride.pos); camLook.copy(api.camOverride.look); } // QA: free camera
    camera.position.copy(camPos);
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 1.2; camera.position.z += (Math.random() - 0.5) * shake * 1.2; shake = Math.max(0, shake - dt * 3); }
    camera.lookAt(camLook);
    sky.follow(camera);

    sun.position.copy(carRig.position).add(tmp.copy(sun.userData.dir || new THREE.Vector3(-0.5, 0.8, 0.35)).multiplyScalar(220));
    sun.target.position.copy(carRig.position);

    // the pedal the engine hears: light throttle to hold speed, more to pull away (never floored for long), none
    // coasting or on the brakes
    const pedal = state === 'driving' && keys.has('gas') && !braking ? Math.max(0.2, Math.min(1, 0.3 + car.accel / 9)) : 0;
    // tyre squeal from a lane change: counted as the side speed the car used to be limited to (3 m/s + 0.6 x road
    // speed), so the much quicker lane change squeals the tyres no more than before, and not at all from a stop
    const sideSlip = Math.min(Math.abs(car.dv), 3 + Math.abs(car.v) * 0.6);
    audio.update(car.v, pedal, Math.min(1, sideSlip / 14 + (braking && car.v > 6 ? 0.6 : 0)), dt);
    setText(hud.time, t.toFixed(1));
    hud.time.classList.toggle('low', t < 10);
    if (t < 10 && state === 'driving') { const sec = Math.ceil(t); if (sec !== lowSec) { lowSec = sec; bump(timeBox, 1.14); } }   // last ten seconds: the clock pulses each second
    setText(hud.speed, Math.round(v * 2.237) + ' mph');
    setText(hud.dist, Math.max(0, Math.round(spot.s - car.s)) + ' m');
    // the next traffic light, readable on a phone (the real lamps are small from up here)
    const nl = state === 'driving' ? signals.next(car.s + 2.5) : null;
    const lightClass = 'drive-light' + (nl ? ' on ' + nl.aspect : '');
    if (hud.light.className !== lightClass) hud.light.className = lightClass;
    if (nl) setText(hud.lightDist, Math.round(nl.gap) + ' m');
    setText(hud.tokens, String(tokens));
    city.cull(camera, scene.fog);   // skip what can't show: sunk grass tiles, flat ground cover past the end of the fog
    comic.render();
  }

  // The way out fades to black inside the drive (a veil over it), never to whatever page is underneath: fading the
  // whole drive out used to show the store under it for most of the fade, then cut to the black how-to-play.
  // Black to black, the next screen (the store's how-to-play, or the drive again after BUSTED) comes up seamlessly.
  let finished = false;
  function finish() {
    if (finished) return; finished = true;   // SKIP tapped twice, or SKIP and the bot's timer: one exit
    cancelFrame(raf); audio.stop(); document.removeEventListener('visibilitychange', onHide);
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', resize);
    const veil = document.createElement('div'); veil.className = 'drive-veil'; root.appendChild(veil);
    const done = () => {
      renderer.dispose(); renderer.forceContextLoss();   // hand the GPU memory back now, not whenever the page gets round to it
      root.remove(); onDone({ ...result });
    };
    if (G) G.to(veil, { opacity: 1, duration: SCREEN_FADE, ease: 'power1.inOut', onComplete: done });
    else { veil.getBoundingClientRect(); veil.classList.add('on'); setTimeout(done, SCREEN_FADE * 1000); }   // drive.css fades it
  }

  progress(1, 'Ready');
  const loadingScreen = root.querySelector('.drive-loading');
  const skip = () => { haptic(HAP.tap); paused = false; Object.assign(result, { hits, tokens, nearMisses }); finish(); };
  root.querySelector('[data-skip]').addEventListener('click', skip);
  root.querySelector('[data-pause]').addEventListener('click', () => { haptic(HAP.tap); setPaused(true); });
  root.querySelector('[data-resume]').addEventListener('click', () => { haptic(HAP.tap); setPaused(false); });
  root.querySelector('[data-quit]').addEventListener('click', skip);
  for (const el of root.querySelectorAll('[data-skip], [data-pause], [data-resume], [data-quit]')) tapHaptic(el);
  // leaving the app mid-drive pauses it (a call, a text, the home screen): nothing happens while you're away
  const onHide = () => { if (document.hidden && (state === 'driving' || state === 'countdown' || state === 'onfoot')) setPaused(true); };
  document.addEventListener('visibilitychange', onHide);
  // build every shader the run can need now, while the level is appearing, instead of the first time each thing comes
  // into view (the first EBT token, the first hazard ring, the first crash's sparks and debris): building a shader
  // mid-drive freezes the frame it happens in. compile() covers every material in the scene, shown or not; with
  // KHR_parallel_shader_compile the browser builds them in the background.
  try { renderer.setRenderTarget(comic.target); renderer.compileAsync(scene, camera).catch(() => {}); } catch {} finally { renderer.setRenderTarget(null); }
  // same for textures: each one is sent to the GPU the first time something using it is on screen (the lawn photos
  // only when the first park comes into view), which stalls that frame; send them all now
  const sent = new Set();
  scene.traverse((o) => { for (const m of [].concat(o.material || [])) for (const v of Object.values(m)) if (v?.isTexture && !sent.has(v)) { sent.add(v); try { renderer.initTexture(v); } catch {} } });
  // The loader stays up until the first picture is actually on screen. That first frame is the slow one (the GPU
  // builds every shader and uploads every texture it needs), so it runs under the loader: placing you, the bully and
  // the camera, then drawing. Then two display frames for it to reach the screen, and only then the loader fades
  // (it used to start fading before the first frame was drawn, so on a phone it froze half-faded while the GPU
  // caught up). Nothing moves while it fades (holding): the chase starts on the picture you can see. The loader sits
  // above the HUD (drive.css), so no button shows before the screen is ready; the HUD drops in as it lifts.
  last = performance.now(); frame(); holding = true;
  await new Promise((ok) => nextFrame(() => nextFrame(ok)));
  const go = () => { holding = false; last = performance.now(); };
  if (G) {   // the loading screen fades away; the HUD drops in from the top and the pedals rise from the bottom
    G.to(loadingScreen, { opacity: 0, duration: SCREEN_FADE, ease: 'power1.inOut', onComplete: () => { loadingScreen.remove(); go(); } });
    G.from(root.querySelectorAll('.drive-hud > *'), { y: -24, opacity: 0, duration: 0.45, stagger: 0.07, delay: 0.15, ease: 'back.out(1.7)', clearProps: 'transform,opacity' });
    G.from(root.querySelectorAll('.drive-pad'), { y: 40, opacity: 0, duration: 0.5, stagger: 0.08, delay: 0.2, ease: 'back.out(1.5)', clearProps: 'transform,opacity' });
  } else { loadingScreen.remove(); go(); }
  // test hooks (drive QA + screenshots)
  Object.assign(api, { car, world, route, spot, keys, result, audio, fx, city, comic, adaptRes: { res, step: adaptRes, PR_MIN, PR_MAX },
    three: { scene, camera, carRig, THREE, renderer },
    ui: { flash, pop, bump, setHint, showBusted, gsap: G },   // the HUD's motion, for tests
    snapshot: (q = 0.85) => { comic.render(); return renderer.domElement.toDataURL('image/jpeg', q); } });
  // live getters (Object.assign would have frozen their values at assignment time)
  Object.defineProperties(api, { state: { get: () => state }, time: { get: () => t }, race: { get: () => race } });
  api.foot = { me, him, homeS, homeD, doorS, doorD };
  window.__drive = api;
  return api;
}

const KEYMAP = { ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'horn', KeyH: 'horn' };

function makeLabel(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = color; g.font = 'bold 110px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
}

const HUD_HTML = `
<div class="drive-hud">
  <div class="drive-box"><span>TIME</span><b class="drive-time">60.0</b></div>
  <div class="drive-box"><span>STORE</span><b class="drive-dist">—</b></div>
  <div class="drive-box tok"><span>EBT</span><b class="drive-tokens">0</b></div>
  <div class="drive-box"><span>SPEED</span><b class="drive-speed">0 mph</b></div>
</div>
<div class="drive-race" hidden><div class="track"><b class="flag">STORE</b><i class="hd him" aria-label="The bully"></i><i class="hd you" aria-label="You"></i></div><span class="gap"></span></div>
<div class="drive-light"><i></i><i></i><i></i><b></b></div>
<div class="drive-msg"></div>
<div class="drive-pop"></div>
<div class="drive-hint"></div>
<button class="drive-skip" data-skip aria-label="Skip the drive">SKIP ▸▸</button>
<button class="drive-pausebtn" data-pause aria-label="Pause"><i></i><i></i></button>
<div class="drive-paused" hidden><b>PAUSED</b><button type="button" data-resume>RESUME ▶</button><button type="button" class="alt" data-quit>SKIP DRIVE ▸▸</button></div>
<div class="drive-pad drive-steerpad">
  <button class="dp left" data-k="left" aria-label="Steer left"><svg viewBox="0 0 24 24"><path d="M15 4 7 12l8 8"/></svg></button>
  <button class="dp right" data-k="right" aria-label="Steer right"><svg viewBox="0 0 24 24"><path d="M9 4l8 8-8 8"/></svg></button>
</div>
<div class="drive-pad drive-pedals">
  <button class="dp horn" data-k="horn" aria-label="Horn"><svg viewBox="0 0 24 24"><path d="M4 10h3l6-4v12l-6-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg><b>HORN</b></button>
  <button class="dp brake" data-k="down" aria-label="Brake, hold to reverse"><b>BRAKE</b><small>HOLD = REV</small></button>
  <button class="dp gas" data-k="gas" aria-label="Gas"><b>GAS</b></button>
</div>
<div class="drive-osm">© OpenStreetMap contributors</div>`;
