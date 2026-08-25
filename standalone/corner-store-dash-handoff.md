# Corner Store Dash — handoff for Claude Code

Standalone browser game for KCTW / RARE Agency. Single self-contained HTML
file, no build step, no dependencies. This doc is written for a fresh Claude
Code session picking up development with no prior context — it explains the
architecture, the non-obvious parts (mainly the collision geometry), and
where to make common changes.

## What this is

A top-down grocery-store chase game. The player collects every item on an
EBT checklist while avoiding a bully that starts wandering and switches to
hunting the moment the first item is picked up. Reach a checkout pad with
everything collected to win.

**The uploaded store mockup image *is* the game board.** There's no tile
engine — a single 853×1844 illustration is drawn to a canvas every frame,
and the player sprite, bully sprite, pickup icons, HUD text, and checkout
glow are all drawn on top of it in canvas 2D. Collision geometry is derived
from that same image, not from a separate level format.

## File layout

- **`index.html`** (shipped deliverable) — the assembled, playable game.
  Built by concatenating a shell (`shell2.html`, the DOM/CSS/overlay markup)
  and the game script (`csd.js`), with the board image inlined as a base64
  WebP data URI. This is the *only* file that matters for playing or
  publishing the game.
- **`worker.js` + `schema.sql`** — optional Cloudflare Worker + D1 schema for
  a global leaderboard. Not required to play; without it, scores are
  session-local (see "Leaderboard" below).
- **`GDD.md`** — describes v1 ("Everything But Trapped"), an earlier
  Pac-Man-style prototype. Superseded; kept for history only. Don't use it
  as a spec for the current game.

If you're working from source (not just the shipped `index.html`), you'll
want `csd.js` (game logic) and `shell2.html` (markup/CSS) as separate files,
then reassemble with a small script — see "Rebuilding index.html" below.
Neither separate file currently ships in outputs; regenerate them from
`index.html` if needed (the game script is the large `<script>` block after
`var BOARD_SRC=...`), or ask the person for the working directory if this
session has one.

## Architecture

Everything lives in one global-scope script (`"use strict"`, no modules, no
bundler — this both keeps it a single portable file and matches the
constraint that it has to run as a static file with no server). Rough
sections, top to bottom in `csd.js`:

1. **Constants & state** — board dimensions, item/spawn/pad coordinates,
   tuning knobs, the `S` game-state object.
2. **Mask build** (`buildMasks`) — turns the board image into three
   collision structures. This is the part that was rebuilt this session;
   see "Collision geometry" below, it's the thing most likely to need
   touching again.
3. **Pathfinding** (`findPath`, BFS over a coarse nav grid) + line-of-sight
   (`los`) — used by the bully AI.
4. **Movement** (`moveEntity`) — full-speed wall-slide with corner-assist,
   shared by player and bully.
5. **Bully AI** (`updateBully`) — wander until first pickup, then hunt via
   BFS + LOS, speed scales with items collected, stuck-watchdog escape.
6. **Game flow** — collect/catch/win/continue/pause/menu handlers.
7. **Input** — keyboard, a trailing-anchor drag joystick, and a d-pad with
   container-level touch tracking (so sliding a finger between arrows
   re-aims instantly instead of only registering the button first pressed).
8. **Sprites & rendering** (`draw`) — everything drawn per frame: the board
   image, HUD score/checklist overlay, pickup icons, checkout glow, player
   and bully (hand-authored pixel-grid sprites, not spritesheets), speech
   bubbles.
9. **Audio** — WebAudio synthesis (square/triangle/sawtooth oscillators),
   no audio files. SFX + a procedural bassline that speeds up when the
   bully is close.
10. **Leaderboard** — local-array fallback or `fetch` to a Worker.
11. **Boot/loop** (`init`, `loop`) — loads the board image, calls
    `buildMasks`, wires up all DOM listeners, starts `requestAnimationFrame`.

## Collision geometry — read this before touching movement or the mask

This is the part of the codebase most likely to bite you, and it's the part
that was rebuilt this session after a report that movement felt
"restricted by poorly defined aisles." Understanding *why* the old approach
failed will save you from reintroducing the same bug.

### The core idea

`buildMasks()` runs once at load. It builds three grids, all derived from
the board image at `MC=4`px cell resolution (`walk`/`field`) and `GC=16`px
for a coarser bully-pathfinding grid (`nav`):

- **`walk`** — is this cell physically floor? Computed per-cell from 4
  sub-pixel samples of the *loaded image*, using a color rule:
  `bright = (r+g+b)/3 > 150 && b < r+40`. Read as "light-colored, and not
  blue-dominant." The blue-dominant exclusion specifically defeats the
  storefront's window glass, which is bright enough to pass a naive
  brightness threshold but is clearly blue, not floor-cream.
