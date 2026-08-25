/**
 * Cloudflare Worker: serves the static game from public/ and backs the
 * leaderboard with the `ebt-leaderboard` D1 database.
 *
 *   GET  /api/scores?limit=10   -> { scores: [...] }
 *   POST /api/scores            -> { ok: true, rank }
 *   GET  /api/health            -> { ok: true, db: boolean }
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...CORS } });

const MAX_SCORE = 100_000; // ceiling well above a perfect run; blocks obvious tampering

function cleanName(value) {
  return String(value ?? '')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 16)
    .toUpperCase() || 'SHOPPER';
}

function validate(payload) {
  const score = Number(payload?.score);
  const items = Number(payload?.items ?? 0);
  const timeLeft = Number(payload?.time_left ?? 0);
  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) return 'score out of range';
  if (!Number.isInteger(items) || items < 0 || items > 32) return 'items out of range';
  if (!Number.isFinite(timeLeft) || timeLeft < 0 || timeLeft > 3600) return 'time_left out of range';
  return null;
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

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (!env.DB) return json({ error: 'D1 binding DB is not configured' }, 503);

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
        const payload = await request.json().catch(() => null);
        if (!payload) return json({ error: 'invalid json' }, 400);
        const problem = validate(payload);
        if (problem) return json({ error: problem }, 400);
        return json(await addScore(env, payload, request), 201);
      }

      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: 'server error', detail: String(err?.message ?? err) }, 500);
    }
  },
};
