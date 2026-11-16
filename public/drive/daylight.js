// Real-time light for the realistic look: where the sun is over Auburn Avenue right now, and what the sky, the sun, the ambient light and the
// street's own lights do about it. Nothing here runs for the comic look.
//
//   solar()       the sun's elevation and azimuth (NOAA's formulas) for a place and an instant
//   moment()      the instant to light: Date.now() (the same instant everywhere on Earth, so the time zone cannot matter for the sun), or in a ?qa
//                 test ?time=HH:MM (Atlanta clock) and ?date=YYYY-MM-DD
//   lightFor()    everything the look needs for that sun elevation, blended smoothly between key phases (bright day, afternoon, golden hour,
//                 sunset, the pink dusk of the title screen, blue hour, night) and under whatever cloud and rain the live weather says
//   GLOW          the two numbers the street's lights follow (windows, signs, lamp heads: `uLit`; lamp pools, headlights: `uLamp`), shared by
//                 every shader that glows, so changing the time is one assignment
//
// The world's axes (public/drive/world.json "frame"): +x east, +y north, z up; three.js puts world (x, y, z) at (x, z, -y), so NORTH IS -Z and
// EAST IS +X. A sun at azimuth az (clockwise from north) and elevation el is therefore the direction (cos el sin az, sin el, -cos el cos az).
// The drive's origin is at the store (33.75541 N, 84.37772 W); the whole play area is under 2 km across, where the sun moves by under a
// hundredth of a degree, so one position serves the whole city.
import * as THREE from './vendor/three.module.min.js';

export const AUBURN = { lat: 33.75541, lon: -84.37772 };
const D2R = Math.PI / 180, ZONE = 'America/New_York';

/** the shared glow numbers: 0 = daylight, 1 = fully lit (windows and signs: lit; lamps and headlights: lamp) */
export const GLOW = { uLit: { value: 0 }, uLamp: { value: 0 } };

// ------------------------------------------------------------------ the sun
/** NOAA solar position: { el, az } in degrees (az clockwise from north), refraction included. `date` is a Date or ms since 1970 (UTC). */
export function solar(date, lat = AUBURN.lat, lon = AUBURN.lon) {
  const jd = +date / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360, M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T), sM = Math.sin(M * D2R);
  const C = sM * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * D2R) * 0.000289;
  const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * D2R);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lam * D2R));
  const y = Math.tan(eps * D2R / 2) ** 2;
  const eq = 4 / D2R * (y * Math.sin(2 * L0 * D2R) - 2 * e * sM + 4 * e * y * sM * Math.cos(2 * L0 * D2R) - 0.5 * y * y * Math.sin(4 * L0 * D2R) - 1.25 * e * e * Math.sin(2 * M * D2R));
  const utcMin = (((+date / 60000) % 1440) + 1440) % 1440, tst = (((utcMin + eq + 4 * lon) % 1440) + 1440) % 1440;
  const H = tst / 4 - 180, la = lat * D2R;
  const cosZ = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(H * D2R), zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const sz = Math.sin(zen) || 1e-9, c = (Math.sin(la) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(la) * sz);
  const a = Math.acos(Math.max(-1, Math.min(1, c)) ) / D2R, az = H > 0 ? (a + 180) % 360 : (540 - a) % 360;
  let el = 90 - zen / D2R; const te = Math.tan(el * D2R);
  const refr = el > 85 ? 0 : el > 5 ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5 : el > -0.575 ? 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711))) : -20.774 / te;
  el += refr / 3600;
  return { el, az, decl: decl / D2R };
}

/** the world direction (three.js axes, see the top of the file) toward a sun at (el, az) degrees */
export function sunVector(el, az, out = new THREE.Vector3()) {
  const e = el * D2R, a = az * D2R;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

/** minutes the Atlanta clock is ahead of UTC at instant t (-300 in winter, -240 in summer) */
function zoneOffset(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(t)).map((q) => [q.type, +q.value]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000) / 60000;
}
/** the instant (ms) at which the Atlanta wall clock reads y-m-d h:mi */
export function atlantaInstant(y, mo, d, h, mi) {
  const wall = Date.UTC(y, mo - 1, d, h, mi); let t = wall;
  for (let i = 0; i < 3; i++) t = wall - zoneOffset(t) * 60000;
  return t;
}
/** today's date on the Atlanta clock */
function atlantaToday(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(t)).map((q) => [q.type, +q.value]));
  return [p.year, p.month, p.day];
}

/** the instant to light: the device's own clock (never fetched), or in a ?qa page ?time=HH:MM and ?date=YYYY-MM-DD on the Atlanta clock */
export function moment(search = location.search) {
  const q = new URLSearchParams(search), now = Date.now();
  if (!q.has('qa') || !(q.has('time') || q.has('date'))) return now;
  const [y, mo, d] = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date').split('-').map(Number) : atlantaToday(now);
  const m = /^(\d{1,2}):(\d{2})$/.exec(q.get('time') || ''), tm = m ? [+m[1], +m[2]] : (() => { const p = new Date(now); const a = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(p); return [+a.find((x) => x.type === 'hour').value, +a.find((x) => x.type === 'minute').value]; })();
  return atlantaInstant(y, mo, d, tm[0], tm[1]);
}

