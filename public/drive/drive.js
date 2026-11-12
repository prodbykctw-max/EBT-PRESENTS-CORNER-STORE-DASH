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
import { heroSegments } from './corral.js';
import { BODY, PROP_R, walkWorldFor, Trail, integrate, approach, wallPass, killInto, chaseTarget, wishVelocity, steerStick, camYawStep, angDiff } from './roam.js';
import { Streetcars } from './tram.js';
import { Signals } from './signals.js';
import { Birds } from './birds.js';
import { haptic, HAP, tapHaptic } from './haptics.js';
import { Look } from './look.js';
import { resolveLook, fallbackToComic } from './mode.js';
import { WIND, NEAR_CUT } from './landscape.js';
import { Guide } from './guide.js';
import { ImpactFX } from './fx.js';
import { fetchWeather, applyWeather } from './weather.js';
import * as SkeletonUtils from './vendor/SkeletonUtils.js';
import { makeBullyMaterial, makeRunClip, makeStandClip, addArmSwing, ARMS, MODEL_H, PLAYER_H, BULLY_H } from './people.js';

const BASE = new URL('./', import.meta.url);
const TIME_LIMIT = 70;   // the traffic (TRAFFIC = 0.25 of what it was: see traffic.js) costs the headless bot a few seconds on a clean run; it parks with about 21 s left (7.7 s with the full street, headless bot means)
// The realistic look's chase camera (the comic look keeps its own: 8 m back and 3 m up, easing back with speed).
// One place to change it: back = back + backV * speed metres behind the car's centre, h metres above the road under the car
// (no speed term), `ahead` = how far down the road the camera points (only its direction is used), `aimD` = how much of the car's own
// sideways position it points at (1 = the car stays centred; the comic camera uses 0.35), yCar = where the car's rear-bottom edge
// (2.45 m behind its centre, 0.3 m up) lands on screen (0 top .. 1 bottom; the tyres and bumper hang a little lower, so the car's
// lowest edge is about 0.06 below it), rear = how far that edge is behind the car's centre.
const CAM_R = { back: 6.8, backV: 0.03, h: 2.8, ahead: 10, aimD: 1, yCar: 0.77, rear: 2.45 };
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
// run: your top speed on foot. 6.4 m/s (was 5.6; the owner, Nov 2026: "he runs just as fast if not faster than me... I need to be able to run a
// little faster"): 1.1 m/s faster than the bully's 5.3 instead of 0.3, so a clean run pulls away about 4x as fast
const FOOT = { run: 6.4, back: 2.2, bully: 5.3, bullyGo: 0.8, start: 14, carAhead: 30, bullyBehind: 8, stun: 0.9, reach: 0.9, pause: 1.1 };
// the on-foot camera: this far behind you (m), this high above your feet, aiming this far ahead of you, and never closer than min (walls pull it in to that)
const ON_FOOT_CAM = { back: 10, up: 6.0, ahead: 7, min: 0.3, nudge: 0.6, nudge2: 1.5, pad: 0.3, skip: 1.5 };   // side: m the camera sits to the runner's left (was 0.6, which drew a straight run 20 px right of centre and read as a pull to the right; Nov 11 2026: centred)
const RACE = { pace: 17, accel: 3.4, hop: 1.6, tail: 4.5, shake: 60, maxLead: 30 };   // 17 m/s: a good run beats him by ~6 s; an average one gets caught late
// the realistic look's pedestrians (people-alt.js, people-b.js, people-real/): by default every person is a B body (MakeHuman CC0, six body types, real
// shoes); people-a.js (the hand-built A person) is NOT loaded unless asked for. ?people=none|0|off draws the old box people; ?people=A or AB picks A or the
// A+B mix (QA; B alone is the default). The comic look never loads any of it. Nothing is requested until the realistic look's own code and textures have loaded (see peopleReady in startDrive).
function peopleKindsFromURL() {
  const q = (new URLSearchParams(location.search).get('people') || 'b').toLowerCase();
  return /^(none|0|off|false|no)$/.test(q) ? '' : /^[ab]+$/.test(q) ? [...new Set(q)].sort().join('') : 'b';
}
async function loadAltPeople(kinds) {
  try {
    const alt = await import('./people-alt.js');
    const variants = await Promise.all([...kinds].map(async (k) => (k === 'a' ? alt.withoutRandom((await import('./people-a.js')).makeA) : (await import('./people-b.js')).makeB(alt.withoutRandom))));
    return { AltPeople: alt.AltPeople, variants };
  } catch (e) { console.warn('realistic pedestrians unavailable, drawing the usual ones:', e?.message || e); return null; }
}
const nextFrame = QA ? (f) => setTimeout(f, 16) : requestAnimationFrame;
// screen-to-screen fades (the loader lifting, the fade to black at the end): the store page's SCREEN_FADE, one pace
const SCREEN_FADE = 0.3;
const cancelFrame = QA ? clearTimeout : cancelAnimationFrame;
// A drive that ends in RESTART (pause menu) or BUSTED is answered by the host starting the drive again in the same page; that start is a retry, which goes
// straight to the chase (the city flyover is the opening of a new game only). Set by finish(), read and cleared by the next startDrive.
let retryNext = false;
// the opening flyover (see "the opening flyover" below): ?qa and ?bot start on foot at once as always; ?qa&fly asks for it, ?nofly never plays it
const FLY_QS = new URLSearchParams(location.search);

