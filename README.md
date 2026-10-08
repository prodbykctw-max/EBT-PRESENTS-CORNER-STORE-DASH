# EBT Presents: Corner Store Dash

### ▶ [Play it free: ebt-corner-store-dash.prodbykctw.workers.dev](https://ebt-corner-store-dash.prodbykctw.workers.dev/)

Phone or desktop, no download, no sign-up.

A free browser game from EBT (Everything But Trapped), in two parts.

1. **The drive.** Drive down Auburn Ave to the corner store against a 70-second clock. Change
   lanes one tap at a time, don't hit the police, grab EBT tokens, and park in the spot out front.
2. **The store.** Grab everything on the EBT list without getting caught by the bully, then pay at
   a register.

## How to play

| | Touch | Keyboard |
| --- | --- | --- |
| **The drive** | ◀ ▶ change lanes, one per tap · GAS to go · BRAKE to stop (hold at a stop to reverse) · HORN clears the way | ↑/W gas · ↓/S brake/reverse · ←/→ or A/D one lane per press · SPACE or H = horn · P or Esc = pause |
| **The store** | Drag anywhere on the screen to move (a floating joystick) | Arrows / WASD · P or Esc = pause |

**The drive.** If you hit a police car, you're busted and go back to the start of the drive. If the
clock runs out ("TOO LATE"), you walk into the store with no bonus. If you park, you get a bonus
that carries into the store. The bonus counts the time left on the clock, the tokens you grabbed
and your near misses. You get extra for a clean park and extra for a run with no hits.

**The store.** There are seven items on the list. Each is worth 100 points, except rice & beans,
which is worth 200. The bully wanders until you grab your first item, then hunts you and speeds
up with every item you bag. Paying at a register adds 500 points plus a speed bonus of
`max(0, 1500 − 15 × seconds)`. If you get caught, you have one continue per run and you keep your
items.

