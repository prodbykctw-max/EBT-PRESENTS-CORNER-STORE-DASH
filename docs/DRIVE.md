# Drive level: "Get to the Store"

A 70-second drive through real downtown Atlanta, seen from behind the car (rear third-person), where
◀ ▶ move the whole car one lane at a time. It ends at the EBT Corner Store and hands straight off to the
store level. It lives in
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

You drive it: GAS and BRAKE set your speed, and ◀ ▶ move the whole car one lane to get around what's in
your way (see Controls). Everything runs in route space (s = metres along the route, d = metres across it), so lanes,
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
- **Work zones** run alternating one-lane traffic (see "The work-zone flagger" below): one direction goes at a time, the
  other waits at its end of the cones, and the turn changes when the cars on the road have cleared.
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
- **Traffic flow:** every car in the street (ours, oncoming and parked cars pulling out) is driven by `traffic.js`, see
  "Traffic: how the cars drive" below. Oncoming traffic is still a steady stream of singles and 2-3 car platoons that
  fills the far lane from the start and is fed from past the store; it never has to appear on screen.
  - Nothing sits in the street for no reason: a car is only stopped by a red light, the car in front, a work-zone
    flagger, a streetcar, a person in its lane or a police stop, and all of those clear.
  - Cross traffic never stops inside the route's road.
- **Finish:** the car slows for the store by itself. Pull right to the curb into the P space.
  bonus = timeLeft × 50 + tokens × 25 + nearMisses × 50 + 500 (clean park) + 300 (no hits).
- **Balance:** the QA bot parks clean with about 14 s left.

## Traffic: how the cars drive (`traffic.js`)

All of this is plain logic (no three.js) in `public/drive/traffic.js`; `runner.js` owns the cars (spawning, drawing, the
cross streets) and calls `traffic.step()` every frame. Cars used to be steered by a few special cases in `runner.js`
(oncoming cars stopped for anything in their lane, "slow" cars ran at 9-13 m/s, and a car stopped for any reason stayed stopped).

- **Speed.** The street limit is taken to be **25 mph (11.2 m/s)**: OpenStreetMap has no `maxspeed` for this route, so this
  is an assumption, not data. Each driver wants the limit plus 5 to 30 % (about 11.8 to 14.6 m/s; robotaxis 8 %, police 22 %), less in bends
  (`curveV`) and in work zones (8 m/s); cars that are free actually average about 12.3 m/s. Before, traffic wanted 9 to 13 m/s and spent
  most of its time stopped.
- **Following (IDM).** Each car follows the one in front with the Intelligent Driver Model (`idmAccel`): a time gap of 1.0 to 1.5 s, comfortable braking, a hard-braking limit when something appears close. Starts and stops are smooth (no jerk, no
  wobble); lateral moves use a Hermite curve that starts and ends with zero sideways speed.
- **Lane changes (MOBIL-style).** A car passes only when the thing ahead is really in the way (a parked car in the lane, a cone,
  a stalled car, something much slower), never a queue that is just waiting its turn, and only when the other lane is clear
  for the whole pass (`laneClear`, projecting moving cars forward) and the car can get back. It returns to its lane once clear.
  Cars also keep a personal offset in their lane (`pers`) and lean away from people close to their side (`room`).
- **Giving way to you (`giveWay`).** A car ahead of you that you are closing on, in the lane you are in, looks at your closing speed
  and distance and moves into the parking lane when there is room all along it (and it is a lane next to its own), or
  brakes early. A horn tap makes it clear out faster. Oncoming cars that see you in their lane brake or swerve early. Nobody pulls
  out in front of you (`maybePullOut` checks your speed and where you will be).
- **Runner on foot.** Cars see the runner (and the bully) as a person in the street: they brake hard with a horn (and a skid
  when they have to stand on it), or swerve. A car that physically cannot stop in time gives a soft bump (below); it is never game
  over.
- **Red lights, cross traffic, trams.** Unchanged in what they do; cars now queue behind each other properly, the streetcar stops
  for the runner and the bully on its track and rings, curb-parked cars on its track are removed when the level is set up, and
  cross-street cars waiting at a dead end that nobody can see for 15 s are removed.
