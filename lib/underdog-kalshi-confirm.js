'use strict';

// Underdog Predict moneylines are Kalshi KXxxGAME contracts, and the phone
// price is Kalshi's yes ask plus the UDX fee (lib/underdog-predict-fee.js):
// Troy 8c → +1070, BKN 16-17c → +490 (2026-10-27, phone experience).
//
// Underdog's updated_at only moves when that price CHANGES. A deep Kalshi
// book can sit on the same cent for days (HOU @ JAX unchanged 52h, KC -435
// 143h), so the age gates in underdog-freshness.js read a live price as
// stale and dropped 11 of 14 NFL games in a 7-day window.
//
// Here an aged h2h side is confirmed live only when the AMERICAN PRICE we
// actually use agrees with Kalshi's current yes ask after the UDX fee
// (within KALSHI_PRICE_TOLERANCE of implied probability). Matching only
// the probability field is not enough: on 2026-10-27 the old 018e1234
// experience printed Troy probability 8 (= Kalshi 8c) with a frozen +835
// (≈10.7c) and was wrongly restamped fresh. A confirmed side gets
// updatedAt = the Kalshi read time; the old stamp is kept as
// priceChangedAt. Every side matched to Kalshi carries kalshiDriftPts
// (signed implied-probability points vs ask + fee); a side whose price
// disagrees keeps its own stamp so it still ages out. Any Kalshi failure
// confirms nothing, so behavior falls back to the timestamp rules.
//
// Options without an event_ticker (most of the phone experience's grouped
// list) are matched to a Kalshi game by both team names and kickoff
// (Kalshi expected_expiration_time ≈ kickoff + ~3h, within
// KALSHI_GAME_WINDOW_MS). Spreads and totals are not confirmed (alt-line
// tickers are not 1:1).

const { underdogPredictFeePerContract } = require('./underdog-predict-fee');

const KALSHI_BASE = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_GAME_SERIES = { NFL: 'KXNFLGAME', CFB: 'KXNCAAFGAME', MLB: 'KXMLBGAME', NHL: 'KXNHLGAME', NBA: 'KXNBAGAME' };
const KALSHI_CONFIRM_TOLERANCE = 0.01;
// Implied-probability tolerance between the Underdog American and Kalshi's
// ask + UDX fee. Underdog rounds American prints; 1 point covers that.
const KALSHI_PRICE_TOLERANCE = 0.01;
// Kalshi expected_expiration_time sits ~3h after kickoff (college tickers
// are sometimes dated a day early), so allow a wide but same-slate window.
const KALSHI_GAME_WINDOW_MS = 30 * 60 * 60 * 1000;
const KALSHI_ASKS_CACHE_MS = 30 * 1000;
const KALSHI_MAX_PAGES = 3;
const defaultAsksCache = new Map();

// Kalshi spells "Kennesaw St." / "Montana St."; Underdog spells "State".
function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map((t) => (t === 'st' ? 'state' : t)).join(' ');
}