export async function startDrive({ mount = document.body, muted = false, onDone = () => {}, onProgress = () => {}, look: lookOption, intro: introOption } = {}) {
  const RETRY = retryNext; retryNext = false;
  WIND.value = 0;   // the tree canopies' sway clock starts from the same place on every start (a restart is exactly a fresh start)
  // which look: the realistic look (the default) or the comic ink look (?look=comic, or startDrive({ look: 'comic' })); mode.js
  const REAL = resolveLook(lookOption);
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
  const MOBILE = matchMedia('(pointer: coarse)').matches;
  const realReady = REAL ? import('./real.js').then(async (R) => ({ R, T: await R.loadTextures(BASE, { mobile: MOBILE }) })).catch((e) => { console.warn('realistic look unavailable, drawing the comic look:', e?.message || e); return null; }) : null;   // the realistic look's code and its 1K scans load alongside the rest
  // the realistic look's cars (cars.js: cars/bc.cars unless ?cars= says otherwise). Nothing here is requested until the realistic look's own code and
  // textures have loaded (realReady resolves with the pack): the comic look never loads cars.js or a .cars file, and a failed realistic look doesn't
  // fetch them for nothing. A set that fails to load only costs the new cars: the drive starts with the props.glb ones (see CARS_WAIT_MS below).
  const carsReady = realReady ? realReady.then(async (pack) => {
    if (!pack) return null;
    try {
      const C = await import('./cars.js');
      const sets = await Promise.all(C.carSetsFromURL().map(async (n) => {
        try { return [n, C.carSetFactory(n, await C.loadCarFile(new URL(`cars/${n.toLowerCase()}.cars`, BASE).href))]; }
        catch (e) { console.warn('car set ' + n + ' unavailable, drawing the usual cars:', e?.message || e); return null; }
      }));
      return sets.filter(Boolean);
    } catch (e) { console.warn('car sets unavailable, drawing the usual cars:', e?.message || e); return null; }
  }) : null;
  // the realistic look's animals (animals.js: the stray dogs and the pigeons, from animals/): same rule again (nothing is requested before the realistic look has loaded; a failure or a
  // late load costs only the new animals: the props.glb dogs and birds are drawn). ?animals=none keeps the old ones (QA).
  const animalsOff = /^(none|0|off|false|no)$/i.test(new URLSearchParams(location.search).get('animals') || '');
  const animalsReady = realReady && !animalsOff ? realReady.then(async (pack) => {
    if (!pack) return null;
    try { const m = await import('./animals.js'); return { m, data: await m.loadAnimalData(MOBILE) }; }
    catch (e) { console.warn('realistic animals unavailable, drawing the usual ones:', e?.message || e); return null; }
  }) : null;
  // the realistic look's pedestrians: same rule as the cars (nothing is requested before the realistic look has loaded; the comic look, ?people=none and a
  // failed realistic look never fetch them; a failure only costs the new people, the drive starts with the old ones)
  const peopleKinds = peopleKindsFromURL();
  // phones only: the contact shadow under each pedestrian (contact.js); desktop and the comic look never request it
  const contactReady = MOBILE && realReady ? realReady.then((pack) => (pack ? import('./contact.js').then((m) => m.ContactBlobs).catch((e) => { console.warn('contact shadows unavailable:', e?.message || e); return null; }) : null)) : null;
  const peopleReady = realReady && peopleKinds ? realReady.then((pack) => (pack ? loadAltPeople(peopleKinds) : null)) : null;
  // motion (GSAP): the store page already carries it; on its own (/drive/index.html) the drive loads the same
  // vendored copy. Phones set to reduce motion, or no GSAP at all, keep the plain CSS behaviour.
  const gsapReady = window.gsap ? Promise.resolve(window.gsap) : new Promise((ok) => {
    const s = document.createElement('script'); s.src = new URL('vendor/gsap.min.js', BASE).href;
    s.onload = () => ok(window.gsap || null); s.onerror = () => ok(null); document.head.appendChild(s);
  });
  const [W, hero, carGltf, props, trees, weather, gsapLib, charGltf, realPack] = await Promise.all([
    fetch(new URL('world.json', BASE)).then((r) => r.json()),
    loader.loadAsync(new URL('hero.glb', BASE).href),
    loader.loadAsync(new URL('car.glb', BASE).href),
    loader.loadAsync(new URL('props.glb', BASE).href),
    loader.loadAsync(new URL('trees.glb', BASE).href),
    fetchWeather(),
    gsapReady,
    loader.loadAsync(new URL('character.glb', BASE).href),   // you and the bully on foot (people.js)
    realReady,
  ]);
  const { R: RL, T: realTex } = realPack || {};
  if (REAL && !RL) fallbackToComic();   // real.js or its textures failed to load: exactly the comic look from here on (everything below keys off RL)
  // ?wx=rain|overcast|fog|storm (tests only): force the weather the lighting and the roads follow
  if (QA && new URLSearchParams(location.search).get('wx')) Object.assign(weather, { rain: { code: 63, cloud: 90, rain: 1, label: 'Rain 58°' }, overcast: { code: 3, cloud: 95, rain: 0, label: 'Overcast 62°' }, fog: { code: 45, cloud: 100, rain: 0, label: 'Fog 55°' } }[new URLSearchParams(location.search).get('wx')] || {});
  if (RL) RL.install();   // the realistic look's prop material and prop geometry hooks: before the city and the traffic are built

  const G = gsapLib && !matchMedia('(prefers-reduced-motion: reduce)').matches ? gsapLib : null;
  if (RL) root.classList.add('real');   // drive.css: the realistic look's HUD (everything new is under .drive-root.real)
  if (G) root.classList.add('gs');   // drive.css: GSAP, not CSS transitions, moves the messages and pop-ups
  progress(0.7, 'Building the city');

  // ---------- renderer / scene ----------
  root.insertAdjacentHTML('beforeend', RL ? HUD_HTML_REAL : HUD_HTML);
  // antialias off on the CANVAS only: the scene is drawn (with MSAA) into the look pass's own target (look.js), and
  // the canvas only ever receives one full-screen quad, which multisampling can't change by a single pixel. A
  // multisampled canvas just cost a full-screen MSAA buffer and a resolve every frame.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2)); // phones: fill-rate is the budget
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  // The look: GTA Chinatown Wars colour, not a washed-out film grade. A hue-true filmic shoulder (Khronos
  // Neutral), then saturation and a touch of contrast on top, in the same pass (no post-processing cost on phones).
  if (!RL) THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    `vec3 CustomToneMapping( vec3 color ) {
      vec3 c = NeutralToneMapping( color );
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c = max( vec3( 0.0 ), mix( vec3( l ), c, 1.4 ) );
      c = pow( c, vec3( 1.1 ) ) * 1.08;
      return clamp( c, 0.0, 1.0 );
    }`);
  renderer.toneMapping = RL ? THREE.NeutralToneMapping : THREE.CustomToneMapping; renderer.toneMappingExposure = 1.0;   // (the realistic look tone-maps with three's Neutral map in its own final pass: real-post.js)
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  // near 2 m: as close as the chase camera ever gets to the ground (measured along the whole route: the road at the
  // bottom of the screen stays >= 2.62 m away with the camera's 2.5 m ground clearance below). The overhead camera
  // used 4 m, but a chase camera ~3 m off the road had the road at the bottom of the screen nearer than 4 m on 81% of
  // the route (phone upright), and it wasn't drawn: the sky dome showed through as a flat grey slab. 2 m keeps the
  // ink pass's depth precision at half the old value, not an eighth; the tightest layer gap (3 cm, levels.js) stays
  // clean out to ~1 km.
  const camera = new THREE.PerspectiveCamera(42, 1, 2, 3000);
  // the look pass: GTA Chinatown Wars ink + comic shading, or the realistic look's post chain (the same API: target, resize, render)
  const comic = RL ? new RL.RealLook(renderer, scene, camera, { mobile: MOBILE }) : new Look(renderer, scene, camera, { mobile: MOBILE });

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
  if (RL) RL.upgradeCity({ city, T: realTex, scene });   // PBR facades, worn roads, concrete, lit trees (real.js)
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
  if (RL) RL.shadows(sun, MOBILE);   // the realistic look: one tightened sun shadow instead of the comic look's coarse +/-110 m box
  scene.add(hemi, sun, sun.target);
  const sky = applyWeather(weather, { scene, renderer, sun, hemi, roads: city.surfaces, real: !!RL });
  if (RL) RL.tuneWeather(weather, { scene, renderer, sun, hemi, look: comic });   // physical light: warm sun, weak hemisphere fill, the sky's environment, haze
  // wheels read the height of the actual road triangles under them (never a formula that could disagree)
  const roadSurface = new TopSurface(city.streets.drivable);
  const surfAt = (x, y, below) => { const h = roadSurface.top(x, -y, below); return h ? h.y : null; };
  // ---------- the run, the car ----------
  // parking space: in front of the store, in the curbside parking lane (or at the right curb if there isn't one)
  const spotS = route.project(SPOT.x, SPOT.y).s;
  const spot = { s: spotS, d: route.parkD(spotS, -1) ?? route.lane(spotS, 0) - 0.35 };
  // car sets (cars.js): only with the realistic look (RL); the comic look, ?cars=none and a failed load draw the props.glb cars
  const carSets = {};
  let altPeople = null, ContactBlobs = null, animals = null;
  if (RL && (carsReady || peopleReady || contactReady || animalsReady)) {
    // the cars and the pedestrians are optional downloads: the drive waits for them only a few seconds after everything it needs has loaded, then starts with
    // the old ones. (One await for both, and no other await from here to the crowd below: whatever draws Math.random while the drive waits cannot
    // interleave with the crowd's own draws, so the crowd's layout does not depend on whether the new people load.)
    const WAIT_MS = 8000;
    const within = (p, what) => { if (!p) return Promise.resolve(null); let timer; return Promise.race([p, new Promise((ok) => { timer = setTimeout(() => { console.warn(what + ' still loading, drawing the usual ones'); ok(null); }, WAIT_MS); })]).finally(() => clearTimeout(timer)); };
    const [got, alt, blobs, anim] = await Promise.all([within(carsReady, 'car sets'), within(peopleReady, 'pedestrians'), within(contactReady, 'contact shadows'), within(animalsReady, 'animals')]);
    for (const r of got || []) carSets[r[0]] = r[1];
    altPeople = alt; ContactBlobs = blobs;
    if (anim) { try { animals = new anim.m.Animals(anim.data, scene, { mobile: MOBILE }); } catch (e) { console.warn('realistic animals unavailable, drawing the usual ones:', e?.message || e); } }   // (made under a private random generator: the shared stream is untouched)
  }
  const world = new World({ route, props: props.scene, scene, W, sEnd: spot.s, audio, surfAt, camera, marks: city.streets.routeMarks, carSets, animals });
  for (const cs of Object.values(world.carSets)) cs.shadowOnly(renderer);   // the cars' shadow proxies are drawn in the sun's shadow pass only
  // the sun's shadow box, so the props that can't cast a shadow into it skip the shadow pass (World.render)
  world.shadowBox = { dir: sun.userData.dir || new THREE.Vector3(-0.5, 0.8, 0.35), half: () => Math.max(sun.shadow.camera.right, sun.shadow.camera.top) };
  const car = new RunnerCar(route, 4);
  const signals = world.signals = new Signals({ route, nodes: city.signals, marks: city.streets.routeMarks, scene });
  const trams = world.trams = new Streetcars({ W, route, ground, surfAt, scene, props: props.scene, world, audio });
  const onRouteRoad = (x, y) => roadSurface.top(x, -y, ground(x, y) + 1.2)?.name === 'route_road';
  // what people's feet stand on (the crowd, dogs, water sellers): the road surface, and the curbs along the route. (The curbs
  // are not in `roadSurface`: wheels and the player's feet never read them. Only the triangles within ~25 m of the route are kept.)
  const nearRoute = new Set();
  for (let i = 0; i < route.n; i += 4) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) nearRoute.add(Math.floor((route.X[i] + a * 10) / 10) * 65536 + Math.floor((route.Y[i] + b * 10) / 10));
  // (a triangle is kept when its bounds touch a cell near the route; one that spans more than 6 cells is kept whole)
  const nearTri = (x0, z0, x1, z1) => {
    const gx0 = Math.floor(x0 / 10), gx1 = Math.floor(x1 / 10), gy0 = Math.floor(-z1 / 10), gy1 = Math.floor(-z0 / 10);
    if (gx1 - gx0 > 6 || gy1 - gy0 > 6) return true;
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) if (nearRoute.has(gx * 65536 + gy)) return true;
    return false;
  };
  // every surface a person can see under his feet but a wheel never reads: the curbs, the crosswalk paint, the lawns / lots / parks, the
  // hero row's sidewalk slab. Only the meshes (and in them only the triangles) that come near the route are read, and each of
  // those is the tile that is actually drawn (the big originals that were split into tiles are hidden and skipped)
  const flat = [], meshNear = (b) => {
    const gx0 = Math.floor(b.min.x / 10), gx1 = Math.floor(b.max.x / 10), gy0 = Math.floor(-b.max.z / 10), gy1 = Math.floor(-b.min.z / 10);
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) if (nearRoute.has(gx * 65536 + gy)) return true;
    return false;
  };
  city.group.traverse((o) => { if (o.userData.wbox && /^(curbs|crosswalks|cover_)/.test(o.name) && meshNear(o.userData.wbox)) flat.push(o); });
  hero.scene.traverse((o) => { if (o.isMesh && /^SIDEWALK_hero/.test(o.name)) flat.push(o); });
  const feetSurface = flat.length ? new TopSurface(flat, 8, nearTri) : null;
  const footAt = (x, y, below) => {
    const a = roadSurface.top(x, -y, below), b = feetSurface ? feetSurface.top(x, -y, below) : null;
    return a && b ? Math.max(a.y, b.y) : a ? a.y : b ? b.y : null;
  };
  world.footAt = footAt; world.feet = { surface: feetSurface, rebuild: () => (flat.length ? new TopSurface(flat, 8, nearTri) : null) };   // (rebuild: for measuring the load-time cost)
  const heroWalls = heroSegments(hero.scene, ground(SPOT.x, SPOT.y));   // (the hand-built row's wall slices: the crowd's corral and the runner's collision world both use them)
  const crowd = world.crowd = new Crowd({
    route, ground, surfAt, heightAt: footAt, scene, camera, spot, mobile: MOBILE, isFree: city.isFree, alt: altPeople, blob: ContactBlobs,
    walls: city.walls, heroWalls, roads: city.streets.index,
    furniture: { ...city.furniture, shelter: [...(city.furniture.shelter || []), ...trams.shelters] },   // riders wait at streetcar platforms too
    onRoute: (x, y) => onRouteRoad(x, y),
    visible: (x, y, z, r) => world.visible(x, y, z, r),
  });
  crowd.shadowBox = world.shadowBox;
  crowd.vehicles = () => world.ambient;   // (walking groups wait at a side street's mouth while a vehicle drives through it)
  world.relocateDogs();   // (the dogs were placed before the crowd existed: out of any stretch with no room between curb and wall)
  world.planCorners(signals);   // water sellers and panhandlers working the red lights
  // flocks fly over the roofs: height of whatever is under a point (roofs, freeway decks, landmarks), by a ray from above
  // (rayTargets: the same roofs, freeway and storefronts cut into small tiles, so a ray tests only what's under it)
  const roofRay = new THREE.Raycaster(), roofHits = rayTargets([city.group.getObjectByName('roofs'), city.freeway.group, hero.scene].filter(Boolean)), down = new THREE.Vector3(0, -1, 0);
  const roofAt = (x, y) => { roofRay.set(toV3(x, y, 400), down); const h = roofRay.intersectObjects(roofHits, true)[0]; return h ? h.point.y : ground(x, y); };
  const groundAt = (x, y) => Math.max(surfAt(x, y, ground(x, y) + 1.2) ?? -Infinity, ground(x, y) + LEVEL.TERRAIN);
  const birds = world.birds = new Birds({ scene, props: props.scene, route, roofAt, groundAt, isFree: city.isFree, sEnd: spot.s,
    trees: [...(city.furniture.tree_round || []), ...(city.furniture.tree_upright || [])],
    occupied: (s, d) => world.ents.some((e) => e.alive && Math.abs(e.s - s) < 7 && Math.abs(e.d - d) < 2.5), visible: (x, y, z, r) => world.visible(x, y, z, r), mobile: MOBILE, animals, camera });
  const carModel = carGltf.scene;
  if (RL) RL.upgradeCar(carModel, realTex);   // clearcoat paint, real glass and rubber (before the brake lamps are looked for just below)
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
  // red path lines + amber chevrons on the road ahead: the realistic look only (guide.js)
  const guide = RL ? new Guide({ scene, route, ground, surfAt, spot }) : null;

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
    try { endStick(); } catch {}                                                 // nor a drag (try: a pause before the level has loaded)
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
    if (fly && !paused) { e.preventDefault(); audio.unlock(); endFly(); return; }   // any key ends the opening flyover (the key is only that: not also a pause, a step or a horn)
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
    if (state === 'onfoot') return;   // on foot ◀ ▶ are held directions (footVec), like the store's arrows, not steps
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
  const hud = { light: $('.drive-light'), lightDist: $('.drive-light b'), time: $('.drive-time'), speed: $('.drive-speed'), dist: $('.drive-dist'), tokens: $('.drive-tokens'), msg: $('.drive-msg'), hint: $('.drive-hint'), pop: $('.drive-pop'), pos: $('.drive-pos'), cp: $('.drive-cp') };   // (pos, cp: the realistic look's HUD only)
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
  const tokBox = hud.tokens.closest('.drive-box, .rb-cell'), timeBox = hud.time.closest('.drive-box, .rb-cell'), cpBox = hud.cp?.closest('.rb-cell'), posBox = hud.pos?.closest('.rb-cell');
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
    // the realistic look's ambient occlusion is the first thing to go, before any resolution is given up; it comes back last
    if (comic.setAO) {
      if (res.aoTrial) {
        if ((res.aoTrial.t -= sec) > 0) return;                     // judge dropping it after 2 s: if frames aren't at least 10% faster it wasn't the cost, so it comes back
        if (res.ema > res.aoTrial.ema * 0.9) { comic.setAO(true); res.lockAO = Math.min(300, 30 * 2 ** res.aoFails++); }
        res.aoTrial = null; res.slow = res.fast = 0; return;
      }
      res.lockAO = Math.max(0, (res.lockAO || 0) - sec);
      if (res.slow > 1.5 && !res.lockAO && comic.aoActive) { comic.setAO(false); res.aoTrial = { ema: res.ema, t: 2 }; res.aoFails ||= 0; res.slow = 0; return; }
      if (res.fast > 6 && !res.lockUp && pr >= PR_MAX && !comic.aoActive && !res.lockAO) { comic.setAO(true); res.fast = 0; return; }
    }
    if (res.slow > 1.5 && !res.lockDown && pr > PR_MIN) {
      if (res.clock - res.upAt < 10) res.bounces++;                  // the last step up didn't hold
      res.trial = { from: pr, ema: res.ema, t: 2 }; setPR(Math.max(PR_MIN, pr - PR_STEP)); res.slow = 0; return;
    }
    if (res.fast > 6 && !res.lockUp && pr < PR_MAX) { setPR(Math.min(PR_MAX, pr + PR_STEP)); res.fast = 0; res.upAt = res.clock; }
  }
  // phones rotate before they report the new size (iOS especially): also re-check on orientation / visual-viewport
  // changes, and every frame (cheap string compare), so the picture is never left squashed or stretched
  const onTurn = () => { setTimeout(resize, 60); setTimeout(resize, 400); };
  addEventListener('orientationchange', onTurn);
  window.visualViewport?.addEventListener('resize', resize);

  const api = { camOverride: null }; // test hooks (filled in below)
  // ---------- state ----------
  let t = TIME_LIMIT, drove = 0, hits = 0, tokens = 0, nearMisses = 0, state = SKIPFOOT ? 'countdown' : 'onfoot', countdown = 3, shake = 0, endT = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3(), lastCar = new THREE.Vector3(); let lastRz = 0;
  const camV = { dist: 0, px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0 }; let camDist = null, camAng = 0;   // on-foot camera: how far behind you it is (smoothDamp state: camV.dist)
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
  let cpFrom = car.s, cpSeen = 0;   // the realistic HUD's CHECKPOINT: 11 points of progress from where you got into the car to the store
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
    // the cruiser you hit stops and stays (traffic.js leaves it alone). A cross-street cruiser is moved by runner.js's ambient loop on vd (its pace)
    // and vs (its real speed), not on v, so both are zeroed: with vd at 0 the loop's target speed is 0 and nothing sets it going again
    if (e.cross) { e.cross.v = e.cross.vd = e.cross.vs = e.cross.acc = 0; } else Object.assign(e, { v: 0, sp: 0, aF: 0, hold: true });
    lightsOn(poseOf(e));
    // backup rolls in from behind: from 60 m back, or the nearest spot behind that is clear (not on top of a car, and no car that can be seen is
    // ever removed to make room; one that can't be seen is)
    const R = 4.75 / 2 + 0.6, spotCars = (s) => world.ents.filter((o) => o.alive && o !== e && !o.scenery && !o.flying && o.L && o.W && Math.abs(o.s - s) < o.L / 2 + R && Math.abs(o.d - car.d) < o.W / 2 + 1.5);
    const seen = (o) => { const q = route.at(o.s, o.d); return world.visible(q.x, q.y, q.z + 0.8, Math.max(6, (o.L || 4.5) / 2 + 2)); };
    let at = null;
    for (let back = 60; back <= 200 && at === null; back += 10) { const s = Math.max(-15, car.s - back); if (!spotCars(s).length) at = s; }
    for (let back = 60; back <= 200 && at === null; back += 10) { const s = Math.max(-15, car.s - back), cs = spotCars(s); if (!cs.some(seen)) { for (const o of cs) o.alive = false; at = s; } }
    if (at !== null) {
      const backup = world.add('police', { s: at, d: car.d, v: 18, cruise: 18, dir: 1, color: 0xffffff, backup: true });
      lightsOn(poseOf(backup)); busted.backup = backup;
    }
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
  guide?.buildChevrons(homeS);   // the bends between your car and the store (guide.js)
  const homeD = inParkLane ? route.parkD(homeS, -1) : route.lane(homeS, 0);
  // the driver's door: the street side of the car. You run up to it along the car's flank, so that line sits clear of
  // the car (its body and mirrors reach 1.08 m from its centre line; you are 0.38 m wide each side of yours). At 1.15 m
  // (the first version) you ran the last few metres with your shoulder 0.3 m inside the car.
  const doorS = homeS + 0.25, doorD = homeD + 1.6;
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

  // you and the bully: the store's character in 3D (people.js), with a walk, a run built from it, and a standing pose
  if (RL) RL.upgradeCharacter(charGltf.scene);   // before makePerson clones it for the bully
  // the walk and the run get a real arm swing on top (people.js addArmSwing: the model's own walk hardly moves the arms,
  // and from behind they did not move at all); the standing pose stays the model's own (arms down)
  const walk0 = charGltf.animations.find((a) => a.name === 'walk');
  const clips = { walk: addArmSwing(walk0, charGltf.scene, ARMS.walk), run: addArmSwing(makeRunClip(walk0), charGltf.scene, ARMS.run), stand: makeStandClip(walk0) };
  // How fast the ground goes by under a clip: the speed a planted foot sweeps backwards while it's on the ground,
  // measured off the clip (and how low the soles get, so the standing pose can be set down on the same ground).
  // Playing the clip at (your speed / that) keeps the planted foot still on the pavement. The first version measured
  // one front-to-back sweep and assumed the clip was one stride, but it holds two: the legs ran at twice the speed you
  // covered ground (12.7 steps a second at full speed, the feet skating backwards).
  const gait = (clip, h) => {
    const o = SkeletonUtils.clone(charGltf.scene), mx = new THREE.AnimationMixer(o); mx.clipAction(clip).play();
    o.scale.setScalar(h / MODEL_H);
    const bones = ['L_Foot', 'R_Foot'].map((n) => o.getObjectByName(n)), toes = ['L_ToeBase', 'R_ToeBase'].map((n) => o.getObjectByName(n));
    const N = 240, dt = clip.duration / N, tr = bones.map(() => []), w = new THREE.Vector3();
    let low = Infinity;
    for (let i = 0; i <= N; i++) {
      mx.setTime(i * dt); o.updateMatrixWorld(true);
      bones.forEach((b, k) => { b.getWorldPosition(w); tr[k].push([w.z, w.y]); low = Math.min(low, w.y); });
      for (const t of toes) low = Math.min(low, t.getWorldPosition(w).y);
    }
    let sum = 0, cnt = 0;
    for (const f of tr) {
      const floor = Math.min(...f.map((p) => p[1]));
      for (let i = 0; i < N; i++) if (f[i][1] < floor + 0.03 && f[i + 1][1] < floor + 0.03) { sum += (f[i][0] - f[i + 1][0]) / dt; cnt++; }
    }
    return { plant: cnt ? Math.max(0.3, sum / cnt) : 1, low };
  };
  function makePerson(bully) {
    const o = SkeletonUtils.clone(charGltf.scene), h = bully ? BULLY_H : PLAYER_H;
    o.scale.setScalar(h / MODEL_H);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; if (bully) m.material = makeBullyMaterial(m.material); } });
    const mixer = new THREE.AnimationMixer(o), act = {};
    for (const k of ['stand', 'walk', 'run']) { act[k] = mixer.clipAction(clips[k]); act[k].play(); }
    scene.add(o);
    // a soft shadow on the ground under them. Their sun shadow is a couple of texels on the phone's shadow map, so
    // nothing showed where they stood: from the high chase camera a runner looked pressed into the facade beside him,
    // which (measured by picking the pixels next to him) is the wall 6-10 m further down the hill, below his feet.
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false }));
    blob.rotation.order = 'YXZ'; blob.renderOrder = 1; blob.scale.set(h * 0.42, h * 0.55, 1); scene.add(blob);
    const run = gait(clips.run, h), walk = gait(clips.walk, h), stand = gait(clips.stand, h);
    return { o, blob, mixer, act, run: act.run, plantRun: run.plant, plantWalk: walk.plant, sink: stand.low - run.low,
      s: 0, d: 0, v: 0, dv: 0, acc: 0, nudge: 0, z: 0, stun: 0, pause: 0, phase: 0, yaw: null, lean: 0, roll: 0, hit: null, ps: 0, pd: 0 };
  }
  const me = makePerson(false), him = makePerson(true);

  // ---------- the line you run along ----------
  // Built once from the street itself (every 0.5 m): the curb side of the sidewalk, the building line (the actual
  // building footprints, scanned every 5 cm), and the street furniture. The first version read the crowd's sidewalk
  // band, which is sampled every 2 m and rounded to the nearest sample, so your line jumped in steps every 2 m (a
  // constant sideways twitch) and at the corner of a building (s ~55 m on Luckie St) the band jumped 1 m outwards
  // before the corner had passed: you and the bully ran into it. Its curb-side line also ran straight through the
  // street trees (s 18, 32, 46) and the bully copied YOUR sideways position at HIS spot on the street, which a few
  // metres back can be inside the wall (he was, for 35 frames at s ~55).
  // (BODY, the radius of a person: 0.42 m, half the width of the bully with his arms swinging, measured off the run; you are 0.38. And PROP_R, below: roam.js)
  const WALL_GAP = BODY + 0.3, PROP_GAP = 0.4, SLOPE = 0.35, DETOUR = 0.4, CURB_GAP = BODY + 0.15;
  const footProps = [];
  for (const [type, list] of Object.entries({ ...city.furniture, shelter: [...(city.furniture.shelter || []), ...trams.shelters] })) {
    if (!PROP_R[type]) continue;
    for (const [x, y, , , sc] of list) { const pr = route.project(x, y); if (pr.d < 0 && pr.s > -5 && pr.s < doorS + 35 && -pr.d < route.hw(pr.s) + 7) footProps.push({ s: pr.s, d: -pr.d, r: PROP_R[type] * (sc || 1), type }); }
  }
  const PATH = (() => {
    const step = 0.5, s0 = 0, s1 = Math.ceil(doorS + 30), n = Math.round((s1 - s0) / step) + 1;
    const B = crowd.band[-1], band = (k, s) => { const x = THREE.MathUtils.clamp(s / 2, 0, B[k].length - 1), i = Math.min(B[k].length - 2, Math.floor(x)); return B[k][i] + (B[k][i + 1] - B[k][i]) * (x - i); };
    const inner = new Float32Array(n), outer = new Float32Array(n), wall = new Float32Array(n), curb = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = s0 + i * step, lo = band(0, s), far = route.hw(s) + 5;
      let w = far; for (let dd = lo; dd <= far; dd += 0.05) { const p = route.at(s, -dd); if (!city.isFree(p.x, p.y)) { w = dd; break; } }
      wall[i] = w; inner[i] = lo + 0.1;
      // the curb: where the street's road surface ends (the crowd's band starts 1.2-1.4 m further in, which kept you off
      // the whole curb-side strip of the sidewalk), plus your body and a little air so you never stand on the edge
      let e = route.hw(s) - 0.4; while (e < lo && onRouteRoad(...(({ x, y }) => [x, y])(route.at(s, -e)))) e += 0.1;
      curb[i] = Math.min(lo, Math.max(route.hw(s), e) + CURB_GAP);
    }
    // past a corner the line eases out; before one it has already moved in (nearest wall within 1.5 m either way)
    for (let i = 0; i < n; i++) { let w = Infinity; for (let k = -3; k <= 3; k++) w = Math.min(w, wall[THREE.MathUtils.clamp(i + k, 0, n - 1)]); outer[i] = w - WALL_GAP; }
    // no slope steeper than SLOPE (m across per m along): the edge you run beside never kinks
    const ease = (a, sign) => { const out = Float32Array.from(a); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = a[j] + sign * SLOPE * step * Math.abs(i - j); if (sign > 0 ? v < out[i] : v > out[i]) out[i] = v; } return out; };
    const O = ease(outer, 1), I = ease(inner, -1), C = ease(curb, -1);
    // the two lines: near the curb, and the building side kept well off the wall (0.62 of the room, not 0.9: from the
    // chase camera, high and behind, a runner even 0.6 m off a facade reads as touching it; where the sidewalk
    // narrows the two lines close up and the wall clearance above still holds)
    const lanes = [0.12, 0.62].map((f) => Float32Array.from(O, (o, i) => I[i] + Math.max(0, o - I[i]) * f));
    // round the street furniture (trees, lamps, signal poles, benches): step off the line to the side with room,
    // starting early and easing back after (DETOUR m across per m along)
    const obst = footProps;
    lanes.forEach((L, li) => {
      const push = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const s = s0 + i * step;
        for (const o of obst) {
          if (Math.abs(o.s - s) > o.r + 0.35) continue;
          const R = o.r + PROP_GAP, at = L[i] + push[i];
          if (Math.abs(at - o.d) >= R) continue;
          const lo = I[i], hi = Math.max(lo, O[i]), inSide = o.d - R, outSide = o.d + R;
          const okIn = inSide >= lo - 0.05, okOut = outSide <= hi + 0.05;
          const to = li === 0 ? (okIn ? inSide : okOut ? outSide : null) : (okOut ? outSide : okIn ? inSide : null);
          push[i] = (to ?? (o.d - lo > hi - o.d ? lo : hi)) - L[i];
        }
      }
      const P = Float32Array.from(push);
      // the step-off eases out along a half cosine (no kink where it starts or ends: the old straight ramp changed the
      // line's sideways speed by 3 m/s in one step, which hit the steering's acceleration limit at every tree), as long
      // as it takes to keep its steepest part at DETOUR
      for (let i = 0; i < n; i++) for (let j = Math.max(0, i - 14); j <= Math.min(n - 1, i + 14); j++) {
        const a = Math.abs(push[j]); if (!a) continue;
        const W = a * Math.PI / (2 * DETOUR), u = Math.min(1, Math.abs(i - j) * step / W), v = a * 0.5 * (1 + Math.cos(Math.PI * u)) * Math.sign(push[j]);
        if (Math.abs(v) > Math.abs(P[i])) P[i] = v;
      }
      for (let i = 0; i < n; i++) L[i] = THREE.MathUtils.clamp(L[i] + P[i], I[i], Math.max(I[i], O[i]));
    });
    const at = (arr, s) => { const x = THREE.MathUtils.clamp((s - s0) / step, 0, n - 1), i = Math.min(n - 2, Math.floor(x)); return arr[i] + (arr[i + 1] - arr[i]) * (x - i); };
    // route d is negative on this (the right) side
    // far: the far curb of the street. (PATH and footProps are only what footLineD reads now: the start and the bully's start positions, the ?bot autopilot's line and updateHimLeft's. Nothing steers you along them: you run anywhere, roam.js)
    return { line: (s, lane) => -at(lanes[lane], s), inner: (s) => -at(I, s), outer: (s) => -at(O, s), left: (s) => -at(C, s), far: (s) => route.hw(s) - CURB_GAP - 0.1, wall: (s) => -at(wall, s), lanes, props: footProps, s0, step };
  })();
  const footLineD = (s, lane = 0) => PATH.line(s, lane);
  // (the GAS pedal used to be relabelled RUN on foot; on foot the pedals are hidden now and you drag to run)
  const gasLabel = () => {};   // the line round the street furniture (the bully's, the autopilot's)
  // ---------- on foot you move the way you move in the store ----------
  // (owner, Nov 2026: "instead of a run button, you should be able to run the same way you run inside the store")
  // The whole screen is the controller, like the store's (standalone/csd.js bindTouch): put a thumb down anywhere that
  // isn't a button and drag the way you want to go. A gold ring appears where you touched and the knob follows your
  // thumb: 60 px of travel (the ring drifts along if you keep pulling), nothing under 5 px, full speed from 50 px
  // (the store's STICK_DEAD / STICK_FULL). Up the screen is away from the camera (it is behind you, and swings round
  // as you run: camYawStep): drag up to run away from it, sideways to run across the screen, down to run back at it, any direction at a speed set by how far you push. A mouse drags the
  // same way; the arrow keys / WASD give the same directions. The pedals are hidden until you're in the car.
  // (Nov 11 2026, "the sensitivity when running needs to be assessed", GTA-on-a-phone feel: it was 6 / 22 / 44 px, so the whole range from standing to flat out was a 16 px wiggle and 5 px of finger shake
  // was a 6.5 degree swing of the run. Now: nothing under 5 px, full speed from 50 px (about an eighth of a 390 px screen), the ring follows from 60 px, a gentle start to the curve (STICK.curve: t^1.5)
  // so small moves are small, and the ring is drawn 120 px wide to match; 5 px of shake at the full push is now 4.8 degrees.)
  const STICK = { dead: 5, full: 50, travel: 60, curve: 1.5 };
  const stickEl = document.createElement('div'); stickEl.className = 'drive-stick'; stickEl.setAttribute('aria-hidden', 'true'); stickEl.innerHTML = '<i></i>'; root.appendChild(stickEl);
  const stickKnob = stickEl.firstElementChild;
  let stick = null;   // the drag in progress: { id, ax, ay (the ring), cx, cy (the thumb), x, y (-1..1), on, q }
  const stickK = (m) => { const t = THREE.MathUtils.clamp((m - STICK.dead) / (STICK.full - STICK.dead), 0, 1); return Math.pow(t, STICK.curve); };
  const showStick = () => {
    stickEl.style.transform = `translate(${stick.ax - 60}px, ${stick.ay - 60}px)`;
    stickKnob.style.transform = `translate(${stick.cx - stick.ax}px, ${stick.cy - stick.ay}px)`; stickEl.classList.add('on');
  };
  const endStick = () => { stick = null; stickEl.classList.remove('on'); };
  const stickMove = (cx, cy) => {
    stick.cx = cx; stick.cy = cy;
    let dx = cx - stick.ax, dy = cy - stick.ay, m = Math.hypot(dx, dy);
    if (m > STICK.travel) { stick.ax = cx - dx / m * STICK.travel; stick.ay = cy - dy / m * STICK.travel; dx = cx - stick.ax; dy = cy - stick.ay; m = STICK.travel; }
    if (m > STICK.dead) {
      const q = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U');
      if (m > 10 && (!stick.on || stick.q !== q)) { stick.q = q; haptic(HAP.lane, 60); }   // a tick when you swing to a new direction, like the store
      const k = stickK(m); stick.on = true; stick.x = dx / m * k; stick.y = dy / m * k;
    } else { stick.on = false; stick.x = stick.y = 0; }
    showStick();
  };
  const stickOK = (t) => state === 'onfoot' && !fly && !paused && !t?.closest?.('button, [data-skip], [data-pause], .drive-paused, .drive-busted, .dp');
  root.addEventListener('touchstart', (e) => {
    if (stick) return; const t = e.changedTouches[0]; if (!t || !stickOK(e.target)) return;
    stick = { id: t.identifier, ax: t.clientX, ay: t.clientY, cx: t.clientX, cy: t.clientY, x: 0, y: 0, on: false };
    audio.unlock(); haptic(HAP.tap); showStick();
  }, { passive: false });
  root.addEventListener('touchmove', (e) => { if (stick) for (const t of e.changedTouches) if (t.identifier === stick.id) stickMove(t.clientX, t.clientY); }, { passive: false });
  const stickLift = (e) => { if (stick) for (const t of e.changedTouches) if (t.identifier === stick.id) endStick(); };
  root.addEventListener('touchend', stickLift); root.addEventListener('touchcancel', stickLift);
  // a mouse or pen: press anywhere on the street and drag (the store's board works the same way)
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0 || stick || !stickOK(e.target)) return;
    stick = { id: 'mouse', ax: e.clientX, ay: e.clientY, cx: e.clientX, cy: e.clientY, x: 0, y: 0, on: false };
    audio.unlock(); showStick(); try { root.setPointerCapture(e.pointerId); } catch {}
  });
  root.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch' && stick?.id === 'mouse') stickMove(e.clientX, e.clientY); });
  const mouseUp = (e) => { if (e.pointerType !== 'touch' && stick?.id === 'mouse') endStick(); };
  root.addEventListener('pointerup', mouseUp); root.addEventListener('pointercancel', mouseUp); root.addEventListener('lostpointercapture', mouseUp);
  // where you're asking to go, like the store's inputVec: the stick, else the keys (ArrowUp/W away from the camera, ArrowDown/S
  // towards it, ◀ ▶ across the screen); x screen-right, y screen-down, length at most 1. (api.foot.stick: a test hook, like the store's testVec)
  const footVec = () => {
    if (api.foot?.stick) return api.foot.stick;
    let x = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0), y = (keys.has('down') ? 1 : 0) - (keys.has('gas') ? 1 : 0);
    if (stick?.on) { x = stick.x; y = stick.y; }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x, y };
  };
  // ---------- the whole city is yours (roam.js) ----------
  // (owner, Nov 2026: "I should be able to run through any and every part of the street outside and everything. It shouldn't be any guidelines. I should only not be able to go in the buildings.")
  // You and the bully live in the world plane (x east, y north): a position, a velocity, a heading. Nothing steers you along the street any more; the only things that stop you
  // are what is solid. roam.js holds the walls (every building's edges and footprint, the hand-built row's wall slices, the freeway's barriers and piers), every tree, pole, bench,
  // bin, hydrant and shelter, and the edge of the map; here are the moving things (cars, people, the bully) and how the person is driven. s and d (along and across the route)
  // are worked out from the position every step, because the traffic and the crowd read them.
  const walk = walkWorldFor({ city, heroWalls, shelters: trams.shelters, W });
  const doorP = route.at(doorS, doorD), DOOR = { x: doorP.x, y: doorP.y };   // the driver's door, in the world plane
  const DOOR_REACH = 1.2;   // m from the door at which you are in
  const startP = route.at(FOOT.start, footLineD(FOOT.start)), startH = route.at(FOOT.start - FOOT.bullyBehind, footLineD(FOOT.start - FOOT.bullyBehind));
  for (const [m, p] of [[me, startP], [him, startH]]) Object.assign(m, { x: p.x, y: p.y, vx: 0, vy: 0, kvx: 0, kvy: 0, heading: startP.a, turn: 0, good: { x: p.x, y: p.y }, px: p.x, py: p.y, gx: p.x, gy: p.y });
  let camYaw = startP.a;   // the way the camera looks (world angle): along the street at the start, then it follows you (updateFoot)
  const trail = new Trail(); trail.push(him.x, him.y); trail.push(me.x, me.y);   // where you have been: the bully runs it
  const chase = {};          // where he is running to (roam.js chaseTarget)
  const PR = { s: 0, d: 0, a: 0, off: 0 };   // projectFine's answer, reused (it is asked several times a step)
  const OFF_ROUTE = 1e4;   // the d of someone who is not beside the route's street at all (see syncRoute)
  const syncRoute = (m) => {
    const pr = route.projectFine(m.x, m.y, PR), c = Math.cos(pr.a), sn = Math.sin(pr.a), vx = m.vx + m.kvx, vy = m.vy + m.kvy;
    // off: how far past the route's start or end the point is (s stops at 0 / the length there, and d would still read a few metres: a runner 40 m behind the start would count as standing at s = 0).
    // Anyone not beside the route is far off it as far as everything that reads s and d is concerned (the traffic, the crowd, the street's boxes).
    m.off = pr.off; m.s = pr.s; m.d = pr.off < 0.5 ? pr.d : OFF_ROUTE; m.v = vx * c + vy * sn; m.dv = -vx * sn + vy * c;   // (along and across the route there: the traffic and the crowd read these)
  };
  // near enough to the route's street for its traffic and its crowd to matter
  const onStreet = (m) => m.off < 0.5 && Math.abs(m.d) < route.hw(m.s) + 9;
  syncRoute(me); syncRoute(him);
  const othersOn = [him], othersOff = [];
  world.others = onStreet(him) ? othersOn : othersOff;   // cars see him too (while he is beside the route's street: moveSolid keeps this)
  me.o.visible = him.o.visible = me.blob.visible = him.blob.visible = !SKIPFOOT;
  root.classList.toggle('onfoot', !SKIPFOOT);   // drive.css: no pedals on foot (you drag, like the store); they come in when you get in
  const focus = { x: 0, y: 0, z: 0 };   // where the sun's shadow box is centred while you are on foot (world.focus, crowd.focus)
  let footT = 0, found = false, race = null, tauntK = 0, footAcc = 0;
  const TAUNTS = ['HEY! YOU!', 'GET BACK HERE!', 'THOSE ARE MINE!', 'GIMME THAT!'];
  // the height of the ground under a foot: the road or the terrain, whichever is higher (a freeway deck is only ever under your feet where it is level with the ground, its walls keep you off the rest)
  const footZ = (x, y) => { const gz = ground(x, y); return Math.max(surfAt(x, y, gz + 1.2) ?? -Infinity, gz + LEVEL.TERRAIN); };
  // how far each of you is from the door, as the crow flies, for the race bar and the YOUR CAR distance. Capped at 60 m so luring him far away and doubling back is no exploit
  const offScreen = (x, y) => !world.visible(x, y, footZ(x, y) + 1, 2.5);   // the camera cannot see a person standing there
  const doorDist = (m) => Math.hypot(m.x - DOOR.x, m.y - DOOR.y), BAR_CAP = 60;
  const barS = (m) => doorS - Math.min(BAR_CAP, doorDist(m));

  // --- movement: fixed 1/120 s steps (like the car), drawn between the last two steps ---
  // Speed eases toward what you're asking for: quick to get going, quick to stop, no kink at either end (a vector now: a turn is as quick as a start).
  const MOVE = { up: [0.16, 17], down: [0.08, 34], stun: [0.12, 30] };   // [time constant s, max m/s^2]
  const TURN = 16;   // rad/s: how fast a person swings round to face where he is running
  const faceMove = (m, dt) => {
    const sp = Math.hypot(m.vx, m.vy); let turn = 0;
    if (sp > 0.6) { const step = THREE.MathUtils.clamp(angDiff(Math.atan2(m.vy, m.vx), m.heading), -TURN * dt, TURN * dt); m.heading += step; turn = step / dt; }
    m.turn += (turn - m.turn) * (1 - Math.exp(-dt * 12));
  };
  // someone you (or he) barge into is knocked aside, away from you, and flinches (hands up). The crowd's own flinch
  // (startle) also steps them 0.9 m toward the buildings, so knocked toward the curb they get pushed that much
  // further, but never off the curb; with no room on that side they go the other way. (crowd d: + = building side;
  // route d: + = left, so a person on the left pavement is at +d and one on the right at -d)
  function knock(q, fromD) {
    const side = q.g.side, qd = side * q.d, lo = crowd.bandAt(side, q.s)[0], room = q.d - (lo - 0.1);
    const toCurb = (qd > fromD ? 1 : -1) * side < 0;   // "away from you" is toward the curb on this person's side
    if (toCurb && room > 0.4) { q.startle = 0.7; q.shove = -Math.min(0.75, room) - 0.63; }
    else { q.startle = 1; q.shove = 0.75; }
  }
  // a stumble you can read: the body rocks (pitch, roll) and settles; amp in radians, the shove adds a sink
  const stagger = (m, pitch, roll, dur, sink = 0) => { m.hit = { t: 0, dur, pitch, roll, sink }; };
  // what the street did this frame that you should hear or feel: a driver leaning on the horn / skidding for a person in the
  // road, and a car that couldn't stop in time for the runner (a shove, never the end: see runnerShove)
  function streetEvents(ev) {
    for (const h of ev.honks || []) {
      const g = Math.max(0, 1 - h.d / 70); if (g > 0.05) { audio.honkAt(g); if (h.skid) audio.skid(g); }
    }
    for (const h of ev.runnerHits || []) { const p = route.at(h.e.s, h.e.d); runnerShove(p.x, p.y); }
  }
  // A car that couldn't stop in time: a shove, never the end. You are knocked out of its way (away from where it is: a speed that fades over about half a second),
  // check to 40 % speed and stagger; the driver has already stood on the brakes.
  function runnerShove(fromX, fromY) {
    if (footT < (me.carHitT || 0)) return;
    me.carHitT = footT + 1.2;
    const dx = me.x - fromX, dy = me.y - fromY, L = Math.hypot(dx, dy) || 1, side = Math.sign(-dx * Math.sin(me.heading) + dy * Math.cos(me.heading)) || 1;
    me.vx *= 0.4; me.vy *= 0.4; me.kvx += dx / L * 3.4; me.kvy += dy / L * 3.4; me.stun = Math.max(me.stun, 0.55); shake = 0.45;
    stagger(me, -0.25, side * 0.14, 0.55);
    pop('WATCH IT!'); audio.crash(0.2); haptic(HAP.bump); tauntK = Math.max(tauntK, 1);
  }
  // ---------- nothing solid is ever walked through ----------
  // The walls and posts are the end of every step (walls always win, roam.js wallPass). Before them, the things that move:
  // 1. the route's street: every car, the streetcar, your own parked car, cones, barricades and the people working the street are a box (its own length and width, widened by
  //    BODY, and swept to wherever it is now as well as where the traffic last saw it). If a person ends a step inside one he is put out of it along the shallowest way. A thing that is
  //    MOVING (a car at speed) is only ever gone round, sideways, never along its travel (which would carry him along in front of it); when it hits him that is the shove (runnerShove).
  //    A thing that is standing is left by whichever of its four ways is shortest; a side is slid along.
  // 2. the cross streets' cars and buses, anywhere in the city, the same way, as the boxes they are drawn as (World.ambientBoxes).
  // 3. the people of the crowd: you bump them (they are knocked aside, you stumble); the bully just shoves through.
  // (all of this runs every 1/120 s step, twice: the boxes, the ways out and the projection are reused objects, nothing is allocated, so a phone's GC does not hitch)
  const E = 0.003, rBoxes = [], rPool = [], aBoxes = [];
  const wCost = [0, 0, 0, 0], wAxis = [0, 0, 0, 0], wTgt = [0, 0, 0, 0], wOrd = [0, 1, 2, 3], TT = { ds: 0, dd: 0, x: 0, y: 0 }, QR = {};
  function wayTo(k, m, s, d, c, sn) { TT.ds = wAxis[k] === 1 ? wTgt[k] - s : 0; TT.dd = wAxis[k] === 0 ? wTgt[k] - d : 0; TT.x = m.x + c * TT.ds - sn * TT.dd; TT.y = m.y + sn * TT.ds + c * TT.dd; }
  function routeBoxes(m, isMe) {
    const obs = world.traffic.obs; if (!obs || !obs.length) return;
    let nb = 0;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.runner || o.o === him || o.o === me || o.cross || !o.L || !o.W || Math.abs(o.s - m.s) > 24) continue;
      const ent = o.o, live = typeof ent.s === 'number' && typeof ent.d === 'number', os = live ? ent.s : o.s, od = live ? ent.d : o.d, b = rPool[nb] || (rPool[nb] = {});
      b.mv = Math.abs(o.vs) > 2; b.sLo = Math.min(o.s, os) - o.L / 2 - BODY; b.sHi = Math.max(o.s, os) + o.L / 2 + BODY; b.dLo = Math.min(o.d, od) - o.W / 2 - BODY; b.dHi = Math.max(o.d, od) + o.W / 2 + BODY;
      rBoxes[nb++] = b;
    }
    rBoxes.length = nb;
    if (!nb) return;
    for (let pass = 0; pass < 6; pass++) {
      const pr = route.projectFine(m.x, m.y, PR), s = pr.s, d = pr.d;
      let h = null; for (let i = 0; i < nb; i++) { const b = rBoxes[i]; if (s > b.sLo && s < b.sHi && d > b.dLo && d < b.dHi) { h = b; break; } }
      if (!h) break;
      // the ways out of it (cost, axis 0 = d / 1 = s, target), nearest first
      let nw = 0;
      wCost[nw] = d - h.dLo; wAxis[nw] = 0; wTgt[nw++] = h.dLo - E;
      wCost[nw] = h.dHi - d; wAxis[nw] = 0; wTgt[nw++] = h.dHi + E;
      if (!h.mv) { wCost[nw] = s - h.sLo; wAxis[nw] = 1; wTgt[nw++] = h.sLo - E; wCost[nw] = h.sHi - s; wAxis[nw] = 1; wTgt[nw++] = h.sHi + E; }
      for (let i = 0; i < nw; i++) wOrd[i] = i;
      for (let i = 1; i < nw; i++) { const k = wOrd[i]; let j = i - 1; while (j >= 0 && wCost[wOrd[j]] > wCost[k]) { wOrd[j + 1] = wOrd[j]; j--; } wOrd[j + 1] = k; }   // (stable insertion sort of at most 4)
      const c = Math.cos(pr.a), sn = Math.sin(pr.a);
      let pk = -1; for (let i = 0; i < nw; i++) { wayTo(wOrd[i], m, s, d, c, sn); if (!walk.solid(TT.x, TT.y, BODY)) { pk = wOrd[i]; break; } }   // the nearest way out that is not into a wall
      if (pk < 0) { pk = wOrd[0]; wayTo(pk, m, s, d, c, sn); }
      m.x = TT.x; m.y = TT.y;
      const sg = Math.sign(wAxis[pk] === 1 ? TT.ds : TT.dd);
      if (wAxis[pk] === 1) killInto(m, c * sg, sn * sg); else killInto(m, -sn * sg, c * sg);
      if (isMe && h.mv && wAxis[pk] === 0 && Math.abs(TT.dd) > 0.12) { const q = route.at((h.sLo + h.sHi) / 2, (h.dLo + h.dHi) / 2); runnerShove(q.x, q.y); }   // (a car at speed took him: knocked aside, checked, staggers)
    }
  }
  function ambientBoxPass(m, isMe) {
    world.ambientBoxes(m.x, m.y, 14, aBoxes);
    for (const b of aBoxes) {
      const c = Math.cos(b.h), sn = Math.sin(b.h), Hl = b.hl + BODY, Hw = b.hw + BODY;
      for (let pass = 0; pass < 3; pass++) {
        const dx = m.x - b.x, dy = m.y - b.y, u = dx * c + dy * sn, w = -dx * sn + dy * c;
        if (Math.abs(u) >= Hl || Math.abs(w) >= Hw) break;
        const ways = [[Hw - w, 'w', Hw + E], [w + Hw, 'w', -Hw - E]];
        if (b.vs <= 2) ways.push([Hl - u, 'u', Hl + E], [u + Hl, 'u', -Hl - E]);   // (one at speed is only gone round, sideways)
        ways.sort((p, q) => p[0] - q[0]);
        const to = (k) => { const du = k[1] === 'u' ? k[2] - u : 0, dw = k[1] === 'w' ? k[2] - w : 0; return { du, dw, x: m.x + c * du - sn * dw, y: m.y + sn * du + c * dw }; };
        let pick = null; for (const k of ways) { const t = to(k); if (!walk.solid(t.x, t.y, BODY)) { pick = { k, t }; break; } }
        if (!pick) pick = { k: ways[0], t: to(ways[0]) };
        m.x = pick.t.x; m.y = pick.t.y;
        const sg = Math.sign(pick.k[1] === 'u' ? pick.t.du : pick.t.dw);
        if (pick.k[1] === 'u') killInto(m, c * sg, sn * sg); else killInto(m, -sn * sg, c * sg);
        if (isMe && b.vs > 2 && Math.abs(pick.t.dw) > 0.12) runnerShove(b.x, b.y);
      }
    }
  }
  function crowdPass(m, isMe) {
    for (const q of crowd.people) {
      if (Math.abs(q.s - m.s) > 3) continue;
      const side = q.g.side, qd = side * q.d, p = route.at(q.s, qd, QR), dist = Math.hypot(p.x - m.x, p.y - m.y);
      if (isMe) {
        if (dist < 0.6 && me.stun <= 0 && (q.bumped || 0) < footT) {
          q.bumped = footT + 2; me.vx *= 0.45; me.vy *= 0.45; me.stun = 0.35; shake = 0.35;
          knock(q, me.d);
          // you bounce off them: a step away from them (as far as the walls allow), so you slide past, not through
          const L = dist || 1, ax = dist ? (me.x - p.x) / L : -Math.sin(me.heading), ay = dist ? (me.y - p.y) / L : Math.cos(me.heading);
          me.kvx += ax * 2.4; me.kvy += ay * 2.4;
          stagger(me, -0.22, (qd > me.d ? 0.12 : -0.12), 0.45);
          pop('WATCH IT!'); audio.crash(0.15); haptic(HAP.bump); tauntK = Math.max(tauntK, 1);
        }
      } else if (dist < 0.75 && !q.shove) knock(q, m.d);
    }
  }
  function moveSolid(m, isMe) {
    syncRoute(m);
    if (onStreet(m)) { routeBoxes(m, isMe); crowdPass(m, isMe); }
    ambientBoxPass(m, isMe);
    wallPass(walk, m, BODY);   // last: walls always win
    syncRoute(m);
    if (!isMe) world.others = onStreet(m) ? othersOn : othersOff;   // the cars see the bully only while he is beside the route's street
  }
  const GAS_HINT = 'Hold GAS to go!'; let gasHint = 0;
  function getIn() {
    // (runnerOn off: the runner is in the car, so traffic stops treating the spot he got in at as a person standing in the road)
    state = 'driving'; world.runnerOn = world.runnerFoot = false; world.focus = crowd.focus = null; gasLabel(false); me.o.visible = me.blob.visible = false; hazards.visible = false; markerSprite.visible = false;
    // the drag ends here (a thumb still down is not GAS: the stick never writes keys) and the pedals come in
    endStick(); root.classList.remove('onfoot');
    if (G) G.from(root.querySelectorAll('.drive-pad'), { y: 40, opacity: 0, duration: 0.45, stagger: 0.07, ease: 'back.out(1.5)', clearProps: 'transform,opacity' });
    // you peel out: the car swings straight into the travel lane (the parking lane ahead is full of parked cars)
    laneK = 1; followLane(); if (BOT) car.targetD = route.lane(car.s, 0);
    cpFrom = car.s;
    hud.pop.replaceChildren();   // a taunt still floating up would sit on top of GO! GO! GO!
    flash('GO! GO! GO!', 900); haptic(HAP.go); audio.chime();
    // your thumb was on the street, not on GAS: say where to go now (phones; cleared when you press GAS or after 3 s)
    setHint(!BOT && matchMedia('(pointer: coarse)').matches ? GAS_HINT : ''); gasHint = 3;
    // he runs for his own ride (just behind where he's standing), then he's coming
    race = { s: homeS - 2 - Math.min(BAR_CAP, doorDist(him)), v: 0, hop: RACE.hop + Math.max(0, him.pause), tail: false, shookAt: 0 };
    raceBar.hidden = false;
  }
  // where the QA autopilot (?bot) wants to go: up the street along the line round the furniture, then in to the driver's door (the same walls, cars and people stop it as stop you)
  const botWish = (out) => {
    let tx = DOOR.x, ty = DOOR.y;
    if (doorDist(me) >= 3.5) {
      const s2 = Math.min(doorS, me.s + 2.5), k = THREE.MathUtils.smoothstep(9 - Math.abs(doorS - s2), 0, 6), q = route.at(s2, THREE.MathUtils.lerp(footLineD(s2), doorD, k));
      tx = q.x; ty = q.y;
    }
    const dx = tx - me.x, dy = ty - me.y, L = Math.hypot(dx, dy) || 1;
    out.x = dx / L * FOOT.run; out.y = dy / L * FOOT.run; return out;
  };
  const wish = { x: 0, y: 0 }, steer = { on: false, a: 0 }, fvOut = { x: 0, y: 0 };
  function updateFoot(dt) {
    footT += dt;
    // you: the stick (or the arrow keys) is the way you run, as seen from the camera: up the screen is away from the camera, sideways is across the screen, down runs at the
    // camera, and how far you push is how fast (the store's stick works the same way). Any direction is full speed at full push (the store's diagonals are full speed too).
    const raw = footVec(), fv = steerStick(steer, raw.x, raw.y, dt, fvOut);   // (the thumb's direction eased and a small cone round straight up counts as straight: roam.js steerStick)
    if (BOT) botWish(wish); else wishVelocity(fv.x, fv.y, camYaw, FOOT.run, wish);
    if (me.stun > 0) wish.x = wish.y = 0;
    me.stun = Math.max(0, me.stun - dt);
    const mv = me.stun > 0 ? MOVE.stun : Math.hypot(wish.x, wish.y) > Math.hypot(me.vx, me.vy) ? MOVE.up : MOVE.down;
    me.acc = approach(me, wish.x, wish.y, mv[0], mv[1], dt, me.heading);
    faceMove(me, dt);
    // the camera swings round with what the thumb asks for (not with where you are facing: that was a loop), as fast as you run (roam.js camYawStep)
    camYaw = camYawStep(camYaw, BOT ? 0 : fv.x, BOT ? -1 : fv.y, Math.hypot(me.vx, me.vy) / FOOT.run, dt);
    integrate(me, dt);
    moveSolid(me, true);
    trail.push(me.x, me.y);
    if (!found && footT > 0.3 && footT < 0.5) setHint('Drag to run — get to your car');   // (straight away: there's no button on screen to tell you)
    if (!found && doorDist(me) < 14) { found = true; audio.token(); setHint('That’s your ride — get in!'); }
    // the bully: a beat to clock you, then he runs you down; catching you is a shove, not the end
    him.pause = Math.max(0, him.pause - dt);
    const go = footT > FOOT.bullyGo && him.pause <= 0;
    // He runs at you when he can see you (a clear line for his body), else along your trail to the newest crumb of it he can see. Closing on you he eases off to your pace instead of
    // slamming into your back (he used to stop dead from 5.3 m/s in one step when you stopped in front of him).
    chaseTarget(walk, trail, him, me, chase, dt);
    let ux = chase.tx - him.x, uy = chase.ty - him.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const gap0 = Math.hypot(me.x - him.x, me.y - him.y) || 1, away = Math.max(0, ((me.vx + me.kvx) * (me.x - him.x) + (me.vy + me.kvy) * (me.y - him.y)) / gap0);   // how fast you are running away from him
    const sp = !go ? 0 : chase.sees ? Math.min(FOOT.bully, away + Math.max(0, gap0 - 0.75) * 4) : FOOT.bully;
    him.acc = approach(him, ux * sp, uy * sp, go ? 0.14 : 0.1, go ? 20 : 30, dt, him.heading);
    faceMove(him, dt);
    integrate(him, dt);
    const gap1 = Math.hypot(him.x - me.x, him.y - me.y);   // (after his step: the push out below scales THIS vector, so it is measured now)
    if (gap1 < 0.7 && gap1 > 1e-4) { const k = 0.7 / gap1; him.x = me.x + (him.x - me.x) * k; him.y = me.y + (him.y - me.y) * k; }   // right on your back: he cannot stand inside you
    moveSolid(him, false);
    // stuck for good somewhere with no way to you (a trapped corner): put back on your trail a dozen metres behind you once he is far away, never on screen
    him.stuckT = go && sp > 2 && Math.hypot(him.vx, him.vy) < 0.8 ? (him.stuckT || 0) + dt : 0;
    // (never where the camera can see: an older crumb, a dozen at a time, until one is out of frame; if every one is on screen he waits and tries again next step)
    if (him.stuckT > 3 && gap0 > 22 && trail.n > 30) {
      let id = trail.n - 24; for (let k = 0; k < 30 && trail.has(id) && !offScreen(trail.px(id), trail.py(id)); k++) id -= 12;
      if (trail.has(id) && offScreen(trail.px(id), trail.py(id))) { him.x = trail.px(id); him.y = trail.py(id); him.vx = him.vy = him.kvx = him.kvy = 0; him.good = { x: him.x, y: him.y }; trail.reached = id; him.stuckT = 0; syncRoute(him); }
    }
    const gap = Math.hypot(me.x - him.x, me.y - him.y);
    if (go && gap < FOOT.reach && me.stun <= 0 && walk.clearLine(me.x, me.y, him.x, him.y, 0.05)) {   // (and nothing solid between you: a thin wall or railing does not let him shove through it)
      // shoved from behind: you lurch away from him, stagger and go down on one knee; he stops to gloat
      me.stun = FOOT.stun; me.vx += (me.x - him.x) / (gap || 1) * 1.2; me.vy += (me.y - him.y) / (gap || 1) * 1.2; him.pause = FOOT.pause; shake = 0.7;
      stagger(me, 0.5, 0.14 * (Math.random() < 0.5 ? -1 : 1), FOOT.stun, 0.22);
      flash('SHOVED!', 800); audio.crash(0.35); haptic(HAP.crash); tauntK = 1.6;   // no taunt on top of SHOVED!
    }
    tauntK -= dt;
    if (go && tauntK <= 0 && me.stun <= 0 && gap < 9) { tauntK = 2.6; pop(TAUNTS[(Math.random() * TAUNTS.length) | 0]); }
    // the crowd watches you and the bully (route-space s, d, speed; t = when) and steps out of the way (crowd.js react). Only along the route's street: that is where the crowd is.
    crowd.runner = onStreet(me) ? { s: me.s, d: me.d, v: me.v, t: footT } : null; crowd.chaser = onStreet(him) ? { s: him.s, d: him.d, v: him.v, t: footT } : null;
    if (doorDist(me) < DOOR_REACH && me.stun <= 0) getIn();
  }
  // after you drive off he's still out there for a moment, running for his ride, until he's behind the camera
  function updateHimLeft(dt) {
    // he was running for his ride; once he is off the route's street, or has had 8 s, he is gone (he used to run on into whatever wall was between him and the car, and stay there)
    him.leftT = (him.leftT || 0) + dt;
    if (!onStreet(him) || him.leftT > 8) { him.o.visible = him.blob.visible = false; world.others = othersOff; return; }
    const q = route.at(him.s + 4, footLineD(him.s + 4)), dx = q.x - him.x, dy = q.y - him.y, L = Math.hypot(dx, dy) || 1, sp = FOOT.bully * 0.7;
    him.acc = approach(him, dx / L * sp, dy / L * sp, 0.2, 12, dt, him.heading);
    faceMove(him, dt); integrate(him, dt); moveSolid(him, false);
    if (car.s - him.s > 25) him.o.visible = him.blob.visible = false;
  }
  // smooth follow that never overshoots, the same at any frame rate (Game Programming Gems 4, "critically damped
  // ease-in/out"; what Unity's SmoothDamp is): used for the body's height and the on-foot camera
  function smoothDamp(cur, target, st, key, smoothTime, dt) {
    const om = 2 / smoothTime, x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const ch = cur - target, tmp = (st[key] + om * ch) * dt;
    st[key] = (st[key] - om * tmp) * ex;
    let out = target + (ch + tmp) * ex;
    if ((target - cur > 0) === (out > target)) { out = target; st[key] = 0; }
    return out;
  }
  /** draw a person between the last two movement steps (al = how far into the next one this frame is) */
  function posePerson(m, dt, al) {
    const x = m.px + (m.x - m.px) * al, y = m.py + (m.y - m.py) * al;
    m.gx = x; m.gy = y;   // where he is drawn (the camera follows this)
    const sp = Math.hypot(m.vx, m.vy), fx = sp > 0.3 ? m.vx / sp : Math.cos(m.heading), fy = sp > 0.3 ? m.vy / sp : Math.sin(m.heading);
    // height: the higher of the ground under you and a step ahead, eased (a 0.32 m curb at s ~76 used to pop you up
    // in one frame, and the camera with you)
    const here = footZ(x, y), gz = Math.max(here, footZ(x + fx * 0.35, y + fy * 0.35));
    if (m.zs === undefined) { m.zs = gz; m.zv = 0; }
    m.zs = smoothDamp(m.zs, gz, m, 'zv', gz > m.zs ? 0.05 : 0.08, dt);
    m.z = m.zs;
    // stumble / shove: a quick rock that settles (sin-shaped in, eased out)
    let hp = 0, hr = 0, hs = 0;
    if (m.hit) {
      m.hit.t += dt; const u = m.hit.t / m.hit.dur;
      if (u >= 1) m.hit = null;
      else { const e = u < 0.18 ? Math.sin(u / 0.18 * Math.PI / 2) : 1 - THREE.MathUtils.smootherstep(u, 0.18, 1); hp = m.hit.pitch * e; hr = m.hit.roll * e; hs = m.hit.sink * e; }
    }
    // weight and lean: into the push-off, back when you pull up, into a turn (a left turn banks left: roll is the negative of the turn rate)
    const k = 1 - Math.exp(-dt * 10);
    m.lean += (THREE.MathUtils.clamp(m.acc * 0.006, -0.1, 0.12) - m.lean) * k;
    m.roll += (THREE.MathUtils.clamp(-m.turn * 0.06, -0.13, 0.13) - m.roll) * k;
    // facing: the way he is running (roam.js / faceMove turns the heading at up to 16 rad/s), eased a little on screen
    const head = m.heading;
    if (m.yaw === null) m.yaw = head;
    m.yaw += angDiff(head, m.yaw) * (1 - Math.exp(-dt * 14));
    // animation: stand, walk and run blended by speed, all on one clock that advances with the ground you cover
    const wRun = THREE.MathUtils.smoothstep(sp, 1.6, 4.2), moving = THREE.MathUtils.smoothstep(sp, 0.05, 1.0);
    const plant = THREE.MathUtils.lerp(m.plantWalk, m.plantRun, wRun), dur = clips.run.duration;
    m.phase = (((m.phase + sp / plant * dt) % dur) + dur) % dur;   // (always forwards now: he runs the way he faces, there is no backing up)
    m.act.stand.setEffectiveWeight(1 - moving); m.act.walk.setEffectiveWeight(moving * (1 - wRun)); m.act.run.setEffectiveWeight(moving * wRun);
    m.act.walk.time = m.act.run.time = m.phase; m.act.stand.time = 0;
    m.mixer.update(0);
    m.o.position.copy(toV3(x, y, m.zs - (1 - moving) * m.sink - hs));
    m.o.rotation.set(m.lean + hp, m.yaw + Math.PI / 2, m.roll + hr, 'YXZ');
    m.blob.visible = m.o.visible;
    m.blob.position.set(m.o.position.x, here + 0.04, m.o.position.z); m.blob.rotation.set(-Math.PI / 2, m.yaw + Math.PI / 2, 0);
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
  const raceFrom = Math.min(barS(him), barS(me)) - 2;
  function drawRaceBar() {
    if (raceBar.hidden) return;
    const span = spot.s - raceFrom, at = (s) => THREE.MathUtils.clamp((s - raceFrom) / span, 0, 1) * 100 + '%';
    const youS = state === 'onfoot' ? barS(me) : car.s, himS = race ? race.s : barS(him);
    const lx = at(youS), hx = at(himS);
    if (rYou.style.left !== lx) rYou.style.left = lx;
    if (rHim.style.left !== hx) rHim.style.left = hx;
    const gapS = race ? (race.tail ? 0 : (youS - himS) / Math.max(6, race.v || RACE.pace)) : (doorDist(him) - doorDist(me)) / FOOT.bully;
    raceBar.classList.toggle('hot', gapS < 2.5);
    setText(rGap, race && race.tail ? 'ON YOUR TAIL!' : state === 'onfoot' ? 'RUN!' : `+${gapS.toFixed(1)}s`);
  }

  // ---------- the opening flyover ----------
  // The first start of a game opens with a swoop over the city before the chase: the camera begins high over the east end of Auburn Ave, dives past the EBT Corner Store, runs the street back
  // west past your parked car, then swings round you (you with the bully behind you, both standing still) and settles behind the bully, which is exactly where the on-foot camera sits, so the
  // chase starts with no jump. Nothing but the camera is new: the street, the people and the traffic carry on as usual, you and the bully do not move (updateFoot does not run, so the chase clock,
  // his chase and every hint wait), the HUD and the stick are held off (drive.css .flying) and a tap or any key goes straight to the on-foot start. Not played on a restart or after BUSTED
  // (the host starts the drive again: retryNext), with ?qa / ?bot (they start on foot at once; ?qa&fly asks for it), ?nofly, ?skipfoot, or with reduced motion set.
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FLY_ON = (introOption ?? !RETRY) && !SKIPFOOT && !BOT && !REDUCED && !FLY_QS.has('nofly') && (!QA || FLY_QS.has('fly'));
  const FLY = { dur: 4.8, clear: 5, ease: 0.35 };   // seconds; metres of air kept over the highest thing under the camera; the pace at the very start (0 = from rest; the end is always at rest)
  const flyFocus = new THREE.Vector3();   // where the sun's shadow box sits during it: under what the camera is looking at
  let fly = FLY_ON ? { t: 0, pos: null, look: null, floor: null, end: null } : null;
  if (fly) { root.classList.add('flying'); root.insertAdjacentHTML('beforeend', '<div class="drive-flyskip">TAP TO SKIP</div>'); }
  function endFly(skipped = true) {
    if (!fly) return;
    fly = null; root.classList.add('flyin'); root.classList.remove('flying'); root.querySelector('.drive-flyskip')?.remove(); setTimeout(() => root.classList.remove('flyin'), 600);
    if (skipped) { camPos.set(0, 0, 0); camLook.set(0, 0, 0); }   // skipped: the next frame puts the camera on its on-foot spot, as on a start with no flyover (a flyover that ran to the end is already there)
    last = performance.now();
  }
  // a tap or a key anywhere ends it (the touch that skips it is not also the start of a run)
  const flyTap = (e) => { if (!fly) return; e.preventDefault(); e.stopPropagation(); audio.unlock(); endFly(); };
  for (const ev of ['pointerdown', 'touchstart']) root.addEventListener(ev, flyTap, { capture: true, passive: false });
  /** the camera's path, built on the first flyover frame once the on-foot camera spot is known (tp, tl: where it will sit; the path ends exactly there) */
  function buildFlight(tp, tl) {
    const f = fly, at = (s, d, h) => { const q = route.at(s, d); return new THREE.Vector3(q.x, q.z + h, -q.y); };
    // The last stretch stays over the street (a camera swinging round you at 20 m radius ends up over the roofs beside it, looking down at a wall of one colour): it runs the street axis past
    // you, a little to one side and high, goes on 24 m, turns back and comes down behind the bully (the last 0.7 s). Its aim stays level on the horizon while the view turns round (the camera is high over the
    // roofs for the turn, so never down at a roof or across at a wall), then comes down to the on-foot aim. (tools-restart/cover.mjs: no one surface over ~35% of the frame.) Heights are over the road under each point. s0 = where you stand along the route; the street runs the way you run (the route's s grows that way).
    const fx = Math.cos(camYaw), fy = Math.sin(camYaw), rel = (a, l, h) => { const x = me.gx + fx * a - fy * l, y = me.gy + fy * a + fx * l; return new THREE.Vector3(x, ground(x, y) + h, -y); };   // (a metres ahead of you, l to your left, h over the ground there)
    const P = [at(1190, -20, 105), at(1152, -8, 52), at(1108, 3, 28), at(1000, 0, 34), at(820, 0, 36), at(640, 0, 36), at(460, 0, 36), at(290, 0, 34), at(150, 0, 32),
      rel(70, 0, 32), rel(34, 0, 34), rel(8, 3.5, 36), rel(-24, 4, 34), rel(-16, 0, 18), tp.clone()];
    const L = [at(1122, -6, 2), at(1112, -6, 4), at(1040, 0, 6), at(910, 0, 4), at(730, 0, 4), at(550, 0, 4), at(370, 0, 4), at(200, 0, 4), at(60, 0, 4),
      rel(-60, 0, 20), rel(-70, 0, 28), rel(-110, 60, 34), rel(-20, 170, 34), rel(90, 0, 26), tl.clone()];
    f.end = { pos: tp.clone(), look: tl.clone() };
    f.pos = new THREE.CatmullRomCurve3(P, false, 'centripetal'); f.look = new THREE.CatmullRomCurve3(L, false, 'centripetal');
    // never inside a building or under the road: along the path, the camera keeps FLY.clear metres over the highest roof, deck or ground under it
    // (and a little before and after, so it climbs over a roof edge before it gets there), city.isFree marking a footprint it must be above in any case
    const N = 240, fl = new Float32Array(N + 1), p = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      f.pos.getPoint(i / N, p); const x = p.x, y = -p.z;
      const up = Math.max(roofAt(x, y), ground(x, y) + LEVEL.TERRAIN, surfAt(x, y, ground(x, y) + 1.2) ?? -Infinity);
      fl[i] = up + FLY.clear + (city.isFree(x, y) ? 0 : 3);
    }
    const sm = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) { let m = -Infinity; for (let k = -7; k <= 7; k++) m = Math.max(m, fl[Math.min(N, Math.max(0, i + k))]); sm[i] = m; }
    for (let i = 0; i <= N; i++) { let a = 0, n = 0; for (let k = -6; k <= 6; k++) { a += sm[Math.min(N, Math.max(0, i + k))]; n++; } fl[i] = a / n; }
    f.floor = fl;
  }
  /** the camera at flyover time t: (position, look) written into camPos / camLook */
  function flyCamera(dt, tp, tl) {
    const f = fly; if (!f.pos) buildFlight(tp, tl);
    // the pace: it starts from rest (the picture it opens on is held while the loader lifts) and comes to rest exactly where the on-foot camera is (a Hermite curve with slope FLY.ease at the start and 0 at the end)
    f.t += dt; const k = Math.min(1, f.t / FLY.dur), u = FLY.ease * (k * k * k - 2 * k * k + k) + (-2 * k * k * k + 3 * k * k);
    f.pos.getPoint(u, camPos); f.look.getPoint(u, camLook);
    const fl = f.floor, x = u * (fl.length - 1), i = Math.min(fl.length - 2, Math.floor(x)), floor = fl[i] + (fl[i + 1] - fl[i]) * (x - i);
    camPos.y = Math.max(camPos.y, floor);
    const w = THREE.MathUtils.smoothstep(u, 0.8, 1);   // the last stretch settles onto where the on-foot camera is NOW (it is the same place it was when the path was made, unless you were moved)
    if (w > 0) { camPos.addScaledVector(tmp.copy(tp).sub(f.end.pos), w); camLook.addScaledVector(tmp.copy(tl).sub(f.end.look), w); }
    flyFocus.set(camLook.x, ground(camLook.x, -camLook.z), camLook.z);
    if (k >= 1) endFly(false);
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
  // QA: api.tick(dt) runs one whole frame at exactly that dt and draws nothing (api.manual = true stops the live
  // loop first), so a test can replay any frame-time pattern, a phone's uneven one included, and measure each frame
  let tickDt = null;
  function frame(ts) {
    const manual = tickDt !== null;
    if (!manual) { raf = nextFrame(frame); if (api.manual) return; }
    if (root.clientWidth + 'x' + root.clientHeight !== sized) resize();
    // the time of THIS frame on screen (requestAnimationFrame's timestamp: the same for everything drawn in it), not
    // whenever this callback happened to start: the start wanders by a few ms frame to frame on a busy phone, and
    // stepping the world by that wandering amount made motion judder even at a steady frame rate
    const now = !manual && typeof ts === 'number' ? ts : performance.now(), dt = manual ? tickDt : Math.max(0, Math.min((now - last) / 1000, 0.05)); last = now;
    if (!manual) adaptRes(now);
    if (paused || api.pause || (holding && !manual)) { if (!manual) comic.render(); return; }   // paused (or QA freeze-frame): the world holds still   // QA: freeze-frame for look-dev
    hornT -= dt;
    if (gasHint > 0 && ((gasHint -= dt) <= 0 || keys.has('gas'))) { gasHint = 0; if (hud.hint.textContent === GAS_HINT) setHint(''); }   // the 'Hold GAS' prompt after getting in
    if (state === 'countdown') {
      countdown -= dt;
      const cd = countdown > 0 ? String(Math.ceil(countdown)) : 'GO!';
      if (cd !== hud.msg.textContent) { hud.msg.textContent = cd; msgIn(); }   // each number punches in as it changes
      if (countdown <= 0) { state = 'driving'; cpFrom = car.s; flash('GO!', 700); setHint(''); haptic(HAP.go); }
    }
    if (state === 'onfoot' || (race && him.o.visible)) {
      // on foot: the same fixed 1/120 s steps as the car, drawn between the last two (a phone's frame times wobble
      // between 8 and 33 ms; moving people by whatever each frame happened to be made every step a different size)
      footAcc = fly ? 0 : footAcc + dt;   // (during the flyover nobody moves)
      while (footAcc >= FIXED) {
        footAcc -= FIXED;
        for (const p of [me, him]) { p.px = p.x; p.py = p.y; }
        if (state === 'onfoot') updateFoot(FIXED); else updateHimLeft(FIXED);   // (getIn() may put you in the car mid-way)
      }
      const al = footAcc / FIXED;
      if (state === 'onfoot') { posePerson(me, dt, al); focus.x = fly ? flyFocus.x : me.gx; focus.y = fly ? -flyFocus.z : me.gy; focus.z = fly ? flyFocus.y : me.zs; world.focus = crowd.focus = focus; hazardMat.opacity = Math.floor(now / 380) % 2 ? 1 : 0.12; markerSprite.position.y = 2.9 + Math.sin(now / 180) * 0.15; }
      if (him.o.visible) posePerson(him, dt, al);
    }
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
      // other drivers leaning on the horn / standing on the brakes for a person in the road: heard from the street while you
      // drive too, but quieter than on foot (you are inside a car) and with a nearer cut-off, so it is a touch of life, not noise
      for (const h of ev.honks || []) { const g = Math.max(0, 1 - h.d / 45) * 0.45; if (g > 0.05) { audio.honkAt(g); if (h.skid) audio.skid(g); } }
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
      if (!b.officer && bk && bk.v < 0.3 && car.s - bk.s < 60) b.officer = world.add('officer', { s: bk.s + 1.2, d: bk.d + 1.2, scenery: true, color: 0x1c2740, hd: 0 });
      if (b.officer) {
        const o = b.officer, ts = car.s - 0.4, td = car.d + 1.35, ds = ts - o.s, dd = td - o.d, L = Math.hypot(ds, dd);
        if (L > 0.1) { const k = Math.min(1, Math.min(3.4, Math.max(1.5, L / 4)) * dt / L);   // (a stroll up to the window, a jog if the cruiser was held up further back)
          // (never through a car: the step is turned aside, up to 100 degrees either way, to the first direction that is clear, else he waits)
          const cars = world.ents.filter((c) => c.alive && c !== o && c !== bk && !c.scenery && !c.flying && c.L && c.W && Math.abs(c.s - o.s) < 12);
          const clear = (x, y) => !cars.some((c) => Math.abs(x - c.s) < c.L / 2 + 0.4 && Math.abs(y - c.d) < c.W / 2 + 0.4);
          const ang = Math.atan2(dd, ds), stp = L * k;
          for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.75, -1.75]) {
            const ns = o.s + Math.cos(ang + da) * stp, nd = o.d + Math.sin(ang + da) * stp;
            if (clear(ns, nd) || (da === 0 && L < 2.5)) { o.s = ns; o.d = nd; break; }
          }
          o.hd = ang; }
        else { o.hd = -Math.PI / 2; b.at = (b.at || 0) + dt; }   // at the driver's window
      }
      if (endT > 9 || b.at > 0.9) showBusted();
    } else {
      // on foot, in the countdown and at the finish the street carries on too: nothing sits frozen in the road. Cars see the
      // runner (world.runner) and brake or swerve for him
      world.runner = me; world.runnerFoot = state === 'onfoot'; world.runnerOn = world.runnerFoot && onStreet(me);   // (the route's traffic sees you only while you are in or beside its street; the cross streets' cars see you wherever you are)
      trams.update(dt, car);
      streetEvents(world.update(dt, car, drove + footT, 0));
      // (the traffic has moved since the last steering step, and a car can drive onto a person who is standing still: once more, with where everything is now, so a frame never ends with anyone inside anything)
      if (state === 'onfoot') { moveSolid(me, true); moveSolid(him, false); }
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
    world.render(car, drove, dt);
    signals.update(dt); WIND.value += dt;   // traffic lights; the tree canopies sway
    if (state !== 'driving') { world.updateFrustum(); trams.render(); }   // (world.update keeps the frustum current while driving)
    crowd.update(dt, car, hornT);
    birds.update(dt, car, drove, hornT > 0 ? 1 : 0); updateBeacons(now);
    fx.update(dt, camera, renderer);
    beacon.material.opacity = 0.12 + 0.08 * Math.sin(now / 250);
    spotGroup.visible = state === 'driving' || state === 'countdown';
    // the lines follow the lane being steered to (a lane tap swings them across); with the autopilot, the line it is steering
    if (guide) guide.update(state === 'driving', drawS, drawD, (ss) => { if (BOT) return car.targetD; let k = laneK; if (laneAt(ss, k) === null) k = k === 0 ? 1 : 2; return laneAt(ss, k); });
    // overpass cutaway: a soft hole in anything above the runner. ON FOOT it is still needed: that camera is 6 m up and 10 m back, which is
    // inside the Connector's slab under it (the slab's top is ~6.7 m over the street). The DRIVING camera no longer needs it: the Connector
    // used to clear the route by 1.9 m, so the chase camera ran through the slab and the deck walled off the view ahead (that is why the
    // hole existed, started 1.45 m over the car and grew to reach the camera at speed); roads.js raiseDecks now gives it 5.4 m, and
    // measured over s = 1015-1100 m the camera is never inside the slab (closest 1.8 m under it in the comic look, 2.5 m in the real look;
    // the car's roof is 3.9 m under it) and the car and road ahead are fully in view with the cut off (tools-bridge/shots.mjs). So while
    // driving the hole is off, and you see the bridge you are driving under.
    const cutAt = state === 'onfoot' ? me.o.position : carRig.position;   // (on foot it follows the runner, who can be under the Connector anywhere)
    const camGap = Math.hypot(camera.position.x - cutAt.x, camera.position.z - cutAt.z);
    CUT.uCutPos.value.copy(cutAt);
    CUT.uCutPos.value.y -= 0.75;
    CUT.uCutR.value = state === 'onfoot' && !fly ? Math.min(25, Math.max(11, camGap + 3)) : 0.001;

    // camera: rear third-person chase view, low and close behind the car, anchored on the car's own position so it
    // follows every lane change.
    // Sized to the CAR, not the street. The overhead camera sized its distance to fit the whole street across the
    // screen, which is right when looking down; behind the car, that same distance put the camera ~37 m back and the
    // car shrank to a speck (measured in the running game: 34.7 m behind at 19 mph, ~35 px wide on a phone with the
    // 70 deg portrait lens). Instead: 8 m behind and 3 m up at a standstill, easing back and up with speed so you see
    // further ahead when you're going fast. 8 m keeps the rear bumper well past the camera's 4 m near plane (line 86),
    // so the car is never sliced.
    const v = Math.max(0, car.v);
    // (the realistic look: CAM_R at the top of the file: closer and lower, and no growth with speed except a little distance)
    const back = RL ? CAM_R.back + v * CAM_R.backV : 8 + v * 0.12, h = RL ? CAM_R.h : 3 + v * 0.03;
    // aim at a point ahead of the car and a little above the road, so the car sits in the lower part of the frame, the
    // street ahead (obstacles!) fills the middle and the horizon sits high; more lead in landscape, where the screen
    // is short
    const ahead = RL ? CAM_R.ahead : (camera.aspect > 1 ? 18 : 14) + v * 0.5;
    camA += Math.atan2(Math.sin(route.at(car.s + 6).a - camA), Math.cos(route.at(car.s + 6).a - camA)) * Math.min(1, dt * 3);
    const look = route.at(drawS + ahead, drawD * (RL ? CAM_R.aimD : 0.35));
    let targetPos, targetLook;
    if (state === 'parked' || state === 'late') {
      // arrival: swing down to the street-level view of the storefronts (the intro's framing)
      const k = Math.min(1, endT / 2.4), e = k * k * (3 - 2 * k);
      const high = arrivalFrom || (arrivalFrom = camPos.clone()), street = toV3(-3, 21, ground(-3, 21) + 2.6);
      targetPos = high.clone().lerp(street, e);
      targetLook = toV3(p.x, p.y, p.z).lerp(toV3(-3, 0, ground(-3, 0) + 4.2), e);
    } else if (state === 'onfoot') {
      // on foot: high behind you, dead behind (ON_FOOT_CAM.side), looking the way the camera faces. High enough to see over the
      // bully on your heels and past the poles at the curb: from 3 m up and 6 m back (the first version) a signal
      // pole beside the camera hid you completely at the start, and the bully, once close, stood between you and the
      // camera (both checked in the running game). From here you, him and the street ahead are all in frame.
      // (Those numbers are the same as when you ran along the street; they are turned by camYaw, the way the camera faces, which
      // swings in behind you as you run: see camYawStep. It used to be the street's heading, and a gentler follow of a sidestep.)
      // Walls pull it in: along the line from you back to where it would be, it stops short of the first wall (never closer than 4 m,
      // the near plane is 2 m) and goes up instead, so a building behind you is looked down over, not through.
      const cfx = Math.cos(camYaw), cfy = Math.sin(camYaw), clx = -cfy, cly = cfx;
      // Nothing solid may stand between you and the camera, or in its near-clip zone (a tree trunk in the middle of the view hid the runner): the line from you to the camera is
      // tested against the walls and every prop circle (roam.js camHit, 2D, the circles grown by CAM_PAD). Blocked: first try the camera 0.6 m to one side (whichever clears; the side eases in and out),
      // else (0.6 m, then 1.5 m, either side) pull it in short of the obstacle (never closer than ON_FOOT_CAM.min; it goes up as it comes in, below; things within ON_FOOT_CAM.skip of you are not occluders), and ease it back out once clear (in fast, out slowly).
      // (the camera sits on a ray from you at the angle `camAng` off straight behind: the nudge is an angle that eases, and the distance slides along that same ray, so any
      // distance it takes while easing out is on the line that was tested)
      const camFree = (side) => {
        const a = Math.atan2(side, ON_FOOT_CAM.back), px = -cfx * Math.cos(a) + clx * Math.sin(a), py = -cfy * Math.cos(a) + cly * Math.sin(a);
        return Math.min(ON_FOOT_CAM.back, walk.camHit(me.gx, me.gy, px, py, ON_FOOT_CAM.back + 0.5, ON_FOOT_CAM.pad, ON_FOOT_CAM.skip) - 0.15);
      };
      let wantSide = 0, want = camFree(0);
      if (want < ON_FOOT_CAM.back - 0.01) for (const sd of [ON_FOOT_CAM.nudge, -ON_FOOT_CAM.nudge, ON_FOOT_CAM.nudge2, -ON_FOOT_CAM.nudge2]) { const f = camFree(sd); if (f > want + 0.01) { want = f; wantSide = sd; if (f >= ON_FOOT_CAM.back - 0.01) break; } }
      want = THREE.MathUtils.clamp(want, ON_FOOT_CAM.min, ON_FOOT_CAM.back);
      camDist = camDist === null ? want : smoothDamp(camDist, want, camV, 'dist', want < camDist ? 0.1 : 0.6, dt);   // (in at once, out slowly)
      camAng = smoothDamp(camAng, Math.atan2(wantSide, ON_FOOT_CAM.back), camV, 'ang', 0.25, dt);
      const cxw = me.gx + (-cfx * Math.cos(camAng) + clx * Math.sin(camAng)) * camDist, cyw = me.gy + (-cfy * Math.cos(camAng) + cly * Math.sin(camAng)) * camDist;
      const camSide = Math.sin(camAng) * camDist;
      targetPos = toV3(cxw, cyw, Math.max(me.zs + ON_FOOT_CAM.up + (ON_FOOT_CAM.back - camDist) * 0.85, ground(cxw, cyw) + 1.8));
      targetLook = toV3(me.gx + cfx * ON_FOOT_CAM.ahead + clx * camSide / 2, me.gy + cfy * ON_FOOT_CAM.ahead + cly * camSide / 2, me.zs + 0.9);
      NEAR_CUT.value = 8;   // trees within 8 m of this camera are not drawn (landscape.js); you are ~12 m away
    } else {
      NEAR_CUT.value = 0;   // the driving camera keeps every tree
      // h is measured from the car, but on a steep street the ground behind the car is higher than the car: on Luckie
      // St (s~48 m) a camera 3 m above the car ended up 0.7 m off the hillside behind it. Keep at least 2.5 m of air
      // under the camera itself.
      const cx = p.x - Math.cos(camA) * back, cy = p.y - Math.sin(camA) * back;
      targetPos = toV3(cx, cy, Math.max(p.z + h, ground(cx, cy) + 2.5));
      targetLook = toV3(look.x, look.y, look.z + 1.2);
      if (RL) {
        // realistic: aim by where the car lands on screen, not at a point up the road. The car's rear-bottom edge is put at
        // CAM_R.yCar of the screen height (the phone's view offset, which lifts the picture by a tenth, is allowed for), and
        // the camera points along the road toward the point it used to look at.
        const oy = coarse ? 0.1 : 0, tn = (2 * (CAM_R.yCar + oy) - 1) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        carRig.updateMatrixWorld(true);   // (the car's own pitch and roll on a hill: the rear edge is where the car really is)
        const rear = tmp3.set(0, 0.3, CAM_R.rear).applyMatrix4(carRig.matrixWorld), rx = rear.x, rz = rear.z, ry = rear.y;
        const beta = Math.atan2(targetPos.y - ry, Math.hypot(targetPos.x - rx, targetPos.z - rz));
        const pitchDown = beta - Math.atan(tn);
        let dx = look.x - targetPos.x, dz = -look.y - targetPos.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        targetLook = tmp2.set(targetPos.x + dx * 20, targetPos.y - 20 * Math.tan(pitchDown), targetPos.z + dz * 20);
      }
    }
    if (!camPos.lengthSq()) { camPos.copy(targetPos); camLook.copy(targetLook); }
    if (fly) flyCamera(dt, targetPos, targetLook);
    else if (state === 'parked' || state === 'late') { camPos.copy(targetPos); camLook.copy(targetLook); }
    else if (state === 'onfoot') {
      // on foot: a critically damped follow (no overshoot, the same at any frame rate) in place of the lerp below,
      // whose pull was a fixed share of the gap per frame: on a phone's uneven frames the camera surged and lagged
      // by turns. Same lag as before at a steady run (about 1 m), so the framing doesn't change.
      for (const [c, k] of [['x', 0], ['y', 1], ['z', 2]]) {
        camPos[c] = smoothDamp(camPos[c], targetPos[c], camV, 'p' + c, 0.18, dt);
        camLook[c] = smoothDamp(camLook[c], targetLook[c], camV, 'l' + c, 0.13, dt);
      }
    }
    else {
      if (RL && lastCar.lengthSq()) {
        // realistic: the follow below trails the car by speed / 6 m (a pull of 6 per second toward a target that moves at speed). Carry the
        // camera along with the car's own forward movement first, so only sideways movement and the camera's own easing are left to smooth.
        // (not when the car was put somewhere, a test hook's teleport)
        const mx = carRig.position.x - lastCar.x, mz = carRig.position.z - lastCar.z;
        if (Math.hypot(mx, mz) < 2) { const f = mx * Math.cos(camA) - mz * Math.sin(camA), fx = f * Math.cos(camA), fz = -f * Math.sin(camA); camPos.x += fx; camPos.z += fz; camLook.x += fx; camLook.z += fz; const my = route.at(drawS, drawD).z - lastRz; camPos.y += my; camLook.y += my; }   // (and the road's climb or fall under it, not the car's own body height: curbs and seams would jolt the frame; on a hill the lag would eat into the 2.5 m of air under the camera)
      }
      camPos.lerp(targetPos, Math.min(1, dt * 6)); camLook.lerp(targetLook, Math.min(1, dt * 8));
      // realistic: the 2.5 m of air under the camera is re-applied where the camera really is after the easing (the target above only
      // knows the ground under where the camera is heading; on the Luckie St climb the eased camera was 1.8 m up at 20 m/s)
      if (RL) camPos.y = Math.max(camPos.y, ground(camPos.x, -camPos.z) + 2.5);
    }
    lastCar.copy(carRig.position); if (RL) lastRz = route.at(drawS, drawD).z;
    if (api.camOverride) { camPos.copy(api.camOverride.pos); camLook.copy(api.camOverride.look); } // QA: free camera
    camera.position.copy(camPos);
    if (shake > 0 && state === 'onfoot') {
      // on foot: a short, smooth jolt (two quick sine wobbles) instead of a new random jump every frame, which at
      // 0.7 threw the view up to 0.4 m each frame on a shove: a blur, and worse the lower the frame rate
      const ph = now / 1000, a = shake * shake * 0.35;
      camera.position.x += Math.sin(ph * 47) * a; camera.position.y += Math.sin(ph * 39 + 1.3) * a * 0.6; camera.position.z += Math.sin(ph * 43 + 2.1) * a;
      shake = Math.max(0, shake - dt * 2.2);
    } else if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 1.2; camera.position.z += (Math.random() - 0.5) * shake * 1.2; shake = Math.max(0, shake - dt * 3); }
    camera.lookAt(camLook);
    sky.follow(camera);

    if (RL) {   // the realistic look's shadow box rides a little ahead of the car and moves in whole shadow texels (no shimmer)
      const yawF = state === 'onfoot' ? camYaw : camA, fwd = tmp.set(Math.cos(yawF), 0, -Math.sin(yawF));   // (on foot the shadow box follows the runner and the way the camera faces)
      RL.placeSun(sun, state === 'onfoot' ? (fly ? flyFocus : me.o.position) : carRig.position, fwd, sun.userData.dir);
    } else {
      const sunAt = state === 'onfoot' ? (fly ? flyFocus : me.o.position) : carRig.position;
      sun.position.copy(sunAt).add(tmp.copy(sun.userData.dir || new THREE.Vector3(-0.5, 0.8, 0.35)).multiplyScalar(220));
      sun.target.position.copy(sunAt);
    }

    // the pedal the engine hears: light throttle to hold speed, more to pull away (never floored for long), none
    // coasting or on the brakes
    const pedal = state === 'driving' && keys.has('gas') && !braking ? Math.max(0.2, Math.min(1, 0.3 + car.accel / 9)) : 0;
    // tyre squeal from a lane change: counted as the side speed the car used to be limited to (3 m/s + 0.6 x road
    // speed), so the much quicker lane change squeals the tyres no more than before, and not at all from a stop
    const sideSlip = Math.min(Math.abs(car.dv), 3 + Math.abs(car.v) * 0.6);
    audio.update(car.v, pedal, Math.min(1, sideSlip / 14 + (braking && car.v > 6 ? 0.6 : 0)), dt);
    if (RL) {
      // the realistic HUD: the clock as M:SS.ss, your place in the race (the bully is the other racer: red when he's within 2.5 s of you), and
      // how far along the way to the store you are, in 11 steps (0/11 on foot, 11/11 parked)
      const cs = Math.round(Math.max(0, t) * 100), mm = Math.floor(cs / 6000);   // (hundredths first, so 59.996 s reads 1:00.00, never 0:60.00)
      setText(hud.time, mm + ':' + ((cs % 6000) / 100).toFixed(2).padStart(5, '0'));
      root.classList.toggle('driving', state !== 'onfoot');   // drive.css: the hint moves up only while driving; on foot the camera is unchanged
      setText(hud.pos, race ? (car.s >= race.s ? '1/2' : '2/2') : state === 'onfoot' ? (doorDist(me) <= doorDist(him) ? '1/2' : '2/2') : '—');
      posBox.classList.toggle('hot', !raceBar.hidden && raceBar.classList.contains('hot'));
      const cp = state === 'onfoot' ? 0 : state === 'parked' ? 11 : Math.min(10, Math.max(0, Math.floor((car.s - cpFrom) / Math.max(1, spot.s - cpFrom) * 11)));
      setText(hud.cp, cp + '/11'); if (cp > cpSeen && state === 'driving') bump(cpBox, 1.14); cpSeen = cp;
    } else setText(hud.time, t.toFixed(1));
    hud.time.classList.toggle('low', t < 10);
    if (t < 10 && state === 'driving') { const sec = Math.ceil(t); if (sec !== lowSec) { lowSec = sec; bump(timeBox, 1.14); } }   // last ten seconds: the clock pulses each second
    setText(hud.speed, Math.round(v * 2.237) + ' mph');
    setText(hud.dist, Math.max(0, Math.round(state === 'onfoot' ? doorDist(me) : spot.s - car.s)) + ' m');   // on foot the box is YOUR CAR: the way to its door
    // the next traffic light, readable on a phone (the real lamps are small from up here)
    const nl = state === 'driving' ? signals.next(car.s + 2.5) : null;
    const lightClass = 'drive-light' + (nl ? ' on ' + nl.aspect : '');
    if (hud.light.className !== lightClass) hud.light.className = lightClass;
    if (nl) setText(hud.lightDist, Math.round(nl.gap) + ' m');
    setText(hud.tokens, String(tokens));
    if (!manual) {
      city.cull(camera, scene.fog);   // skip what can't show: sunk grass tiles, flat ground cover past the end of the fog
      comic.render();
    }
  }

  // The way out fades to black inside the drive (a veil over it), never to whatever page is underneath: fading the
  // whole drive out used to show the store under it for most of the fade, then cut to the black how-to-play.
  // Black to black, the next screen (the store's how-to-play, or the drive again after BUSTED) comes up seamlessly.
  let finished = false;
  function finish() {
    if (finished) return; finished = true;   // SKIP tapped twice, or SKIP and the bot's timer: one exit
    if (result.busted || result.restart) retryNext = true;   // the host starts the drive again: that start skips the flyover
    cancelFrame(raf); audio.stop(); document.removeEventListener('visibilitychange', onHide); clearTimeout(flash.t);
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', resize);
    removeEventListener('orientationchange', onTurn); window.visualViewport?.removeEventListener('resize', resize);   // (a restart builds the whole drive again: nothing of the last one stays hooked to the page)
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
  // RESTART (pause menu): this drive ends here and the host starts a fresh one, from the very beginning: on foot, the bully behind you, the clock, score, EBT, hits and the race all new
  // (the drive is built again from its loaded files, so a restart is exactly a fresh boot; the page's own start-again path after BUSTED does the same)
  root.querySelector('[data-restart]').addEventListener('click', () => { haptic(HAP.tap); paused = false; Object.assign(result, { restart: true }); finish(); });
  for (const el of root.querySelectorAll('[data-skip], [data-pause], [data-resume], [data-restart], [data-quit]')) tapHaptic(el);
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
  // (the new people's baked-animation textures are shader uniforms, not material properties, so the loop above cannot see them)
  for (const l of world.crowd?.alt?.lods || []) for (const v of Object.values(l.uniforms || {})) if (v?.value?.isTexture && !sent.has(v.value)) { sent.add(v.value); try { renderer.initTexture(v.value); } catch {} }
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
    G.from(root.querySelectorAll(RL ? '.drive-rbar > *, .drive-row2 > *' : '.drive-hud > *'), { y: -24, opacity: 0, duration: 0.45, stagger: 0.07, delay: 0.15, ease: 'back.out(1.7)', clearProps: 'transform,opacity' });
    G.from(root.querySelectorAll('.drive-pad'), { y: 40, opacity: 0, duration: 0.5, stagger: 0.08, delay: 0.2, ease: 'back.out(1.5)', clearProps: 'transform,opacity' });
  } else { loadingScreen.remove(); go(); }
  // test hooks (drive QA + screenshots)
  Object.assign(api, { car, world, route, spot, keys, result, guide, camR: CAM_R, audio, fx, city, comic, adaptRes: { res, step: adaptRes, PR_MIN, PR_MAX },
    three: { scene, camera, carRig, THREE, renderer },
    ui: { flash, pop, bump, setHint, showBusted, gsap: G },   // the HUD's motion, for tests
    tick: (dt) => { tickDt = dt; try { frame(); } finally { tickDt = null; } },
    snapshot: (q = 0.85) => { city.cull(camera, scene.fog); comic.render(); return renderer.domElement.toDataURL('image/jpeg', q); } });
  // live getters (Object.assign would have frozen their values at assignment time)
  Object.defineProperties(api, { state: { get: () => state }, time: { get: () => t }, race: { get: () => race }, fly: { get: () => (fly ? { t: fly.t, dur: FLY.dur } : null) } });   // (fly: the opening flyover, null once it is over or if there is none)
