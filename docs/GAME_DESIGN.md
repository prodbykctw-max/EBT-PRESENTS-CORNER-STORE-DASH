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
