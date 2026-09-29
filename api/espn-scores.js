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
// GET /api/espn-scores?live=nfl  → today's NFL scoreboard, slimmed to the
//   live game-state fields (status, clock, period, scores, situation) for the
//   odds boards' game-state line and frozen gates (src/nflGameState.js).
//   Server-side because ESPN's CDN 403s browser user agents from some
//   networks; s-maxage 3 so every board viewer shares one upstream call.
// Returns only games ESPN has scored. We do not invent scores or winners.
// Combo Locks stamps risk won / risk lost / push from these + Kalshi legs.
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

function scoreboardUrl(sport, date) {
  const base = ESPN[sport];
  if (!base) return null;
  // Saturday NCAAF slates exceed ESPN's default page; include FCS (Mercyhurst).
  const extra = sport === 'ncaaf' ? '&limit=300' : '';
  return `${base}?dates=${encodeURIComponent(date)}${extra}`;
}

async function fetchScoreboard(sport, date) {
  const url = scoreboardUrl(sport, date);
  if (!url) return [];
  const data = await fetchJson(url);
  return slimScoreboard(data, sport, date);
}

function liveParam(req) {
  if (req && req.query && req.query.live) return String(req.query.live).toLowerCase();
  try { return (new URL((req && req.url) || '', 'http://localhost').searchParams.get('live') || '').toLowerCase(); } catch (_) { return ''; }
}

// Keep only what src/nflGameState.js reads (stateFromEspnEvent).
function slimLiveEvent(ev) {
  const comp = ev && ev.competitions && ev.competitions[0];
  if (!comp) return null;
  const sit = comp.situation || null;
  const lp = sit && sit.lastPlay;
  return {
    id: ev.id,
    status: ev.status || comp.status || null,
    competitions: [{
      competitors: (comp.competitors || []).map((c) => ({
        homeAway: c.homeAway,
        score: c.score,
        team: c.team ? { id: c.team.id, abbreviation: c.team.abbreviation, displayName: c.team.displayName } : null,
      })),
      situation: sit ? {
        down: sit.down, distance: sit.distance, yardLine: sit.yardLine, isRedZone: sit.isRedZone,
        possession: sit.possession, possessionText: sit.possessionText,
        downDistanceText: sit.downDistanceText, shortDownDistanceText: sit.shortDownDistanceText,
        homeTimeouts: sit.homeTimeouts, awayTimeouts: sit.awayTimeouts,
        lastPlay: lp ? { type: lp.type ? { text: lp.type.text } : null, text: lp.text } : null,
      } : null,
    }],
  };
}

async function liveHandler(res) {
  res.setHeader('Cache-Control', 's-maxage=3, stale-while-revalidate=5');
  const data = await fetchJson(ESPN.nfl);
  const events = ((data && data.events) || []).map(slimLiveEvent).filter(Boolean);
  res.status(200).json({ events, source: data ? 'espn' : null, updatedAt: new Date().toISOString() });
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (liveParam(req) === 'nfl') {
    try { await liveHandler(res); } catch (e) { res.status(200).json({ events: [], source: null, error: String(e && e.message || e) }); }
    return;
  }
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
module.exports._helpers = { queriesFromReq, slimEvent, slimScoreboard, DATE_RE, ESPN, scoreboardUrl, slimLiveEvent, liveParam };
