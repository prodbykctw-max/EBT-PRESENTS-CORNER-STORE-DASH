/**
 * Leaderboard client. The API is optional by design: if the Worker is not
 * deployed (or offline) the game still plays and scores fall back to localStorage,
 * so a dead network never blocks a run.
 */

import { API_BASE, STORAGE_KEY } from './config.js';

const LOCAL_SCORES = 'csd.scores.local';

const safeJSON = async (res) => {
  if (!res.ok) throw new Error(`api ${res.status}`);
  return res.json();
};

export function rememberName(name) {
  try { localStorage.setItem(STORAGE_KEY, name); } catch { /* private mode */ }
}

export function recallName() {
  try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
}

function localTop(limit = 10) {
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_SCORES) ?? '[]');
    return rows.sort((a, b) => b.score - a.score).slice(0, limit);
  } catch { return []; }
}

function localSave(entry) {
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_SCORES) ?? '[]');
    rows.push(entry);
    localStorage.setItem(LOCAL_SCORES, JSON.stringify(rows.slice(-100)));
  } catch { /* ignore */ }
}

export async function fetchTop(limit = 10) {
  try {
    const res = await fetch(`${API_BASE}/api/scores?limit=${limit}`, { headers: { accept: 'application/json' } });
    const data = await safeJSON(res);
    return { source: 'remote', rows: data.scores ?? [] };
  } catch {
    return { source: 'local', rows: localTop(limit) };
  }
}

export async function submitScore({ name, score, items, timeLeft, won }) {
  const entry = {
    name: String(name || 'SHOPPER').slice(0, 16).toUpperCase(),
    score: Math.max(0, Math.floor(score)),
    items,
    time_left: Math.max(0, Math.floor(timeLeft)),
    won: Boolean(won),
    created_at: new Date().toISOString(),
  };
  localSave(entry);
  try {
    const res = await fetch(`${API_BASE}/api/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
    const data = await safeJSON(res);
    return { ok: true, source: 'remote', rank: data.rank ?? null };
  } catch {
    return { ok: false, source: 'local', rank: null };
  }
}
