# CORNER STORE DASH — standalone EBT game (v2.1)

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

## Global leaderboard
The leaderboard client is wired to this repo's Worker API (`worker/index.js`:
`POST/GET /api/scores`, D1 `ebt-leaderboard`, id `3a2c03b7-8a55-4cce-8b66-b9486219a8f2`).
`API_BASE = ""` means same-origin — deploy with `npm run deploy` and the game served at
`/standalone.html` talks to `/api/scores` directly, no config. Set `API_BASE` to a Worker
URL only when hosting the HTML elsewhere (e.g. Pages). If the API is unreachable
(`file://`, static-only hosting), scores fall back to local session storage automatically.

## Tuning knobs (top of the script in index.html)
`PSPEED 260` player · `B_BASE 205` bully base · `B_PER_ITEM 8` escalation · `B_CAP 253` max ·
`CATCH_R 30` catch radius · `PICK_R 36` pickup radius · time bonus in `winCheck()`.