- **`field`** — flood-fill of `walk` starting from the player spawn point.
  This is the mask actually used for collision (`fieldAt`, `boxFree`). Its
  job is to strip out any *disconnected* patches that happen to classify as
  "floor-colored" but aren't reachable — enclosed pockets, a stray bright
  pixel inside a shelf's product art, etc. A pixel only needs to look like
  floor *and* be walkably connected to where the player starts.
- **`nav`** — coarser 16px grid for the bully's BFS pathfinder. A cell
  counts as passable only if a full actor box fits centered on it
  (`boxFree` at the cell center) — this avoids the bully finding "paths"
  through gaps too narrow for its own sprite.

`boxFree(x,y)` is the actual per-frame collision primitive: it samples
`field` at 5 points forming the corners/center of a ~18×9px box around
`(x,y)` (`x±9,y`, `x±9,y-6`, `x,y+3` — an asymmetric box because sprites
are drawn feet-down, so the "front" of the collision box is a few px below
the coordinate and it's taller above). Both player and bully movement check
`boxFree` before committing a step.

### Why brightness-alone wasn't enough (the bug this session fixed)

The original mask build used pure brightness (no blue exclusion) and
patched over the resulting false positives — the storefront's windows and
"LOW PRICES" sign read as walkable — with a handful of *hand-guessed*
rectangles sealing off the right side of the store at x≈653–718. Those
rectangles were measured by eyeballing a low-resolution grid overlay and
were wrong: the store's real right wall sits much farther out (x≈760–850
depending on row — the store is drawn in a slight perspective, so the true
wall position tapers). The seals were sealing off 100–150px of genuine
floor along the entire right-side aisle, which is what produced the
"restricted" feeling.

### How the fix works

Instead of guessing wall rectangles, the true wall boundary is now
**measured programmatically, per horizontal row**: for each row from
y=295 to y=1540 (the "aisle band," excluding the busy top shelf row and the
bottom entryway which are handled separately — see below), a script scanned
the actual pixel data from both edges inward, looking for where a sustained
run (≥18px) of floor-colored pixels starts. That gives a `(leftEdge,
rightEdge)` pair per row. Those were cleaned (median-based outlier
rejection, since a few rows have highlight artifacts on checkout-counter
edges that briefly read as false-narrow) and are embedded directly in
`csd.js` as two arrays, sampled once per 4px mask row:

```js
var CLIP_CY0=73;                 // first cell-row the clip applies to (y=295 → cy=73)
var CLIP_L=[109,109,109,...];    // left boundary in px, one entry per cell-row
var CLIP_R=[760,762,763,...];    // right boundary in px, one entry per cell-row
```

`buildMasks` applies these as a hard per-row clip on top of the color
classification: cells outside `[CLIP_L[i]-1, CLIP_R[i]+2]` are forced
unwalkable regardless of what the color classifier said. This is what
actually kills the window-glass problem for good — even if a bright
non-blue artifact ever slipped past the color rule, it can't extend the
walkable area past the *measured* true wall.

**If the board image is ever swapped or re-cropped, this clip data goes
stale and needs to be regenerated.** The method (for a future session, in
Python with PIL/numpy against the board PNG):

1. Classify every pixel: `floorish = brightness>150 and blue < red+40`.
2. For each row in the aisle band, scan inward from both edges (`x=0→W`
   and `x=W→0`) for the first sustained run of ≥18 floorish pixels;
   record that boundary.
3. Reject outliers with a local median filter (window ~13 rows, threshold
   ~25–35px) and re-interpolate — a handful of rows have a checkout
   counter's reflective highlight strip that briefly reads as floor a
   long way from the true edge, and this cleans that up.
4. Light final moving-average smooth (window ~5).
5. Downsample to one value per 4px cell-row (matching `MC`), starting at
   whatever cell row your aisle band begins at, and paste the two arrays
   into `csd.js` along with the matching `CLIP_CY0`.
6. **Always render a verification overlay before trusting it** — tint
   `field` green over the board image and eyeball it at full resolution.
   This caught every real bug this session; trusting printed numbers
   without a visual check did not.

### The zones the row-scan can't handle, and what covers them instead

- **Top shelf row (y < 295)**: no horizontal clip is applied here at all —
  this band is dominated by the dairy/exit-door/rice&beans cluster, which
  packs shelf + door + shelf edge to edge with no clean "wall to wall"
  floor sweep for a row-scan to measure. It relies on the color
  classifier plus the explicit door/panel block rects below plus
  flood-fill connectivity, and that combination is sufficient — verified
  visually.