api.endFly = endFly;
  // stick: {x, y} overrides the input (tests). x, y, heading are world-plane; walls / solidAt are the collision world the runner and the bully use.
  api.foot = { cam: ON_FOOT_CAM, me, him, homeS, homeD, doorS, doorD, door: DOOR, path: PATH, stick: null, get drag() { return stick; }, get camYaw() { return camYaw; }, set camYaw(v) { camYaw = v; }, trail, walk,
    get walls() { return walk.segs; }, solidAt: (x, y) => walk.solid(x, y, BODY), clearLine: (x0, y0, x1, y1) => walk.clearLine(x0, y0, x1, y1, BODY), doorDist };
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

// The realistic look's racing bar: row 1 POSITION / TIME / CHECKPOINT, row 2 EBT, the race to the store (the bully's head and yours), SPEED and the distance
// (STORE, or YOUR CAR on foot). Each number's label comes first in the markup and drive.css (column-reverse) puts it under the number.
const HUD_HTML_REAL = `
<div class="drive-rhud">
  <div class="drive-rbar">
    <div class="rb-cell"><span>POSITION</span><b class="drive-pos">—</b></div>
    <div class="rb-cell rb-time"><span>TIME</span><b class="drive-time">1:10.00</b></div>
    <div class="rb-cell"><span>CHECKPOINT</span><b class="drive-cp">0/11</b></div>
  </div>
  <div class="drive-row2">
    <div class="rb-cell tok"><span>E.B.T</span><b class="drive-tokens">0</b></div>
    <div class="drive-race" hidden><div class="track"><b class="flag">STORE</b><i class="hd him" aria-label="The bully"></i><i class="hd you" aria-label="You"></i></div><span class="gap"></span></div>
    <div class="rb-cell"><span>SPEED</span><b class="drive-speed">0 mph</b></div>
    <div class="rb-cell"><span>STORE</span><b class="drive-dist">—</b></div>
  </div>
</div>
<div class="drive-light"><i></i><i></i><i></i><b></b></div>
<div class="drive-msg"></div>
<div class="drive-pop"></div>
<div class="drive-hint"></div>
<button class="drive-skip" data-skip aria-label="Skip the drive">SKIP ▸▸</button>
<button class="drive-pausebtn" data-pause aria-label="Pause"><i></i><i></i></button>
<div class="drive-paused" hidden><b>PAUSED</b><button type="button" data-resume>RESUME ▶</button><button type="button" class="alt" data-restart>RESTART ↻</button><button type="button" class="alt" data-quit>SKIP DRIVE ▸▸</button></div>
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

const HUD_HTML = `
<div class="drive-hud">
  <div class="drive-box"><span>TIME</span><b class="drive-time">60.0</b></div>
  <div class="drive-box"><span>STORE</span><b class="drive-dist">—</b></div>
  <div class="drive-box tok"><span>E.B.T</span><b class="drive-tokens">0</b></div>
  <div class="drive-box"><span>SPEED</span><b class="drive-speed">0 mph</b></div>
</div>
<div class="drive-race" hidden><div class="track"><b class="flag">STORE</b><i class="hd him" aria-label="The bully"></i><i class="hd you" aria-label="You"></i></div><span class="gap"></span></div>
<div class="drive-light"><i></i><i></i><i></i><b></b></div>
<div class="drive-msg"></div>
<div class="drive-pop"></div>
<div class="drive-hint"></div>
<button class="drive-skip" data-skip aria-label="Skip the drive">SKIP ▸▸</button>
<button class="drive-pausebtn" data-pause aria-label="Pause"><i></i><i></i></button>
<div class="drive-paused" hidden><b>PAUSED</b><button type="button" data-resume>RESUME ▶</button><button type="button" class="alt" data-restart>RESTART ↻</button><button type="button" class="alt" data-quit>SKIP DRIVE ▸▸</button></div>
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
