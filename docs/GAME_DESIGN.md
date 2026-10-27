# Corner Store Dash — Game Design Document

## Pitch

You are shopping the corner store with an EBT list. Every aisle holds one item you need.
One bully works the store and wants you gone. Clear the list, then reach the checkout lane
before the clock — or before he catches you three times.

## Core loop

1. **Read the list.** Eight items, one per aisle, shown in the side panel.
2. **Route it.** The store is a 19×19 grid of shelf blocks and aisles. Item placement is
   symmetric, so there is no single dominant route — the fast line depends on where the
   bully is.
3. **Dodge.** The bully takes the shortest path to you most of the time, with a small
   scatter roll so he stays readable but never perfectly predictable.
4. **Escalate.** Every item you bag makes him faster (`BULLY_SPEED_PER_ITEM`). The last two
   items are the hard ones by design.
5. **Cash out.** The checkout lane is locked (🔒) until the list is complete, then opens (🛒).
   Reaching it ends the run and banks the time and lives bonuses.

## Rules

| Rule | Value | Where |
| --- | --- | --- |
| Lives | 3 carts | `TUNING.LIVES` |
| Round clock | 150s | `TUNING.TIME_LIMIT` |
| Player speed | 5.2 tiles/s | `TUNING.PLAYER_SPEED` |
| Bully speed | 4.0 tiles/s, +0.18 per item | `TUNING.BULLY_SPEED_*` |
| Pen delay | 2.5s before the first chase | `TUNING.PEN_DELAY` |
| Respawn grace | 1.6s after a hit | `TUNING.RESPAWN_GRACE` |
| Catch radius | 0.7 tiles | `game.js#collide` |

The player is faster than the bully at every stage. That is deliberate: losing should feel
like a routing mistake — getting pinned in a dead end — not like being outrun.

## Scoring

| Source | Points |
| --- | --- |
| Items | 100 / 150 / 200 / 250, rising with aisle depth |
| Seconds left at checkout | ×10 |
| Unused cart (life) | ×500 |

A clean, unhurried win lands around 3,000–4,000. A fast, no-hit run clears 5,000. The
leaderboard rewards routing, not grinding — there is nothing to farm.

## Movement model

Actors hold a float position in tile units but only ever make decisions on a tile centre.
The player has a **queued turn**: press a direction any time, and it fires the moment the
turn is legal. That is what makes tight corners feel fair instead of twitchy. The bully
refuses to reverse unless he is boxed in, which is what makes him legible — you can read his
approach and cut the other way.

## Difficulty tuning notes

- The pen delay is the whole opening. 2.5s is enough to bank the two nearest items.
- Scatter chance at 0.18 keeps him from locking into a perfect pursuit line; above ~0.3 he
  reads as drunk, below ~0.1 he reads as unfair.
- The speed ramp is the pressure curve. If playtests end too often at 6/8 items, drop
  `BULLY_SPEED_PER_ITEM` before touching the base speed.

## Art

The store renders as clean vectors out of the box. Dropping the client's mockup in at
`public/assets/board.png` swaps in the real board art as the floor layer, with shelves drawn
as a translucent overlay so collision stays readable. The art must match the 19×19 grid; if
it does not, edit `MAP` in `config.js` rather than stretching the image, then re-run
`npm run qa` to confirm the store is still fully connected.

## Not in v1

Power-ups, a second antagonist, multiple store floors, and audio. The single-bully chase is
the whole hook — everything above is a v2 conversation, not a scope creep.

## Store motion: why it was choppy and what fixed it

This section is about the live store game (`standalone/csd.js`), not the grid prototype the rest of this document
describes. The owner plays on a phone and found the store choppy, jerky and hard to steer, with the bully looking
"aggressive" and both characters running into walls. Each problem below was measured in the running game (headless
Chromium at phone size, 390 x 844 at 3x pixels, with phone-like frame times of 8/16/33/50/67 ms) before it was
changed. The measuring scripts and their results are not part of the repo; numbers are quoted here.

**1. Uneven steps (the judder).** Everyone moved by however long the last frame took and was drawn rounded to a
whole board pixel. A board pixel is about 2.4 phone pixels, and phones deliver uneven frames, so a steady walk was
drawn as a run of different-sized hops, and the camera (rounded to whole CSS pixels, 3 phone pixels) hopped on a
different beat. Measured as how much the player sprite's speed on screen changes from one frame to the next while
the stick is held steady (95th percentile): 233 CSS px/s at a steady 60 fps, 696 with phone-like frame times.
Now: `loop()` advances the game in fixed 1/120 s steps (`STEP`) and draws each character between its last two
steps (`rpos`, `ALPHA`). The characters and speech bubbles are drawn on a screen-sized layer at the phone's own
resolution (`drawActors`, canvas `#actors`, over the board), placed to the nearest phone pixel, and the camera moves
in phone pixels too (`placeView`, `VX`/`VY`). The board itself is untouched (same canvas, same pixels). Same
measure after: 34 at 60 fps, 15 with phone-like frame times. The bully on screen: 123 -> 47 (60 fps). Sprites, shadows and bubbles are the same art at the same size and place: the bubble
is drawn at board resolution once and scaled up like the board, so its blocky look is kept.

**2. Instant speed.** The stick set full speed the moment your thumb moved 10 px, and speed went from 0 to full (and
back) in one frame. Now the drag ramps from a 6 px dead zone to full speed at 22 px (`STICK_DEAD`, `STICK_FULL`,
`stickK`), and the player's speed eases to the stick in a few hundredths of a second (`P_ACCEL_T`, `P_STOP_T`; a
sharp turn or sidestep takes half that). Top speed is unchanged (`PSPEED` 260).

