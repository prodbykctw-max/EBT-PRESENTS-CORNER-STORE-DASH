// The traffic and parked cars of the REALISTIC look. With no ?cars the realistic look draws the BC fleet (cars/bc.cars: C's
// street cars, with B's concept car as about one ordinary car in three); ?cars=none (or 0 / off) gives back the props.glb cars.
// For QA: ?cars=A, B, C or BC (or a list, A,B,C: World.setCarSet(name) switches between the loaded ones).
// The comic look never reaches this file: drive.js only loads car sets when the realistic look is up.
//
// A set is one file, public/drive/cars/<a|b|c>.cars (made by tools-cars/, see CREDITS.txt there): per body, three levels of
// detail (L0 near ~25k tris with a real interior and a separate see-through glass mesh, L1 ~5k, L2 ~1k), plus small add-ons
// (police light bar, robotaxi roof sensor). Every vertex carries its colour, a part id (the ids real.js's prop material
// already understands: paint / glass / rubber / lamps / chrome / trim / light-bar lens) and a baked ambient occlusion, so
// one solid-colour PBR material draws everything, the instance colour tinting the paint. A role (sedan / suv / police /
// robotaxi) is a body + add-ons + livery rule + a scale, assembled here at load time, so the bytes of a body are
// shipped once however many roles use it.
//
// World.render (runner.js) calls CarSet.pick() for every car: distance to the camera chooses the LOD, and each LOD is its
// own InstancedMesh (one draw call per role and level). Cars that are drawn as L0/L1 don't cast a shadow themselves: a
// ~600-triangle proxy of the same car (invisible to the camera, depth only) casts it.
import * as THREE from './vendor/three.module.min.js';
import { propMaterial, shadowSplit } from './runner.js';

const ROLES = ['sedan', 'suv', 'police', 'robotaxi'];

export const DEFAULT_SET = 'BC';
export function carSetsFromURL() {
  const q = new URLSearchParams(location.search).get('cars');
  if (q === null || q === '') return [DEFAULT_SET];                       // no ?cars: the BC fleet
  return [...new Set(q.toUpperCase().split(/[,|]/).filter((s) => /^(A|B|C|BC)$/.test(s)))];   // ?cars=none / 0 / off (or anything else): no set
}

/** fetch + parse one .cars file (gzip when it starts with the gzip magic) */
export async function loadCarFile(url) {
  let buf = await (await fetch(url)).arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) buf = await new Response(new Response(buf).body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, false) !== 0x43415253) throw new Error('not a .cars file');
  const jl = dv.getUint32(4, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))), base = 8 + jl;
  const out = { ...head, raw: {} };
  for (const [name, m] of Object.entries(head.meshes)) {
    const q = new Int16Array(buf.slice(base + m.pos, base + m.pos + m.n * 6));
    const pos = new Float32Array(m.n * 3);
    for (let i = 0; i < m.n; i++) for (let c = 0; c < 3; c++) pos[i * 3 + c] = m.ctr[c] + (q[i * 3 + c] / 32767) * m.ext[c];
    out.raw[name] = {
      pos, nrm: new Int8Array(buf.slice(base + m.nrm, base + m.nrm + m.n * 3)), col: new Uint8Array(buf.slice(base + m.col, base + m.col + m.n * 3)),
      part: new Uint8Array(buf.slice(base + m.part, base + m.part + m.n)), ao: new Uint8Array(buf.slice(base + m.ao, base + m.ao + m.n)),
      idx: m.wide ? new Uint32Array(buf.slice(base + m.idx, base + m.idx + m.m * 4)) : new Uint16Array(buf.slice(base + m.idx, base + m.idx + m.m * 2)),
    };
  }
  return out;
}

// ------------------------------------------------------------------ liveries (rules on the paint vertices of a body)
// vertex colours are read as linear values: these whites are about 0.6 linear (a clean sRGB 0.8 paint), not 0.93, which the sun and the bloom burn out
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const LIVERY = {
  // white cruiser, navy lower body and a navy roof stripe: reads as police from a long way off
  police(v, body) {
    const hn = (v.y - body.min.y) / (body.max.y - body.min.y);
    if (Math.abs(v.nx) > 0.45 && hn < 0.50) return hex(0x0f1b33);
    if (Math.abs(v.nx) > 0.45 && hn < 0.54) return hex(0xd9a21a);   // gold pinstripe
    return hex(0x95989c);
  },
  // pearl white with a teal skirt: a driverless taxi
  robotaxi(v, body) {
    const hn = (v.y - body.min.y) / (body.max.y - body.min.y);
    if (Math.abs(v.nx) > 0.45 && hn < 0.42) return hex(0x12a89c);
    return hex(0x9a9d9e);
  },
};

