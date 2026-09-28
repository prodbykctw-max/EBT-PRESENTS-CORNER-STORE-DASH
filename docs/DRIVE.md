# Drive level: "Get to the Store"

A 70-second, top-down, player-steered drive (GTA 1 style) through real downtown Atlanta
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

## Game design: "Temple Run with cars"

The car **auto-drives** the route and speeds up from about 40 to 72 mph. You don't steer the road; you
**dodge**. Everything runs in route space (s = metres along the route, d = metres across it), so lanes,
obstacles and collisions line up exactly with what's painted on the road.

- **Road:** one continuous two-lane road is drawn along the whole route (unbroken double-yellow,
  white edges). Your lane is the right one, and on two-way stretches the left one carries oncoming
  traffic.
- **Obstacles** (hitting one costs speed; big hits also cost 1 s):
  - **Slow cars** (20–29 mph) in your lane. Pass them when the oncoming lane is clear.
  - **Oncoming traffic** every 5–9 s. It is never spawned so that it meets you beside a blocker.
  - **Parked cars** at the curb.
  - **Construction:** a ROAD WORK sign 38 m ahead, a cone taper, cones along the lane line and a
    barricade. The right lane is closed.
  - **Panhandlers** working the lane line at the lights. **HORN** sends them back to the curb.
    Nobody gets hurt: if you clip one, he jumps clear and you just lose the moment.
- **Scenery** (can't be hit): a procedural crowd on both sidewalks (see below), cyclists along the
  curb, and city buses and cars on the cross streets, which wait at the intersections while you pass.
- **Streets at real width:** curb-to-curb is measured from OSM's mapped sidewalks every 10 m (10–14 m on
  Auburn). There are two travel lanes, plus a 2.4 m curbside parking lane each side where the width allows,
  with parked cars (~60 % full) clear of junctions, crosswalks, work zones and the P space. The P space is
  in the parking lane at the store.
- **Atlanta Streetcar** (`tram.js`): real OSM track (`railway=tram`) is set into the pavement as steel rails
  with flangeway grooves.
  - The car (a generic 3-section, ~25 m S70-class; no logos) runs **westbound on Auburn, toward the player
    in the oncoming lane**, as the real one does.
  - It dwells 7–10 s at the real MARTA platforms (shelters, with riders waiting) and stops for anything on
    its track, ringing its bell (synthesised) at the player.
  - Oncoming traffic queues behind it.
  - Each section sits on the track itself, so it bends through curves.
- **Traffic signals** (`signals.js`): every OSM-signalised intersection on the route (8) runs a real cycle.
  - Auburn green (20–27 s) → yellow 3 s → all-red 1 s → cross green (8–10 s) → yellow → all-red.
  - The corridor is a green wave at ~21 m/s: keep pace and you mostly meet greens; get held up and you meet
    reds.
  - Our direction, oncoming traffic and the streetcar stop at their stop lines (at the edge of the
    junction/crosswalk zone). On yellow they only stop if they comfortably can.
  - Cross traffic moves on its own green, and a vehicle already in the junction clears it.
  - The mast lamps really light (lit lamp plus glow, dark others). A HUD light on the left shows the next
    signal and its distance, since lamps are small from overhead.
  - Running a red means meeting cross traffic.
- **Work zones** run alternating traffic: as the player comes up to one, a flagger holds oncoming cars and the
  streetcar past its far end, so the open lane is theirs.
- **Crowd** (`crowd.js`): one parametric low-poly person (~200 tris), drawn as a single InstancedMesh.
  - **Variety:** each person has their own height, build, skin tone, top, bottoms, and hair, cap,
    locs, backpack or hood.
  - **Animation:** the walk cycle (legs and arms swinging, a bob on each step) runs in the vertex
    shader, with no skeletons. Colours come from palette indices, keeping the draw within WebGL's
    16-attribute limit.
  - **Density:** the whole route is populated from the start, one person per ~5 m of sidewalk
    (6.5 m on phones).
  - **Groups:** they walk in groups of 1–3, talk in circles, wait at bus shelters, and hang out at
    the corner store. Some check their phones.
  - **Sidewalk band:** they keep between the curb or roadway and the building line, step round
    trees, lamps, benches and shelters (single file if they must), and keep right for oncoming groups.
  - **Reactions:** they flinch back and put their hands up when you run close to their curb or honk.
  - **Cost:** only people near the car or on camera are simulated. Only those the camera can see
    are drawn, with a margin that grows with distance, so nobody ever pops in. Phones skip crowd
    shadows.