- **Bottom entryway (y ≥ 1540)**: the welcome mat, turnstile posts, and
  the entry floor sitting on the navy floor-border color are all
  non-floor-colored (the mat is dark red, the border is dark navy), so
  the color classifier alone would wrongly exclude them. This band is
  force-set walkable (`setRect(14,1476,840,1606,1)`), then the cart
  corrals / plants / posts are individually blocked back out on top.
- **Small flat-colored props anywhere else** (exit door, the EBT list
  panel HUD, the ENTRANCE sign, the ATM unit, one potted plant near the
  Rice & Beans corner, the "LOW PRICES" sign) — these are either too dark
  or too uniformly saturated for the brightness rule to reliably exclude,
  or sit close enough to real aisle space that getting them wrong chokes
  a real path (this happened twice this session — see below). Each gets
  one small explicit `setRect(...,0)` block. The full current list is in
  `buildMasks`, each with an inline comment.

### The mistake to avoid if you touch these prop rects

Twice this session, a "safety" block rect for a small prop (the ENTRANCE
sign, a potted plant) was measured generously — padded out "to be safe" —
and that padding silently ate a real aisle gap next to it, because these
props sit close to genuinely narrow pinch points (e.g. the ~25–40px gap
between a checkout counter and the entrance sign). **Measure these tight,
not generous.** If you need to add or adjust one:

1. Crop the board image around the prop with a fine pixel grid overlay
   (10px minor / 50px major gridlines, 3× scale) and read the true edges
   off the gridlines — don't eyeball proportions in a downscaled view.
2. Cross-check with a raw pixel dump (`print` the RGB and brightness at a
   handful of x steps across the suspected boundary) rather than trusting
   the visual read alone — several props this session had thin dark
   grout-line or shadow artifacts that looked like part of the prop but
   weren't.
3. After changing a rect, re-run the boxFree probes in the test suite
   (below) and re-render a green-tint overlay of `field` before shipping.
   A rect that's 20px too generous on one edge is invisible in gameplay
   until someone walks into exactly that spot — the automated tests catch
   this far more reliably than playtesting a few runs.

### Key coordinates (current)

```js
ITEMS: APPLE(395,972) CHIPS(395,790) CHICKEN(530,858) LEMONADE(395,608)
       BREAD(410,440) MILK(480,320) "RICE & BEANS"(530,292, 200pts, 2 rows)
SPAWN_P: (368,1330)   — between the entry plaza and the first shelf row
SPAWN_B: (650,320)    — top area, right of the exit door, left of Rice&Beans
PADS (checkout, win trigger): [402,390,430,465] [402,550,430,635] [402,728,430,812]
```

`MILK` and `SPAWN_B` were both relocated this session — their original
positions (`MILK` at x=250, `SPAWN_B` at x=398) sat under the EBT list
panel and inside the exit door's footprint respectively. Both were only
ever reachable because the old, noisier mask happened not to enforce
those obstacles precisely; the accurate mask correctly rejects them. If
you relocate any item or spawn point, always verify with `boxFree(x,y)` in
the browser console (or a puppeteer script) before committing — don't
assume a coordinate is walkable just because it looks like open floor in
the source image, since these areas are genuinely tight (the exit door,
panel, and top shelves leave a fairly narrow usable gap up there).

## Movement

`moveEntity(e, dt)` is shared by player and bully. Per sub-step: try the
full combined move; if blocked, try pouring the *entire* step magnitude
into whichever single axis is free (full-speed wall-slide — this is what
makes sliding along a wall feel smooth instead of the old capped-speed
"crawl" that shipped earlier this session); if both axes are blocked,
try a small corner-assist nudge perpendicular to the blocked axis (probes
±3..9px, escape step uncapped at the sub-step's own magnitude+1.2, not
a fixed cap — capping this caused input-pull yo-yo stuttering on angled
walls in earlier testing).

Bully movement additionally has a stuck-watchdog: if it hasn't moved more
than ~15% of its expected distance for 0.4s while hunting, it force-repaths
and physically displaces a few px in whichever cardinal direction is free,
plus sets a brief `noLos` timer so it won't immediately re-request a
straight-line chase into the same corner.

## Testing

There's no formal test framework — QA this session was a set of
hand-written Puppeteer scripts (`test7.js` in the working directory is the
most complete one, if this session has file access to it; otherwise
recreate from the pattern below) driving the game headless via test hooks
exposed on `window.__csd`:

