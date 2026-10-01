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
| Store game source | `standalone/csd.js` (+ `shell2.html`, `*.b64` art). **Edit these, then run `npm run build:standalone`**, which regenerates `standalone/index.html`, `public/standalone.html` and `./index.html`. Never hand-edit those three. |
| Drive level (three.js) | `public/drive/`. Entry: `startDrive()` in `drive.js`. The store game loads it with `import("./drive/drive.js")` (`DRIVE_URL` in `csd.js`) when START is tapped, and starts the store run when it ends. |
| Drive car physics | `public/drive/runner.js`: `Car.step()` (speed, lateral spring toward `targetD`, `yaw`), `pose` (position + heading) |
| Drive steering + camera | `public/drive/drive.js`: `laneAt` / `laneShift` / `followLane` (stiff one-lane-per-press steering), the camera rig (`const h = dist * …, back = dist * …`), wheel pivots, body lean |
| Drive look (ink + cel shading) | `public/drive/look.js` |
| Drive route, lanes, parking spot | `runner.js` route: `lane(s,k)`, `parkD(s,side)`, `travel(s)`; `drive.js`: `spot` |
| Store tuning | Constants at the top of `standalone/csd.js` (`ITEMS`, `PADS`, speeds) |
| Design notes | `docs/` (may lag the code; see rule 1) |

## Running and testing

- `npm run dev` serves `public/` at http://localhost:5173 (`scripts/serve.mjs`).
  - Full game: `/standalone.html` (START runs the drive, then the store).
  - Drive alone: **`/drive/index.html`**. Not `/drive/`: the dev server doesn't serve folder URLs, so that 404s.
    Options: `?qa` (test mode), `?bot` (autopilot drives it), `?demo=auburn|arrive` (jump to a set piece).
- If the server won't start, an old one holds the port (`EADDRINUSE`): find it with
  `ps -eo pid,args | grep "[s]erve.mjs"` and kill it. Don't `pkill -f` a pattern that also matches your own
  command line.
- `npm run qa`: store map integrity + a bot that plays a full store run. It does not test the drive.
- Drive test hook: `window.__drive` → `car` (`s`, `d`, `targetD`, `v`, `yaw`), `route`, `spot`, `state`,
  `three.{camera, carRig, scene, renderer}`, `snapshot()` (JPEG data URL of the current frame).
- Headless browser in Claude Code cloud sessions: Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`,
  `npm install --no-save playwright-core`, launch args `--no-sandbox --use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader` for WebGL2. The drive takes minutes to boot on software WebGL; give
  `page.waitForFunction(fn, null, { timeout })` a long timeout. Options are the third argument, not the second.

## Deploying

`.github/workflows/ci.yml`: `npm run qa` runs on every PR and push to `main`; **only a push to `main` deploys**
(Cloudflare Worker via `wrangler deploy`). Anything on another branch is not live until it is merged to `main`.
