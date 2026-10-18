'use strict';

// Underdog Predict moneylines are Kalshi KXxxGAME contracts (each option
// carries event_ticker), and the phone price is Kalshi's yes ask: checked
// 2026-10-17 on all 54 NFL sides, e.g. HOU @ JAX +117 / -145 = 44c / 57c.
//
// Underdog's updated_at only moves when that price CHANGES. A deep Kalshi
// book can sit on the same cent for days (HOU @ JAX unchanged 52h, KC -435
// 143h), so the age gates in underdog-freshness.js read a live price as
// stale and dropped 11 of 14 NFL games in a 7-day window.
//
// Here an aged h2h side is confirmed live when Kalshi's current yes ask for
// that same team is within 1c of the Underdog probability. A confirmed side
// gets updatedAt = the Kalshi read time; the old stamp is kept as
// priceChangedAt. A frozen quote that no longer matches Kalshi (Miami
// -1112, match 183027) is not confirmed and still ages out. Any Kalshi
// failure confirms nothing, so behavior falls back to the timestamp rules.
// Spreads and totals are not confirmed (alt-line tickers are not 1:1).

const KALSHI_BASE = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_GAME_SERIES = { NFL: 'KXNFLGAME', CFB: 'KXNCAAFGAME', MLB: 'KXMLBGAME', NHL: 'KXNHLGAME' };
const KALSHI_CONFIRM_TOLERANCE = 0.01;
const KALSHI_ASKS_CACHE_MS = 30 * 1000;
const KALSHI_MAX_PAGES = 3;
const defaultAsksCache = new Map();

function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
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
      byEvent.get(event).push({ code: code.toUpperCase(), sub: normName(m.yes_sub_title), ask, at: hit.at });
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

// Mutates nothing; returns new line objects. Internal side fields are removed.
function confirmUnderdogLinesWithKalshi(lines, asks) {
  const byEvent = asks && asks.byEvent;
  return (lines || []).map((line) => {
    if (!line) return line;
    const { eventTicker, sideCode, sideName, ...rest } = line;
    if (!byEvent || rest.market !== 'h2h' || !eventTicker || rest.probability == null) return rest;
    const market = kalshiMarketForSide(byEvent.get(eventTicker), line);
    if (!market) return rest;
    if (Math.abs(Number(rest.probability) - market.ask) > KALSHI_CONFIRM_TOLERANCE + 1e-9) return rest;
    const prev = Number(rest.updatedAt);
    if (Number.isFinite(prev) && prev >= market.at) return rest;
    return {
      ...rest,
      updatedAt: market.at,
      ...(Number.isFinite(prev) && prev > 0 ? { priceChangedAt: prev } : {}),
      confirmedBy: 'kalshi',
    };
  });
}

module.exports = {
  KALSHI_ASKS_CACHE_MS,
  KALSHI_CONFIRM_TOLERANCE,
  KALSHI_GAME_SERIES,
  confirmUnderdogLinesWithKalshi,
  fetchKalshiGameAsks,
  kalshiMarketForSide,
};
