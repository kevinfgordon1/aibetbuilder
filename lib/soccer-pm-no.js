'use strict';

// Soccer Promo / Free Bet No resolution from prediction-market books.
// Odds API soccer is Yes-only on Kalshi (no h2h_lay). True No is the PM
// catalog / orderbook ask: Kalshi YES bids → No asks.
//
// Ranking path: Kalshi nested-market no_ask covers the EPL/MLS slate (one
// catalog fetch per series). Poly / Novig / ProphetX use the same book-depth
// No helpers; merge them when a fetch fn is injected. Betfair/Matchbook
// h2h_lay stays a last-resort fallback in transform — not the ranking path.

const {
  SOCCER_ML_SIDES,
  isSoccerSport,
  soccerSideTeam,
  soccerPmGameKey,
  pickBestSoccerLay,
} = require('./soccer-pairing');
const {
  KALSHI_SERIES,
  matchKalshiMarket,
  kalshiCatalogTop,
  fetchKalshiSeriesEvents,
  fetchVenueDepth,
} = require('./book-depth');

const SOCCER_PM_NO_VENUES = ['kalshi', 'polymarket', 'novig', 'prophetx'];

function emptySideMap() {
  return Object.fromEntries(SOCCER_ML_SIDES.map((s) => [s, []]));
}

function addQuote(bucket, side, quote) {
  if (!quote || quote.price == null) return;
  bucket[side].push(quote);
}

function finalizeQuotes(quotesBySide) {
  const out = {};
  for (const side of SOCCER_ML_SIDES) {
    const picked = pickBestSoccerLay(quotesBySide[side] || []);
    if (picked.best == null) continue;
    out[side] = picked;
  }
  return out;
}

async function resolveKalshiSoccerNos(games, { eventsBySport } = {}) {
  const list = (games || []).filter((g) => isSoccerSport(g.sport));
  const catalogs = { ...(eventsBySport || {}) };
  const sports = [...new Set(list.map((g) => g.sport))];
  for (const sport of sports) {
    if (catalogs[sport]) continue;
    const series = (KALSHI_SERIES[sport] || {}).ML;
    if (!series) continue;
    catalogs[sport] = await fetchKalshiSeriesEvents(series);
  }

  const out = {};
  for (const g of list) {
    const key = soccerPmGameKey(g);
    const sides = emptySideMap();
    for (const side of SOCCER_ML_SIDES) {
      const team = soccerSideTeam(side, g.away, g.home);
      const sel = {
        market: 'ML',
        sport: g.sport,
        away: g.away,
        home: g.home,
        team,
        buySide: 'no',
      };
      const hit = matchKalshiMarket(sel, catalogs[g.sport] || []);
      const top = hit && kalshiCatalogTop(hit.market, 'no');
      if (!top) continue;
      addQuote(sides, side, { book: 'kalshi', price: top.american, size: top.size });
    }
    out[key] = finalizeQuotes(sides);
  }
  return out;
}

async function quoteVenueSoccerNo(game, side, venue, fetchVenueDepthFn) {
  const team = soccerSideTeam(side, game.away, game.home);
  const fetched = await fetchVenueDepthFn({
    venue,
    market: 'ML',
    sport: game.sport,
    game: `${game.away} @ ${game.home}`,
    away: game.away,
    home: game.home,
    commence_time: game.commence_time,
    team,
    buySide: 'no',
  });
  const top = fetched && fetched.levels && fetched.levels[0];
  if (!top || top.american == null) {
    return { quote: null, reason: (fetched && fetched.reason) || 'empty' };
  }
  return {
    quote: { book: venue, price: top.american, size: top.size ?? null },
    reason: fetched.reason || 'ok',
  };
}

async function resolveOtherPmSoccerNos(games, {
  venues,
  fetchVenueDepthFn = fetchVenueDepth,
} = {}) {
  const list = (games || []).filter((g) => isSoccerSport(g.sport));
  const wanted = (venues || []).filter((v) => v && v !== 'kalshi');
  const out = {};
  const skip = new Set();
  for (const venue of wanted) {
    for (const g of list) {
      if (skip.has(venue)) break;
      const key = soccerPmGameKey(g);
      if (!out[key]) out[key] = emptySideMap();
      for (const side of SOCCER_ML_SIDES) {
        const { quote, reason } = await quoteVenueSoccerNo(g, side, venue, fetchVenueDepthFn);
        if (reason === 'prophetx_needs_credentials' || reason === 'novig_needs_credentials') {
          skip.add(venue);
          break;
        }
        addQuote(out[key], side, quote);
      }
    }
  }
  const finalized = {};
  for (const [key, sides] of Object.entries(out)) {
    finalized[key] = finalizeQuotes(sides);
  }
  return finalized;
}

function mergePmNoMaps(...maps) {
  const merged = {};
  for (const map of maps) {
    for (const [key, rec] of Object.entries(map || {})) {
      if (!merged[key]) merged[key] = emptySideMap();
      for (const side of SOCCER_ML_SIDES) {
        const q = rec && rec[side];
        if (!q || q.best == null) continue;
        addQuote(merged[key], side, {
          book: q.bestBook,
          price: q.best,
          size: q.bestSize,
        });
      }
    }
  }
  const out = {};
  for (const [key, sides] of Object.entries(merged)) {
    out[key] = finalizeQuotes(sides);
  }
  return out;
}

async function resolveSoccerPmNos(games, {
  venues = SOCCER_PM_NO_VENUES,
  trustedBookKeys,
  eventsBySport,
  fetchVenueDepthFn = null,
} = {}) {
  const allowed = (venues || []).filter((v) => SOCCER_PM_NO_VENUES.includes(v))
    .filter((v) => !trustedBookKeys || trustedBookKeys.has(v));
  const maps = [];
  if (allowed.includes('kalshi')) {
    maps.push(await resolveKalshiSoccerNos(games, { eventsBySport }));
  }
  // Poly / Novig / ProphetX use the same book-depth No path. Ranking only
  // fans out when a fetch fn is injected (tests / small slates). Live Promo
  // uses Kalshi catalog for the full EPL/MLS slate — keyless and complete.
  const others = allowed.filter((v) => v !== 'kalshi');
  if (others.length && fetchVenueDepthFn) {
    maps.push(await resolveOtherPmSoccerNos(games, { venues: others, fetchVenueDepthFn }));
  }
  return mergePmNoMaps(...maps);
}

module.exports = {
  SOCCER_PM_NO_VENUES,
  resolveKalshiSoccerNos,
  resolveOtherPmSoccerNos,
  resolveSoccerPmNos,
  mergePmNoMaps,
  quoteVenueSoccerNo,
};
