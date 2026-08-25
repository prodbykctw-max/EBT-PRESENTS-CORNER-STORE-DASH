# EBT Presents: Corner Store Dash

A browser chase game. Grab every item on the EBT list — one item per aisle — without
getting caught by the bully, then clear the checkout lane. Runs post to a live
Cloudflare D1 leaderboard.

- **No build step.** Plain ES modules, Canvas 2D, zero runtime dependencies.
- **One deploy.** A single Cloudflare Worker serves the game *and* the leaderboard API,
  so there is no cross-origin hop between the two.
- **Degrades cleanly.** If the API is down the game still plays and scores fall back to
  `localStorage`.

## Quick start

```bash
npm install          # optional — only needed for QA + wrangler
npm run dev          # static server on http://localhost:5173
npm run qa           # map + gameplay checks (browser pass runs if puppeteer is installed)
```

To run the game against a local Worker and a local D1 copy:

```bash
npm run db:local     # apply schema.sql to the local D1
npm run dev:worker   # wrangler dev — serves public/ and /api/*
```

## Controls

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Move |
| Swipe or on-screen D-pad | Move (touch) |
| SPACE / ENTER | Start |
| R | Restart |

## Layout

```
public/            deploy root — everything here is served as-is
  index.html       page shell + HUD
  styles.css       theme, responsive layout, mobile D-pad
  manifest.webmanifest
  assets/          drop board.png + icons here (see assets/README.md)
  src/
    config.js      map glyphs, shopping list, all tuning constants
    maze.js        grid parsing, exits, BFS pathfinding
    entities.js    Actor / Player / Bully movement
    game.js        rules: collect, checkout, lives, timer, scoring
    renderer.js    Canvas 2D drawing
    input.js       keyboard + swipe + D-pad
    leaderboard.js API client with localStorage fallback
    main.js        bootstrap + game loop
worker/index.js    Worker: static assets + /api/scores on D1
schema.sql         D1 tables and indexes
tests/qa.mjs       map integrity, simulated playthrough, browser smoke test
docs/              game design doc + deployment runbook
```

## Tuning

Every balance number lives in `public/src/config.js` — speeds, the bully's ramp per item
collected, scatter chance, lives, round clock and score bonuses. Change the store layout by
editing the `MAP` glyph rows, then run `npm run qa`: it flood-fills the grid and fails if any
item, the pen or the checkout lane became unreachable.

## Leaderboard API

| Route | Method | Notes |
| --- | --- | --- |
| `/api/scores?limit=10` | GET | Top N, score DESC, oldest first on ties |
| `/api/scores` | POST | `{ name, score, items, time_left, won }` — returns `{ ok, rank }` |
| `/api/health` | GET | Confirms the D1 binding is live |

Submissions are sanitised and range-checked server-side (`worker/index.js`). This is a party
leaderboard, not a bank — the check blocks garbage and obvious tampering, not a determined cheat.

## Targets

Lighthouse ≥ 85 (performance, accessibility, best practices, SEO) — `npm run lighthouse`
against `npm run dev`.