**3. Shaking against walls.** When a push into a wall was blocked, the old slide poured the whole step sideways at
full speed, whichever way the stick leaned. A thumb wobbling a few degrees either side of straight shook you
left-right at full speed (measured: 29 direction flips in 1.5 s, net movement zero, at every wall tested). In
pockets, the corner nudges stepped you back off the wall and the push walked you straight in again (a 2-3 px
shudder). Now (`moveEntity`): you slide at the speed of the part of the push that runs along the wall (nothing within
~8 degrees of straight on, full speed from 30 degrees, `SLIDE_MIN_SIN` / `SLIDE_FULL_SIN`); a straight push stands you still against
the wall; `cornerSeek` keeps rounding the corner the way it started; the nudges only move you the way you are
already pushing. Wall test (8 walls x 4 push angles, a thumb wobbling +-4 degrees): 414 back-and-forth reversals before, 10 after. Drawn positions between steps
sampled 5 times per step along those pushes: 201 of 14400 samples inside a wall before, 6 after (all a diagonal step
cutting the end of a wall by about 1 px).

**4. Facing flicker and skating feet.** Facing came from the stick, by whichever axis was bigger, so a diagonal
swapped the sprite between two rows whenever the thumb wandered across 45 degrees; the walk cycle advanced by |vx|+|vy|,
so diagonals ran the legs 41% fast and a blocked push ran on the spot. Now facing follows where the character really
went (averaged over 0.1 s, so a stepped wall doesn't flicker it), with a little hysteresis (`faceToward`,
`FACE_BIAS`) and a hold (`FACE_HOLD`, 0.18 s: a turn is not undone straight away; the lunge's squaring-up ignores it), and the walk cycle advances by the distance actually covered (`moveEntity`, `drawSheet`). In bot runs
(phone frame times, 60 runs): facing changes 2.0 -> 1.1 a second (player), 1.7 -> 0.75 (bully); walk-cycle frames per
pixel walked, 95th percentile, 2.24 -> 1.00 (1.0 = feet planted). Wall pushes with a wobbling thumb never swap facing
more than once per 0.18 s.

**5. The bully's staircase and snaps.** His path is a chain of 16 px grid cells joined up/down/left/right, and he
walked it cell by cell: every diagonal was a staircase (1-1.7 turns sharper than 60 degrees per second, his sprite
flipping between up and side). Now he heads for the farthest of the next few waypoints he can walk to in a line
(`pathAim`), his velocity eases toward where he wants to go over `B_TURN_T` instead of snapping, he slows into a
spot he is walking to, and he brakes into the lunge wind-up (and squares up to you) instead of freezing; the dash
gets up to speed in a few hundredths of a second. Sharp turns (over 60 degrees in one frame): 1.1 a second before, 0.18 after. The stuck
watchdog no longer fires while he stands looking around (it used to pop him 10 px sideways and blind him every
0.4 s there).

**6. Camera shake.** The shake jumped to a new random offset every frame (a buzz, worse at higher frame rates). It
now sways on two mixed sine waves, same size, same fast fade (`SHAKE`, `placeView`).

**7. Per-frame work.** The EBT list HUD was copied off the board every frame; now only when it changes. The threat
overlay and the off-screen arrow only write styles when they change. Headless Chromium at phone size with the CPU
slowed 4x: the game's own script time fell from 288-349 ms per second of play to 133-163 (the list copy alone was
~6 ms a frame). Real phones draw on the GPU, so their numbers will differ; this was not measured on a phone.

**Difficulty.** Measured with a bot that plays full runs (walks the shortest route to each item and sidesteps the
lunge's wind-up; same seeds, same frame times, before and after; "won" = reached the till with a continue allowed).
Two things moved it. The bully's straighter paths (`pathAim`) make him arrive sooner at the same speed: that alone took
the bot from 18 wins in 120 runs to 9 in 120. And the old game let a fast mover skip past the catch check on slow frames
(it checked once per frame, up to 16 px of dash per check on a slow phone frame; now every 1/120 s step), so the old game
was a little easier on slower phones. To balance it, the lunge wind-up is 0.46 s (was 0.38: a longer, clearer cue) and the
bully's three hunt terms are 0.90x what they were (`B_BASE` 129, `B_PER_ITEM` 5.0, `B_CAP` 153; were 143 / 5.6 / 177),
which is about what his shorter paths gave back.

| bot runs, same seeds | won | items per run | seconds survived |
| --- | --- | --- | --- |
| before, 120 fps (120 runs) | 18 | 3.73 | 12.3 |
| straight paths, old speeds, 120 fps (60 runs) | 7 | 3.80 | 12.4 |
| after (these speeds), 120 fps (120 runs) | 14 | 3.58 | 12.2 |
| before, phone frame times (60 runs) | 10 | 3.97 | 13.3 |
| after, phone frame times (60 runs) | 7 | 3.57 | 12.7 |

No run in any row timed out. Win counts from a bot this size wander by +-5, so read these as "about the same, a touch
harder on phone frame times", not as exact. Lunge duels set up at the same 260 spots along a real route: the lunge lands
about as often as before (34 vs 33 of ~97). With the bully frozen, the bot's full shop takes the same time (17.6 s both),
so the player's easing doesn't slow you down. If the store needs to be easier still, `B_CAP`, `B_BASE` and `LUNGE_WIND`
are the knobs.