function concat(parts) {
  const n = parts.reduce((a, p) => a + p.pos.length / 3, 0), m = parts.reduce((a, p) => a + p.idx.length, 0);
  const o = { pos: new Float32Array(n * 3), nrm: new Int8Array(n * 3), col: new Uint8Array(n * 3), part: new Uint8Array(n), ao: new Uint8Array(n), idx: new Uint32Array(m) };
  let vo = 0, io = 0;
  for (const p of parts) {
    const pn = p.pos.length / 3;
    o.pos.set(p.pos, vo * 3); o.nrm.set(p.nrm, vo * 3); o.col.set(p.col, vo * 3); o.part.set(p.part, vo); o.ao.set(p.ao, vo);
    for (let i = 0; i < p.idx.length; i++) o.idx[io + i] = p.idx[i] + vo;
    vo += pn; io += p.idx.length;
  }
  return o;
}

/** body + add-ons -> one BufferGeometry in game axes (x right, y up, z back), scaled, liveried, with the aProp attribute real.js's material reads */
function assemble(raw, names, scale, livery, { tintRoles }) {
  const parts = names.filter((n) => raw[n]).map((n) => raw[n]);
  const g = concat(parts), n = g.pos.length / 3;
  const body = { min: { y: Infinity }, max: { y: -Infinity } };
  const first = raw[names[0]];
  for (let i = 0; i < first.pos.length / 3; i++) { const y = first.pos[i * 3 + 1]; if (y < body.min.y) body.min.y = y; if (y > body.max.y) body.max.y = y; }
  body.min.y *= 1;
  const col = g.col.slice(), part = g.part.slice();
  const bn = first.part.length;   // only the body itself is re-liveried, never the add-ons
  if (livery && LIVERY[livery]) {
    for (let i = 0; i < bn; i++) if (part[i] === 1) {   // (only the car's own tinted paint: a body's black accent panels stay)
      const c = LIVERY[livery]({ y: g.pos[i * 3 + 1], nx: g.nrm[i * 3] / 127 }, body); col.set(c, i * 3); part[i] = 7;
    }
  }
  for (let i = 0; i < n; i++) { g.pos[i * 3] *= scale[0]; g.pos[i * 3 + 1] *= scale[1]; g.pos[i * 3 + 2] *= scale[2]; }
  const aProp = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { aProp[i * 2] = part[i]; aProp[i * 2 + 1] = g.ao[i] / 255; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.nrm, 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  geo.setAttribute('aProp', new THREE.BufferAttribute(aProp, 2));
  geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/** The prop material's clear coat is so tight (roughness 0.02) that a perfectly flat patch (a plate, a flat panel) facing the sun
 *  overflows the half-float render target: a blown-out glare with a black hole in it. These cars have big smooth panels, so the
 *  coat's roughness is floored at 0.1 and the lit colour is capped at 5 (a sun glint on a big flat panel can otherwise overflow). */
function flatSafe(m) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('material.clearcoatRoughness = min(1.0, pCoatR + geometryRoughness);', 'material.clearcoatRoughness = clamp(pCoatR + geometryRoughness, 0.1, 1.0);')
      .replace('#include <opaque_fragment>', 'outgoingLight = min(outgoingLight, vec3(5.0));\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|cars-flat3';
  m.needsUpdate = true;
  return m;
}

function glassMaterial() {
  // glass lets you see the interior: its reflection is ADDED (rgb at full strength) and the car behind it is dimmed by the tint
  return new THREE.MeshStandardMaterial({
    color: 0x0a1014, roughness: 0.03, metalness: 0.0, envMapIntensity: 1.6, transparent: true, opacity: 0.55, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}
function proxyMaterial() { return new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }); }

/** a 32-bit integer hash (murmur3's finaliser): consecutive car numbers give uncorrelated results */
const mix32 = (h) => { h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };

// three.js gives every object, material and geometry a uuid made with Math.random(). The drive is seeded for its tests and its planner and
// traffic share Math.random(), so building a car set (a few hundred such objects) must not take draws from that stream: it would make
// a different street whenever a car set is loaded. The set is built with a private generator of its own, then the page's is put back.
let isoState = 0x2545f491;
const isoRandom = () => { isoState ^= isoState << 13; isoState ^= isoState >>> 17; isoState ^= isoState << 5; return (isoState >>> 0) / 4294967296; };
function isolated(fn) { const real = Math.random; Math.random = isoRandom; try { return fn(); } finally { Math.random = real; } }
/** the factory World calls (runner.js) with its scene, its mesh table and its capacities */
export const carSetFactory = (name, data) => (scene, meshes, caps) => isolated(() => new CarSet(name, data, scene, meshes, caps));

export class CarSet {
  constructor(name, data, scene, meshes, caps) {
    this.name = name; this.data = data; const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;   // phones switch to the lighter models sooner
    this.lod = (data.lod || [20, 56]).map((m) => m * (phone ? 0.75 : 1)); this.vehicle = data.vehicle || {};
    this.keys = {}; this.pairs = []; this.proxies = [];
    this.mix = data.mix || {};   // { sedan: { alt: 'sedanB', every: 3 } }: about one `sedan` car in `every` is drawn as the role `alt` (pick)
    const mat = flatSafe(propMaterial()), gmat = glassMaterial(), pmat = proxyMaterial();
    const mat0 = flatSafe(propMaterial()); if (data.doubleL0) mat0.side = THREE.DoubleSide;   // (a source whose thin panels are single surfaces drawn from both sides)
    let mat0d = null;   // (a role of its own on a set that mixes bodies: just that body's near level is double sided)
    const raw = data.raw, mk = (geo, cap, key, cast, m_ = mat) => {
      const im = new THREE.InstancedMesh(geo, m_, cap);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      im.castShadow = cast; im.receiveShadow = true; im.count = 0; im.frustumCulled = false; im.name = 'car_' + key;
      if (cast) shadowSplit(im);
      meshes[key] = im; scene.add(im); return im;
    };
    for (const role of Object.keys(data.roles)) {
      const r = data.roles[role], capRole = r.as || role; if (!ROLES.includes(capRole)) continue;
      const cap = caps[capRole], tag = `${role}@${name}`, sc = r.scale || [1, 1, 1];
      const names = (lv) => [`${r.body}.${lv}`, ...(r.addons || []).map((a) => `${a}.${lv}`)];
      const K = { lod: [`${tag}0`, `${tag}1`, `${tag}2`], shadow: `${tag}s`, glass: `${tag}g` };
      const g0 = assemble(raw, names('L0'), sc, r.livery, {}), g1 = assemble(raw, names('L1'), sc, r.livery, {}), g2 = assemble(raw, names('L2'), sc, r.livery, {});
      const near = mk(g0, cap, K.lod[0], false, r.doubleL0 ? (mat0d ||= (() => { const m = flatSafe(propMaterial()); m.side = THREE.DoubleSide; return m; })()) : mat0); mk(g1, cap, K.lod[1], false); mk(g2, cap, K.lod[2], true);
      const proxy = mk(g2, cap, K.shadow, true); proxy.material = pmat; proxy.visible = false; this.proxies.push(proxy);   // (shown only while the sun's shadow map is drawn: shadowOnly)
      if (raw[`${r.body}.L0g`]) {
        const gg = assemble(raw, [`${r.body}.L0g`], sc, null, {});
        const gl = new THREE.InstancedMesh(gg, gmat, cap); gl.instanceMatrix = near.instanceMatrix;   // the same cars, the same places
        gl.castShadow = false; gl.receiveShadow = false; gl.count = 0; gl.frustumCulled = false; gl.renderOrder = 2; gl.name = 'car_' + K.glass;
        meshes[K.glass] = gl; scene.add(gl); this.pairs.push([near, gl]);
      }
      this.keys[role] = K;
    }
    this.names = Object.keys(meshes).filter((k) => k.includes('@' + name));
  }
  /** the role's mesh keys for one car: with a `mix`, a car's number (World.add's counter, set once for its whole life) picks the body,
   *  from a hash of that number alone: no random draw, no link to the paint colour, the same body at every distance and frame */
  pick(type, cid) {
    const m = this.mix[type];
    if (m && cid !== undefined && this.keys[m.alt] && mix32(cid + 1) % m.every === 0) return this.keys[m.alt];
    return this.keys[type];
  }
  /** which LOD mesh a car at this world position is drawn with */
  lodAt(x, y, z, cam) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
    return d2 < this.lod[0] * this.lod[0] ? 0 : d2 < this.lod[1] * this.lod[1] ? 1 : 2;
  }
  sync() { for (const [n, g] of this.pairs) g.count = n.count; }
  /** The shadow proxies write no colour and no depth, but if they are visible three still runs their vertices through the camera's own pass and counts
   *  their draws there. A layer can't keep them out of it: r186 tests an object's layers against the CAMERA's in the shadow pass too (WebGLShadowMap), so a
   *  layer the camera doesn't see casts no shadow and one it does is drawn. So they are hidden, and shown only around the shadow map's own draw. */
  shadowOnly(renderer) {
    const sm = renderer.shadowMap, draw = sm.render, proxies = this.proxies;
    sm.render = function (...a) { for (const p of proxies) p.visible = true; try { return draw.apply(this, a); } finally { for (const p of proxies) p.visible = false; } };
    this.restoreShadow = () => { sm.render = draw; for (const p of proxies) p.visible = true; };   // (QA: the proxies as they were, drawn in both passes)
  }
}

/** triangles of every LOD mesh of a set (for the report) */
export function setStats(data) {
  const out = {};
  for (const [k, m] of Object.entries(data.meshes)) out[k] = Math.round(m.m / 3);
  return out;
}
