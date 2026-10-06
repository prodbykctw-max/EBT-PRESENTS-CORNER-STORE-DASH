/**
 * Cloudflare Worker: serves the static game from public/ and backs the
 * leaderboard with the `ebt-leaderboard` D1 database.
 *
 *   GET  /api/scores?limit=10   -> { scores: [...] }
 *   POST /api/scores            -> { ok: true, rank }
 *   GET  /api/health            -> { ok: true, db: boolean }
 */

import { validate } from './score-rules.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

// No CORS headers: the game is served by this same Worker, so /api/* is
// same-origin and browsers on other sites cannot read it or preflight a POST.
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function cleanName(value) {
  return String(value ?? '')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 16)
    .toUpperCase() || 'SHOPPER';
}

async function listScores(env, limit) {
  const { results } = await env.DB.prepare(
    `SELECT name, score, items, time_left, won, created_at
       FROM scores
      ORDER BY score DESC, created_at ASC
      LIMIT ?1`,
  ).bind(limit).all();
  return results ?? [];
}

async function addScore(env, payload, request) {
  const name = cleanName(payload.name);
  const score = Math.floor(Number(payload.score));
  const row = {
    name,
    score,
    items: Math.floor(Number(payload.items ?? 0)),
    time_left: Math.floor(Number(payload.time_left ?? 0)),
    won: payload.won ? 1 : 0,
    country: request.headers.get('cf-ipcountry') ?? null,
  };

  await env.DB.prepare(
    `INSERT INTO scores (name, score, items, time_left, won, country)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(row.name, row.score, row.items, row.time_left, row.won, row.country).run();

  const rank = await env.DB.prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > ?1')
    .bind(score)
    .first('rank');

  return { ok: true, rank: Number(rank ?? 1), name };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // the front page is the full game (drive + store), the same page GitHub Pages serves at /
    // (public/index.html stays the modular build the tests exercise; wrangler.toml runs us first for / only)
    if (url.pathname === '/') {
      return env.ASSETS.fetch(new Request(new URL('/standalone', url), request));
    }
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    if (!env.DB) return json({ error: 'unavailable' }, 503);

    try {
      if (url.pathname === '/api/health') {
        await env.DB.prepare('SELECT 1').first();
        return json({ ok: true, db: true });
      }

      if (url.pathname === '/api/scores' && request.method === 'GET') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 100);
        return json({ scores: await listScores(env, limit) });
      }

      if (url.pathname === '/api/scores' && request.method === 'POST') {
        // same-origin only: a browser on another site always sends its Origin
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) return json({ error: 'forbidden' }, 403);
        if (env.SCORE_LIMIT) {
          const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
          const { success } = await env.SCORE_LIMIT.limit({ key: ip });
          if (!success) return json({ error: 'too many requests' }, 429);
        }
        const payload = await request.json().catch(() => null);
        if (!payload) return json({ error: 'invalid json' }, 400);
        const problem = validate(payload);
        if (problem) return json({ error: problem }, 400);
        return json(await addScore(env, payload, request), 201);
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: 'server error' }, 500);
    }
  },
};
