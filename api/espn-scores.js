// ─────────────────────────────────────────────────────────────────────────
// api/espn-scores.js — public ESPN scoreboard proxy for Combo Locks
// underlying results when a Kalshi combo ticker never existed (unfilled).
//
// Source: ESPN site API (no key), same-origin so the browser avoids CORS.
//   MLB    https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard
//   NFL    https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
//   NCAAF  https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard
//
// GET /api/espn-scores?queries=mlb:20260903,nfl:20260913
// Returns only games ESPN has scored. We do not invent scores or winners.
// Combo Locks stamps would-have-won / lost / push from these + Kalshi legs.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const ESPN = {
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  ncaaf: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
};

const DATE_RE = /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; } finally { clearTimeout(t); }
}

function queriesFromReq(req) {
  let raw = '';
  if (req && req.query) {
    const q = req.query.queries || req.query.q || '';
    raw = Array.isArray(q) ? q.join(',') : String(q);
  }
  if (!raw && req && req.url) {
    try {
      const u = new URL(req.url, 'http://localhost');
      raw = u.searchParams.get('queries') || u.searchParams.get('q') || '';
    } catch (_) {}
  }
  const out = [];
  const seen = new Set();
  for (const part of String(raw).split(/[,\s]+/)) {
    const m = /^(mlb|nfl|ncaaf):(\d{8})$/i.exec(part.trim());
    if (!m || !DATE_RE.test(m[2])) continue;
    const sport = m[1].toLowerCase();
    const date = m[2];
    const key = sport + ':' + date;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sport, date });
  }
  return out.slice(0, 12);
}

function competitorOf(comp, side) {
  const list = (comp && comp.competitors) || [];
  return list.find((c) => String(c.homeAway || '').toLowerCase() === side) || null;
}

function slimEvent(ev, sport, date) {
  const comp = ev && ev.competitions && ev.competitions[0];
  if (!comp) return null;
  const home = competitorOf(comp, 'home');
  const away = competitorOf(comp, 'away');
  if (!home || !away || !home.team || !away.team) return null;
  const status = ev.status && ev.status.type ? ev.status.type : {};
  const completed = status.completed === true || String(status.state || '').toLowerCase() === 'post';
  const hs = home.score === '' || home.score == null ? null : Number(home.score);
  const as = away.score === '' || away.score == null ? null : Number(away.score);
  const hasScores = Number.isFinite(hs) && Number.isFinite(as);
  if (!completed || !hasScores) {
    return {
      sport,
      date,
      home: home.team.displayName || home.team.name || '',
      homeAbbr: home.team.abbreviation || '',
      away: away.team.displayName || away.team.name || '',
      awayAbbr: away.team.abbreviation || '',
      homeScore: hasScores ? hs : null,
      awayScore: hasScores ? as : null,
      completed: false,
      status: status.name || status.state || 'pre',
    };
  }
  return {
    sport,
    date,
    home: home.team.displayName || home.team.name || '',
    homeAbbr: home.team.abbreviation || '',
    away: away.team.displayName || away.team.name || '',
    awayAbbr: away.team.abbreviation || '',
    homeScore: hs,
    awayScore: as,
    completed: true,
    status: status.name || 'STATUS_FINAL',
  };
}

function slimScoreboard(data, sport, date) {
  const events = (data && data.events) || [];
  return events.map((ev) => slimEvent(ev, sport, date)).filter(Boolean);
}

async function fetchScoreboard(sport, date) {
  const base = ESPN[sport];
  if (!base) return [];
  const url = `${base}?dates=${encodeURIComponent(date)}`;
  const data = await fetchJson(url);
  return slimScoreboard(data, sport, date);
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  try {
    const queries = queriesFromReq(req);
    if (!queries.length) {
      res.status(200).json({ games: [], source: 'espn', updatedAt: new Date().toISOString() });
      return;
    }
    const batches = await Promise.all(queries.map((q) => fetchScoreboard(q.sport, q.date)));
    const games = batches.flat();
    res.status(200).json({ games, source: 'espn', updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ games: [], source: 'espn', updatedAt: null, error: String(e && e.message || e) });
  }
}

module.exports = handler;
module.exports._helpers = { queriesFromReq, slimEvent, slimScoreboard, DATE_RE, ESPN };