```js
__csd.step(dt, n)       // advance the sim n times by dt seconds, deterministic, then draw
__csd.setInput(x,y)     // override player input vector (null to release)
__csd.tp(x,y)           // snap-teleport the player to the nearest valid point near (x,y)
__csd.freeze(bool)      // pause the bully's own update (for isolating player-only tests)
__csd.boxFree(x,y)      // the actual collision predicate, callable directly
__csd.path()            // current bully→player BFS path length (-1 if none)
__csd.S / .player / .bully / .items   // live state getters
```

Pattern for a movement test: `tp` to a known start, `setInput` a direction,
`step` for N ticks at 1/60, read back position, assert it moved a sane
amount and didn't get stuck. Pattern for an aisle-width regression: pick a
handful of `(x,y)` probes along a previously-broken area and assert
`boxFree` on each — this is exactly what caught the two "generous prop
rect" bugs described above, well before they'd have been noticed by eye.

**Always freeze the bully (`__csd.freeze(true)`) for pure movement/geometry
tests.** Several apparent test "failures" earlier this session turned out
to be the bully legitimately catching the player mid-test, not a bug.

**When a probe test fails, check whether it's actually wrong before
"fixing" the game.** A few failures this session were the test's own
assumption being unrealistic for the *true* (now-accurate) geometry — e.g.
a single straight vertical line at a fixed x doesn't clear the exit door
anymore, correctly, because the door really is there. Verify via a fresh
crop of the source image before assuming the mask is at fault.

## Rebuilding index.html from source

If you're editing `csd.js` and/or `shell2.html` directly, reassemble with:

```python
shell = open('shell2.html').read()
game  = open('csd.js').read()
b64   = open('board.b64').read().strip()   # base64 of the board WebP, no data: prefix
out = shell.replace('%%B64%%', b64).replace('%%GAME%%', game)
# shell2.html contains literal \u escapes for a few glyphs (arrows, speaker icon,
# pause icon, middot, em dash) that need unescaping after the substitution:
out = (out.replace('\\u2026','…').replace('\\uD83D\\uDD0A','🔊')
          .replace('\\u25B2','▲').replace('\\u25BC','▼')
          .replace('\\u25C0','◀').replace('\\u25B6','▶')
          .replace('\\u23F8','⏸').replace('\\u00b7','·').replace('\\u2014','—'))
open('index.html','w').write(out)
```

If `board.b64` isn't available, regenerate it from the original mockup PNG
(erase the baked-in player figure/HUD digits/d-pad first — see git history
or the erase coordinates in the original build notes if you have transcript
access) and re-export as WebP q82 for size.

## Leaderboard

`API_BASE` at the top of `csd.js` is empty by default → the client talks to
the **same-origin** `/api/scores` endpoints served by this repo's Worker
(`worker/index.js`; payload `{name, score, items, time_left, won}`, response
`{ok, rank}`, list via `GET /api/scores?limit=10`). If the API is
unreachable (opened as `file://`, or hosted static-only), `submitScore`
falls back to a local in-memory session array (`localLB`). To host the HTML
somewhere other than the Worker, set `API_BASE` to the deployed Worker URL
and reassemble (D1 database `ebt-leaderboard` already exists, id
`3a2c03b7-8a55-4cce-8b66-b9486219a8f2`, schema applied).

## Tuning knobs

All near the top of `csd.js`: `PSPEED` (player speed), `B_IDLE`/`B_BASE`/
`B_PER_ITEM`/`B_CAP` (bully speed curve — idle wander speed, base hunting
speed, per-item escalation, hard cap), `CATCH_R`/`PICK_R` (catch and pickup
radii). Time bonus formula is inline in `winCheck` (`max(0, 1500 −
15·seconds)`).

## Known judgment calls / open items

- Rice & Beans is one merged pickup worth 200 (vs 100 for everything else)
  since it's genuinely two checklist items at one shelf. Easy to split back
  into two if that ever feels wrong — it's one line in `ITEMS`.
- One continue per run, items retained on respawn, per explicit request.
- The right-side aisle between checkout lane 3 and the entrance sign is
  still the tightest spot in the store (~25–40px clear, vs 50–100px+
  elsewhere) — it's genuinely walkable now (confirmed both by `boxFree`
  probes and by moving the player through it in a screenshot), just not
  spacious. If it ever comes up as still feeling tight, the entrance sign
  rect (`setRect(730,580,795,840,0)`) is the thing to nudge — but re-verify
  its true bounds against the source image first, don't just shrink it
  blind; that's exactly the mistake that caused this whole rebuild.