- **The work-zone flagger** (`zoneTurns`): each work zone has a turn: ours goes, then ours stops while the cars in the zone clear,
  then oncoming goes, then oncoming stops while theirs clear. A turn lasts at least 8 s and at most 20 s (a platoon that is
  arriving extends it), and you waiting in the right lane at the cones counts as a car waiting. Held cars stop at hold lines 6 m
  outside the cones.
- **Gridlock safety.** If two cars end up nose to nose (a pass that met the other direction), the one in the wrong lane backs
  into its own lane when it is free; after 7 s both are allowed to drive through each other so nothing sits there for the run
  (counted in `traffic.stats.standoffs`, rare).
- **Diagnostics.** Every car records why it is slow (`whyK`: `light`, `zone`, `parked`, the type of the car in front, `free`)
  and what is limiting it (`whyO`); `traffic.stats` counts passes, lane changes, evacuations, honks and runner brakes.

**Measured** (headless browser, the real game, `?qa&bot` autopilot and a kinematic "ghost" player; a car counts as stuck when it is under
0.5 m/s for more than 3 s; "no reason" means not a red light, work zone, streetcar, queue behind a stop, police stop or a person in the lane):

| | before | after |
| --- | --- | --- |
| Ghost player at 13 m/s down the whole street, 6 runs each: cars stuck for no reason, per run | 7.3 (5.7 of them for over 20 s; in the one `?qa&bot` run 6 cars sat in the lane for the whole run) | 2.0 (none over 20 s) |
| Bot runs: cars stuck for no reason in the playable street (not counting side-street cars waiting 12 to 22 s at a stop line) | not comparable: 6 cars sat in the lane for the whole run | about 1 per run, none over 5 s on the route |
| Same, player at 6 m/s (4 runs) | not run | 3.3, none over 20 s (the rest are side-street cars at a dead end that give up after 15 s) |
| Forward traffic stopped (share of samples) | 47 % (85 % in the one bot run) | 16 to 32 % (red lights and queues) |
| Forward traffic, average speed while moving | 6.5 m/s (11.8 in the bot run) | 8.9 to 9.1 m/s |
| What the drivers want (limit assumed 25 mph = 11.2 m/s) | 9 to 13 m/s (mean 11) | 11.8 to 14.6 m/s (mean 12.7), free cars measured at about 12.3 |
| `?qa&bot` runs that reach the store | 1 of 1 valid run, 77 s, 14.2 m/s | 14 of 14 (two batches, 8 and 6), 40 to 59 s, 18.7 to 27.3 m/s (the bot drives at up to 30 m/s) |
| Collisions between two traffic cars | 1.2 per ghost run | 0.17 per ghost run (1 in 6) and 5 in the 14 bot runs |
| Hits on the player in the bot runs | 1 (1 run) | 89 in 14 runs (6.4 per run): 86 the bot's own doing (ran into the back of a car it was closing on at 20 m/s or more, or clipped cones), 3 where a car moved sideways into it |

Oncoming traffic that is moving averages 8.6 m/s, lower than before (10 m/s), because it now queues at red lights and behind the streetcar
instead of driving through them; the share of oncoming samples that are stopped is 15 %, down from 27 to 30 %.

Sizes: a sedan is 4.5 x 1.8 m, an SUV 4.75 x 1.95 m, the bus 12 x 2.55 m and the streetcar 24.8 x 2.65 m; the travel lanes are
3.45 to 4.89 m wide (median 3.96 m), so the cars are not too big for the road; a lane is about twice a car's width, which is
standard. Nothing about the car models, sizes or looks was changed.

## The chase (Kema's opening): on foot to your car, then race the bully to the store

The drive opens on foot (`state === 'onfoot'`, `updateFoot` in `drive.js`; tuning in `FOOT` / `RACE` at the top):

