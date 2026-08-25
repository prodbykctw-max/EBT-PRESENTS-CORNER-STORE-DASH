# Deployment runbook

One Cloudflare Worker serves the static game from `public/` and the leaderboard API from
`/api/*`, bound to the existing `ebt-leaderboard` D1 database.

## Prerequisites

```bash
npm install
npx wrangler login
```

`wrangler.toml` already points at the live database:

```
database_name = "ebt-leaderboard"
database_id   = "3a2c03b7-8a55-4cce-8b66-b9486219a8f2"
```

## First deploy

```bash
npm run db:remote     # create the scores table + indexes in D1
npm run deploy        # publish the Worker (game + API)
```

Then verify:

```bash
curl https://<your-worker>.workers.dev/api/health      # -> {"ok":true,"db":true}
curl https://<your-worker>.workers.dev/api/scores      # -> {"scores":[]}
```

## Local development

```bash
npm run db:local      # schema into the local D1 copy
npm run dev:worker    # http://localhost:8787 — game + API together
```

`npm run dev` serves `public/` alone (no API). The game detects that and falls back to
`localStorage` scores, which is the right way to test the offline path.

## Custom domain

Add a route in the Cloudflare dashboard (Workers → your worker → Settings → Domains &
Routes), or in `wrangler.toml`:

```toml
routes = [{ pattern = "dash.example.com", custom_domain = true }]
```

## Checking the leaderboard

```bash
npm run db:top        # top 10 straight from D1
npx wrangler d1 execute ebt-leaderboard --remote \
  --command "DELETE FROM scores WHERE created_at < datetime('now','-30 days')"
```

## Before shipping to the party

- [ ] `npm run qa` passes (map connectivity + simulated playthrough)
- [ ] `npm run lighthouse` ≥ 85 across the four categories
- [ ] Board art in `public/assets/board.png` lines up with the 19×19 grid
- [ ] `icon-192.png` / `icon-512.png` present so the phone install looks right
- [ ] Played once on a real phone over cell data, not just desktop
- [ ] `/api/health` returns `{"ok":true,"db":true}` on the production URL

## Rollback

```bash
npx wrangler deployments list
npx wrangler rollback --message "reverting to last known good"
```

D1 is not rolled back with the Worker — the schema is additive, so a rollback is safe as
long as no column was dropped.
