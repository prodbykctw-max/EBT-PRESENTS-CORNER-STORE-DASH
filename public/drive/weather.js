// Live Atlanta weather → lighting. Open-Meteo is free and keyless. Any failure falls back to a
// clear afternoon so the drive never blocks on the network.
import * as THREE from './vendor/three.module.min.js';
import { buildSky } from './sky.js';
import { lightFor, moment, GLOW } from './daylight.js';

const URL_ATL = 'https://api.open-meteo.com/v1/forecast?latitude=33.7556&longitude=-84.3772'
  + '&current=temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m&temperature_unit=fahrenheit&timezone=America%2FNew_York';

const CLEAR = { code: 0, cloud: 10, rain: 0, tempF: 75, label: 'Clear' };

export async function fetchWeather(timeoutMs = 2500) {
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeoutMs);
    const j = await (await fetch(URL_ATL, { signal: ctl.signal })).json(); clearTimeout(to);
    const c = j.current, code = c.weather_code;
    const rain = c.precipitation > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    const label = code >= 95 ? 'Storms' : rain ? 'Rain' : code === 45 || code === 48 ? 'Fog'
      : c.cloud_cover > 75 ? 'Overcast' : c.cloud_cover > 35 ? 'Partly cloudy' : 'Clear';
    return { code, cloud: c.cloud_cover, rain: rain ? 1 : 0, tempF: Math.round(c.temperature_2m), label: `${label} ${Math.round(c.temperature_2m)}°` };
  } catch {
    return { ...CLEAR, label: 'Clear 75°' };
  }
}

/** The comic look: daytime always (sun strength, shadow softness, haze and wet roads follow the sky). The realistic look: the sun is where it really is over
 *  Auburn Avenue at this moment (daylight.js), and the sky, the sun, the ambient light and the street's lights follow it, with the weather on top. */
export function applyWeather(w, { scene, renderer, sun, hemi, roads, real = false, when = null }) {
  const cloud = w.cloud / 100, fog = w.code === 45 || w.code === 48;
  if (real) return applyRealLight(w, { scene, renderer, sun, hemi, roads, fog, when });
  const grey = Math.min(1, cloud * 1.1 + w.rain * 0.4);
  // (the realistic look's sky is deeper blue over a paler horizon; overcast and rain still grade it to grey)
  const zenith = new THREE.Color().lerpColors(new THREE.Color(0x3f78c8), new THREE.Color(0x9aa3ad), grey);
  const horizon = new THREE.Color().lerpColors(new THREE.Color(0xc9dcef), new THREE.Color(0xc2c6ca), grey);
  scene.fog = new THREE.Fog(horizon, fog ? 90 : 320, fog ? 420 : 1600);
  sun.intensity = THREE.MathUtils.lerp(3.4, 0.9, Math.min(1, cloud * 0.85 + w.rain * 0.3));
  sun.color.set(cloud > 0.7 ? 0xe9eef5 : 0xfff1dc);
  hemi.intensity = THREE.MathUtils.lerp(1.0, 1.7, cloud);
  sun.shadow.radius = 2 + cloud * 8; // soft-edged shadows under cloud cover
  sun.userData.dir = new THREE.Vector3(-0.45, 0.82, 0.36).normalize(); // mid-afternoon sun from the SW
  const sky = buildSky(renderer, scene, { zenith, horizon, sunDir: sun.userData.dir, cloud, real: false });
  renderer.toneMappingExposure = 1.0 + cloud * 0.15;
  for (const r of roads || []) r.material.userData.wet.value = w.rain ? 1 : 0;
  return sky;
}

/** (re)light the realistic look for the instant `when` (ms; default: the moment daylight.js picks, i.e. now, or ?time= in a ?qa page). Can be called again
 *  with another instant: the previews do, to show one boot at every hour. real.js tuneWeather finishes the job (it reads scene.userData.light). */
function applyRealLight(w, { scene, renderer, sun, hemi, roads, fog, when, prev = null }) {
  const L = lightFor(when ?? moment(), w), cloud = w.cloud / 100;
  scene.userData.light = L; scene.userData.weather = w;
  GLOW.uLit.value = L.lit; GLOW.uLamp.value = L.lamp; GLOW.uPoolK.value = w.rain ? 1.7 : 1;
  const fogNear = fog ? 90 : 320, fogFar = fog ? 420 : 1600;
  if (scene.fog) { scene.fog.color.copy(L.horizon); scene.fog.near = fogNear; scene.fog.far = fogFar; } else scene.fog = new THREE.Fog(L.horizon, fogNear, fogFar);
  sun.shadow.radius = 2 + cloud * 8;   // soft-edged shadows under cloud cover
  // sun.userData.dir is the direction the shadow comes from (the sun, or the moon at night; it is one Vector3 for good, other code keeps a reference to it);
  // sun.userData.sunDir is the real sun (below the horizon after sunset: the glow in the sky and the haze use it)
  if (!sun.userData.dir) sun.userData.dir = new THREE.Vector3();
  sun.userData.dir.copy(L.lightDir); sun.userData.sunDir = L.sunDir.clone();
  const old = scene.getObjectByName('sky'), dome = prev || null;
  const sky = buildSky(renderer, scene, { zenith: L.zenith, horizon: L.horizon, sunDir: L.sunDir, cloud, real: true, light: L });
  for (const r of roads || []) r.material.userData.wet.value = w.rain ? 1 : 0;
  return sky;
}

/** re-light an already built realistic drive for another instant (tests and previews): replaces the sky dome and its environment, then real.js retunes the lights */
export function relight(w, ctx, when) {
  const { scene, renderer } = ctx, old = scene.getObjectByName('sky'), oldEnv = scene.environment;
  if (old) { scene.remove(old); old.geometry.dispose(); old.material.dispose(); }
  const sky = applyRealLight(w, { ...ctx, fog: w.code === 45 || w.code === 48, when });
  if (oldEnv) oldEnv.dispose();
  return sky;
}
