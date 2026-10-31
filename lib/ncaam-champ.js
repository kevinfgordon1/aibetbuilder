'use strict';

// NCAAM national champion futures (Kevin Oct 30 2026).
//   Yes side: every sportsbook (Odds API outrights) + Kalshi KXMARMAD + Polymarket US cbb-champ-*.
//   Opposing (No) side: Kalshi and Polymarket US only (books do not sell "will not win"), each with its own
//   taker fee (applyBookAdjustments: Kalshi 0.07, Polymarket US 0.0695 = gateway feeCoefficient).
//   Polymarket US replaces the international gamma event for this league.
//   Teams join on ESPN team id through lib/ncaam-champ-crosswalk.json (73 teams, regenerate with
//   scripts/gen-ncaam-champ-crosswalk.cjs) and lib/ncaab-d1.js; anything unmatched is dropped.
//   Depth is reported as potential profit: contracts x (1 - p) - taker fee, at the top-of-book price.

const { d1Team } = require('./ncaab-d1');
const XWALK = require('./ncaam-champ-crosswalk.json');
const POLY_FEE = require('./polymarket-us-fee.json').takerFeeCoefficient;

const KALSHI_FEE = 0.07;
const POLY_GATEWAY = 'https://gateway.polymarket.us';
// Gateway /book allows ~6 calls then a ~10s lockout (lib/player-td-feeds.js), so book sizes are best-effort:
// the likeliest teams first, paced, stopping at the first 429.
const MAX_POLY_BOOKS = 12;
const POLY_BOOK_GAP_MS = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BY_POLY_SLUG = new Map();
const BY_KALSHI_TICKER = new Map();
const BY_ESPN = new Map();
for (const t of XWALK.teams || []) {
  BY_ESPN.set(t.espnId, t);
  if (t.polymarket && t.polymarket.slug) BY_POLY_SLUG.set(t.polymarket.slug, t);
  if (t.kalshi && t.kalshi.ticker) BY_KALSHI_TICKER.set(t.kalshi.ticker, t);
}