- **Pickups:** EBT tokens in lines and weaves (+25). A NEAR MISS against oncoming traffic is +50.
- **Density:** an in-lane event every 75–110 m, tightening slightly as the run goes on.
- **Traffic flow:** oncoming traffic is a steady stream of singles and 2–3 car platoons.
  - It fills the far lane from the start and is fed from past the store.
  - Oncoming cars stop for anything in their lane, squeeze past a player over the line, and wave
    you through once you've stopped behind a blockage.
  - Slow cars follow, overtake parked cars and work zones when the other lane is clear, check
    their mirrors, and never rear-end the player.
  - Cross traffic never stops inside the route's road.
  - With this traffic a clean run spends ~10 s waiting, hence the 70 s clock.
- **Finish:** the car slows for the store by itself. Pull right to the curb into the P space.
  bonus = timeLeft × 50 + tokens × 25 + nearMisses × 50 + 500 (clean park) + 300 (no hits).
- **Balance:** the QA bot parks clean with about 14 s left.

## Controls (mobile-first: the game is played on phones)

You drive it (GTA Chinatown Wars layout): steer bottom left, pedals bottom right, all held buttons.

| Phone | Keyboard | Action |
| --- | --- | --- |
| **◀ / ▶** | ← / → or A / D | Steer across the road while held (brisker the faster you go), a haptic tick per lane line |
| **GAS** | ↑ / W | Accelerate (to 67 mph; corners cap it). Off the gas the car coasts down |
| **BRAKE** | ↓ / S | Progressive brake; keep holding at a standstill to **reverse** (to 11 mph) |
| **HORN** | Space / H | Anyone on foot in your path up ahead hops clear, dogs bolt, the crowd flinches |
| SKIP | | Skip the drive |

## Sound

The engine uses real V8 recordings (on-throttle and off-throttle loops), pitched by rpm and
crossfaded by throttle, over a 5-speed auto box with audible shifts. The tire squeal, screech,
horn, token clink and crash (sheet metal, plus glass on big hits, over a low thump) are recordings
too. Sources and licenses are in `public/drive/sfx/CREDITS.txt`. The V8 is CC BY-SA 4.0
(DerMeehdrescher / Meehdrescher Studios) and **needs a credit in the game's credits**; the rest is CC0.
`drive/tools/build_sfx.py` cuts, normalizes and makes the loops seamless (349 KB total).

**Look:** a custom tone map (Khronos Neutral shoulder, then +40 % saturation and a touch of contrast) instead of
AgX's desaturated film grade, for GTA Chinatown Wars-style colour at no extra render cost.

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

## World integrity (nothing sinks, floats or pokes through)

Everything that can stand on something follows one set of rules:

- **One height function.** `makeGround()` (city.js) resamples the DEM onto an 8 m grid, and
  `ground(x, y)` interpolates it with exactly the triangles the terrain mesh is built from. A thing placed at
  `ground()` is on the rendered terrain.
- **One height stack** (`levels.js`): terrain −0.05, lawns/lots +0.02, streets +0.14 (+ class bias), the
  route road +0.17, curb tops +0.29.
- **Roads are draped per vertex** (columns ≤1.5 m, rows 1–4 m, denser where the terrain bends). A final
  pass raises any road triangle whose centre or edge midpoint would dip under the terrain.
- **Sharp corners are split into separate pieces** with a pavement pad at the elbow, so ribbons never
  fold over themselves. Every junction is filled with a draped pad.
- **Freeway:** deck heights are propagated from OSM bridge spans at a 5 % grade and capped at 6 % from any
  point where a ramp meets a street, so ramps land at street level. `deckTop()` puts high decks on a
  shared, blurred grade surface (overlapping decks line up) and blends low ramp ends down onto the ground.
  Where a ramp merges under another deck by less than 2 m, it is lifted onto it to form one surface.
- **Vehicles read the real triangles.** `surface.js` bins every drivable triangle into a grid, and the
  player car, obstacles and all traffic sample the actual rendered road/deck under their four wheels
  (`standOn`: height, pitch and roll, settled so no wheel is below the surface). Cones and barricades
  stand on the rendered road too.