- **On foot.** You start on the right sidewalk of Luckie St (s = 14 m) with the bully 8 m behind you. Your car is parked
  at the right curb up the block with its **hazards flashing** and a yellow ▼ over it, in the first stretch of parking
  lane where it sits level (Luckie St is steep: on its cross-slope a car rolls ~10°, so the spot is picked by measuring
  the car's roll and pitch with `standOn`). Hold RUN (the GAS pedal, labelled RUN while you are on foot) to run (5.6 m/s), BRAKE to back up, ◀ ▶ to step left or right
  anywhere across the sidewalk (see "Where you run" below). Run into someone from the crowd and you stumble ("WATCH IT!"); the bully
  shoves through people. He runs 5.3 m/s, so a clean run gets away and a sloppy one gets caught: a catch is a **shove**
  ("SHOVED!", 0.9 s down), never the end. Near the car you cut over to the driver's door yourself and jump in: "GO! GO!
  GO!", no 3-2-1, and the car swings straight into the travel lane. The drive's clock only runs once you're driving.
- **The street is yours too** (`streetPath`, `streetEvents`, `runnerShove` in `drive.js`). ◀ ▶ now take you off the curb and
  across the whole street to the far curb (`PATH.far`; before, ◀ stopped at the centre line of the sidewalk). Parked cars, moving cars,
  the streetcar, cones and barricades are solid: each is checked where it will be over the next 1.8 s as well as where it is, and your
  line is moved to the nearest free side, preferring the side you are already leaning to; with no gap at all you stop and wait
  (`me.blocked`) instead of running into it. The bully follows you into the street. The traffic keeps running while you are on foot and
  reacts to you (honks, skids). If a car really cannot stop you get a **soft bump**: you stagger to the side out of its way, lose
  speed for 0.55 s, "WATCH IT!" and the crash sound, at most once every 1.2 s, never game over. The camera follows a sidestep gently
  (`camD`) and keeps you framed anywhere in the street. Standing still next to a parked car, ◀ does nothing until a gap
  in the parked cars lines up, since the car is solid; running, you slip through the gaps.
- **How you move on foot** (`updateFoot`, `posePerson`, the `PATH` block in `drive.js`). You and the bully move in the
  same fixed 1/120 s steps as the car and are drawn between the last two steps, so a phone's uneven frames (8 to 33 ms)
  don't make the run stutter. GAS gets you to full speed in about 0.35 s and letting go stops you in about 0.27 s
  (0.45 m), easing in and out instead of a flat ramp and a dead stop. ◀ ▶ is a smooth sidestep (a stiff spring, 90 % of
  the way in 0.35 s, at most 5 m/s sideways); you turn a little toward where you're going and lean into it, so it reads
  as a cut, not a slide. The camera follows on a critically damped spring (no overshoot, the same at any frame rate)
  and follows a sidestep more gently than you make it.
  - **Where you run** is your choice: ◀ ▶ step you left or right (a tap is a 0.9 m step; holding keeps you moving
    at 2.6 m/s after 0.2 s) anywhere from just inside the curb (`PATH.left`: where the street's road surface ends,
    plus 0.57 m for your body) to 0.72 m off the buildings (`PATH.outer`), and you stay where you let go. Street
    furniture is solid: you slip round a trunk or pole on the side you're already on (`avoidProps`). Before
    (Oct 27 2026) there were only the two fixed lines below, both at least 1.35 m in from the curb, and you started on
    the left one, so ◀ did nothing and you couldn't get out to the left round people; on the narrow stretch at
    s 44-56 the two lines were 4 cm apart, right by the wall. The lines below are now only the bully's and the
    autopilot's.
  - **The two lines on the sidewalk** are built once from the street: the curb side of the sidewalk, the building
    line from the real building footprints (every 0.5 m along, 5 cm across), and the street furniture at body height
    (tree trunks 0.24 m, poles ~0.2 m, benches, bins, hydrants). Your body (with the bully's arms swinging: 0.42 m each
    side) keeps 0.3 m off the walls, the line never bends more than 0.35 m across per metre along, it moves in before a
    building corner and eases out after one, and it steps round trunks and poles in good time. The curb-side line sits
    at 0.12 of the room, the building-side line at 0.62 (0.9 hugged the facade). The first version read the crowd's
    2 m-step sidewalk band: your line twitched sideways every 2 m, it ran through three street trees, and at the corner
    of the building at s ~55 m the band jumped out before the corner had passed. The bully runs his own line at his own
    spot on the street (he used to copy your sideways position, which a few metres back was inside that building: 35
    frames, 0.26 m deep) and only closes onto you in the last few metres. Near the car you run up its driver's side
    1.6 m off its centre line (it's 1.08 m to its mirrors; at 1.15 m your shoulder ran 0.35 m into the car).
  - **The animation** blends a standing pose, the walk and the run by speed on one clock that moves with the ground
    you cover, measured off each clip as the speed a planted foot sweeps backwards (the run 1.44 m per clip second).
    The first version took one foot sweep as the whole clip, but the clip holds two strides: the legs ran at twice the
    speed you moved (12.6 steps a second at full speed, now 6.6) and the feet skated. Stopping now settles into the
    standing pose (`makeStandClip`: every joint at its average over the walk) instead of freezing mid-stride, and
    backing up plays the run backwards. `makeRunClip` meant to make the hips bob more but scaled the forward/back
    component (the rig is Z-up under a Root bone): the hips surged 0.2 m back and forth every stride; it now scales
    the height.
  - **Height** follows the ground under you and a step ahead on a short spring, so a 0.32 m curb (s ~76 m) is a step,
    not a one-frame pop of you and the camera.
  - **Bumps and the shove read as a stagger**: run into someone and you check to 45 % speed, rock back and sway, and
    they're knocked aside (`knock`, `shove` in `crowd.js`, eased back over ~2 s) instead of you running on through
    them. Shoved, you lurch forward, pitch over and recover over the 0.9 s; he eases to your pace as he closes instead
    of stopping dead from 5.3 m/s, and stops to gloat. The on-foot camera jolt is two quick smooth wobbles, not a new
    random 0.4 m jump every frame. Each runner has a soft shadow on the ground under them (their sun shadow is a couple
    of texels on a phone): without it, from up here, the facade 6 to 10 m further down the hill sat right beside you
    on screen and you looked pressed into the wall.
- **The on-foot camera** sits 10 m behind you, 6 m up and 0.6 m to the street side, looking 7 m ahead. The first
  version (6 m back, 3 m up, 1.6 m to the street side) had a signal pole beside the camera that hid you completely at
  the start, and once the bully was close he stood between you and the camera; from up here you, him and the sidewalk
  ahead stay in frame (checked at s = 14 to 84 m in the running game). Up there it rides through the street trees'
  canopies, so while you're on foot trees within 8 m of the camera aren't drawn (`NEAR_CUT` in `landscape.js`, a clean
  cut: a dithered fade turned into black speckle under the ink outlines). The driving camera keeps every tree.
- **Taunts** ("HEY! YOU!", ...) pop every 2.6 s while he's within 9 m, but not while you're down from a shove, not
  within a second of a "WATCH IT!", and any still floating are cleared when you get in, so they never pile onto the
  other messages.
- **The people** are the store's own character in 3D (`people.js`, `character.glb`: the rigged Tripo model from the
  commercial's Blender scene, decimated to 16k triangles, exported by `drive/tools/export_character.py`), with its walk
  and a run built from it at load time (`makeRunClip`), plus a standing pose (`makeStandClip`); see "How you move on
  foot" above for how they're played. The bully is the same model recoloured in the shader exactly as the
  store's sprite sheet is (white tee -> red, denim -> charcoal, red kicks -> black) and drawn taller.
- **The race.** When you get in he runs for his own ride (1.6 s), then comes after you at 17 m/s, shown only on the bar
  at the top (`.drive-race`: your head, his head, the STORE flag; `heads.png`). If he gets within 4.5 m he's **on your
  tail** ("HE CAUGHT UP!") and can't get past you; open a 60 m gap and you **shook him**.
- **What it decides.** `result.bully = { lead, caughtUp }`: your lead in seconds when you park (capped at 30). In the
  store (`csd.js`, `startStoreRun` / `bullyEnters`) he walks in through the door that many seconds into the run (at
  least 2 s; a "HE'S COMING" pill counts it down), or 1.4 s in, with a burst, if he caught up. Skip the drive and the
  store plays as before (he starts somewhere in the store and your first pickup sets him off).
- **QA:** `?qa&skipfoot` starts in the car with the old 3-2-1; `?qa&bot` runs to the car on its own, then the autopilot
  drives. Hooks: `__drive.foot` (`me`, `him`, `homeS`, `doorS`, `path` (`line(s, lane)`, `inner`, `outer`, `wall`),
  `lane`, ...), `__drive.race`. `__drive.manual = true` stops the live loop and `__drive.tick(dt)` runs one frame at
  exactly that dt without drawing, so a test can replay a phone's uneven frame times and measure every frame.

## Controls (mobile-first: the game is played on phones)

You drive it: lane buttons bottom left, pedals bottom right, all held buttons. **Stiff lane steering:** each press
of ◀ or ▶ moves the whole car exactly one lane, and holding does nothing more. The car never turns: its nose stays on
the road's heading, the front wheels stay straight and the body doesn't lean; it slides across as one block. There
are up to four lanes, right to left: your parking lane, your lane, the oncoming lane, the far parking lane. Parking
lanes only exist where the street is wide enough, so ◀ ▶ skip one that isn't there, and if the one you're in runs
out the car moves onto the road beside it. The car stays centred in its lane as the street widens and narrows.
A press acts the moment it happens (`tapLane`, from the touch or key event itself, so even a lightning tap between two
frames counts), and the car is half way into the next lane in about 60 ms and fully in it in about 0.2 s, at any speed:
a stiff critically damped spring (w = 28) with no side-speed cap. The car is drawn between the 120 Hz physics steps,
so the move stays smooth whatever the screen's frame rate.
The camera sits behind the car (rear third-person chase view): about 8 m behind and 3 m up at a standstill, easing back
and up with speed, aimed ahead of the car so the car sits in the lower part of the screen with the street ahead in
view. It follows each lane change.

(Code: `drive.js` laneAt / laneShift / followLane and the camera rig; `runner.js` Car.step's lateral path.)

| Phone | Keyboard | Action |
| --- | --- | --- |
| **◀ / ▶** | ← / → or A / D | Move the whole car one lane per press (holding does nothing more); a haptic tick per lane crossed |
| **GAS** | ↑ / W | Accelerate (to 67 mph; corners cap it). Off the gas the car coasts down |
| **BRAKE** | ↓ / S | Progressive brake; keep holding for half a second at a standstill to **reverse** (to 11 mph) |
| **HORN** | Space / H | Anyone on foot in your path up ahead hops clear, dogs bolt, the crowd flinches |
| SKIP | | Skip the drive |

## Sound

The engine uses real V8 recordings (on-throttle and off-throttle loops), pitched by rpm and
crossfaded by throttle, over an 8-speed automatic with audible shifts. It plays at 37% of its original level
(`ENGINE_LEVEL` in `audio.js`: 63% quieter, measured at the speakers). The tire squeal, screech,
horn, token clink and crash (sheet metal, plus glass on big hits, over a low thump) are recordings
too. Sources and licenses are in `public/drive/sfx/CREDITS.txt`. The V8 is CC BY-SA 4.0
(DerMeehdrescher / Meehdrescher Studios) and **needs a credit in the game's credits**; the rest is CC0.
`drive/tools/build_sfx.py` cuts, normalizes and makes the loops seamless (349 KB total).

**Look** (`look.js`, one full-screen pass): GTA Chinatown Wars comic style for the whole world.
- Ink outlines on silhouettes (depth jumps) and on creases (Laplacian of 1/depth: building corners, roof lines, car
  panels, curbs).
- Light cel banding and lifted, sunny light.
- A saturated custom tone map (Khronos Neutral shoulder, +40 % saturation, a touch of contrast) instead of AgX.
- A comic building palette: warm brick, pastel stucco, coloured offices, teal glass.

The camera's near plane is 2 m (it was 4 m for the overhead camera; the chase camera keeps 2.5 m of air under itself, and the road at the bottom of the screen then never comes nearer than 2.6 m, measured along the whole route).

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

## Frame rate: keeping the drive smooth on phones

The drive felt choppy because of two things: every frame drew far more than the screen could show, and every so
often one frame froze for a quarter of a second to three seconds. Neither changed how anything looks; the fixes below
were each checked by rendering the same moments of the same run (same random seed, same frames) before and after:
the pictures match pixel for pixel (see "Same picture" below).

**What a frame cost before** (measured in the game, phone portrait, 1.5× pixel ratio, driving on Luckie St):
about 3 million triangles and ~360 draw calls a frame, 610k of the triangles in the sun's shadow pass. Most of it
was out of sight: every road, curb and the whole terrain of downtown were one mesh each (so all of downtown was drawn
whatever you looked at), the lawns of every park a kilometre or two off were drawn triangle by triangle, and all
~100 parked and moving cars went through the shadow pass although only the ones near you can cast a shadow you see.

What changed (code, then what it does):

- **The city is drawn in tiles** (`city.js` `tileForCulling`/`splitMesh`). The big static meshes (roads, curbs,
  terrain, lawns and lots, the freeway, and anything else over 30k triangles) are also drawn as 300 m square tiles,
  so three.js skips every tile the camera, or the sun's shadow camera, can't see. The tiles share the original's
  vertex data (each tile is only its own list of triangles, in the original order), and the originals stay in the
  scene hidden, so raycasts and the QA scanner still find them by name. About 40% fewer triangles a frame.
- **Ground cover past the end of the fog is skipped** (`city.js` `cull`, called from `drive.js` just before each
  render). Lawns, lots, streets, curbs, crosswalks and contact shadows lie flat on the terrain, and past the fog's end
  three.js paints them in nothing but the fog colour, the same colour as the terrain under them, so they are left
  out there. The distance accounts for the fog being measured along the view direction (screen corners).
- **Grass tiles that have sunk flat are skipped** (`landscape.js` `buildGrass` → `userData.cull`): tufts sink into the
  lawn 40–55 m out, so a tile entirely past 55 m draws nothing; it is no longer sent to the GPU.
- **Only cars that can cast a shadow go through the shadow pass** (`runner.js` `World.render` + `shadowSplit`;
  `crowd.js` `render` on desktop, where the crowd casts shadows). Instances inside the sun's 220 m shadow box (+25 m
  to spare) are written first in each instanced buffer and the shadow pass draws just that run. Shadow-pass triangles
  roughly halve.
- **Bird flocks no longer freeze the game** (`city.js` `rayTargets`, used for `roofAt` in `drive.js`). Placing a
  flock fires ~13 straight-down rays per try to find the roof heights along its path, and each ray tested every roof
  in the city and the whole freeway (~100k triangles): 0.2–3 s frozen frames, several times a run. The same meshes are
  now cut into 32 m ray tiles, so a ray tests only what's under it; the heights found are the same.
- **Parked things aren't re-seated every frame** (`runner.js` `World.render`): seating a car or cone on the road reads
  the road triangles under its four corners. Things that haven't moved keep the answer (same inputs, same pose):
  ~300 road-height lookups a frame became ~80. The lookup itself (`surface.js` `TopSurface.top`) now skips
  triangles by their bounding box before the exact test (same answers).
- **Less sent to the GPU every frame**: instanced buffers upload only the instances drawn (`runner.js` `uploadUsed`;
  the crowd's buffers hold the whole route's ~500 people), the spark/debris effect skips its 600-particle sweep and
  upload when nothing is flying (`fx.js`), and the city's matrices are worked out once instead of every frame
  (`drive.js`, `matrixAutoUpdate = false` on the city and storefronts).
- **No canvas MSAA** (`drive.js` renderer `antialias: false`): the scene already renders with MSAA into the look pass's
  own target (`look.js`); the canvas only receives one full-screen quad, so its multisampling was pure cost.
- **No mid-drive shader builds or texture uploads** (`drive.js`, before the first frame): `compileAsync` builds every
  material's shader up front (the first EBT token, hazard ring, crash sparks and debris each used to build one the
  moment they first appeared), and every texture is sent to the GPU up front (the lawn photos used to upload when the
  first park came into view).
- **Steadier motion** (`drive.js` `frame`): the world steps by requestAnimationFrame's timestamp (the frame's own time)
  instead of whenever the callback happened to start, and the HUD only rewrites text that changed. The crowd's walk
  round street furniture looks only at the furniture near each group (`crowd.js`, binary search; same choices).
