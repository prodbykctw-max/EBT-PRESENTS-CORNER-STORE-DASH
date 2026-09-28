// "Get to the Store": a 60-second auto-drive runner (Temple Run with cars) down Luckie St and Auburn Ave,
// loaded on demand by the main game.
//   const { startDrive } = await import('./drive/drive.js');
//   startDrive({ mount: document.body, muted, onDone: (result) => { /* start the store level */ } });
// result = { arrived, parked, timeLeft, cleanPark, hits, tokens, nearMisses, bonus, busted }
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { buildCity, makeGround, toV3 } from './city.js';
import { LEVEL, standOn } from './levels.js';
import { CUT } from './roads.js';
import { TopSurface } from './surface.js';
import { RouteFrame, RunnerCar, World } from './runner.js';
import { DriveAudio } from './audio.js';
import { Crowd } from './crowd.js';
import { Streetcars } from './tram.js';
import { Signals } from './signals.js';
import { Birds } from './birds.js';
import { haptic, HAP } from './haptics.js';
import { Look } from './look.js';
import { WIND } from './landscape.js';
import { ImpactFX } from './fx.js';
import { fetchWeather, applyWeather } from './weather.js';

const BASE = new URL('./', import.meta.url);
const TIME_LIMIT = 70;   // real traffic (an oncoming stream, queues at work zones) costs ~10 s of waiting on a clean run
const REAR_AXLE = 1.45; // car.glb origin sits on the rear axle; the runner tracks the car's centre
// Curbside parking space in front of the EBT Corner Store (world frame; the row faces north onto Auburn).
const SPOT = { x: 0, y: 9.0, heading: Math.PI, len: 7.0, wid: 3.0 };
// ?qa drives the loop from a timer: hidden tabs/panes pause requestAnimationFrame, which would freeze automated tests.
const QA = new URLSearchParams(location.search).has('qa');
const nextFrame = QA ? (f) => setTimeout(f, 16) : requestAnimationFrame;
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
  root.addEventListener('touchstart', (e) => { if (!e.target.closest?.('[data-skip], .drive-busted button')) e.preventDefault(); }, { passive: false });
  root.innerHTML = '<div class="drive-loading"><b>AUBURN AVE</b><span>Get to the corner store</span><i></i></div>';
  mount.appendChild(root);
  const bar = root.querySelector('.drive-loading i');
  const progress = (p, label) => { bar.style.width = p * 100 + '%'; onProgress(p, label); };
  progress(0.05, 'Loading Auburn Ave');
  const audio = new DriveAudio({ muted });
  audio.unlock(); // still inside the START tap's user activation on most browsers
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const [W, hero, carGltf, props, trees, weather] = await Promise.all([
    fetch(new URL('world.json', BASE)).then((r) => r.json()),
    loader.loadAsync(new URL('hero.glb', BASE).href),
    loader.loadAsync(new URL('car.glb', BASE).href),
    loader.loadAsync(new URL('props.glb', BASE).href),
    loader.loadAsync(new URL('trees.glb', BASE).href),
    fetchWeather(),
  ]);
  progress(0.7, 'Building the city');

  // ---------- renderer / scene ----------
  root.insertAdjacentHTML('beforeend', HUD_HTML);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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
  const camera = new THREE.PerspectiveCamera(42, 1, 4, 3000);   // near 4 m: the camera never gets closer, and the ink pass needs the depth precision
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
  const car = new RunnerCar(route, 4);
  const signals = world.signals = new Signals({ route, nodes: city.signals, marks: city.streets.routeMarks, scene });
  const trams = world.trams = new Streetcars({ W, route, ground, surfAt, scene, props: props.scene, world, audio });
  const crowd = world.crowd = new Crowd({
    route, ground, surfAt, scene, camera, spot, mobile: MOBILE, isFree: city.isFree,
    furniture: { ...city.furniture, shelter: [...(city.furniture.shelter || []), ...trams.shelters] },   // riders wait at streetcar platforms too
    onRoute: (x, y) => roadSurface.top(x, -y, ground(x, y) + 1.2)?.name === 'route_road',
    visible: (x, y, z, r) => world.visible(x, y, z, r),
  });
  world.planCorners(signals);   // water sellers and panhandlers working the red lights
  // flocks fly over the roofs: height of whatever is under a point (roofs, freeway decks, landmarks), by a ray from above
  const roofRay = new THREE.Raycaster(), roofHits = [city.group.getObjectByName('roofs'), city.freeway.group, hero.scene].filter(Boolean), down = new THREE.Vector3(0, -1, 0);
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
  // Phone: ◀ ▶ steer (bottom left), GAS, BRAKE (hold at a stop to reverse) and HORN (bottom right), all held
  // buttons. Keys: ↑/W gas, ↓/S brake / reverse, ←/→ or A/D steer, Space/H horn.
  const keys = new Set();
  let hornT = 0;
  const honk = () => { if (hornT <= 0) { audio.horn(); hornT = 0.6; } };
  const kd = (e) => {
    audio.unlock();
    const k = KEYMAP[e.code]; if (!k) return; e.preventDefault();
    if (k === 'horn') honk();
    keys.add(k);
  };
  const ku = (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); };
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  // the four lanes (your parking lane, your lane, the oncoming lane, the far parking lane, where the street has them):
  // the drive guide the car settles into when you let go of the steering, and the edges of the road you drive on
  const laneCentres = (s) => [route.parkD(s, -1), route.lane(s, 0), route.lane(s, 1), route.parkD(s, 1)].filter((v) => v !== null);
  const BOT = new URLSearchParams(location.search).has('bot');   // the QA autopilot steers by line (car.targetD)
  let laneWas = null;
  const steerFeel = () => {                                       // a haptic tick each time you cross into a new lane
    const cs = laneCentres(car.s), i = cs.reduce((b, c, k) => Math.abs(c - car.d) < Math.abs(cs[b] - car.d) ? k : b, 0);
    if (laneWas !== null && i !== laneWas) haptic(HAP.lane, 90);
    laneWas = i;
    if (car.scrape > 0) { haptic(HAP.edge, 400); car.scrape = 0; }
  };
  for (const b of root.querySelectorAll('[data-k]')) {
    // held until the finger lifts, even if the thumb drifts off the button (pointer capture), with a tick of haptics
    const on = (e) => {
      audio.unlock(); if (b.dataset.k === 'horn') honk(); keys.add(b.dataset.k); b.classList.add('on');
      try { b.setPointerCapture(e.pointerId); } catch {}
      haptic(HAP.tap);
      e.preventDefault();
    }, off = () => { keys.delete(b.dataset.k); b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  }

  // ---------- HUD ----------
  const $ = (s) => root.querySelector(s);
  const hud = { light: $('.drive-light'), lightDist: $('.drive-light b'), time: $('.drive-time'), speed: $('.drive-speed'), dist: $('.drive-dist'), tokens: $('.drive-tokens'), msg: $('.drive-msg'), hint: $('.drive-hint'), pop: $('.drive-pop') };
  const flash = (text, ms = 1200) => { hud.msg.textContent = text; hud.msg.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => hud.msg.classList.remove('on'), ms); };
  const pop = (text) => { const el = document.createElement('b'); el.textContent = text; hud.pop.appendChild(el); setTimeout(() => el.remove(), 900); };
  hud.hint.textContent = `${weather.label} in the ATL`;

  const coarse = MOBILE;
  const resize = () => {
    const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); comic.resize(); camera.aspect = w / h;
    camera.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(26)) / camera.aspect)), 44, 70);
    if (coarse) camera.setViewOffset(w, h, 0, h * 0.1, w, h); else camera.clearViewOffset(); // car clears the buttons
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize); resize();

  const api = { camOverride: null }; // test hooks (filled in below)
  // ---------- state ----------
  let t = TIME_LIMIT, drove = 0, hits = 0, tokens = 0, nearMisses = 0, state = 'countdown', countdown = 3, shake = 0, endT = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let camA = route.at(0).a, arrivalFrom = null;
  const result = { arrived: false, parked: false, timeLeft: 0, cleanPark: false, hits: 0, tokens: 0, nearMisses: 0, bonus: 0 };

  function park() {
    state = 'parked';
    Object.assign(result, { arrived: true, parked: true, timeLeft: Math.max(0, t), hits, tokens, nearMisses });
    result.cleanPark = Math.abs(car.d - spot.d) < 0.8;
    result.bonus = Math.round(result.timeLeft * 50 + tokens * 25 + nearMisses * 50 + (result.cleanPark ? 500 : 0) + (hits === 0 ? 300 : 0));
    flash(result.cleanPark ? 'CLEAN PARK! 🅿️' : 'PARKED 🅿️', 2600);
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
    hud.msg.classList.add('busted'); flash('BUSTED', 600000); hud.hint.textContent = '';
    if (e.cross) e.cross.v = 0; else Object.assign(e, { v: 0, v0: 0, cruise: 0 });   // the cruiser you hit stops
    lightsOn(poseOf(e));
    const backup = world.add('police', { s: Math.max(-15, car.s - 60), d: car.d, v: 18, cruise: 18, dir: 1, color: 0xffffff, backup: true });
    lightsOn(poseOf(backup)); busted.backup = backup;
    audio.siren(); haptic(HAP.busted);
  }
  function showBusted() {
    if (root.querySelector('.drive-busted')) return;
    hud.msg.classList.remove('on');
    const card = document.createElement('div'); card.className = 'drive-busted';
    card.innerHTML = '<h2>BUSTED</h2><p>You hit a police car. You’re going to jail.</p><button type="button">Drive again</button>';
    card.querySelector('button').addEventListener('click', () => { haptic(HAP.tap); finish(); }, { once: true });
    root.appendChild(card);
    if (QA && window.__botReport) setTimeout(() => { if (root.isConnected) finish(); }, 2500);   // the autopilot doesn't wait for a tap
  }

  // ---------- loop ----------
  let last = performance.now(), raf = 0, acc = 0;
  const FIXED = 1 / 120;
  function frame() {
    raf = nextFrame(frame);
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (api.pause) { comic.render(); return; }   // QA: freeze-frame for look-dev
    hornT -= dt;
    if (state === 'countdown') {
      countdown -= dt;
      hud.msg.textContent = countdown > 0 ? String(Math.ceil(countdown)) : 'GO!'; hud.msg.classList.add('on');
      if (countdown <= 0) { state = 'driving'; flash('GO!', 700); hud.hint.textContent = ''; haptic(HAP.go); }
    }
    const braking = keys.has('down');
    if (state === 'driving') steerFeel();
    const approaching = car.s > spot.s - 95;
    if (state === 'driving' || state === 'parked' || state === 'late' || state === 'busted') {
      acc += dt;
      while (acc >= FIXED) {
        acc -= FIXED;
        car.step(FIXED, {
          targetD: car.targetD, brake: braking || state !== 'driving', gas: state === 'driving' && keys.has('gas') ? 1 : 0,
          stopAt: approaching ? spot.s : undefined, lanes: laneCentres(car.s),
          steer: BOT ? undefined : state === 'driving' ? (keys.has('left') ? 1 : 0) - (keys.has('right') ? 1 : 0) : 0,
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
      if (ev.tokens) { tokens += ev.tokens; pop('+' + ev.tokens * 25); audio.token(); haptic(HAP.token, 60); }
      if (approaching) hud.hint.textContent = Math.abs(car.d - spot.d) < 0.8 ? 'Nice — hold the curb' : 'Pull right to the curb ▸';
      if (state === 'driving' && approaching && car.v < 0.3 && Math.abs(car.s - spot.s) < 2) park();
      if (state === 'driving' && t <= 0) { t = 0; state = 'late'; Object.assign(result, { hits, tokens, nearMisses }); flash('TOO LATE — walk it in', 2600); endT = 0; }
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
      endT += dt; hud.hint.textContent = '';
      if (endT > 4.2) { finish(); return; } // 2.4 s camera swing + a beat on the storefronts
    }

    // car transform
    const p = car.pose;
    // all four wheels on the road: height, pitch and roll from the ground under the axles and both sides
    const onRoad = (x, y) => surfAt(x, y, ground(x, y) + 1.2) ?? ground(x, y) + LEVEL.ROUTE;
    const st = standOn(onRoad, p.x, p.y, p.a, 1.47, 0.82);
    carRig.position.copy(toV3(p.x, p.y, st.z));
    carRig.rotation.set(st.pitch, p.a - Math.PI / 2, st.roll, 'YXZ');
    carModel.rotation.z = THREE.MathUtils.clamp(-car.dv * 0.012, -0.07, 0.07);   // body roll into the dodge
    carModel.visible = car.invuln <= 0 || Math.floor(car.invuln * 12) % 2 === 0; // blink while recovering
    const lit = keys.has('down') || car.accel < -4;
    for (const m of tailLamps) { m.emissive.copy(lit ? BRAKE_GLOW : m.userData.base.color); m.emissiveIntensity = lit ? 4 : m.userData.base.k; }
    wheelRoll = (wheelRoll + car.v * dt / TYRE_R) % (Math.PI * 2);
    for (const w of wheelSpin) w.o.quaternion.copy(w.q0).multiply(dq.setFromAxisAngle(X, wheelRoll));
    const steer = THREE.MathUtils.clamp(Math.atan2(car.dv, Math.max(car.v, 4)) * 1.6, -0.5, 0.5);   // fronts lead the dodge
    for (const w of wheelSteer) w.o.quaternion.copy(w.q0).multiply(dq.setFromAxisAngle(Y, steer));
    world.render(car, drove);
    signals.update(dt); WIND.value += dt;   // traffic lights; the tree canopies sway
    if (state !== 'driving') { world.updateFrustum(); trams.render(); }   // (world.update keeps the frustum current while driving)
    crowd.update(dt, car, hornT);
    birds.update(dt, car, drove, hornT > 0 ? 1 : 0); updateBeacons(now);
    fx.update(dt, camera, renderer);
    beacon.material.opacity = 0.12 + 0.08 * Math.sin(now / 250);
    spotGroup.visible = state === 'driving' || state === 'countdown';
    // overpass cutaway follows the car (a soft hole in anything above it)
    CUT.uCutPos.value.copy(carRig.position);

    // camera: high and behind along the road (runner framing), rising and reaching further with speed
    // GTA Chinatown Wars framing: steep, nearly overhead, ~30 % closer than before, pulling up with speed and
    // leading the car so you see what's coming
    const v = Math.max(0, car.v), h = (15 + v * 0.42) / 1.3, back = h * 0.34, ahead = 2 + v * 0.22;
    camA += Math.atan2(Math.sin(route.at(car.s + 6).a - camA), Math.cos(route.at(car.s + 6).a - camA)) * Math.min(1, dt * 3);
    const look = route.at(car.s + ahead, car.d * 0.35);
    let targetPos, targetLook;
    if (state === 'parked' || state === 'late') {
      // arrival: swing down to the street-level view of the storefronts (the intro's framing)
      const k = Math.min(1, endT / 2.4), e = k * k * (3 - 2 * k);
      const high = arrivalFrom || (arrivalFrom = camPos.clone()), street = toV3(-3, 21, ground(-3, 21) + 2.6);
      targetPos = high.clone().lerp(street, e);
      targetLook = toV3(p.x, p.y, p.z).lerp(toV3(-3, 0, ground(-3, 0) + 4.2), e);
    } else {
      targetPos = toV3(p.x - Math.cos(camA) * back, p.y - Math.sin(camA) * back, p.z + h);
      targetLook = toV3(look.x, look.y, look.z);
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
    audio.update(car.v, pedal, Math.min(1, Math.abs(car.dv) / 14 + (braking && car.v > 6 ? 0.6 : 0)), dt);
    hud.time.textContent = t.toFixed(1);
    hud.time.classList.toggle('low', t < 10);
    hud.speed.textContent = Math.round(v * 2.237) + ' mph';
    hud.dist.textContent = Math.max(0, Math.round(spot.s - car.s)) + ' m';
    // the next traffic light, readable on a phone (the real lamps are small from up here)
    const nl = state === 'driving' ? signals.next(car.s + 2.5) : null;
    hud.light.className = 'drive-light' + (nl ? ' on ' + nl.aspect : '');
    if (nl) hud.lightDist.textContent = Math.round(nl.gap) + ' m';
    hud.tokens.textContent = tokens;
    comic.render();
  }

  function finish() {
    cancelFrame(raf); audio.stop();
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', resize);
    root.classList.add('out');
    setTimeout(() => { renderer.dispose(); root.remove(); onDone({ ...result }); }, 450);
  }

  progress(1, 'Ready');
  root.querySelector('.drive-loading').remove();
  root.querySelector('[data-skip]').addEventListener('click', () => { haptic(HAP.tap); Object.assign(result, { hits, tokens, nearMisses }); finish(); });
  frame();
  // test hooks (drive QA + screenshots)
  Object.assign(api, { car, world, route, spot, keys, result, audio, fx, city, comic, 
    three: { scene, camera, carRig, THREE, renderer },
    snapshot: (q = 0.85) => { comic.render(); return renderer.domElement.toDataURL('image/jpeg', q); } });
  // live getters (Object.assign would have frozen their values at assignment time)
  Object.defineProperties(api, { state: { get: () => state }, time: { get: () => t } });
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
<div class="drive-light"><i></i><i></i><i></i><b></b></div>
<div class="drive-msg"></div>
<div class="drive-pop"></div>
<div class="drive-hint"></div>
<button class="drive-skip" data-skip aria-label="Skip the drive">SKIP ▸▸</button>
<div class="drive-pad drive-steerpad">
  <button class="dp left" data-k="left" aria-label="Steer left"><svg viewBox="0 0 24 24"><path d="M15 4 7 12l8 8"/></svg></button>
  <button class="dp right" data-k="right" aria-label="Steer right"><svg viewBox="0 0 24 24"><path d="M9 4l8 8-8 8"/></svg></button>
</div>
<div class="drive-pad drive-pedals">
  <button class="dp horn" data-k="horn" aria-label="Horn"><svg viewBox="0 0 24 24"><path d="M4 10h3l6-4v12l-6-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg><b>HORN</b></button>
  <button class="dp brake" data-k="down" aria-label="Brake, hold to reverse"><b>BRAKE</b><small>HOLD = REV</small></button>
  <button class="dp gas" data-k="gas" aria-label="Gas"><b>GAS</b></button>
</div>
<div class="drive-tip">GAS to go · ◀ ▶ to steer · HORN clears the way</div>
<div class="drive-osm">© OpenStreetMap contributors</div>`;