- **Traffic stays on its road:** each vehicle gets a lane offset that keeps its whole body on the road
  (ramps get extra edge clearance, and buses stay on city streets). Cross traffic waits behind a stop
  line that scales with vehicle length, is solid if it's in your road, and never uses the route's own
  street.

**Scanner:** open `/drive/index.html?qa`, then run
`(await import('./integrity.js')).scanWorld(__drive)`. It checks:

| Check | Last result |
|---|---|
| Route and street surfaces are the top surface, never terrain or lawns | 66,771/66,771 |
| Every vehicle's wheels are within 10 cm of the surface (buses may hang up to 20 cm on a crest) | 2,325/2,325 over 32 checkpoints |
| Cones, barricades and panhandlers stand on the road | included in the wheel count |
| Every lane a vehicle can be given keeps all wheels on its road or deck | 2,620/2,620 |
| Street props stand on the ground | 2,246/2,246 |

Run it after any change to world building.

## City life

Everything is modelled in `blender_props.py` (no logos, lettering or insignia on any of it); look-dev render:
`blender_render_citylife.py`.

- **Traffic mix:** about 1 in 10 cars is a white driverless robotaxi (roof lidar dome, fender and corner sensor
  pods) and 1 in 20 is a black-and-white police cruiser (light bar, push bar). Both drive, park and queue like any
  other car, and you can hit them like any other car.
- **BUSTED:** drive into a police car (above a crawl; a scrape while you're stopped is just a crash) and the run
  ends. The cruiser lights up, backup pulls in behind you with its siren going, an officer walks to your window,
  and the card reads "BUSTED: you're going to jail". *Drive again* restarts the drive (the full game never drops
  you into the store after a bust). The result has `busted: true`.
- **Stray dogs** amble along the sidewalks with sniffing stops. Now and then one trots across the street in front
  of you, 2.3–3.6 s ahead and only when it's on screen and no traffic is about to reach that spot, so it's always
  a fair dodge. Hit one and it bolts clear: a scare ("WATCH IT!"), never an injury.
- **Water sellers and panhandlers work the red lights** (`planCorners`). At about 85 % of signalised junctions,
  one or two kids selling cold water (cooler on the corner) or a panhandler with a sign waits on the corner. A
  beat after red they cross at the crosswalk in front of the stopped cars and walk down the lane line, up to your
  window if you're stopped nearby. After green they linger, head back up the line and cross to the corner once
  there's a gap, right across anyone pulling off. Traffic stops for them; you have to as well.
- **Birds** (`birds.js`), pure scenery that casts shadows:
  - Rock pigeons, American crows and grackles peck about in the gutter along the curb, in gaps between parked cars
    and clear of tree canopies. They burst up and away down the street as you drive up, or when you honk.
  - Flocks also cross the street overhead, just over the roofs on their path (raycast against roofs, freeway decks
    and landmarks).
  - Birds are drawn a little over life size so they read from the chase camera.

## Trees and lawns (beauty pass)

Built the way game foliage is built, from CC0 Poly Haven scans (`drive/tools/fetch_foliage.mjs` downloads them
into `drive/art/foliage/`; photo-scanned tree models run 0.3–17 M triangles, far too heavy for phones):

- **Leaf clusters** (`make_leaf_atlas.py` → `tex/leaves.webp`): 4 twig tiles composed from the `island_tree_02`
  leaf scans. Every leaf's stem base sits on a node of its twig and the blade points away from it (alternate
  leaves, leaning toward the tip, with a terminal leaf); leaves are never scattered loose.
- **Trees** (`blender_trees.py` → `trees.glb`): a bark trunk with branches plus a canopy of leaf-cluster cards on
  the crown's shell. `tree_round` (110 cards) and `tree_upright` (72 cards), about 0.6–1k triangles each. Vertex
  colour R is height in the canopy and drives the wind sway (`WIND`, advanced in drive.js). Instanced in 150 m tiles
  so the camera and shadow pass skip the tiles they can't see.
- **Lawns:** the `leafy_grass` photo plus its normal map, graded to a late-summer green in the shader, with
  world-space noise for lusher and drier patches, so it never looks tiled. Cover is draped adaptively: triangles
  split where the terrain bends under them, so the cover never dips below the ground.
- **Grass tufts** (`make_grass_atlas.py` → `tex/grass_tuft.webp`): strips of `grass_bermuda_01` plants on crossed
  cards, only on lawns within 55 m of the drive (about 3.7k on desktop, capped at 16k on phones). They sway
  and sink into the lawn from 40–55 m out, so nothing pops.