- **Adaptive resolution** (`drive.js` `adaptRes`): if frames run slower than 60 a second for 1.5 s, the pixel ratio
  steps down by 0.25 (never below 1 pixel per CSS pixel, so a 1:1 screen never changes), kept only if frames then get at least
  10% faster within 2 s, otherwise put back and left alone for 30 s (doubling each time: iOS Low Power Mode caps at
  30 fps whatever the resolution). It steps back up after a while of fast frames. A phone that keeps up never changes.
  Off with `?qa` or `?fixedres`. Test hook: `__drive.adaptRes`.

**Measured result** (phone portrait, 390x844, same seeded run before and after, in-car at points along the route; the
count is what the renderer reports for one whole frame, shadow pass included):

| Where on the route (s, metres) | Triangles before | after | Draw calls before | after |
| --- | --- | --- | --- | --- |
| On foot at the start (92) | 1.78 M | 1.03 M | 207 | 233 |
| 60 | 1.69 M | 0.93 M | 199 | 229 |
| 224 (busiest) | 2.94 M | 1.85 M | 326 | 371 |
| 449 | 2.75 M | 1.89 M | 300 | 338 |
| 673 | 2.40 M | 1.52 M | 260 | 292 |
| 898 | 2.06 M | 1.02 M | 219 | 249 |
| 1088 (at the store) | 1.91 M | 0.78 M | 214 | 237 |

