# CORNER STORE DASH — standalone EBT game (v2.2)

## v2.2 update: full free-flow floor
Aisle sign banners, the ENTRANCE sign, the welcome mat and the doorway were
all being treated as solid because they aren't floor-colored. Every aisle
sign is now a walk-through overlay, the entry/mat area is open, and only
real furniture (shelf bodies, counters, cart corrals, walls) blocks. Also
fixed a ghost of the mockup's baked-in shopper that had been stamped into
the floor by a bad erase in v2 — it was an invisible obstacle sitting in
the middle of the main lane. Store went from 22% to 38% walkable; the main
lane now runs the full height with no pinch points.

## v2.1 update: collision geometry rebuilt
Movement was reported as "restricted by poorly defined aisles and walk area."
Root cause: the collision mask was built by thresholding pixel brightness alone,
which is noisy (anti-aliased edges, floor tile speckling) and had let a few
hand-guessed "wall seal" rectangles ship way too conservative — the right-side
aisle was sealed off around x=653–718 when the real wall sits past x=800 in
most rows. Rebuilt from scratch: the true wall boundary is now measured
programmatically per row (a color rule that correctly rejects the storefront's
blue window glass, so it doesn't need to guess where the wall is), shelf
silhouettes are still traced from the art directly, and everything is clipped
against that measured boundary. The right-side aisle is now open its full true
width. Full derivation and every measured coordinate are written up in
`corner-store-dash-geometry.md` for anyone extending this later.

**One file. The mockup image IS the game board.** Player sprites, item pickups, the bully,
score digits, and EBT-list checkmarks are all rendered live on top of the artwork.
`GDD.md` describes v1 (Everything But Trapped) and is superseded by this build.

## What shipped in v2
- Removed: all event/RSVP content. This is a standalone EBT game.
- **Goal:** grab all 8 EBT-list items (one pickup per aisle), dodge **the bully**, reach a **CHECKOUT** pad.
- Bully AI: wanders until you grab your first item — then it hunts (BFS pathfinding + box-checked line-of-sight, speeds up per item collected, taunt bubbles, chase music kicks in under 280px).
- One catch = run over. **RUN IT BACK** restarts instantly.
- Scoring: 100/item + 500 checkout + speed bonus `max(0, 1500 − 15·seconds)`.
- Controls: drag anywhere / on-screen d-pad (mobile), arrows/WASD (desktop).
- Leaderboard: same backend as v1 — Worker + D1 (unchanged `worker.js` + `schema.sql`).

## Judgment calls to review
1. **RICE and BEANS are two separate pickups at the RICE & BEANS aisle** (it's named for both). Every other aisle has exactly one. Easy to move — each item is one line in `ITEMS` in the script.
2. **One life.** Matches "without being caught." Feel too harsh? Say the word and I'll add hearts.

## Publish (either)
- **Quick link:** open `index.html` as an artifact in Claude → share → Publish.
- **Production:** Cloudflare Dashboard → Workers & Pages → Create → Pages → **Upload assets** → drop `index.html` → `ebt-game.pages.dev`.

## Global leaderboard (optional, later)
1. `npx wrangler deploy` in a folder with `worker.js` + `wrangler.toml` (D1 already created: `ebt-leaderboard`, id `3a2c03b7-8a55-4cce-8b66-b9486219a8f2`, schema applied).
2. Set `ALLOWED_ORIGIN` in `worker.js` to your Pages URL.
3. In `index.html`, set `API_BASE = "https://<worker>.workers.dev"`. Blank = local session scores (works fine without any of this).

## Tuning knobs (top of the script in index.html)
`PSPEED 260` player · `B_BASE 205` bully base · `B_PER_ITEM 8` escalation · `B_CAP 253` max ·
`CATCH_R 30` catch radius · `PICK_R 36` pickup radius · time bonus in `winCheck()`.
