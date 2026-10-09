'use strict';

// Promo / +EV: Novig prices from Novig's own free feed (our odds relay, which
// reads Novig's public v3 REST plus the signed websocket), in place of The
// Odds API's `novig` bookmaker.
//
// Runs inside the /api/fetch-odds cron, per featured sport. Only the markets
// the relay has for a matched game are replaced (h2h, main spread, main
// total); anything else on that game keeps The Odds API's Novig entry. If
// the relay is down or a game does not match, that game keeps The Odds API's
// Novig entry, so Promo never loses Novig.
//
// Units: relay `size` is payout dollars at the best ask. Odds API `bet_limit`
// for Novig is stake dollars (size x price), so bet_limit = floor(size x odds).
//
// Kill switch: PROMO_NOVIG_DIRECT=0.

const RELAY_LEAGUE = Object.freeze({
  americanfootball_nfl: 'NFL',
  americanfootball_ncaaf: 'NCAAF',
  baseball_mlb: 'MLB',
});
const MATCH_WINDOW_MS = 3 * 3600 * 1000;
const RELAY_TIMEOUT_MS = 4000;
const MIN_ODDS = 0.02;
const MAX_ODDS = 0.98;

function enabled(env = process.env) {
  const v = String(env.PROMO_NOVIG_DIRECT == null ? '' : env.PROMO_NOVIG_DIRECT).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

function relayBase(env = process.env) {
  const raw = String(env.ODDS_RELAY_URL || env.VITE_ODDS_RELAY_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\//i.test(raw) ? raw : '';
}

async function fetchRelayNovig(league, { base, fetchImpl = fetch, timeoutMs = RELAY_TIMEOUT_MS } = {}) {
  if (!base || !league) return { ok: false, error: 'relay not configured', quotes: [] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/board?league=${encodeURIComponent(league)}&venue=novig`, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: 'relay ' + res.status, quotes: [] };
    const json = await res.json();
    const quotes = Array.isArray(json && json.quotes) ? json.quotes : [];
    return { ok: true, quotes };
  } catch (err) {
    return { ok: false, error: (err && err.name === 'AbortError') ? 'relay timeout' : String(err && err.message || err), quotes: [] };
  } finally {
    clearTimeout(timer);
  }
}

function norm(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "western kentucky" matches "western kentucky hilltoppers"; exact wins.
function nameScore(oddsApiName, relayName) {
  const a = norm(oddsApiName);
  const b = norm(relayName);
  if (!a || !b) return 0;
  if (a === b) return 2;
  if (a.startsWith(b + ' ') || b.startsWith(a + ' ')) return 1;
  return 0;
}

/** Group relay quotes into games keyed by away|home|start. */
function relayGames(quotes) {
  const games = new Map();
  for (const q of quotes || []) {
    if (!q || q.book !== 'novig' || !q.home || !q.away) continue;
    const key = `${q.away}|${q.home}|${q.start || ''}`;
    let g = games.get(key);
    if (!g) {
      g = { away: q.away, home: q.home, startMs: Date.parse(q.start) || 0, quotes: [] };
      games.set(key, g);
    }
    g.quotes.push(q);
  }
  return [...games.values()];
}

/** The one relay game for an Odds API game, or null when none / ambiguous. */
function matchGame(game, rgames) {
  const t = Date.parse(game.commence_time) || 0;
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const g of rgames) {
    if (t && g.startMs && Math.abs(g.startMs - t) > MATCH_WINDOW_MS) continue;
    const h = nameScore(game.home_team, g.home);
    const a = nameScore(game.away_team, g.away);
    if (!h || !a) continue;
    const score = h + a;
    if (score > bestScore) { best = g; bestScore = score; tie = false; } else if (score === bestScore) tie = true;
  }
  return best && !tie ? best : null;
}

function usable(q) {
  const p = Number(q && q.odds);
  return p > MIN_ODDS && p < MAX_ODDS && Number.isFinite(Number(q.american));
}

function outcome(name, q, point) {
  // Even money: the relay writes -100, The Odds API writes +100. Match the
  // existing rows so an unchanged price doesn't read as a change.
  const american = Number(q.american) === -100 ? 100 : Number(q.american);
  const out = { name, price: american };
  if (point != null) out.point = point;
  const size = Number(q.size);
  out.bet_limit = size > 0 ? Math.floor(size * Number(q.odds)) : null;
  return out;
}

/** Odds API-shaped markets for one matched game. */
function marketsFor(game, rg) {
  const teamFor = (side) => {
    if (nameScore(game.home_team, side) && nameScore(game.home_team, side) >= nameScore(game.away_team, side)) return game.home_team;
    if (nameScore(game.away_team, side)) return game.away_team;
    return null;
  };
  const main = rg.quotes.filter((q) => !q.is_alt);
  const markets = [];
  let latest = 0;
  const touch = (q) => { const u = Date.parse(q.updated_at) || 0; if (u > latest) latest = u; };

  const ml = main.filter((q) => q.bet_type === 'moneyline' && usable(q));
  const h2h = [];
  for (const q of ml) {
    const team = teamFor(q.side);
    if (team && !h2h.some((o) => o.name === team)) { h2h.push(outcome(team, q)); touch(q); }
  }
  // One-sided markets would hide the other side's Odds API price; need both.
  if (h2h.length === 2) markets.push({ key: 'h2h', outcomes: h2h });

  const sp = main.filter((q) => q.bet_type === 'spread' && usable(q) && Number.isFinite(Number(q.line)));
  const spreads = [];
  for (const q of sp) {
    const team = teamFor(q.side);
    if (team && !spreads.some((o) => o.name === team)) { spreads.push(outcome(team, q, Number(q.line))); touch(q); }
  }
  // Both sides must be the same line (points sum to zero) to count as the main spread.
  if (spreads.length === 2 && Math.abs(spreads[0].point + spreads[1].point) > 1e-9) spreads.length = 0;
  if (spreads.length === 2) markets.push({ key: 'spreads', outcomes: spreads });

  const tot = main.filter((q) => q.bet_type === 'total' && usable(q) && Number.isFinite(Number(q.line)));
  const totals = [];
  for (const q of tot) {
    const side = /^over$/i.test(q.side) ? 'Over' : (/^under$/i.test(q.side) ? 'Under' : null);
    if (side && !totals.some((o) => o.name === side)) { totals.push(outcome(side, q, Number(q.line))); touch(q); }
  }
  if (totals.length === 2 && totals[0].point !== totals[1].point) totals.length = 0;
  if (totals.length === 2) markets.push({ key: 'totals', outcomes: totals });

  const stamp = latest ? new Date(latest).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
  for (const m of markets) if (stamp) m.last_update = stamp;
  return { markets, lastUpdate: stamp };
}

/**
 * Replace The Odds API's Novig markets with relay markets for matched games.
 * Returns { data, stats }. Never throws; never drops a game or a book.
 */
function overlayNovigDirect(sport, data, quotes) {
  const stats = { sport, games: 0, matched: 0, replacedMarkets: 0, added: 0, kept: 0 };
  if (!Array.isArray(data)) return { data, stats };
  const rgames = relayGames(quotes);
  const out = data.map((game) => {
    stats.games += 1;
    if (!game || !Array.isArray(game.bookmakers)) return game;
    const rg = matchGame(game, rgames);
    if (!rg) { stats.kept += 1; return game; }
    const { markets, lastUpdate } = marketsFor(game, rg);
    if (!markets.length) { stats.kept += 1; return game; }
    stats.matched += 1;
    const idx = game.bookmakers.findIndex((b) => b && b.key === 'novig');
    const prior = idx >= 0 ? game.bookmakers[idx] : null;
    const replaced = new Set(markets.map((m) => m.key));
    const keep = prior && Array.isArray(prior.markets) ? prior.markets.filter((m) => !replaced.has(m.key)) : [];
    stats.replacedMarkets += markets.length;
    if (!prior) stats.added += 1;
    const book = {
      key: 'novig',
      title: 'Novig',
      last_update: lastUpdate || (prior && prior.last_update) || null,
      markets: [...markets, ...keep],
      source: 'novig-direct',
    };
    const bookmakers = game.bookmakers.slice();
    if (idx >= 0) bookmakers[idx] = book; else bookmakers.push(book);
    return { ...game, bookmakers };
  });
  return { data: out, stats };
}

/** Cron hook: (sport, data) -> data with Novig from the relay. Safe on any failure. */
function createNovigDirect({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  if (!enabled(env)) return null;
  const base = relayBase(env);
  if (!base) return null;
  const cache = new Map();
  return async function novigDirect(sport, data) {
    const league = RELAY_LEAGUE[sport];
    if (!league || !Array.isArray(data)) return data;
    try {
      if (!cache.has(league)) cache.set(league, fetchRelayNovig(league, { base, fetchImpl }));
      const pulled = await cache.get(league);
      if (!pulled.ok || !pulled.quotes.length) {
        log(`[novig-direct] ${sport}: keeping Odds API Novig (${pulled.error || 'no relay quotes'})`);
        return data;
      }
      const { data: next, stats } = overlayNovigDirect(sport, data, pulled.quotes);
      log(`[novig-direct] ${sport}: matched ${stats.matched}/${stats.games}, markets ${stats.replacedMarkets}`);
      return next;
    } catch (err) {
      log(`[novig-direct] ${sport}: keeping Odds API Novig (${err && err.message})`);
      return data;
    }
  };
}

module.exports = {
  RELAY_LEAGUE,
  enabled,
  relayBase,
  fetchRelayNovig,
  relayGames,
  matchGame,
  marketsFor,
  overlayNovigDirect,
  createNovigDirect,
  nameScore,
};