Triangles fall by 35-60% (the GPU's work, which is what makes a phone choppy). Draw calls go UP by about 12-15%: a big
mesh drawn as tiles is a few draw calls instead of one. That is a deliberate trade (a draw call costs the phone's CPU a
few microseconds; a million triangles costs its GPU milliseconds); the render-submission time on the CPU measured the
same to about 1 ms higher in the middle of the route. Shader programs: 46 at the start of the drive growing to 51 as
things first appeared (five builds mid-drive) before; 48 built up front and one more later (a shadow-depth variant that
first appears near the store, which `compileAsync` doesn't cover) now. The longest single-frame freeze in a full
run of the game's code (rendering skipped, so this is JS only) fell from 1,150 ms (a bird flock being placed) to
about 90 ms, and the bird-flock cost from 0.69 ms a frame on average to 0.11 ms. A full QA-bot run
(`?qa&bot`) arrives, parks cleanly and scores the same before and after (`__drive.result` identical).

**Same picture:** the same moments of the same run (frames 60, 400, 1200, 1500, 1900, 2400, 3000, 3600: on foot, driving, parked)
rendered before and after are identical pixel for pixel; the largest difference anywhere is one shade of one colour
channel on 1 to 2 pixels out of 740,610 in two of the frames.

Still over the 500k-triangle budget above on the busiest stretches (~1–1.9M on a phone): the lawns' terrain-following
subdivision (every lawn triangle ≤ 4 m, ~500k triangles of park within the fog), parked cars (~2,700 triangles each,
~75 in view), trees and the crowd. Cutting those further means level-of-detail models, which change how distant things
look; not done.

**How to measure:** a seeded, virtual-clock run of the drive (`?qa&bot`, Math.random and every timer replaced so each run is
the same frame for frame), `renderer.info` read right after the main render for triangles and draw calls, and snapshots
of the same frames compared pixel by pixel. Software WebGL (SwiftShader, as in a cloud session) can't say what a phone's
GPU does, so the counts and the JS time are the evidence; a real-phone frame time was not measured.

## Hero storefronts

The facade art comes from the intro video's designs, repainted as straight-on elevation textures
(Higgsfield `gpt_image_2`, with intro frames as reference). They are stored in `drive/art/facades/`
as 2048 px JPGs. Each shop is a real box: CC0 brick sides (Poly Haven, `fetch_pbr.mjs`), a roof with a
parapet cap and rooftop units (the original overhead camera mostly saw roofs), and a modeled awning and sign
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
| `roads.js` | street and route surfaces (markings in the shader), junction and corner pads, curbs, crosswalks, and the freeway (deck, barriers, soffit, pier bents, overpass cutaway, which still matters from behind: the Connector's deck underside is only ~2.1 m above the route near s=1056 m, so the chase camera passes through the slab and the hole keeps the deck from walling off the view; drive.js starts the cut 1.45 m above the car, just above its roof, instead of the shader's 2.2 m, because at the bottom of the deck's dip the underside is only 1.8 m above the car, and widens the circle from 11 m to reach 3 m past the camera when it trails further back at speed, capped at 25 m) |
| `landscape.js` | terrain mesh, parks/lawns/lots, grass tufts, contact shadows, streetscape (trees, lamps, signal masts, benches, bins, hydrants, shelters) |
| `levels.js`, `surface.js` | the height stack, `standOn`, `deckTop`, and triangle height queries |
| `sky.js` | sky dome and generated environment lighting |
| `crowd.js` | procedural sidewalk crowd: parametric person, GPU walk cycle, group behaviour |
| `signals.js` | the route's traffic signals: green-wave timing, stop lines, lamp overlays, cross-traffic gates, HUD light |
| `birds.js` | pigeons, crows and grackles: pecking flocks that take off as you pass, flocks crossing over the roofs |
| `tram.js` | Atlanta Streetcar: embedded rails from OSM, the westbound car on its real track, platform dwells, bell |
| `integrity.js`, `autopilot.js` | QA only: world scanner; player-like autopilot with hit and pop-in audits |
| `runner.js` | route space (RouteFrame), the auto-driving car, obstacle/scenery/traffic population, collisions, instanced rendering |
| `traffic.js` | how every car drives: IDM car-following, lane changes, giving way to the player and the runner, the work-zone flagger (pure logic, no three.js) |
| `audio.js`, `sfx/` | recorded engine and effects mix |
| `props.glb` | traffic, bus, panhandler, cyclist, cones, barricade, sign (vertex colour; white = per-instance tint) |
| `weather.js` | live Atlanta weather → sky, sun, shadows, haze, wet roads |
| `hero.glb`, `car.glb` | Blender exports (meshopt + WebP). The player car is the user-supplied "Crimson Demon X" model (`drive/ref/car/`, dimensioned to the production Challenger SRT Demon, no badges); `drive/tools/blender_car.py` turns it nose-forward, puts the origin on the rear axle, decimates 78k to 36.5k tris and keeps the `*_STEER` / `*_SPIN` wheel pivots; the runtime rolls the wheels and holds the steer pivots straight (lane changes slide the whole car) |
| `vendor/` | three.js r186.1 (MIT), imports rewritten to relative paths so no import map is needed; meshopt decoder 1.3.0 (MIT); GSAP 3.15.0 (GreenSock standard no-charge license) for the HUD's motion |

**Game hook:** in `standalone/csd.js`, TAP TO START shows the drive's how-to-play (`ovDriveHow`, a plain
black screen). START DRIVE calls `startWithDrive()`, which dynamic-imports `./drive/drive.js` and runs the drive.
When it ends, `showStoreHow()` shows the store's how-to-play (`ovHow`, also plain black), and START RUN calls
`startStoreRun()`: `startRun()`, then the drive bonus. "Run it back" skips the drive and both how-to-plays. If it's
offline, opened from disk, or `?nodrive` is set, TAP TO START goes straight to the store's how-to-play, so the
single-file build stays drive-free. The drive's code is prefetched while the title screen is up. How each screen
hands off to the next (loading screens, fades, what's hidden when): `docs/FLOW.md`.

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
