# Working on this repo

## Hard rules

1. **The code is the truth.** Read the code before saying anything about how something works, and before
   changing it. Docs and comments go stale here: `docs/DRIVE.md` said the car auto-drives months after
   commit `7441452` made the player drive it, and a comment in `runner.js` said a code path left the car's
   nose alone on the line directly above one that turned it. Trust the line, not the note about the line.
2. **Don't ask the owner what the code can answer.** The owner directs this game by describing what they want
   to see and feel; they are not reading the code. Work out where things live, what they do and what a
   change will touch from the source, every time, whatever it costs in reading.
3. **Read every path that produces a behaviour before changing it**, not just the first one that looks
   responsible. Example: the drive's "front-end steering" came from three places (nose yaw in `runner.js`,
   front-wheel pivots and body lean in `drive.js`); changing one left the other two in place.
4. **Change only what was asked.** Art, look, colour, models and layout don't change unless the owner asks
   for that specifically. A reference link, video or screenshot is a reference for the one thing the owner
   names (e.g. "the camera view and the steering"), never a spec to rebuild the game toward.
5. **Prove it runs.** A syntax check is not verification. Run the game, drive the change, measure it, and say
   plainly what was verified and what wasn't.
6. **Explain changes in plain language, with detail:** what changed, where, why, what it looks/feels like
   now, and how to see it.

## Before deciding something doesn't exist

- `git fetch origin` first. Branches are invisible until fetched; the whole drive level once looked missing
  because only `main` had been fetched.
- Search the whole repo (`grep -r`), including generated files, before saying it isn't here.

## Map

