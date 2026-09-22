// First-party Polymarket + Kalshi quotes for the New Odds Board.
// Always on unless VITE_FIRST_PARTY_PM_LIVE is 0 / false / off.
// That var is a kill switch only — the board does not wait for a prod build.
// Quotes carry a 0–1 best ask; toAmericanOdds treats that as a contract price.

export function firstPartyPmLiveFromEnv(raw) {
  if (raw == null || raw === "") return true;
  const s = String(raw).trim().toLowerCase();
  return s !== "0" && s !== "false" && s !== "off";
}

export function firstPartyPmLiveEnabled() {
  let raw;
  let prod = false;
  try {
    const env = import.meta && import.meta.env;
    if (env) {
      prod = env.PROD === true;
      if (env.VITE_FIRST_PARTY_PM_LIVE != null && env.VITE_FIRST_PARTY_PM_LIVE !== "") {
        raw = env.VITE_FIRST_PARTY_PM_LIVE;
      }
    }
  } catch {
    /* node tests have no Vite env */
  }
  if (raw == null) {
    try {
      if (typeof process !== "undefined" && process.env && process.env.VITE_FIRST_PARTY_PM_LIVE != null) {
        raw = process.env.VITE_FIRST_PARTY_PM_LIVE;
      }
    } catch {
      /* ignore */
    }
  }
  return firstPartyPmLiveFromEnv(raw, prod);
}

export function polymarketStreamUrl({ league } = {}) {
  const p = new URLSearchParams();
  if (league) p.set("league", league);
  const q = p.toString();
  return q ? `/api/polymarket-stream?${q}` : "/api/polymarket-stream";
}

export function kalshiStreamUrl({ league } = {}) {
  const p = new URLSearchParams();
  if (league) p.set("league", league);
  const q = p.toString();
  return q ? `/api/kalshi-stream?${q}` : "/api/kalshi-stream";
}

function normName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesHit(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 3 || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
}

function teamHitsGame(game, name) {
  if (!game || !name) return false;
  return namesHit(name, game.away)
    || namesHit(name, game.home)
    || namesHit(name, game.awayAbbr)
    || namesHit(name, game.homeAbbr);
}

export function matchGameForQuote(games, quote) {
  if (!quote || !quote.side) return null;
  const league = String(quote.league || "").toUpperCase();
  const hits = [];
  for (const game of games || []) {
    if (!game) continue;
    if (league && String(game.league || "").toUpperCase() !== league) continue;
    if (!teamHitsGame(game, quote.side)) continue;
    if (quote.away && quote.home) {
      if (!teamHitsGame(game, quote.away) || !teamHitsGame(game, quote.home)) continue;
    }
    hits.push(game);
  }
  return hits.length === 1 ? hits[0] : null;
}

// Synthetic Betstamp markets so applyStreamMarkets can paint the cell.
// liveBoard forces is_live: Kalshi has no in-game flag, and a pregame
// stamp would be ignored once the fixture is already live.
export function venueQuotesToMarkets(games, quotes, { liveBoard = false } = {}) {
  const markets = [];
  for (const quote of quotes || []) {
    if (!quote || quote.odds == null) continue;
    if (quote.bet_type && quote.bet_type !== "moneyline") continue;
    const game = matchGameForQuote(games, quote);
    if (!game) continue;
    markets.push({
      fixture_id: game.id,
      odd_provider_id: quote.book_id,
      bet_type: "Moneyline",
      period: "FT",
      is_alt: false,
      side: quote.side,
      odds: quote.odds,
      size: quote.size,
      is_live: liveBoard === true || quote.is_live === true,
      updated_at: quote.updated_at,
    });
  }
  return markets;
}
