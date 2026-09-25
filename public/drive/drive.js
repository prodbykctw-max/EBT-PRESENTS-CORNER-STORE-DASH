// "Get to the Store": a 60-second auto-drive runner (Temple Run with cars) down Luckie St and Auburn Ave,
// loaded on demand by the main game.
//   const { startDrive } = await import('./drive/drive.js');
//   startDrive({ mount: document.body, muted, onDone: (result) => { /* start the store level */ } });
// result = { arrived, parked, timeLeft, cleanPark, hits, tokens, nearMisses, bonus }
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import { buildCity, buildRouteRoad, toV3 } from './city.js';
import { RouteFrame, RunnerCar, World } from './runner.js';
import { DriveAudio } from './audio.js';
import { ImpactFX } from './fx.js';
import { fetchWeather, applyWeather } from './weather.js';

const BASE = new URL('./', import.meta.url);
const TIME_LIMIT = 60;
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
  root.innerHTML = '<div class="drive-loading"><b>AUBURN AVE</b><span>Get to the corner store</span><i></i></div>';
  mount.appendChild(root);
  const bar = root.querySelector('.drive-loading i');
  const progress = (p, label) => { bar.style.width = p * 100 + '%'; onProgress(p, label); };
  progress(0.05, 'Loading Auburn Ave');
  const audio = new DriveAudio({ muted });
  audio.unlock(); // still inside the START tap's user activation on most browsers
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const [W, hero, carGltf, props, weather] = await Promise.all([
    fetch(new URL('world.json', BASE)).then((r) => r.json()),
    loader.loadAsync(new URL('hero.glb', BASE).href),
    loader.loadAsync(new URL('car.glb', BASE).href),
    loader.loadAsync(new URL('props.glb', BASE).href),
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
  const ground = city.ground;

  // lights: the sun follows the car so its shadow map stays sharp where you are
  const hemi = new THREE.HemisphereLight(0xbcd3ec, 0x5d574f, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true; sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 600 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);
  // ---------- route space, the run, the car ----------
  const route = new RouteFrame(W, ground, 70);
  const routeRoad = buildRouteRoad(route, city.asphalt); scene.add(routeRoad);
  applyWeather(weather, { scene, renderer, sun, hemi, roads: [...city.roads, routeRoad] });
  const spot = route.project(SPOT.x, SPOT.y);             // parking space in route coords
  const world = new World({ route, props: props.scene, scene, W, sEnd: spot.s, audio });
  const car = new RunnerCar(route, 4);
  const carModel = carGltf.scene;
  carModel.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const carRig = new THREE.Group(); carRig.add(carModel); carModel.position.z = REAR_AXLE;
  scene.add(carRig);
  const fx = new ImpactFX(scene);

  // ---------- parking space (painted box + beacon, the drop-off marker) ----------
  const spotGroup = new THREE.Group();
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const addLine = (w, h, ox, oy) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat); m.rotation.x = -Math.PI / 2; m.position.set(ox, 0.25, oy); m.renderOrder = 2; spotGroup.add(m); };
  addLine(SPOT.len, 0.18, 0, SPOT.wid / 2); addLine(SPOT.len, 0.18, 0, -SPOT.wid / 2); addLine(0.18, SPOT.wid, SPOT.len / 2, 0); addLine(0.18, SPOT.wid, -SPOT.len / 2, 0);
  const pLetter = makeLabel('P', '#ffd400'); pLetter.rotation.x = -Math.PI / 2; pLetter.position.set(0, 0.26, 0); pLetter.material.polygonOffset = true; pLetter.material.polygonOffsetFactor = -6; pLetter.renderOrder = 2; pLetter.scale.set(2.4, 2.4, 1); spotGroup.add(pLetter);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  beacon.position.y = 20; spotGroup.add(beacon);
  spotGroup.position.copy(toV3(SPOT.x, SPOT.y, ground(SPOT.x, SPOT.y))); spotGroup.rotation.y = SPOT.heading;
  scene.add(spotGroup);

  // ---------- input: tight and snappy ----------
  // Phone: drag anywhere and the car follows your thumb across the road 1:1 (half the screen width = the
  // whole road). Keys: ←/→ jump a lane, ↓ brake, Space/H horn.
  const keys = new Set();
  let hornT = 0;
  const honk = () => { if (hornT <= 0) { audio.horn(); hornT = 0.6; } };
  const laneJump = (dir) => { const hw = route.hw(car.s); car.targetD = Math.max(-hw, Math.min(hw, car.targetD + dir * hw / 2)); };
  const kd = (e) => {
    audio.unlock();
    const k = KEYMAP[e.code]; if (!k) return; e.preventDefault();
    if (k === 'left' && !keys.has('left')) laneJump(1);
    if (k === 'right' && !keys.has('right')) laneJump(-1);
    if (k === 'horn') honk();
    keys.add(k);
  };
  const ku = (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); };
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  const touch = { id: null, x0: 0, d0: 0 };
  const knob = root.querySelector('.drive-knob'), zone = root.querySelector('.drive-steer');
  zone.addEventListener('pointerdown', (e) => {
    audio.unlock();
    if (touch.id !== null) return;
    Object.assign(touch, { id: e.pointerId, x0: e.clientX, d0: car.targetD });
    try { zone.setPointerCapture(e.pointerId); } catch {}
    knob.style.left = e.clientX + 'px'; knob.style.top = e.clientY + 'px'; knob.classList.add('on');
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.id) return;
    const dx = e.clientX - touch.x0, hw = route.hw(car.s);
    car.targetD = touch.d0 - dx * (2 * hw) / (root.clientWidth * 0.5); // screen right = road right
    knob.style.setProperty('--dx', Math.max(-70, Math.min(70, dx)) + 'px');
  });
  const lift = (e) => { if (e.pointerId !== touch.id) return; touch.id = null; knob.classList.remove('on'); knob.style.setProperty('--dx', '0px'); };
  zone.addEventListener('pointerup', lift); zone.addEventListener('pointercancel', lift);
  for (const b of root.querySelectorAll('[data-k]')) {
    const on = (e) => { audio.unlock(); if (b.dataset.k === 'horn') honk(); keys.add(b.dataset.k); e.preventDefault(); }, off = () => keys.delete(b.dataset.k);
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  }

  // ---------- HUD ----------
  const $ = (s) => root.querySelector(s);
  const hud = { time: $('.drive-time'), speed: $('.drive-speed'), dist: $('.drive-dist'), tokens: $('.drive-tokens'), msg: $('.drive-msg'), hint: $('.drive-hint'), pop: $('.drive-pop') };
  const flash = (text, ms = 1200) => { hud.msg.textContent = text; hud.msg.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => hud.msg.classList.remove('on'), ms); };
  const pop = (text) => { const el = document.createElement('b'); el.textContent = text; hud.pop.appendChild(el); setTimeout(() => el.remove(), 900); };
  hud.hint.textContent = `${weather.label} in the ATL`;

  const coarse = MOBILE;
  const resize = () => {
    const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(26)) / camera.aspect)), 44, 70);
    if (coarse) camera.setViewOffset(w, h, 0, h * 0.1, w, h); else camera.clearViewOffset(); // car clears the buttons
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize); resize();

  // ---------- state ----------
  let t = TIME_LIMIT, drove = 0, hits = 0, tokens = 0, nearMisses = 0, state = 'countdown', countdown = 3, shake = 0, endT = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let camA = route.at(0).a, arrivalFrom = null;
  const result = { arrived: false, parked: false, timeLeft: 0, cleanPark: false, hits: 0, tokens: 0, nearMisses: 0, bonus: 0 };
  const cruise = () => Math.min(32, 18 + drove * 0.5); // ~40 → ~72 mph: the run speeds up like a runner should

  function park() {
    state = 'parked';
    Object.assign(result, { arrived: true, parked: true, timeLeft: Math.max(0, t), hits, tokens, nearMisses });
    result.cleanPark = Math.abs(car.d - spot.d) < 0.8;
    result.bonus = Math.round(result.timeLeft * 50 + tokens * 25 + nearMisses * 50 + (result.cleanPark ? 500 : 0) + (hits === 0 ? 300 : 0));
    flash(result.cleanPark ? 'CLEAN PARK! 🅿️' : 'PARKED 🅿️', 2600);
    audio.chime(); endT = 0;
  }

  // ---------- loop ----------
  let last = performance.now(), raf = 0, acc = 0;
  const FIXED = 1 / 120;
  function frame() {
    raf = nextFrame(frame);
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now;
    hornT -= dt;
    if (state === 'countdown') {
      countdown -= dt;
      hud.msg.textContent = countdown > 0 ? String(Math.ceil(countdown)) : 'GO!'; hud.msg.classList.add('on');
      if (countdown <= 0) { state = 'driving'; flash('GO!', 700); hud.hint.textContent = ''; }
    }
    const braking = keys.has('down');
    const approaching = car.s > spot.s - 95;
    if (state === 'driving' || state === 'parked' || state === 'late') {
      acc += dt;
      while (acc >= FIXED) {
        acc -= FIXED;
        car.step(FIXED, {
          targetD: car.targetD, brake: braking || state !== 'driving', cruise: state === 'driving' ? cruise() : 0,
          stopAt: approaching ? spot.s : undefined,
        });
      }
    }
    if (state === 'driving') {
      t -= dt; drove += dt;
      const ev = world.update(dt, car, drove, hornT > 0 ? 1 : 0);
      for (const h of ev.hits) {
        hits++; car.v *= 1 - 0.65 * h.power; car.stun = 0.5 * h.power; car.invuln = 1.0; shake = Math.min(1, 0.4 + h.power * 0.6);
        if (h.power > 0.9) { t -= 1; flash('−1s  ' + h.label, 700); } else if (h.label) flash(h.label, 700);
        audio.crash(h.power); try { navigator.vibrate?.(h.power > 0.9 ? [30, 40, 60] : 25); } catch {}
        if (h.e.type !== 'panhandler') { // sparks where the metal meets; plastic chips off cones and barricades
          const cp = car.pose, ep = route.at(h.e.s, h.e.d);
          const at = toV3((cp.x + ep.x) / 2, (cp.y + ep.y) / 2, (cp.z + ep.z) / 2 + 0.6);
          fx.burst(at, new THREE.Vector3(Math.cos(cp.a), 0, -Math.sin(cp.a)), { power: h.power, kind: h.e.solid < 0.8 ? 'plastic' : 'metal', color: h.e.color });
        }
      }
      if (ev.nearMiss) { nearMisses += ev.nearMiss; pop('NEAR MISS +50'); audio.whoosh(); }
      if (ev.tokens) { tokens += ev.tokens; pop('+' + ev.tokens * 25); audio.token(); }
      if (approaching) hud.hint.textContent = Math.abs(car.d - spot.d) < 0.8 ? 'Nice — hold the curb' : 'Pull right to the curb ▸';
      if (approaching && car.v < 0.3 && Math.abs(car.s - spot.s) < 2) park();
      if (t <= 0) { t = 0; state = 'late'; Object.assign(result, { hits, tokens, nearMisses }); flash('TOO LATE — walk it in', 2600); endT = 0; }
    } else {
      world.update(0, car, drove, 0);
    }
    if (state === 'parked' || state === 'late') {
      endT += dt; hud.hint.textContent = '';
      if (endT > 4.2) { finish(); return; } // 2.4 s camera swing + a beat on the storefronts
    }

    // car transform
    const p = car.pose;
    carRig.position.copy(toV3(p.x, p.y, p.z));
    carRig.rotation.set(0, p.a - Math.PI / 2, 0);
    carModel.rotation.z = THREE.MathUtils.clamp(-car.dv * 0.012, -0.07, 0.07);   // body roll into the dodge
    carModel.visible = car.invuln <= 0 || Math.floor(car.invuln * 12) % 2 === 0; // blink while recovering
    world.render(car, drove);
    fx.update(dt, camera, renderer);
    beacon.material.opacity = 0.12 + 0.08 * Math.sin(now / 250);
    spotGroup.visible = state === 'driving' || state === 'countdown';
    // under an overpass? fade the deck so you never lose the car
    const under = city.decks.some(([ax, ay, bx, by, r]) => {
      const dx = bx - ax, dy = by - ay, tt = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p.x - ax - tt * dx, p.y - ay - tt * dy) < r;
    });
    const bm = city.bridges.material; bm.opacity += ((under ? 0.25 : 1) - bm.opacity) * Math.min(1, dt * 6); bm.depthWrite = bm.opacity > 0.95;

    // camera: high and behind along the road (runner framing), rising and reaching further with speed
    const v = car.v, h = 17 + v * 0.4, back = 14 + v * 0.45, ahead = 10 + v * 0.35; // car sits in the lower third
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
    camera.position.copy(camPos);
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 1.2; camera.position.z += (Math.random() - 0.5) * shake * 1.2; shake = Math.max(0, shake - dt * 3); }
    camera.lookAt(camLook);

    sun.position.copy(carRig.position).add(tmp.copy(sun.userData.dir || new THREE.Vector3(-0.5, 0.8, 0.35)).multiplyScalar(220));
    sun.target.position.copy(carRig.position);

    audio.update(car.v, state === 'driving' && !braking ? (car.v < cruise() - 0.5 ? 1 : 0.45) : 0.1, Math.min(1, Math.abs(car.dv) / 14 + (braking && car.v > 6 ? 0.6 : 0)), dt);
    hud.time.textContent = t.toFixed(1);
    hud.time.classList.toggle('low', t < 10);
    hud.speed.textContent = Math.round(v * 2.237) + ' mph';
    hud.dist.textContent = Math.max(0, Math.round(spot.s - car.s)) + ' m';
    hud.tokens.textContent = tokens;
    renderer.render(scene, camera);
  }

  function finish() {
    cancelFrame(raf); audio.stop();
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', resize);
    root.classList.add('out');
    setTimeout(() => { renderer.dispose(); root.remove(); onDone({ ...result }); }, 450);
  }

  progress(1, 'Ready');
  root.querySelector('.drive-loading').remove();
  root.querySelector('[data-skip]').addEventListener('click', () => { Object.assign(result, { hits, tokens, nearMisses }); finish(); });
  frame();
  // test hooks (drive QA + screenshots)
  const api = { car, world, route, spot, keys, result, audio, fx, get state() { return state; }, get time() { return t; },
    three: { scene, camera, carRig, THREE },
    snapshot: (q = 0.85) => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', q); } };
  window.__drive = api;
  return api;
}

const KEYMAP = { ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'horn', KeyH: 'horn' };

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
<div class="drive-msg"></div>
<div class="drive-pop"></div>
<div class="drive-hint"></div>
<button class="drive-skip" data-skip aria-label="Skip the drive">SKIP ▸▸</button>
<div class="drive-steer" aria-label="Drag to steer"></div>
<div class="drive-knob"><i></i></div>
<div class="drive-touch">
  <button class="horn" data-k="horn" aria-label="Horn">HORN</button>
  <button class="brake" data-k="down" aria-label="Brake">BRAKE</button>
</div>
<div class="drive-tip">Drag to dodge · grab the EBT tokens</div>
<div class="drive-osm">© OpenStreetMap contributors</div>`;
