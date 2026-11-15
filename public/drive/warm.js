// Start the drive's downloads early, and all at once.
//
// The drive needs about 8 MB of files (models, textures, the people / cars / animals data, the sounds). Asked for in the order the code
// reaches them they used to run in a chain: real.js, then its textures, THEN the cars, people and animals, THEN the last eight textures. Here every file
// the drive will ask for is requested up front (`warm()`), so the chain collapses into one parallel batch that only the phone's bandwidth limits.
//
// The store page calls `warm()` while the player is still on the title screen and the drive how-to-play (csd.js `prefetchDrive`), and
// `startDrive()` calls it again at the very top (a second call does nothing). Each file is fetched into the browser's HTTP cache; the
// loaders that ask for it later (GLTFLoader, TextureLoader, fetch) join the same request, or find it in the cache. Nothing is parsed or built
// here: no three.js object is made, so no Math.random is drawn (the drive's own sequence is exactly the one it had).
//
// KEEP IN STEP with the loaders: a file the drive asks for that is missing here is simply loaded late (the same as before); a file listed here
// that the drive never asks for is a wasted download. tools-load/check-warm.mjs lists both from a real boot.
// No imports on purpose: this file must stay a few hundred bytes of plain code.
const BASE = new URL('./', import.meta.url);

const CORE = ['drive.css', 'world.json', 'hero.glb', 'car.glb', 'props.glb', 'trees.glb', 'character.glb',
  'tex/asphalt_diff.webp', 'tex/asphalt_nor.webp', 'tex/grass_diff.webp', 'tex/grass_nor.webp', 'tex/bark.webp', 'tex/bark_nor.webp', 'tex/leaves.webp', 'tex/grass_tuft.webp'];
const SFX = ['engine_on.wav', 'engine_off.wav', 'squeal_loop.wav', 'screech.mp3', 'horn.mp3', 'horn_far.mp3', 'coin.mp3', 'crash_metal_1.mp3', 'crash_metal_2.mp3', 'crash_metal_3.mp3', 'crash_glass.mp3'].map((f) => 'sfx/' + f);
// the realistic look (the default; ?look=comic never loads any of it)
const REAL_TEX = ['brick_d', 'brick_n', 'conc_d', 'conc_n', 'curt_d', 'curt_n', 'pave_d', 'pave_n', 'asph_r', 'peel'].map((f) => `tex/real/${f}.webp`);
const REAL_MODULES = ['real.js', 'real-post.js', 'cars.js', 'animals.js', 'people-alt.js', 'people-b.js'];

const q = (k) => new URLSearchParams(location.search).get(k);
const off = (v) => /^(none|0|off|false|no)$/i.test(v || '');

/** the data files (not code) the drive will load, as URLs. real: the realistic look (default). */
export function dataFiles({ real = q('look') !== 'comic', mobile = matchMedia('(pointer: coarse)').matches } = {}) {
  const f = [...CORE, ...SFX];
  if (real) {
    f.push(...REAL_TEX);
    const cars = q('cars');
    if (cars === null || cars === '') f.push('cars/bc.cars');
    else for (const n of new Set(cars.toUpperCase().split(/[,|]/).filter((s) => /^(A|B|C|BC)$/.test(s)))) f.push(`cars/${n.toLowerCase()}.cars`);
    if (!off(q('animals'))) f.push('animals/animals.json', 'animals/animals.bin', 'animals/dog.webp', 'animals/dog_n.webp', 'animals/pigeon.webp');
    const pq = (q('people') || 'b').toLowerCase(), kinds = off(pq) ? '' : /^[ab]+$/.test(pq) ? pq : 'b';   // (drive.js peopleKindsFromURL)
    if (kinds.includes('b')) f.push('people-real/people2.json', 'people-real/people2.bin');
  }
  return f.map((p) => new URL(p, BASE).href);
}

let started = null;
/** begin every download; safe to call any number of times, from the title screen on. Returns the promise of "all of them landed" (never rejects). */
export function warm(opts) {
  if (started) return started;
  const real = opts?.real ?? q('look') !== 'comic';
  if (real) for (const m of matchMedia('(pointer: coarse)').matches ? [...REAL_MODULES, 'contact.js'] : REAL_MODULES) {   // the realistic look's code: fetched and compiled, not run (modulepreload does not evaluate)
    const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = new URL(m, BASE).href; document.head.appendChild(l);
  }
  started = Promise.all(dataFiles({ real }).map((u) => fetch(u).then((r) => r.arrayBuffer()).catch(() => {}))).then(() => {});
  return started;
}
