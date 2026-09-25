# Drive level: "Get to the Store"

A 60-second, top-down, player-steered drive (GTA 1 style) through real downtown Atlanta
that ends at the EBT Corner Store and hands straight off to the store level. It lives in
the same game rather than as a separate app.

## Route (approved)

About 1.1 km of real streets, routed on OpenStreetMap data with one-ways respected:

**Luckie St → Auburn Ave (full length) → store**

The drive starts on Luckie St. The original Centennial Olympic Park start (1.5 km) was measured
too tight for 60 s. Speed-profile lap times with no traffic (grip-limited cornering plus
accel/brake passes over the route):

| Driver | Time from Centennial Olympic Park | Time from Luckie St |
| --- | --- | --- |
| Expert | 50 s | 34 s |
| Good | 60 s | 41 s |
| Casual | 71 s | 48 s |

With traffic, crashes and parking adding roughly 10–15 s, a good player finishes with a few seconds
spare and an expert banks about 20 s of bonus. The full-route autopilot in QA arrives with 23 s
left and no crashes.

Along the way you pass Apex Museum, Big Bethel AME, the John Lewis "Hero" mural, and the
underpass beneath the I-75/85 Downtown Connector. The hero row is fictional and stands on the **south side of Auburn Ave between Fort St and
Hilliard St**, facing north. Seen from the street, left to right, it runs in the intro's order:
Susie's Hair Care, Laundromat, EBT Corner Store, JJ's Fish & Chicken, then the **"FORT ST / AUBURN
AVE" corner sign kept from the intro**. The store is on JJ's left. You come out from under the
Connector and the row is right there.

**We never build over landmarks.** The north side of this block is the SCLC headquarters and the
Prince Hall Masonic Building, and Ebenezer Baptist and the King Center are just east. All of them stay
as they are, and the hero row only replaces an ordinary commercial lot (a credit union).
`blender_hero_row.py` prints every OSM lot it clears; check that list after any placement change.

The route is only the suggested line. The arrow points at the store, and the player can cut
through Edgewood Ave or side streets.

Map: `drive/route_v1.png`. To regenerate it, run `node drive/tools/route.mjs` and
`node drive/tools/routemap.mjs`.

## Controls (mobile-first: the game is played on phones)

| Phone | Keyboard | Action |
| --- | --- | --- |
| Hold anywhere | ↑ / W | Gas |
| Slide left/right from where you touched | ← → / A D | Analog steering (about 75 px of slide = full lock; the yellow knob shows it) |
| Lift your thumb | release | Coast |
| **BRAKE** (big, bottom-right) | ↓ / S | Brake, then reverse |
| **DRIFT** | Space | Handbrake drift |
| ↺ R | R | Reset to road (−3 s) |
| SKIP | | Skip the drive |

On phones the renderer caps pixel ratio at 1.5 and shadows at 1024². Portrait widens the FOV
to keep about 48° of horizontal view, the view shifts up so the car clears the buttons, and crashes
vibrate (Android).

## Feel

- **Camera:** overhead chase camera (24 m up, rising with speed) that follows your heading.
  **C** toggles a classic north-up GTA 1 view.
- **Handling:** arcade but weighty. `physics.js` is a 2D bicycle model with slip-angle tires,
  speed-scaled steering, a yaw stability assist and a handbrake drift (**Space**). Top speed is
  about 90 mph. We chose this over Rapier: a top-down game doesn't need a 3D rigid-body engine,
  and this adds 0 KB instead of about 2 MB of WASM.
- **Collision:** buildings are solid, using the car's footprint circles against OSM edges in a
  spatial grid. Canopies and raised floors are drive-under. Hits over about 20 mph cost 1 s.
  **R** resets you to the road for 3 s.
- **Overpasses:** the Connector deck fades while you're underneath, so you never lose the car.
- **Pressure:** traffic on the real lane graph, cross streets, and the clock. Crashes cost
  time rather than ending the run.
- **Lighting:** always daytime. Sky, sun, cloud, fog and wet-road state come from live
  Atlanta weather (Open-Meteo, no API key needed). If the fetch fails, it falls back to a
  clear afternoon.
- **Parking (the finish):** GTA 1 just had you drive into a drop-off marker. Here you pull
  into the painted **P** space at the curb in front of the EBT Corner Store (a nod to the lot in
  the intro) and stop. A beacon and the route arrow guide you in.
- **Payoff:** `bonus = timeLeft × 50 + 500 (clean park: straight and centered) + 300 (no
  crashes)`. It's added to the store level's score, with a "CLEAN PARK +N" bubble.