/** the minute (Atlanta clock) at which the sun crosses elevation `el` going up or down on the day containing instant t, or null; used by the previews */
export function crossing(t, el, rising) {
  const [y, mo, d] = atlantaToday(t), t0 = atlantaInstant(y, mo, d, 0, 0);
  let prev = solar(t0).el;
  for (let m = 1; m <= 1440; m++) {
    const e = solar(t0 + m * 60000).el;
    if (rising ? (prev < el && e >= el) : (prev >= el && e < el)) return t0 + m * 60000;
    prev = e;
  }
  return null;
}
export const atlantaClock = (t) => new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(t));

// ------------------------------------------------------------------ the phases
// Key frames by sun elevation (degrees). Between two, every number and colour is blended with a smoothstep, so the light is one continuous
// function of the sun's height and nothing snaps. Colours are sRGB hex. `sky` is five stops from the zenith down to the horizon at heights
// (sine of elevation) 1, 0.45, 0.2, 0.08, 0: the three pink / orange ones are sampled from the painted title sky (standalone/title_sky.b64:
// magenta 0xd81ea6 at the top, pink 0xfb4a7d, coral 0xfc8753, orange 0xfc9f48, gold 0xfece28 at the horizon).
//   sun: colour, strength (the day's was 6.0 at the old fixed sun); hemi: sky / ground colour and strength; env: the sky's reflected light;
//   envSat: how much of the sky's colour the ambient keeps; ex: exposure; sat / con / tint: the final pass's grade
const KEYS = [
  { el: -18, sky: [0x040818, 0x060c20, 0x0a1230, 0x101a3a, 0x1a2646], sun: 0x000000, sunI: 0, hemi: 0x2a3a70, hemiG: 0x14141e, hemiI: 0.09, env: 0.09, envSat: 0.4, ex: 1.2, sat: 0.95, con: 0.1, tint: 0x9aa8d0, cloud: 0x10141f },
  { el: -10, sky: [0x0b1236, 0x131b48, 0x1f2658, 0x40306a, 0x6a3a6c], sun: 0x000000, sunI: 0, hemi: 0x34447e, hemiG: 0x1c1822, hemiI: 0.16, env: 0.16, envSat: 0.45, ex: 1.18, sat: 1.02, con: 0.1, tint: 0xb4b0d6, cloud: 0x2a2a46 },
  { el: -6.5, sky: [0x1a1446, 0x2d2468, 0x5a3584, 0xa24a86, 0xe0607a], sun: 0x000000, sunI: 0, hemi: 0x7a6a9a, hemiG: 0x2a2028, hemiI: 0.3, env: 0.26, envSat: 0.35, ex: 1.15, sat: 1.1, con: 0.12, tint: 0xe0b8c8, cloud: 0x7a4a80 },
  { el: -3, sky: [0xd81ea6, 0xf83a88, 0xfb6070, 0xfc9f48, 0xfece28], sun: 0xff7a40, sunI: 0.0, hemi: 0xa88a9c, hemiG: 0x5a3a48, hemiI: 0.5, env: 0.4, envSat: 0.3, ex: 1.1, sat: 1.12, con: 0.12, tint: 0xffe2cc, cloud: 0xff6a8a },
  { el: 0, sky: [0x5a3aa6, 0xc03a8c, 0xf0586c, 0xff8a40, 0xffb23c], sun: 0xff6a30, sunI: 1.0, hemi: 0xb89098, hemiG: 0x6a4a40, hemiI: 0.62, env: 0.55, envSat: 0.3, ex: 1.08, sat: 1.12, con: 0.12, tint: 0xffc89a, cloud: 0xff7a5a },
  { el: 4, sky: [0x3a5aa4, 0x6a80b8, 0xc89aa0, 0xf4aa74, 0xffbc72], sun: 0xffa55c, sunI: 3.2, hemi: 0xc7b8c9, hemiG: 0x8a6a50, hemiI: 0.75, env: 0.78, envSat: 0.4, ex: 1.03, sat: 1.12, con: 0.13, tint: 0xffd29a, cloud: 0xffc89a },
  { el: 10, sky: [0x2c68c2, 0x4a86cd, 0x86a9d4, 0xdcc0a8, 0xf4d2a4], sun: 0xffcc8c, sunI: 4.6, hemi: 0xdde0ea, hemiG: 0x8a7a64, hemiI: 0.85, env: 0.86, envSat: 0.28, ex: 1.0, sat: 1.06, con: 0.12, tint: 0xffe6c0, cloud: 0xfff0e0 },
  { el: 24, sky: [0x2468c8, 0x3f86dc, 0x6aa6e8, 0x9cc6ee, 0xcadef0], sun: 0xffe6c4, sunI: 5.8, hemi: 0xe4e8ee, hemiG: 0x8a7a64, hemiI: 0.9, env: 0.9, envSat: 0.2, ex: 1.0, sat: 1.0, con: 0.12, tint: 0xfff5e6, cloud: 0xffffff },
  { el: 40, sky: [0x2166c8, 0x3a84dc, 0x66a4e8, 0x9ac6ee, 0xc8def0], sun: 0xffeed6, sunI: 6.2, hemi: 0xe4e8ee, hemiG: 0x8a7a64, hemiI: 0.9, env: 0.9, envSat: 0.2, ex: 1.0, sat: 1.0, con: 0.12, tint: 0xfff5e6, cloud: 0xffffff },
];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const col = (h) => new THREE.Color(h);
const NUM = ['sunI', 'hemiI', 'env', 'envSat', 'ex', 'sat', 'con'], COL = ['sun', 'hemi', 'hemiG', 'cloud'];
// the grade's tint multiplies display values (after the sRGB conversion), so it is a plain RGB triple, not a colour-managed one
const raw = (h) => new THREE.Color().setRGB(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
const GREY = new THREE.Color(0x9aa3ad), PALE = new THREE.Color(0xe6edf6);

/** the moon's direction: a fixed spot in the south-east sky (the real moon's phase and place are not modelled: it is a night light) */
const MOON = new THREE.Vector3(0.5, 0.62, 0.6).normalize();

/**
 * Everything the light needs at one instant.
 *   t: the instant (ms); w: the live weather { cloud 0-100, rain 0|1, code }
 * Returns { el, az, phase, sunDir (toward the sun, below the horizon after sunset), lightDir (the directional light: the sun, kept at least
 * 7 degrees up so a low sun's shadows stay inside the shadow map, or the moon at night), sunColor, sunI, hemi{Sky,Ground,I}, env, envSat,
 * exposure, sky[5], zenith, horizon, haze, fogFar, sat, con, tint, cloudTint, lit, lamp, night, glow }
 */
export function lightFor(t, w = { cloud: 10, rain: 0, code: 0 }) {
  const { el, az } = solar(t), cloud = w.cloud / 100, grey = Math.min(1, cloud * 0.85 + w.rain * 0.3);
  // the bracketing key frames
  let i = 0; while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const A = KEYS[i], B = KEYS[i + 1], f = smooth(A.el, B.el, el);
  const num = {}; for (const k of NUM) num[k] = THREE.MathUtils.lerp(A[k], B[k], f);
  const c = {}; for (const k of COL) c[k] = col(A[k]).lerp(col(B[k]), f);
  const sky = A.sky.map((h, k) => col(h).lerp(col(B.sky[k]), f));
  const dayW = smooth(2, 26, el);   // how much of the daytime overcast grey applies (dusk keeps its own colour under cloud, only duller)
  // weather on top: cloud and rain pull the sky to grey and the sun down, exactly as the old daytime-only rules did
  for (let k = 0; k < sky.length; k++) {
    const l = sky[k].r * 0.2126 + sky[k].g * 0.7152 + sky[k].b * 0.0722, dull = new THREE.Color(l, l, l).lerp(sky[k], 0.35);
    const target = dull.lerp(GREY, dayW).multiplyScalar(THREE.MathUtils.lerp(1, 1.0, dayW));
    sky[k].lerp(target, grey * (k === 0 ? 1 : 0.9));
  }
  const sunI = num.sunI * THREE.MathUtils.lerp(1, 2 / 6, grey);
  const sunColor = c.sun.clone().lerp(PALE, smooth(0.5, 0.9, cloud) * 0.6 * dayW);
  const night = smooth(-6, -14, el);                  // 0 until the end of civil twilight, 1 at night
  const moonI = 0.32 * night * (1 - grey * 0.5);
  const sunDir = sunVector(el, az);
  const useSun = el > -2.5;
  const lightDir = useSun ? sunVector(Math.max(el, 7), az) : MOON.clone();
  const lit = 1 - smooth(-5, 1.5, el), lamp = 1 - smooth(-4, 2.5, el);
  const phase = el > 28 ? 'day' : el > 12 ? 'afternoon' : el > 4 ? 'golden hour' : el > 0 ? 'sunset' : el > -6.5 ? 'dusk' : el > -12 ? 'blue hour' : 'night';
  const zenith = sky[0].clone(), horizon = sky[4].clone();
  return {
    el, az, phase, sunDir, lightDir, useSun,
    sunColor: useSun ? sunColor : new THREE.Color(0.62, 0.72, 1.0), sunI: useSun ? sunI : moonI, moonI, night,
    hemiSky: c.hemi.clone(), hemiGround: c.hemiG.clone(), hemiI: num.hemiI * (1 + 0.11 * cloud),
    env: num.env * (1 + 0.11 * grey), envSat: num.envSat, exposure: num.ex + cloud * 0.15 * dayW,
    sky, zenith, horizon, haze: horizon.clone().lerp(zenith, 0.3).multiplyScalar(0.8),
    sat: num.sat, con: num.con, tint: raw(A.tint).lerp(raw(B.tint), f), cloudTint: c.cloud, lit, lamp,
  };
}
