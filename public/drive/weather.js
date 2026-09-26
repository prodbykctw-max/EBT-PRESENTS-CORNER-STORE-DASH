// Live Atlanta weather → lighting. Open-Meteo is free and keyless. Any failure falls back to a
// clear afternoon so the drive never blocks on the network.
import * as THREE from './vendor/three.module.min.js';
import { buildSky } from './sky.js';

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

/** Daytime always; sun strength, shadow softness, haze and wet roads follow the sky. */
export function applyWeather(w, { scene, renderer, sun, hemi, roads }) {
  const cloud = w.cloud / 100, fog = w.code === 45 || w.code === 48;
  const grey = Math.min(1, cloud * 1.1 + w.rain * 0.4);
  const zenith = new THREE.Color().lerpColors(new THREE.Color(0x3f78c8), new THREE.Color(0x9aa3ad), grey);
  const horizon = new THREE.Color().lerpColors(new THREE.Color(0xc9dcef), new THREE.Color(0xc2c6ca), grey);
  scene.fog = new THREE.Fog(horizon, fog ? 90 : 320, fog ? 420 : 1600);
  sun.intensity = THREE.MathUtils.lerp(3.4, 0.9, Math.min(1, cloud * 0.85 + w.rain * 0.3));
  sun.color.set(cloud > 0.7 ? 0xe9eef5 : 0xfff1dc);
  hemi.intensity = THREE.MathUtils.lerp(1.0, 1.7, cloud);
  sun.shadow.radius = 2 + cloud * 8; // soft-edged shadows under cloud cover
  sun.userData.dir = new THREE.Vector3(-0.45, 0.82, 0.36).normalize(); // mid-afternoon sun from the SW
  const sky = buildSky(renderer, scene, { zenith, horizon, sunDir: sun.userData.dir, cloud });
  renderer.toneMappingExposure = 1.0 + cloud * 0.15;
  for (const r of roads || []) r.material.userData.wet.value = w.rain ? 1 : 0;
  return sky;
}