function dollars(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

function marketAsk(m) {
  if (!m) return null;
  const d = dollars(m.yes_ask_dollars);
  if (d != null) return d;
  const cents = Number(m.yes_ask);
  return Number.isFinite(cents) && cents > 0 && cents < 100 ? cents / 100 : null;
}

async function fetchSeriesMarkets(fetchFn, series) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < KALSHI_MAX_PAGES; page += 1) {
    const url = `${KALSHI_BASE}/markets?series_ticker=${encodeURIComponent(series)}&status=open&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchFn(url, { headers: { accept: 'application/json' } });
    if (!res || !res.ok) break;
    const body = await res.json();
    for (const m of (body && body.markets) || []) out.push(m);
    cursor = body && body.cursor;
    if (!cursor) break;
  }
  return out;
}

// Map event_ticker -> [{ code, sub, ask }]. Never throws.
async function fetchKalshiGameAsks(fetchFn, sportIds, now = Date.now(), cache = defaultAsksCache) {
  const byEvent = new Map();
  let fetchedAt = null;
  const series = [...new Set((sportIds || []).map((id) => KALSHI_GAME_SERIES[id]).filter(Boolean))];
  await Promise.all(series.map(async (s) => {
    let hit = cache && cache.get(s);
    if (!hit || now - hit.at >= KALSHI_ASKS_CACHE_MS) {
      try {
        const markets = await fetchSeriesMarkets(fetchFn, s);
        hit = { at: now, markets };
        if (cache && markets.length) cache.set(s, hit);
      } catch (_) {
        hit = { at: now, markets: [] };
      }
    }
    for (const m of hit.markets) {
      const event = m && m.event_ticker;
      const ask = marketAsk(m);
      if (!event || ask == null || !m.ticker) continue;
      const code = String(m.ticker).slice(String(event).length + 1);
      if (!byEvent.has(event)) byEvent.set(event, []);
      const exp = Date.parse(m.expected_expiration_time || m.occurrence_datetime || '') || null;
      byEvent.get(event).push({ code: code.toUpperCase(), sub: normName(m.yes_sub_title), ask, at: hit.at, exp });
    }
    if (hit.markets.length) fetchedAt = fetchedAt == null ? hit.at : Math.min(fetchedAt, hit.at);
  }));
  return { byEvent, fetchedAt };
}

function kalshiMarketForSide(markets, line) {
  if (!Array.isArray(markets) || !markets.length || !line) return null;
  const code = String(line.sideCode || '').toUpperCase();
  if (code) {
    const byCode = markets.filter((m) => m.code === code);
    if (byCode.length === 1) return byCode[0];
  }
  const name = normName(line.sideName || line.name);
  if (!name) return null;
  const byName = markets.filter((m) => m.sub && m.sub.length >= 3 && (name === m.sub || name.startsWith(`${m.sub} `) || name.startsWith(m.sub)));
  if (byName.length === 1) return byName[0];
  // "Los Angeles" prefix of both Rams and Chargers: take the longest unique sub.
  if (byName.length > 1) {
    const longest = Math.max(...byName.map((m) => m.sub.length));
    const top = byName.filter((m) => m.sub.length === longest);
    if (top.length === 1) return top[0];
  }
  return null;
}

function impliedFromAmerican(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}

// Kalshi yes ask → the phone's effective price (ask + UDX fee), 0..1.
function phonePriceFromKalshiAsk(ask) {
  const p = Number(ask);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  return p + underdogPredictFeePerContract(p);
}

function americanFromPrice(p) {
  if (!(p > 0 && p < 1)) return null;
  const d = 1 / p;
  return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1));
}

// Signed drift in implied-probability points: + means the Underdog price
// pays LESS than Kalshi + fee (e.g. Troy +835 vs +1072 → +2.2).
function kalshiDriftPts(american, ask) {
  const ud = impliedFromAmerican(american);
  const k = phonePriceFromKalshiAsk(ask);
  if (ud == null || k == null) return null;
  return Math.round((ud - k) * 1000) / 10;
}

function priceAgreesWithKalshi(american, ask, tol = KALSHI_PRICE_TOLERANCE) {
  const ud = impliedFromAmerican(american);
  const k = phonePriceFromKalshiAsk(ask);
  if (ud == null || k == null) return false;
  return Math.abs(ud - k) <= tol + 1e-9;
}

function nameHitsMarket(name, market) {
  const n = normName(name);
  if (!n || !market || !market.sub || market.sub.length < 3) return false;
  return n === market.sub || n.startsWith(`${market.sub} `);
}

// Underdog side with no event_ticker → the Kalshi game whose two markets
// match the game's two team names, closest to kickoff. Returns the market
// list for that event or null. A name that hits more than one market of an
// event (e.g. "Sam Houston" vs "Samford") resolves by the longest sub.
function kalshiEventForGame(byEvent, game) {
  if (!byEvent || !game || !game.away || !game.home) return null;
  const kickoff = Date.parse(game.scheduledAt || '') || null;
  let best = null;
  let bestDelta = Infinity;
  for (const markets of byEvent.values()) {
    if (!Array.isArray(markets) || markets.length < 2) continue;
    const a = kalshiMarketForSide(markets, { name: game.away });
    const h = kalshiMarketForSide(markets, { name: game.home });
    if (!a || !h || a === h) continue;
    if (!nameHitsMarket(game.away, a) || !nameHitsMarket(game.home, h)) continue;
    const exp = a.exp || h.exp || null;
    const delta = kickoff && exp ? Math.abs(exp - kickoff) : 0;
    if (kickoff && exp && delta > KALSHI_GAME_WINDOW_MS) continue;
    if (delta < bestDelta) { best = markets; bestDelta = delta; }
  }
  return best;
}

// Mutates nothing; returns new line objects. Internal side fields are removed.
// game (optional): { away, home, scheduledAt } for options with no ticker.
function confirmUnderdogLinesWithKalshi(lines, asks, game = null) {
  const byEvent = asks && asks.byEvent;
  return (lines || []).map((line) => {
    if (!line) return line;
    const { eventTicker, sideCode, sideName, ...rest } = line;
    if (!byEvent || rest.market !== 'h2h' || rest.american == null) return rest;
    const markets = eventTicker && byEvent.get(eventTicker)
      ? byEvent.get(eventTicker)
      : kalshiEventForGame(byEvent, game);
    if (!markets) return rest;
    const market = kalshiMarketForSide(markets, { sideCode: eventTicker ? sideCode : null, sideName, name: rest.name });
    if (!market) return rest;
    const drift = kalshiDriftPts(rest.american, market.ask);
    const checked = drift == null ? rest : { ...rest, kalshiDriftPts: drift };
    if (!priceAgreesWithKalshi(rest.american, market.ask)) return checked;
    if (rest.priceSuspect) return checked;
    const prev = Number(rest.updatedAt);
    if (Number.isFinite(prev) && prev >= market.at) return checked;
    return {
      ...checked,
      updatedAt: market.at,
      ...(Number.isFinite(prev) && prev > 0 ? { priceChangedAt: prev } : {}),
      confirmedBy: 'kalshi',
    };
  });
}

module.exports = {
  KALSHI_ASKS_CACHE_MS,
  KALSHI_CONFIRM_TOLERANCE,
  KALSHI_PRICE_TOLERANCE,
  KALSHI_GAME_WINDOW_MS,
  americanFromPrice,
  kalshiDriftPts,
  kalshiEventForGame,
  phonePriceFromKalshiAsk,
  priceAgreesWithKalshi,
  KALSHI_GAME_SERIES,
  confirmUnderdogLinesWithKalshi,
  fetchKalshiGameAsks,
  kalshiMarketForSide,
};