function probToAmerican(p) {
  if (p == null || !(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v && typeof v === 'object' ? v.value : v);
  return Number.isFinite(n) ? n : null;
}

// Potential profit (USD) of buying `contracts` at price p with taker fee theta*p*(1-p) per contract.
function potentialProfit(contracts, p, theta) {
  const n = Number(contracts);
  if (!(n > 0) || !(p > 0 && p < 1)) return null;
  const v = n * (1 - p) - n * theta * p * (1 - p);
  return v > 0 ? Math.round(v * 100) / 100 : null;
}

// ESPN team id for a contract: crosswalk first (exact slug / ticker), then the D1 name matcher.
function espnIdForPoly(slug, teamName) {
  const x = BY_POLY_SLUG.get(slug);
  if (x) return x.espnId;
  const t = d1Team(teamName);
  return t && BY_ESPN.has(t.espnId) ? t.espnId : null;
}
function espnIdForKalshi(ticker, label) {
  const x = BY_KALSHI_TICKER.get(ticker);
  if (x) return x.espnId;
  const t = d1Team(label);
  return t && BY_ESPN.has(t.espnId) ? t.espnId : null;
}

async function getJson(fetchFn, url) {
  try {
    const r = await fetchFn(url, { headers: { accept: 'application/json' } });
    if (!r || !r.ok) return { ok: false, status: r ? r.status : 0, body: null };
    return { ok: true, status: r.status, body: await r.json() };
  } catch (_) {
    return { ok: false, status: 0, body: null };
  }
}

// Polymarket US champion contracts: [{ espnId, team, yesP, noP, yes, no, yesSize, noSize, yesProfit, noProfit }].
async function fetchPolymarketUsChamp({ fetchFn = fetch, sleepFn = sleep, maxBooks = MAX_POLY_BOOKS } = {}) {
  const list = await getJson(fetchFn, `${POLY_GATEWAY}/v2/leagues/cbb/events?type=futures&limit=100&active=true&closed=false`);
  const events = (list.body && list.body.events) || [];
  const ev = events.find((e) => /^cbb-champ-/.test(String(e.slug || '')) && !e.closed && e.active !== false);
  if (!ev) return [];
  const full = await getJson(fetchFn, `${POLY_GATEWAY}/v1/events/slug/${encodeURIComponent(ev.slug)}`);
  const event = full.body && (full.body.event || full.body);
  const out = [];
  for (const m of (event && event.markets) || []) {
    if (!m || m.closed || m.active === false) continue;
    const side = (m.marketSides || []).find((s) => s && s.long) || {};
    const team = side.team || {};
    const espnId = espnIdForPoly(m.slug, team.safeName || team.name);
    if (!espnId) continue; // unmatched: dropped
    const ask = num(m.bestAskQuote);
    const bid = num(m.bestBidQuote);
    const yesP = ask != null && ask > 0 && ask < 1 ? ask : null;
    const noP = bid != null && bid > 0 && bid < 1 ? Math.round((1 - bid) * 10000) / 10000 : null;
    if (yesP == null && noP == null) continue;
    const theta = num(m.feeCoefficient) != null ? num(m.feeCoefficient) : POLY_FEE;
    out.push({ espnId, slug: m.slug, team: team.name || null, theta, yesP, noP, yes: probToAmerican(yesP), no: probToAmerican(noP), yesSize: null, noSize: null, yesProfit: null, noProfit: null });
  }
  // Top-of-book sizes (contracts) for the likeliest teams. Yes = best offer qty; No = best bid qty.
  const byLikely = out.slice().sort((a, b) => (b.yesP || 0) - (a.yesP || 0)).slice(0, maxBooks);
  for (let i = 0; i < byLikely.length; i += 1) {
    const r = byLikely[i];
    const book = await getJson(fetchFn, `${POLY_GATEWAY}/v1/markets/${encodeURIComponent(r.slug)}/book`);
    if (book.status === 429) break;
    const data = book.body && (book.body.marketData || book.body);
    const offers = (data && (data.offers || data.asks)) || [];
    const bids = (data && data.bids) || [];
    const bestOffer = offers.map((o) => ({ p: num(o.px), q: num(o.qty) })).filter((o) => o.p != null && o.q != null).sort((a, b) => a.p - b.p)[0];
    const bestBid = bids.map((o) => ({ p: num(o.px), q: num(o.qty) })).filter((o) => o.p != null && o.q != null).sort((a, b) => b.p - a.p)[0];
    if (bestOffer && r.yesP != null && Math.abs(bestOffer.p - r.yesP) < 1e-9) r.yesSize = bestOffer.q;
    if (bestBid && r.noP != null && Math.abs((1 - bestBid.p) - r.noP) < 1e-6) r.noSize = bestBid.q;
    r.yesProfit = potentialProfit(r.yesSize, r.yesP, r.theta);
    r.noProfit = potentialProfit(r.noSize, r.noP, r.theta);
    if (i < byLikely.length - 1) await sleepFn(POLY_BOOK_GAP_MS);
  }
  return out;
}

function kalshiPrice(dollars, cents) {
  const d = parseFloat(dollars);
  if (Number.isFinite(d)) return d;
  const c = Number(cents);
  return Number.isFinite(c) ? c / 100 : null;
}

// Kalshi KXMARMAD contracts from an /events?series_ticker=KXMARMAD&with_nested_markets=true body.
function kalshiChampFromEvents(body) {
  const out = [];
  for (const m of ((body && body.events) || []).flatMap((e) => e.markets || [])) {
    if (m.status && m.status !== 'active' && m.status !== 'open') continue;
    const espnId = espnIdForKalshi(m.ticker, m.yes_sub_title);
    if (!espnId) continue;
    const y = kalshiPrice(m.yes_ask_dollars, m.yes_ask);
    const n = kalshiPrice(m.no_ask_dollars, m.no_ask);
    const yesP = y != null && y > 0 && y < 1 ? y : null;
    const noP = n != null && n > 0 && n < 1 ? n : null;
    if (yesP == null && noP == null) continue;
    const ys = parseFloat(m.yes_ask_size_fp);
    const ns = parseFloat(m.no_ask_size_fp != null ? m.no_ask_size_fp : m.yes_bid_size_fp);
    const yesSize = Number.isFinite(ys) && ys > 0 ? ys : null;
    const noSize = Number.isFinite(ns) && ns > 0 ? ns : null;
    out.push({ espnId, ticker: m.ticker, team: m.yes_sub_title || null, yesP, noP, yes: probToAmerican(yesP), no: probToAmerican(noP), yesSize, noSize,
      yesProfit: potentialProfit(yesSize, yesP, KALSHI_FEE), noProfit: potentialProfit(noSize, noP, KALSHI_FEE) });
  }
  return out;
}

// Inject Kalshi + Polymarket US bookmakers onto the Odds API outrights event, using each team's sportsbook
// name when a book lists it (joined by ESPN id) and the ESPN display name otherwise. Raw prices (no fee) go in;
// applyBookAdjustments bakes the venue fee in afterwards. `profit` = depth as potential profit (fee in).
function buildNcaamChampBookmakers(rawData, { polymarket = [], kalshi = [] } = {}, nowIso = new Date().toISOString()) {
  const ev = Array.isArray(rawData) ? rawData[0] : null;
  const bookName = new Map();
  const unmatchedBooks = new Set();
  for (const bm of (ev && ev.bookmakers) || []) {
    for (const mk of bm.markets || []) {
      if (mk.key !== 'outrights') continue;
      for (const o of mk.outcomes || []) {
        const t = o && o.name ? d1Team(o.name) : null;
        if (t && !bookName.has(t.espnId)) bookName.set(t.espnId, o.name);
        else if (!t && o && o.name) unmatchedBooks.add(o.name);
      }
    }
  }
  const nameFor = (espnId) => bookName.get(espnId) || (BY_ESPN.get(espnId) || {}).name || null;
  const bookmakers = [];
  for (const [key, title, rows] of [['polymarket', 'Polymarket US', polymarket], ['kalshi', 'Kalshi', kalshi]]) {
    const yesOut = [];
    const noOut = [];
    for (const r of rows || []) {
      const name = nameFor(r.espnId);
      if (!name) continue;
      if (r.yes != null) yesOut.push({ name, price: r.yes, size: r.yesSize, profit: r.yesProfit });
      if (r.no != null) noOut.push({ name, price: r.no, size: r.noSize, profit: r.noProfit });
    }
    if (yesOut.length || noOut.length) {
      bookmakers.push({ key, title, last_update: nowIso, markets: [
        ...(yesOut.length ? [{ key: 'outrights', outcomes: yesOut }] : []),
        ...(noOut.length ? [{ key: 'outrights_lay', outcomes: noOut }] : []),
      ] });
    }
  }
  return { bookmakers, diag: { polymarket: polymarket.length, kalshi: kalshi.length, unmatchedBooks: [...unmatchedBooks].slice(0, 20) } };
}

// One row per team on the Odds Board (Kevin Oct 30 2026: NCAAM Championship laid out like the NFL one).
// Sportsbooks spell schools differently ("Loyola (Chi) Ramblers" vs "Loyola Chicago Ramblers"), and the board
// groups by outcome name, so rename every outcome (every book + Kalshi + Polymarket US, Yes and No) to one
// name per ESPN team id: the first sportsbook spelling, else the crosswalk name. Unresolved names pass through.
function unifyTeamNames(rawData) {
  if (!Array.isArray(rawData)) return rawData;
  const EXCH = new Set(['kalshi', 'polymarket']);
  const canon = new Map();
  const idOf = new Map();
  const resolve = (name) => {
    if (!idOf.has(name)) { const t = d1Team(name); idOf.set(name, t ? t.espnId : null); }
    return idOf.get(name);
  };
  const walk = (fn) => rawData.forEach((ev) => (ev && ev.bookmakers || []).forEach((bm) => (bm.markets || []).forEach((mk) => {
    if (mk.key !== 'outrights' && mk.key !== 'outrights_lay') return;
    (mk.outcomes || []).forEach((o) => { if (o && o.name) fn(bm, o); });
  })));
  walk((bm, o) => { const id = resolve(o.name); if (id && !EXCH.has(bm.key) && !canon.has(id)) canon.set(id, o.name); });
  walk((bm, o) => { const id = resolve(o.name); if (id && !canon.has(id)) canon.set(id, (BY_ESPN.get(id) || {}).name || o.name); });
  let renamed = 0;
  walk((bm, o) => { const id = resolve(o.name); const c = id && canon.get(id); if (c && c !== o.name) { o.name = c; renamed += 1; } });
  return renamed;
}

// The Odds API sometimes returns no event for the league (preseason); exchanges still deserve a row.
function ensureOutrightsEvent(rawData, sport, nowIso = new Date().toISOString()) {
  if (Array.isArray(rawData) && rawData[0]) return rawData;
  return [{ id: `${sport}-exchanges`, sport_key: sport, sport_title: 'NCAAB Championship Winner', commence_time: nowIso, home_team: null, away_team: null, bookmakers: [] }];
}

module.exports = {
  KALSHI_FEE, POLY_FEE, MAX_POLY_BOOKS, XWALK_TEAM_COUNT: (XWALK.teams || []).length,
  probToAmerican, potentialProfit, espnIdForPoly, espnIdForKalshi,
  fetchPolymarketUsChamp, kalshiChampFromEvents, buildNcaamChampBookmakers, ensureOutrightsEvent, unifyTeamNames,
};