| What | Where |
| --- | --- |
| Store game source | `standalone/csd.js` (+ `shell2.html`, `*.b64` art: `board.b64` lossy WebP, `player`/`bully`/`items.b64` lossless WebP, same pixels as the PNGs they replaced). **Edit these, then run `npm run build:standalone`**, which regenerates `standalone/index.html`, `public/standalone.html` and `./index.html` (and copies `public/llms*.txt` to the repo root). Never hand-edit those. |
| Drive level (three.js) | `public/drive/`. Entry: `startDrive()` in `drive.js`. The store game loads it with `import("./drive/drive.js")` (`DRIVE_URL` in `csd.js`) when START is tapped, and starts the store run when it ends. |
| Drive car physics | `public/drive/runner.js`: `Car.step()` (speed, lateral spring toward `targetD`, `yaw`), `pose` (position + heading) |
| Drive steering + camera | `public/drive/drive.js`: `laneAt` / `laneShift` / `followLane` / `tapLane` (stiff one-lane-per-press steering; `tapLane` runs from the touch/key event itself so no tap is missed; the car is drawn between the 120 Hz physics steps via `prevS`/`prevD`), the chase camera (`back`, `h`, `ahead` in the camera block: distance behind, height, how far ahead it aims), wheel pivots, body lean. The overpass cutaway (`CUT`, from `roads.js`) follows the car and is still needed with the chase camera (the Connector's deck is ~2.1 m above the route; without the hole it blocks the view), and drive.js lowers where it starts to 1.45 m above the car (`uCutPos.y -= 0.75`) because at the bottom of the deck's dip the underside is 1.8 m above the car, and grows its radius (`uCutR`) from 11 m to reach the camera at speed, capped at 25 m. Near plane is 2 m, with 2.5 m minimum ground clearance under the camera. **The realistic look has its own closer, lower chase camera: `CAM_R` (top of `drive.js`: `back`, `backV`, `h`, `ahead`, `yCar`, `rear`; one-line edits), aimed by where the car lands on screen and carried along with the car so there is no speed lag; the comic camera (8 m / 3 m) is untouched** |
| Drive racing guide + HUD (realistic look only) | `public/drive/guide.js` (`Guide`, `GUIDE`: the red path lines, the amber bend chevrons, the optional `?pullin` chevrons), wired in `drive.js` (`guide`, `guide.update` beside `spotGroup.visible`). The racing HUD: `HUD_HTML_REAL` + the `if (RL)` block beside `setText(hud.time...)` in `drive.js`, CSS under `.drive-root.real` at the end of `drive.css`. `.real` is added to the root only when the realistic look loaded, so the comic look keeps `HUD_HTML` and its CSS byte for byte |
| The chase (on foot to your car, then racing the bully; Kema's opening) | `public/drive/drive.js`: `FOOT` / `RACE` (top), `updateFoot`, `getIn`, `updateRace`, `raceResult`, `drawRaceBar`, the on-foot camera; `public/drive/people.js` (the 3D characters: bully recolour shader, run clip, and the arm swing: `addArmSwing` + `ARMS` (`walk`, `run`: degrees of shoulder swing, elbow bend and pump, tuck, shoulder roll; one-line edits), put on the walk and the run at load time because the model's own walk hardly moves the arms, and from behind, the chase camera's view, they did not move at all; the store's sprite sheets keep the walk as it is, the owner judged them fine), `character.glb` (from `drive/tools/export_character.py`, then `drive/tools/fix_character_weights.py`, which untangles the hands from the jeans and tee: the scan's auto-weights made the hands drag the pockets and the strides pull the hands), `heads.png` (race-bar heads). See docs/DRIVE.md, "The chase" |
| Store bully (cut-offs, last-seen search, "!" spot burst, telegraphed lunge) | `standalone/csd.js`: `updateBully` + the `B_*` / `LUNGE_*` constants; the store side of the race: `startStoreRun`, `bullyEnters`, `DOOR`, `BULLY_IN_*`; threat on screen (red edges, off-screen arrow, "HE'S COMING" pill): `drawThreat` |
| Store motion (fixed 1/120 s steps, drawing between steps, the actor layer, wall slide, player easing, facing) | `standalone/csd.js`: constants `STEP`..`SLIDE_MIN_SIN` under the bully constants; `loop` + `rpos` (interpolation), `moveEntity` / `cornerSeek` / `faceToward`, `pathAim` (bully string-pulling), `drawActors` / `drawSheet` / `drawBubble` (characters and bubbles are drawn on the screen-sized `#actors` canvas over the board, not on the board canvas), `placeView` (camera in phone pixels, `VX`/`VY`, `SHAKE`). See docs/GAME_DESIGN.md, "Store motion". Headless screenshots only show the actor layer when the page runs its own requestAnimationFrame |
| Drive look | **Realistic is the default; `?look=comic` (or `startDrive({ look: 'comic' })`) is the ink look.** `public/drive/mode.js` (the switch: `look.real`, `hooks`, `fallbackToComic()`; the URL beats the option), `real.js` (materials: facades, roads, curbs, trees, car paint, shadows, `faceTerrainUp`, weather light) and `real-post.js` (`RealLook`: AO, bloom, haze, tone map, grade), with `tex/real/*.webp` (credits in `tex/CREDITS.txt`, built by `drive/tools/build_real_tex.mjs`); `sky.js` `REAL_FRAG`. The ink + cel look is `look.js` (comic only). The comic path must stay pixel-identical |
| Drive traffic cars (realistic look) | `public/drive/cars.js` + `public/drive/cars/*.cars` (credits: `cars/CREDITS.txt`; built by `drive/tools/cars/`, `build_bc.py` writes the default). **The realistic look draws the BC fleet with no URL param**: C's street cars (sedan, SUV, police, robotaxi) with B's concept car (Khronos CarConcept, CC BY 4.0) as about 1 in 3 sedan-role cars. The body is picked per car from `cid`, a counter `World.add()` and the ambient spawn set once (`CarSet.pick`; never `Math.random()`, which traffic and the planner share). `?cars=none` (or `0`/`off`) gives the props.glb cars back; `?cars=A\|B\|C\|BC` load one option for comparison. `drive.js` loads `cars.js` (a dynamic `import`) and the file only once the realistic look's own code and textures have loaded (the comic look requests neither), waits for them at most 8 s after everything else is ready (`CARS_WAIT_MS`), and starts the drive with the old cars if the fetch fails or is late. `World.setCarSet` always restores `VEHICLE_BASE` before applying a set's sizes, so a second drive in one page never inherits the last one's. The shadow proxies are hidden for the camera and shown only around the sun's shadow map (`CarSet.shadowOnly`; a layer can't do it in r186). B's credit is on the title screen's credits line (`standalone/shell2.html`). `runner.js` `World.render` `put()` routes a car to a LOD mesh by distance and writes a shadow proxy. Three LODs (~25k / ~5k / ~1.5k tris), one InstancedMesh per body per LOD |
| Drive pedestrians (realistic look) | `public/drive/people-alt.js` (`AltPeople`: draws the crowd's people in kinds, near/far LOD each; `traitsFor` picks every person's body type, hair, outfit and shoe from a hash of the index, never `Math.random`, and a person never shares a body type with the person before, nor an outfit except two hooded people in a row; three.js ids are made under `withoutRandom`, a private generator whose state persists, and `AltPeople` then takes the 4 draws the old crowd's `InstancedMesh` took, so the shared `Math.random` stream, and so the traffic and behaviour after the crowd, match `?people=none`), `people-b.js` + `people-real/people2.json`+`people2.bin` (the older `people.json`/`people.bin` are kept unchanged for cached old code; `build()` throws on a wrong version or short file, so the box people come back) (MakeHuman CC0 bodies, 6 body types, walk baked to vertex-animation textures, **and real shoes**: a sneaker, a lace-up dress shoe and an ankle boot, CC0 MakeHuman clothes fitted to each body and skinned to the same bones, so they move with the feet in every pose; which one a person wears is an accessory-mask bit like the hair, `BIT.sneaker/dress/boot`; hair, caps, bags, hoods and skirts are baked into the same mesh by the build, nothing of A is loaded at run time; credits and licences `people-real/CREDITS.txt`; built by `drive/tools/people/fetch_shoes.py` + `build_people.py` + `shoes.py`). The shoe paint (sole, upper, toe cap, laces, sock or trouser cuff, polish) is `pedShoe` in `people-alt.js`, from the height above the sole and distance from the heel baked per vertex. **The realistic look draws every person as a B body, with shoes, with no URL param** and does not request `people-a.js`; `?people=none` (or `0`/`off`) gives the box people back, `?people=A` and `?people=AB` load the hand-built A person (QA). `crowd.js` decides everything about the people and only hands drawing over (`alt`). `drive.js` loads the files (dynamic `import`) only after the realistic look has loaded, waits for them with the cars at most 8 s, and keeps the old people on failure; the comic look requests nothing. Phones (`pointer: coarse`) in the realistic look also get a contact-shadow blob under every person drawn, either LOD, and under the box people with `?people=none` (`public/drive/contact.js`, one instanced mesh fed from `render`, drawn before the people, which have `renderOrder: 2` when the blob is on; `drive.js` imports it only on phones in the realistic look; built without drawing `Math.random`). Proof tools: `tools-people/`, `tools-shadow/`, `tools-allb/` |
| Drive sound | `public/drive/audio.js`: `ENGINE_LEVEL` (engine loudness) and `OFF_SHARE` (how much of it you hear off the gas: GTA-style, a faint rumble until you press GAS), the squeal fed by `sideSlip` in `drive.js` |
| Motion (GSAP 3.15.0) | One copy: `public/drive/vendor/gsap.min.js`. `standalone/build.mjs` inlines it into the store page (last, verbatim); the drive uses the page's `window.gsap` or loads that file on its own. Store: the `motion (GSAP)` block in `csd.js` (`MOTION`, `overlayIn`/`overlayOut` behind `show`/`hide`, `springButtons`, `SHOWN` score count-up, `REVEAL` item pop, `PAYIN` pay-spot pop, bubbles' `sc`/`rise`). Drive: `G` in `drive.js` (`msgIn`/`msgOut`/`flash`, `pop`, `bump`, `setHint`, pause panel, BUSTED card, loading fade, HUD entrance; `.gs` on the root turns off the CSS versions in `drive.css`). Reduced motion or no GSAP falls back to the old instant / CSS behaviour. The plain-black how-to-play screens (`data-solid`) never fade their background, so nothing shows through |
| Vendored libraries | `public/drive/vendor/README.txt`: three.js r186.1 (latest), meshopt decoder 1.3.0, GSAP 3.15.0 |
| Start screens | `standalone/shell2.html`: `ovTitle`, `ovDriveHow` (drive how-to-play), `ovHow` (store how-to-play, shown on arriving at the store), both how-to-plays on plain black; flow in `csd.js`: `btnTitle` → `btnDrive` → `startWithDrive()` → `showStoreHow()` → `btnStart` → `startStoreRun()` |
| Drive route, lanes, parking spot | `runner.js` route: `lane(s,k)`, `parkD(s,side)`, `travel(s)`; `drive.js`: `spot` |
| Store character sheets (`player.b64`, `bully.b64`) | Rendered in Blender from the original Tripo character and its own walk (`standalone/tools/bake_characters.py`), packed by `standalone/tools/compose_sheets.py` (the bully is the player's sheet recoloured) and saved as lossless WebP; `renders2` on the owner's laptop (`Desktop/corner-store-dash-character`) rebuilds them pixel for pixel. **The owner judged the store's arms fine as they are (Nov 6 2026): don't change the sheets unless asked.** `CSD_ARMS=1` bakes them with the drive's arm swing (`standalone/tools/arm_swing.py`; a bake is in `renders3`) |
| Store tuning | Constants at the top of `standalone/csd.js` (`ITEMS`, `PADS`, speeds) |
| Search, link previews, AI assistants | The `ai-seo:v2` block in `standalone/shell2.html`'s head: description, canonical, share tags, icons, JSON-LD (VideoGame + FAQ). Everything names the **main link** (`https://ebt-corner-store-dash.prodbykctw.workers.dev/`), the GitHub Pages copy included, so search engines treat Pages as a copy of it. Files the main link serves from `public/`: `robots.txt`, `sitemap.xml`, `llms.txt` + `llms-full.txt` (the game described for AI assistants; keep them in step with the head block), `share.jpg` (1200x630 link preview: the title screen), `favicon.ico` + `icons/` (the game's cart on the title card's pink and gold). `build.mjs` points the Pages copy's icon links at `public/`. The GitHub repo's About description and website link can't be set from a cloud session (the proxy refuses settings writes) |
| Design notes | `docs/` (may lag the code; see rule 1) |

## Running and testing

- `npm run dev` serves `public/` at http://localhost:5173 (`scripts/serve.mjs`).
  - Full game: `/standalone.html` (TAP TO START → drive how-to-play → START DRIVE → the drive → store how-to-play →
    START RUN → the store run).
  - Drive alone: **`/drive/index.html`**. Not `/drive/`: the dev server doesn't serve folder URLs, so that 404s.
    Options: `?qa` (test mode), `?bot` (autopilot drives it), `?demo=auburn|arrive` (jump to a set piece).
- If the server won't start, an old one holds the port (`EADDRINUSE`): find it with
  `ps -eo pid,args | grep "[s]erve.mjs"` and kill it. Don't `pkill -f` a pattern that also matches your own
  command line.
- `npm run qa` (`tests/qa.mjs`): map integrity + a bot run + a browser smoke test of the OLD grid prototype
  (`public/src/*`, served as `public/index.html`). It does not load `standalone/csd.js` (the live store) or the drive,
  so a pass says nothing about either. Test the live store in a browser through `window.__csd`.
- Drive test hook: `window.__drive` → `car` (`s`, `d`, `targetD`, `v`, `yaw`), `route`, `spot`, `state`,
  `three.{camera, carRig, scene, renderer}`, `snapshot()` (JPEG data URL of the current frame).
- Headless browser in Claude Code cloud sessions: Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
  `npm install --no-save playwright-core`, launch args `--no-sandbox --use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader` for WebGL2. The drive takes minutes to boot on software WebGL; give
  `page.waitForFunction(fn, null, { timeout })` a long timeout. Options are the third argument, not the second.

## Deploying

- Live: https://ebt-corner-store-dash.prodbykctw.workers.dev/ (Worker `ebt-corner-store-dash`). `worker/index.js` serves
  `public/standalone.html` at `/`; every other path is `public/` as-is.
- Deploys: Cloudflare Workers Builds is connected to this repo (dashboard: the Worker → Settings → Builds; production
  branch `main`, no build command, deploy command `npx wrangler deploy`, preview builds OFF because previews would share
  the live D1 leaderboard). Every push to `main` deploys itself; the Worker's Deployments tab shows each build.
  `.github/workflows/ci.yml` only tests (`npm run qa`, `npm run test:worker`). Its old `deploy` job needed a
  `CLOUDFLARE_API_TOKEN` secret that was never set and failed on every push; it was removed when Builds was connected.
  `npm run deploy` from a computer with `wrangler login` still works for a manual deploy.
- Anything not on `main` is not live. Before saying something is live, check the latest build in the Worker's Builds/Deployments and
  compare a changed file on the live site with the branch (`curl -s <live>/drive/drive.js | sha1sum`). Builds made on
  the owner's Windows machine carry CRLF line endings in some files; strip `\r` before comparing.
