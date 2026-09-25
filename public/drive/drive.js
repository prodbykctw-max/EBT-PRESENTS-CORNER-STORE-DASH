// "Get to the Store": the 60-second top-down drive, loaded on demand by the main game.
//   const { startDrive } = await import('./drive/drive.js');
//   startDrive({ mount: document.body, onDone: (result) => { /* start the store level */ } });
// result = { arrived, parked, timeLeft, cleanPark, hits, bonus }
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { buildCity, toV3 } from './city.js';
import { Car, Collision, CAR } from './physics.js';
import { fetchWeather, applyWeather } from './weather.js';

const BASE = new URL('./', import.meta.url);
const TIME_LIMIT = 60;
// Curbside parking space in front of the EBT Corner Store (world frame; the row faces north onto Auburn).
const SPOT = { x: 0, y: 9.0, heading: Math.PI, len: 7.0, wid: 3.0 }; // eastbound lane is the far side; park facing west at the south curb
const ANGLE_TOL = 0.45;
// ?qa drives the loop from a timer: hidden tabs/panes pause requestAnimationFrame, which would freeze automated tests.
const QA = new URLSearchParams(location.search).has('qa');
const nextFrame = QA ? (f) => setTimeout(f, 16) : requestAnimationFrame;
const cancelFrame = QA ? clearTimeout : cancelAnimationFrame;