**Scores.** At the end you can save your initials to the score list. In the live game, that list
only lasts for the current browser session. It does not go to the global leaderboard (see
[Leaderboard](#leaderboard)).

## For developers

- **No bundler.** The pieces are:
  - **The store game:** a single self-contained HTML page with canvas art. `npm run build:standalone`
    assembles it from `standalone/`.
  - **The drive:** plain ES modules using three.js (WebGL).
  - **Libraries:** three.js r186.1, the meshopt decoder and GSAP 3.15.0, all vendored in
    `public/drive/vendor/`.
- **One deploy.** A single Cloudflare Worker serves the game *and* the leaderboard API from the
  same origin.

## Builds in this repo

- **Store game (live)**: lives in `standalone/`. The store mockup image *is* the board: collision
  and pathfinding come from its pixels when the page loads (see
  `standalone/corner-store-dash-handoff.md`). Edit `standalone/csd.js`, `shell2.html` or the `*.b64`
  art, then run `npm run build:standalone`. That regenerates `standalone/index.html`,
  `public/standalone.html` and the repo-root `index.html`, which is a copy for GitHub Pages with its
  paths pointed into `public/`. It also copies `public/llms*.txt` to the repo root. Don't
  hand-edit the generated files.
- **Drive level (live)**: lives in `public/drive/`, with `startDrive()` in `drive.js` as the
  entry point. The store page loads it when you tap START, and the store run begins when the
  drive ends. `drive/tools/` holds the Blender and Node scripts that build the drive's world and
  assets.
- **v1 modular store (not live)**: `public/index.html` plus `public/src/`. This is the older
  tile-grid version. `npm run qa` tests it, and the dev server serves it at `/`.

## Quick start

```bash
npm run dev               # zero-dependency static server for public/ on http://localhost:5173
npm run qa                # v1 map + gameplay checks (puppeteer smoke test only if installed)
npm run test:worker       # leaderboard Worker tests (node --test)
npm install --include=dev # only for the browser QA pass + wrangler
```

On the dev server:

- **Full live game (drive, then store):** `http://localhost:5173/standalone.html`
- **Drive on its own:** `http://localhost:5173/drive/index.html`. It accepts `?qa` (test mode),
  `?bot` (autopilot) and `?demo=auburn|arrive`. A bare `/drive/` URL returns 404 because the dev
  server doesn't serve folder URLs.
- **v1 modular build:** `http://localhost:5173/`

If `.certs/dev.key` and `.certs/dev.crt` exist, the dev server also serves the same files over
HTTPS on port 5174, so you can test on a phone.

> On a machine with `NODE_ENV=production` set globally, a bare `npm install` silently
> skips devDependencies and prints "up to date". Use `--include=dev` there.

To run against a local Worker and a local D1 copy:

```bash
npm run db:local     # apply schema.sql to the local D1
npm run dev:worker   # wrangler dev, which serves public/ and /api/*
```

## Controls (v1 modular build)

The live game's controls are under [How to play](#how-to-play). These are for the v1 build in
`public/src/`.

| Input | Action |
| --- | --- |
| Arrow keys / WASD | Move |
| Swipe or on-screen D-pad | Move (touch) |
| SPACE / ENTER | Start |
| R | Restart |

## Layout

```
public/              deploy root: everything here is served as-is
  standalone.html    the live game (generated by build:standalone; the Worker serves it at /)
  index.html         v1 modular page shell + HUD
  styles.css         v1 theme, responsive layout, mobile D-pad
  manifest.webmanifest, favicon.ico, icons/, share.jpg, robots.txt, sitemap.xml, llms*.txt
  assets/            optional v1 art drop (see assets/README.md)
  drive/             the drive level (three.js): drive.js, runner.js, roads.js, city.js, world.json, …
    vendor/          three.js, meshopt decoder, GSAP, GLTFLoader, SkeletonUtils
  src/               v1 modular store
    config.js        map glyphs, shopping list, tuning constants
    maze.js          grid parsing, exits, BFS pathfinding
    entities.js      Actor / Player / Bully movement
    game.js          rules: collect, checkout, lives, timer, scoring
    renderer.js      Canvas 2D drawing
    input.js         keyboard + swipe + D-pad
    leaderboard.js   API client with localStorage fallback
    main.js          bootstrap + game loop
standalone/          live store game source: csd.js, shell2.html, *.b64 art, build.mjs, tools/
drive/tools/         Blender / Node scripts that build the drive's world and assets
worker/index.js      Worker: static assets + /api/* on D1
worker/score-rules.js  score validation used by the Worker and its tests
schema.sql           D1 tables and indexes
scripts/serve.mjs    the dev server
tests/qa.mjs         v1 map integrity, simulated playthrough, browser smoke test
tests/worker.test.mjs  Worker validation, origin check, rate limit, error handling
docs/                game design doc, drive notes, deployment runbook (may lag the code)
```

## Tuning

- **Live store game:** the constants at the top of `standalone/csd.js` (`ITEMS`, `PADS`, player
  and bully speeds). Rebuild with `npm run build:standalone` after changing them.
- **Drive:** `public/drive/drive.js` (for example `TIME_LIMIT = 70` and the parking bonus).
- **v1 modular build:** every balance number lives in `public/src/config.js`: speeds, the bully's
  speed increase per item, scatter chance, lives, round clock and score bonuses. To change the
  store layout, edit the `MAP` glyph rows and run `npm run qa`. It flood-fills the grid and fails
  if any open tile, the bully pen or the checkout became unreachable.

## Leaderboard

| Route | Method | Notes |
| --- | --- | --- |
| `/api/scores?limit=10` | GET | Top N (1–100), score DESC, oldest first on ties |
| `/api/scores` | POST | `{ name, score, items, time_left, won }`: returns `{ ok, rank, name }` (201) |
| `/api/health` | GET | `{ ok: true, db: true }` when the D1 binding works |

The Worker checks every submission before saving it:

- **Same origin only:** a POST from another site gets a 403.
- **Rate limit:** 5 POSTs per 60 seconds per IP, using the `SCORE_LIMIT` binding.
- **Score check:** `worker/score-rules.js` rejects scores outside the v1 scoring rules (8 items,
  150 s clock, 3 lives).

This is a party leaderboard, not a bank. The check blocks garbage and obvious tampering, not a
determined cheater.

**What uses it today.** Only the v1 modular build (`public/src/leaderboard.js`) talks to this API.
If the API is unreachable, v1 falls back to `localStorage`.

The live store game does not post to it. `API_BASE` in `standalone/csd.js` is empty, so saved
initials stay in an in-memory list for that session. Setting `API_BASE` alone would not connect
it: the store game sends `{ initials, score, level_reached }` to `/api/score`, while the Worker
expects `{ name, score, items, time_left, won }` at `/api/scores`. Its scoring also differs from
the v1 rules that `score-rules.js` checks.

## Deployment

- `wrangler.toml` deploys the Worker `ebt-corner-store-dash`:
  - Static assets come from `./public`.
  - D1 is bound as `DB` (database `ebt-leaderboard`).
  - The rate limiter is bound as `SCORE_LIMIT`.
  - The Worker runs first for `/` only and serves `public/standalone.html` there.
- `npm run deploy` runs `wrangler deploy` from a machine logged in with `wrangler login`.
  `npm run db:remote` applies `schema.sql` to the remote D1.
- `.github/workflows/ci.yml` runs `npm run qa` on every pull request and every push to `main`. On a
  push to `main` it then runs `npx wrangler deploy`. That step only works when the repo has the
  Actions secret `CLOUDFLARE_API_TOKEN`; `CLOUDFLARE_ACCOUNT_ID` is optional.
- Full runbook: `docs/DEPLOYMENT.md`.

## Targets

Lighthouse ≥ 85 for performance, accessibility, best practices and SEO. Run `npm run lighthouse`
against `npm run dev`, which audits the dev server's `/` (the v1 page).