## Runtime (public/drive/)

| File | Role |
| --- | --- |
| `drive.js` | `startDrive({ mount, onDone })`: loader, scene, loop, HUD, parking, arrival, QA hooks (`window.__drive`) |
| `city.js` | the height function, the OSM buildings (procedural facades, roofs, rooftop units), and orchestration |
| `roads.js` | street and route surfaces (markings in the shader), junction and corner pads, curbs, crosswalks, and the freeway (deck, barriers, soffit, pier bents, overpass cutaway) |
| `landscape.js` | terrain mesh, parks/lawns/lots, grass tufts, contact shadows, streetscape (trees, lamps, signal masts, benches, bins, hydrants, shelters) |
| `levels.js`, `surface.js` | the height stack, `standOn`, `deckTop`, and triangle height queries |
| `sky.js` | sky dome and generated environment lighting |
| `crowd.js` | procedural sidewalk crowd: parametric person, GPU walk cycle, group behaviour |
| `signals.js` | the route's traffic signals: green-wave timing, stop lines, lamp overlays, cross-traffic gates, HUD light |
| `birds.js` | pigeons, crows and grackles: pecking flocks that take off as you pass, flocks crossing over the roofs |
| `tram.js` | Atlanta Streetcar: embedded rails from OSM, the westbound car on its real track, platform dwells, bell |
| `integrity.js`, `autopilot.js` | QA only: world scanner; player-like autopilot with hit and pop-in audits |
| `runner.js` | route space (RouteFrame), the auto-driving car, obstacle/scenery/traffic population, collisions, instanced rendering |
| `audio.js`, `sfx/` | recorded engine and effects mix |
| `props.glb` | traffic, bus, panhandler, cyclist, cones, barricade, sign (vertex colour; white = per-instance tint) |
| `weather.js` | live Atlanta weather → sky, sun, shadows, haze, wet roads |
| `hero.glb`, `car.glb` | Blender exports (meshopt + WebP). The player car is the user-supplied "Crimson Demon X" model (`drive/ref/car/`, dimensioned to the production Challenger SRT Demon, no badges); `drive/tools/blender_car.py` turns it nose-forward, puts the origin on the rear axle, decimates 78k to 36.5k tris and keeps the `*_STEER` / `*_SPIN` wheel pivots the runtime rolls and steers |
| `vendor/` | three.js r186 (MIT), imports rewritten to relative paths so no import map is needed |

**Game hook:** in `standalone/csd.js`, START RUN calls `startWithDrive()`. That
dynamic-imports `./drive/drive.js`, runs the drive, then `startRun()` and adds the bonus.
"Run it back" skips the drive. If it's offline, opened from disk, or `?nodrive` is set, the run starts
directly, so the single-file build stays drive-free. The drive's code is prefetched while the title
screen is up.

**QA:** `/drive/index.html` is a standalone harness. Add `?qa` to either page to drive the loop from a
timer, since hidden tabs pause `requestAnimationFrame`.

**Autopilot:** `/drive/index.html?qa&bot` plays the run like a player (`autopilot.js`, never loaded by the
game). It drags into the clearest gap within 3 s of road, brakes when every gap is closing, honks at
panhandlers and pulls to the curb for the park. It runs muted; add `&sound` to hear it. The report is in
`__botReport` and on the finish screen. It lists every hit, plus pop-in, pop-out and teleport audits
(anything appearing, vanishing or jumping while on camera), stalls, off-road moments and script errors.
A healthy run parks clean with 0 hits and 0 pops.

**Spawning rule:** nothing appears or disappears on screen (`World.visible` tests the camera frustum).
- **Cross traffic** starts at an off-screen point of its street, at least 18 m from the route. OSM splits
  ways at junctions, so a way's first point is often inside our road.
- **At the end of its way** it continues onto the connecting way, preferring the same street name, and
  never onto the route's own street or off a deck.
- **Oncoming cars** spawn beyond the edge of the screen.
- **Pedestrians** re-enter off-screen.
- **Despawns** happen only out of view.

Current download: about 3.7 MB of drive files (assets and code; the player car is 0.78 MB) plus about
0.9 MB of three.js (≈0.25 MB gzipped). That is over the 3 MB first-chunk target but well within the 8 MB
budget.

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