export async function startDrive({ mount = document.body, onDone = () => {}, onProgress = () => {} } = {}) {
  // ---------- load (the game has no loader of its own, so the drive shows one) ----------
  if (!document.querySelector('link[data-drive-css]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('drive.css', BASE).href; l.dataset.driveCss = '';
    document.head.appendChild(l);
  }
  const root = document.createElement('div');
  root.className = 'drive-root';
  root.innerHTML = '<div class="drive-loading"><b>AUBURN AVE</b><span>Get to the corner store</span><i></i></div>';
  mount.appendChild(root);
  const bar = root.querySelector('.drive-loading i');
  const progress = (p, label) => { bar.style.width = p * 100 + '%'; onProgress(p, label); };
  progress(0.05, 'Loading Auburn Ave');
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const [W, hero, carGltf, weather] = await Promise.all([
    fetch(new URL('world.json', BASE)).then((r) => r.json()),
    loader.loadAsync(new URL('hero.glb', BASE).href),
    loader.loadAsync(new URL('car.glb', BASE).href),
    fetchWeather(),
  ]);
  progress(0.7, 'Building the city');

  // ---------- renderer / scene ----------
  root.insertAdjacentHTML('beforeend', HUD_HTML);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const MOBILE = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2)); // phones: fill-rate is the budget
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.AgXToneMapping; renderer.toneMappingExposure = 1.0;
  root.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 3000);

  // shared tiling textures come from the hero glTF materials, so they download once
  const tex = {};
  hero.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material; o.castShadow = o.receiveShadow = true;
    if (/brick/.test(m.name)) tex.brick = m.map;
    if (/roof/.test(m.name)) tex.roof = tex.concrete = m.map;
    if (/sidewalk/.test(m.name)) tex.sidewalk = m.map;
  });
  for (const t of Object.values(tex)) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  const city = buildCity(W, tex);
  scene.add(city.group, hero.scene);
  const collide = new Collision(city.colliders);
  const ground = city.ground;

  // lights: the sun follows the car so its shadow map stays sharp where you are
  const hemi = new THREE.HemisphereLight(0xbcd3ec, 0x5d574f, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true; sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 600 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);
  applyWeather(weather, { scene, renderer, sun, hemi, roads: city.roads });
  root.querySelector('.drive-weather').textContent = weather.label;

  // ---------- parking space (painted box + beacon, GTA-style drop-off marker) ----------
  const spotGroup = new THREE.Group();
  const zSpot = ground(SPOT.x, SPOT.y);
  // drawn over the road ribbons (which already use a polygon offset), so push these further toward the camera
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const addLine = (w, h, ox, oy) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat); m.rotation.x = -Math.PI / 2; m.position.set(ox, 0.25, oy); m.renderOrder = 2; spotGroup.add(m); };
  addLine(SPOT.len, 0.18, 0, SPOT.wid / 2); addLine(SPOT.len, 0.18, 0, -SPOT.wid / 2); addLine(0.18, SPOT.wid, SPOT.len / 2, 0); addLine(0.18, SPOT.wid, -SPOT.len / 2, 0);
  const pLetter = makeLabel('P', '#ffd400'); pLetter.rotation.x = -Math.PI / 2; pLetter.position.set(0, 0.26, 0); pLetter.material.polygonOffset = true; pLetter.material.polygonOffsetFactor = -6; pLetter.renderOrder = 2; pLetter.scale.set(2.4, 2.4, 1); spotGroup.add(pLetter);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  beacon.position.y = 20; spotGroup.add(beacon);
  spotGroup.position.copy(toV3(SPOT.x, SPOT.y, zSpot)); spotGroup.rotation.y = SPOT.heading;
  scene.add(spotGroup);

  // ---------- car ----------
  const carModel = carGltf.scene;
  carModel.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const carRig = new THREE.Group(); carRig.add(carModel); carModel.position.z = CAR.b; // model origin = rear axle
  scene.add(carRig);
  const route = W.route.pts;
  const [sx, sy] = route[0], [nx, ny] = route[3];
  const car = new Car(sx, sy, Math.atan2(ny - sy, nx - sx));

  // guidance arrow floating over the car (GTA-style), pointing along the route
  const arrow = new THREE.Mesh(arrowGeometry(), new THREE.MeshBasicMaterial({ color: 0xffd400, depthTest: false, transparent: true, opacity: 0.92 }));
  arrow.renderOrder = 10; scene.add(arrow);

  // ---------- input ----------
  const keys = new Set();
  const kd = (e) => { if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); } };
  const ku = (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); };
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  // Touch: put a thumb down anywhere = gas; slide left/right from where you touched = analog steering.
  // Lift = coast. BRAKE/REVERSE and DRIFT are the only buttons.
  const touch = { id: null, x0: 0, steer: 0 };
  const knob = root.querySelector('.drive-knob');
  const zone = root.querySelector('.drive-steer');
  zone.addEventListener('pointerdown', (e) => {
    if (touch.id !== null) return;
    touch.id = e.pointerId; touch.x0 = e.clientX; touch.steer = 0;
    try { zone.setPointerCapture(e.pointerId); } catch {}
    knob.style.left = e.clientX + 'px'; knob.style.top = e.clientY + 'px'; knob.classList.add('on');
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.id) return;
    const range = Math.min(innerWidth, 520) * 0.2;           // ~75 px of slide = full lock on a phone
    const dx = e.clientX - touch.x0;
    touch.steer = Math.max(-1, Math.min(1, -dx / range));      // physics: +steer = left
    knob.style.setProperty('--dx', Math.max(-range, Math.min(range, dx)) + 'px');
  });
  const lift = (e) => { if (e.pointerId !== touch.id) return; touch.id = null; touch.steer = 0; knob.classList.remove('on'); knob.style.setProperty('--dx', '0px'); };
  zone.addEventListener('pointerup', lift); zone.addEventListener('pointercancel', lift);
  for (const b of root.querySelectorAll('[data-k]')) {
    const on = (e) => { keys.add(b.dataset.k); e.preventDefault(); }, off = () => keys.delete(b.dataset.k);
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  }
  let camMode = 'follow';
  const onC = (e) => {
    if (e.code === 'KeyC') camMode = camMode === 'follow' ? 'classic' : 'follow';
    if (e.code === 'KeyR' && state === 'driving') resetToRoad();
  };
  root.querySelector('[data-reset]').addEventListener('click', () => state === 'driving' && resetToRoad());
  // Wedged against a wall? Put the car back on the route (GTA had no such mercy; we charge 3 s for it).
  function resetToRoad() {
    let best = 0, bd = Infinity;
    route.forEach(([x, y], i) => { const d = Math.hypot(x - car.x, y - car.y); if (d < bd) { bd = d; best = i; } });
    const a = route[Math.min(best, route.length - 2)], b = route[Math.min(best, route.length - 2) + 1];
    Object.assign(car, { x: a[0], y: a[1], heading: Math.atan2(b[1] - a[1], b[0] - a[0]), vx: 0, vy: 0, yawRate: 0 });
    t -= 3; flash('RESET  −3s', 900);
  }
  addEventListener('keydown', onC);

  // ---------- HUD ----------
  const $ = (s) => root.querySelector(s);
  const hud = { time: $('.drive-time'), speed: $('.drive-speed'), dist: $('.drive-dist'), msg: $('.drive-msg'), hint: $('.drive-hint') };
  const flash = (text, ms = 1200) => { hud.msg.textContent = text; hud.msg.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => hud.msg.classList.remove('on'), ms); };

  const coarse = matchMedia('(pointer: coarse)').matches;
  const resize = () => {
    const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(24)) / camera.aspect)), 42, 66);
    if (coarse) camera.setViewOffset(w, h, 0, h * 0.14, w, h); else camera.clearViewOffset(); // car clears the touch buttons
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize); resize();

  // ---------- state ----------
  let t = TIME_LIMIT, hits = 0, state = 'countdown', countdown = 3, parkedFor = 0, routeIdx = 0, shake = 0, endT = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let camYaw = car.heading, arrivalFrom = null;
  const snapCam = true;
  const result = { arrived: false, parked: false, timeLeft: 0, cleanPark: false, hits: 0, bonus: 0 };

  function input() {
    if (state !== 'driving') return { steer: 0, throttle: 0, brake: 1, handbrake: false };
    const braking = keys.has('down');
    let steer = (keys.has('left') ? 1 : 0) - (keys.has('right') ? 1 : 0);
    if (touch.id !== null) steer = Math.abs(touch.steer) < 0.06 ? 0 : touch.steer; // small dead zone
    return {
      steer,
      throttle: keys.has('up') || (touch.id !== null && !braking) ? 1 : 0,
      brake: braking ? 1 : 0, handbrake: keys.has('hb'),
    };
  }

  function nearestAhead() {
    let best = routeIdx, bd = Infinity;
    for (let i = routeIdx; i < Math.min(route.length, routeIdx + 30); i++) {
      const d = Math.hypot(route[i][0] - car.x, route[i][1] - car.y); if (d < bd) { bd = d; best = i; }
    }
    routeIdx = best;
    // aim ~35 m further along the route; near the end aim at the parking space
    let acc = 0, i = best;
    while (i + 1 < route.length && acc < 35) { acc += Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]); i++; }
    const dStore = Math.hypot(SPOT.x - car.x, SPOT.y - car.y);
    return dStore < 60 || i >= route.length - 1 ? [SPOT.x, SPOT.y] : route[i];
  }

  function checkPark(dt) {
    const dx = car.x - SPOT.x, dy = car.y - SPOT.y;
    const c = Math.cos(SPOT.heading), s = Math.sin(SPOT.heading);
    const along = dx * c + dy * s, across = -dx * s + dy * c;
    let dAng = Math.abs(((car.heading - SPOT.heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    dAng = Math.min(dAng, Math.PI - dAng); // either direction counts
    const inside = Math.abs(along) < SPOT.len / 2 - 1.2 && Math.abs(across) < SPOT.wid / 2 + 0.2;
    const still = car.speed < 0.8;
    if (inside && dAng < ANGLE_TOL) { hud.hint.textContent = still ? 'Hold it…' : 'Stop in the box'; parkedFor = still ? parkedFor + dt : 0; }
    else { parkedFor = 0; hud.hint.textContent = Math.hypot(dx, dy) < 25 ? 'Pull into the P space' : ''; }
    if (parkedFor > 0.6) {
      state = 'parked';
      result.arrived = result.parked = true; result.timeLeft = Math.max(0, t); result.hits = hits;
      result.cleanPark = dAng < 0.15 && Math.abs(across) < 0.6;
      result.bonus = Math.round(result.timeLeft * 50 + (result.cleanPark ? 500 : 0) + (hits === 0 ? 300 : 0));
      flash(result.cleanPark ? 'CLEAN PARK! 🅿️' : 'PARKED 🅿️', 2600);
      endT = 0;
    }
  }

  // ---------- loop ----------
  let last = performance.now();
  let raf = 0, acc = 0;
  const FIXED = 1 / 120;
  function frame() {
    raf = nextFrame(frame);
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (state === 'countdown') {
      countdown -= dt;
      hud.msg.textContent = countdown > 0 ? String(Math.ceil(countdown)) : 'GO!'; hud.msg.classList.add('on');
      if (countdown <= 0) { state = 'driving'; flash('GO!', 700); }
    }
    if (state === 'driving' || state === 'parked' || state === 'late') {
      acc += dt;
      while (acc >= FIXED) {
        acc -= FIXED;
        car.step(FIXED, input());
        const hit = collide.resolve(car);
        if (hit > 5 && performance.now() - car.lastImpact > 500) {
          car.lastImpact = performance.now(); hits++; shake = Math.min(1, hit / 15);
          try { navigator.vibrate?.(hit > 9 ? [30, 40, 60] : 25); } catch {}
          if (hit > 9 && state === 'driving') { t -= 1; flash('−1s  CRASH', 700); }
        }
      }
    }
    if (state === 'driving') {
      t -= dt;
      checkPark(dt);
      if (t <= 0) { t = 0; state = 'late'; result.hits = hits; flash('TOO LATE — walk it in', 2600); endT = 0; }
    }
    if (state === 'parked' || state === 'late') {
      endT += dt;
      if (endT > 4.2) { finish(); return; } // 2.4 s camera swing + a beat on the storefronts
    }

    // car transform (ground-following with a little pitch/roll from the terrain)
    const z = ground(car.x, car.y);
    carRig.position.copy(toV3(car.x, car.y, z));
    carRig.rotation.set(0, car.heading - Math.PI / 2, 0);
    const lean = THREE.MathUtils.clamp(-car.yawRate * car.speed * 0.004, -0.06, 0.06);
    carModel.rotation.z = lean;

    // guidance arrow
    const [gx, gy] = nearestAhead();
    arrow.position.copy(toV3(car.x, car.y, z + 5.5));
    arrow.rotation.set(0, Math.atan2(gy - car.y, gx - car.x) - Math.PI / 2, 0);
    arrow.visible = state === 'driving';
    beacon.material.opacity = 0.12 + 0.08 * Math.sin(performance.now() / 250);
    // under an overpass? fade the deck so you never lose the car
    const under = city.decks.some(([ax, ay, bx, by, r]) => {
      const dx = bx - ax, dy = by - ay, tt = Math.max(0, Math.min(1, ((car.x - ax) * dx + (car.y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(car.x - ax - tt * dx, car.y - ay - tt * dy) < r;
    });
    const bm = city.bridges.material; bm.opacity += ((under ? 0.25 : 1) - bm.opacity) * Math.min(1, dt * 6); bm.depthWrite = bm.opacity > 0.95;
    spotGroup.visible = state === 'driving' || state === 'countdown';
    if (state !== 'driving') hud.hint.textContent = '';

    // camera: rises and looks further ahead with speed (GTA 1 zoom-out)
    const spd = car.speed, h = 24 + spd * 0.75; // GTA-1 framing: the car stays readable, the view opens up with speed
    const ahead = Math.min(spd * 0.35, 10); // look a little ahead; keeps the car in the lower third
    const lookX = car.x + car.vx / (spd || 1) * ahead, lookY = car.y + car.vy / (spd || 1) * ahead;
    let targetPos, targetLook;
    if (state === 'parked' || state === 'late') {
      // arrival: swing down to the street-level view of the storefronts (the intro's framing)
      const k = Math.min(1, endT / 2.4), e = k * k * (3 - 2 * k);
      const high = arrivalFrom || (arrivalFrom = camPos.clone()), street = toV3(-3, 21, ground(-3, 21) + 2.6);
      targetPos = high.clone().lerp(street, e); // clone: the start pose must stay fixed for the whole swing
      targetLook = toV3(car.x, car.y, z).lerp(toV3(-3, 0, ground(-3, 0) + 4.2), e);
    } else if (camMode === 'classic') {
      targetPos = toV3(lookX, lookY - h * 0.18, z + h); targetLook = toV3(lookX, lookY, z);
    } else {
      camYaw += angDiff(car.heading, camYaw) * Math.min(1, dt * (spd > 3 ? 2.2 : 0.8));
      targetPos = toV3(lookX - Math.cos(camYaw) * h * 0.42, lookY - Math.sin(camYaw) * h * 0.42, z + h);
      targetLook = toV3(lookX, lookY, z);
    }
    if (snapCam && !camPos.lengthSq()) { camPos.copy(targetPos); camLook.copy(targetLook); }
    if (state === 'parked' || state === 'late') { camPos.copy(targetPos); camLook.copy(targetLook); } // the swing is already eased
    else { camPos.lerp(targetPos, Math.min(1, dt * 4)); camLook.lerp(targetLook, Math.min(1, dt * 6)); }
    camera.position.copy(camPos);
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 1.6; camera.position.z += (Math.random() - 0.5) * shake * 1.6; shake = Math.max(0, shake - dt * 3); }
    camera.lookAt(camLook);

    // sun + shadow box track the car
    sun.position.copy(carRig.position).add(tmp.copy(sun.userData.dir || new THREE.Vector3(-0.5, 0.8, 0.35)).multiplyScalar(220));
    sun.target.position.copy(carRig.position);

    hud.time.textContent = t.toFixed(1);
    hud.time.classList.toggle('low', t < 10);
    hud.speed.textContent = Math.round(spd * 3.6 * 0.621) + ' mph';
    hud.dist.textContent = Math.round(Math.hypot(SPOT.x - car.x, SPOT.y - car.y)) + ' m';
    renderer.render(scene, camera);
  }

  function finish() {
    cancelFrame(raf);
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('keydown', onC); removeEventListener('resize', resize);
    root.classList.add('out');
    setTimeout(() => {
      renderer.dispose(); root.remove();
      onDone({ ...result });
    }, 450);
  }

  progress(1, 'Ready');
  root.querySelector('.drive-loading').remove();
  root.querySelector('[data-skip]').addEventListener('click', () => { result.hits = hits; finish(); });
  frame();
  // test hooks (used by tests/drive-qa.mjs)
  const api = { car, get state() { return state; }, get time() { return t; }, keys, result, spot: SPOT, route, skip: () => { state = 'late'; endT = 99; }, three: { scene, camera, carRig, THREE },
    // QA: grab the current frame as a JPEG data URL (render + read back in the same task)
    snapshot: (q = 0.85) => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', q); } };
  window.__drive = api;
  return api;
}

const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'hb' };
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function arrowGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 2.4); s.lineTo(1.6, 0.2); s.lineTo(0.55, 0.2); s.lineTo(0.55, -1.8); s.lineTo(-0.55, -1.8); s.lineTo(-0.55, 0.2); s.lineTo(-1.6, 0.2); s.closePath();
  const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); // tip → local -Z (the car-forward convention)
  return g;
}

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
  <div class="drive-box"><span>SPEED</span><b class="drive-speed">0 mph</b></div>
  <div class="drive-box wx"><span>ATL NOW</span><b class="drive-weather">—</b></div>
</div>
<div class="drive-msg"></div>
<div class="drive-hint"></div>
<button class="drive-reset" data-reset aria-label="Reset to road">↺ R</button>
<button class="drive-skip" data-skip aria-label="Skip the drive">SKIP ▸▸</button>
<div class="drive-steer" aria-label="Hold to drive, slide to steer"></div>
<div class="drive-knob"><i></i></div>
<div class="drive-touch">
  <button class="drift" data-k="hb" aria-label="Drift (handbrake)">DRIFT</button>
  <button class="brake" data-k="down" aria-label="Brake / reverse">BRAKE</button>
</div>
<div class="drive-tip">Hold anywhere to drive · slide to steer</div>`;