- **Arrival:** the camera swings down to the intro's street-level framing of the storefronts,
  then hands off.
- **Car:** a Challenger-inspired muscle coupe (plum, twin stripes, hood scoop, quad headlamps,
  full-width tail bar). It carries our own design and **no Dodge marks**, the way GTA does its
  car "parodies".

## Budgets (hard limits)

The store level has to stay smooth, so the drive has to earn every byte.

| Budget | Limit |
| --- | --- |
| Drive download, total (compressed) | **≤ 8 MB** |
| First playable chunk | **≤ 3 MB**, prefetched while the title/intro plays |
| `standalone.html` | **+0 MB**. The drive is not embedded; offline builds skip straight to the store |
| Frame | 60 fps on a mid-range phone: ≤ 150 draw calls, ≤ 500k visible tris |
| Textures | KTX2 (Basis), shared trim-sheet atlases, ≤ 2048² |
| Geometry | glTF + meshopt, merged per city tile, LOD for anything past ~150 m |

The drive's code and assets load on demand (dynamic `import()` + fetch). Nothing is added
to the store level's startup cost.

## Hero storefronts

The facade art comes from the intro video's designs, repainted as straight-on elevation textures
(Higgsfield `gpt_image_2`, with intro frames as reference). They are stored in `drive/art/facades/`
as 2048 px JPGs. Each shop is a real box: CC0 brick sides (Poly Haven, `fetch_pbr.mjs`), a roof with a
parapet cap and rooftop units (the overhead camera mostly sees roofs), and a modeled awning and sign
board UV-projected from the same facade image, so paint and depth line up.
**To fix before shipping:** the EBT facade shows real chip brands in the window. Paint them out.

## Runtime (public/drive/)

| File | Role |
| --- | --- |
| `drive.js` | `startDrive({ mount, onDone })`: loader, scene, loop, HUD, parking, arrival, QA hooks (`window.__drive`) |
| `city.js` | builds terrain, roads (markings in the shader), and all OSM buildings (procedural window facades, roofs, rooftop units) from `world.json` |
| `physics.js` | car model + building collision |
| `weather.js` | live Atlanta weather → sky, sun, shadows, haze, wet roads |
| `hero.glb`, `car.glb` | Blender exports (meshopt + WebP) |
| `vendor/` | three.js r186 (MIT), imports rewritten to relative paths so no import map is needed |

**Game hook:** in `standalone/csd.js`, START RUN calls `startWithDrive()`. That
dynamic-imports `./drive/drive.js`, runs the drive, then `startRun()` and adds the bonus.
"Run it back" skips the drive. If it's offline, opened from disk, or `?nodrive` is set, the run starts
directly, so the single-file build stays drive-free. The drive's code is prefetched while the title
screen is up.

**QA:** `/drive/index.html` is a standalone harness. Add `?qa` to either page to drive the loop from a
timer, since hidden tabs pause `requestAnimationFrame`.

Current download: about 2.4 MB of assets plus about 0.9 MB of three.js (≈0.25 MB gzipped), within the
3 MB first-chunk budget.

## Asset pipeline

Every step is a script checked into `drive/tools/`, so the world can be rebuilt from
scratch rather than hand-tweaked.

1. **Data:** Overpass (OSM) extract → `drive/osm/auburn.json` (git-ignored raw data).
2. **World build:** `build_world.mjs` converts OSM plus a sampled elevation grid into
   `world.json` in local metres (origin = store, +X east, +Y north), with building
   heights, road classes and widths, bridges and layers, and the route polyline. Blender
   and the game engine both read this one file.
3. **Blender (via `drive/tools/bl.py`):** blockout from `world.json`. Then hero
   storefronts and landmarks, procedural facades for the rest (floor count → window
   grid on trim sheets), and prop scatter.
4. **Bake:** AO and bounce light baked in Cycles. The sun and shadows stay real-time
   so they can follow the weather.
5. **Optimize/export:** LODs, merge per tile, glTF → `gltf-transform` (meshopt + KTX2).
6. **Engine:** three.js (WebGPU with WebGL2 fallback) + Rapier, as a lazy-loaded
   scene module in the main game.
7. **QA:** scripted browser run (as in `tests/qa.mjs`) plus screenshots.

`drive/tools/bl.py` talks to the BlenderMCP add-on socket directly (port 9876). It is used
for long jobs such as imports and bakes, where the MCP bridge times out.
