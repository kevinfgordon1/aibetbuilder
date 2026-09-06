'use strict';

// On-demand prediction-market depth for Promo true-odds lines.
// The Odds API includeBetLimits is top-of-book only (one bet_limit / outcome) —
// there is no depth parameter. Cron must not deep-fetch every game.
//
// Real books today:
//   kalshi     — public GET /markets/{ticker}/orderbook?depth=N (keyless)
//   polymarket — public CLOB GET /book?token_id= (keyless)
//   prophetx   — affiliate get_markets (needs PROPHETX_API_KEY or access/secret)
//   novig      — GET /nbx/v2/emm/book/{id} (needs NOVIG_CLIENT_ID + SECRET)
//
// Display only. No orders.
// Blended $1,000-face VWAP: src/blendAskLadder.js (walks these levels on Promo true-odds).

// Same taker-fee / commission math as lib/odds-shared.js (kept local so this
// module does not pull the Supabase client into the on-demand depth path).
const KALSHI_FEE_COEFF = 0.07;
const POLYMARKET_FEE_COEFF = 0.05;
const PROPHETX_COMMISSION_RATE = 0.02;

function applyTakerFee(rawAmericanOdds, theta) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  let p;
  if (rawAmericanOdds > 0) p = 100 / (rawAmericanOdds + 100);
  else p = Math.abs(rawAmericanOdds) / (Math.abs(rawAmericanOdds) + 100);
  if (p <= 0 || p >= 1) return rawAmericanOdds;
  const effPrice = p * (1 + theta * (1 - p));
  const decimalOdds = 1 / effPrice;
  if (decimalOdds <= 1) return rawAmericanOdds;
  if (decimalOdds >= 2) return Math.round((decimalOdds - 1) * 100);
  return -Math.round(100 / (decimalOdds - 1));
}

function applyKalshiFee(raw) { return applyTakerFee(raw, KALSHI_FEE_COEFF); }
function applyPolymarketFee(raw) { return applyTakerFee(raw, POLYMARKET_FEE_COEFF); }
function applyProphetXCommission(rawAmericanOdds) {
  if (rawAmericanOdds === null || rawAmericanOdds === undefined) return rawAmericanOdds;
  const rawDecimal = rawAmericanOdds > 0 ? 1 + rawAmericanOdds / 100 : 1 + 100 / Math.abs(rawAmericanOdds);
  const effectiveDecimal = 1 + (rawDecimal - 1) * (1 - PROPHETX_COMMISSION_RATE);
  if (effectiveDecimal <= 1) return rawAmericanOdds;
  if (effectiveDecimal >= 2) return Math.round((effectiveDecimal - 1) * 100);
  return -Math.round(100 / (effectiveDecimal - 1));
}

const DEPTH_VENUES = new Set(['kalshi', 'polymarket', 'prophetx', 'novig']);
const MAX_LEGS = 8;
const FETCH_MS = 10000;
const CATALOG_TTL_MS = 60 * 1000;
const KALSHI_BASE = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const POLY_GAMMA = 'https://gamma-api.polymarket.com';
const POLY_CLOB = 'https://clob.polymarket.com';
const PROPHETX_BASE = process.env.PROPHETX_API_BASE || 'https://cash.api.prophetx.co/partner';
const NOVIG_BASE = process.env.NOVIG_API_BASE || 'https://api.novig.us';

const KALSHI_SERIES = {
  baseball_mlb: { ML: 'KXMLBGAME', SPR: 'KXMLBSPREAD', TOT: 'KXMLBTOTAL' },
  americanfootball_nfl: { ML: 'KXNFLGAME', SPR: 'KXNFLSPREAD', TOT: 'KXNFLTOTAL' },
  americanfootball_ncaaf: { ML: 'KXNCAAFGAME', SPR: 'KXNCAAFSPREAD', TOT: 'KXNCAAFTOTAL' },
};

const STOP = new Set([
  'the', 'and', 'vs', 'versus', 'at', 'over', 'under', 'total', 'points', 'scored',
  'game', 'wins', 'by', 'st', 'state', 'university', 'univ',
]);

const catalogCache = new Map();

function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = FETCH_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, {
    method,
    headers: { accept: 'application/json', 'user-agent': 'aibetbuilder/1.0 (+https://aibetbuilder.io)', ...headers },
    body,
    signal: ctrl.signal,
  }).then(async (r) => {
    const text = await r.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch (_) { json = null; }
    }
    return { ok: r.ok, status: r.status, json, text };
  }).catch((e) => ({ ok: false, status: 0, json: null, text: String(e && e.message || e) }))
    .finally(() => clearTimeout(t));
}

function cached(key, loader) {
  const hit = catalogCache.get(key);
  if (hit && (Date.now() - hit.at) < CATALOG_TTL_MS) return Promise.resolve(hit.data);
  return loader().then((data) => {
    catalogCache.set(key, { at: Date.now(), data });
    return data;
  });
}

function nameTokens(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && w.length >= 2 && !STOP.has(w));
}

function teamsFromGame(game) {
  const parts = String(game || '').split(/\s+@\s+|\s+vs\.?\s+/i);
  if (parts.length >= 2) return { away: parts[0].trim(), home: parts[1].trim() };
  return { away: '', home: '' };
}

function tokensHit(hayTokens, needleTokens) {
  if (!needleTokens.length) return false;
  return needleTokens.some((n) => hayTokens.includes(n) || hayTokens.some((h) => h.includes(n) || n.includes(h)));
}

function eventMatchesTeams(title, away, home) {
  const t = nameTokens(title);
  return tokensHit(t, nameTokens(away)) && tokensHit(t, nameTokens(home));
}

function lineEqual(a, b) {
  if (a == null || b == null || !isFinite(Number(a)) || !isFinite(Number(b))) return false;
  return Math.abs(Number(a) - Number(b)) < 1e-9;
}

function probToAmerican(p) {
  if (p == null || !isFinite(p) || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return -Math.round((100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

function decimalToAmerican(d) {
  if (d == null || !isFinite(d) || d <= 1) return null;
  if (d >= 2) return Math.round((d - 1) * 100);
  return -Math.round(100 / (d - 1));
}

function applyVenueFee(venue, american) {
  if (american == null) return null;
  if (venue === 'kalshi') return applyKalshiFee(american);
  if (venue === 'prophetx') return applyProphetXCommission(american);
  if (venue === 'polymarket') return applyPolymarketFee(american);
  return american;
}

function parseOppSelection(leg) {
  if (!leg || typeof leg !== 'object') return null;
  const venue = String(leg.bestOppBook || leg.venue || '').toLowerCase();
  if (!DEPTH_VENUES.has(venue)) return null;
  const market = String(leg.market || '').toUpperCase();
  const label = String(leg.bestOppName || '');
  const game = String(leg.game || '');
  const { away, home } = teamsFromGame(game);
  const sport = String(leg.sport || '');
  const base = { venue, market, sport, game, away, home, commence_time: leg.commence_time || null };

  if (market === 'TOT' || market === 'TT') {
    const m = /(?:^|[\s/])([ou])\s*([+-]?\d+(?:\.\d+)?)\s*$/i.exec(label)
      || /\b([ou])(\d+(?:\.\d+)?)\b/i.exec(label);
    const ou = m ? m[1].toLowerCase() : null;
    const line = m ? parseFloat(m[2]) : NaN;
    let team = null;
    if (market === 'TT') {
      team = label.replace(/\s*TT\s*[ou].*$/i, '').replace(/\s*[ou]\s*[\d.]+.*$/i, '').trim();
    }
    if (!ou || !isFinite(line)) return null;
    return { ...base, side: ou === 'o' ? 'over' : 'under', line, team };
  }
  if (market === 'ML') {
    const team = label.replace(/\s*ML\s*$/i, '').trim();
    if (!team) return null;
    return { ...base, side: 'ml', line: null, team };
  }
  if (market === 'SPR') {
    const m = /([+-]?\d+(?:\.\d+)?)\s*$/.exec(label);
    const line = m ? parseFloat(m[1]) : NaN;
    const team = label.replace(/\s*[+-]?\d+(?:\.\d+)?\s*$/, '').trim();
    if (!team || !isFinite(line)) return null;
    return { ...base, side: 'spread', line, team };
  }
  return null;
}

function sortAsksBestFirst(levels, venue) {
  const byPrice = new Map();
  for (const raw of levels || []) {
    const american = applyVenueFee(venue, raw.american);
    const size = raw.size;
    if (american == null || !isFinite(size) || size <= 0) continue;
    const prev = byPrice.get(american);
    byPrice.set(american, (prev || 0) + size);
  }
  return [...byPrice.entries()]
    .map(([american, size]) => ({ american, size }))
    .sort((a, b) => b.american - a.american);
}

// Kalshi: bids only. Buying YES takes NO bids as YES asks (ask = 1 − no_bid).
// Buying NO takes YES bids as NO asks (ask = 1 − yes_bid).
function kalshiAsksFromOrderbook(orderbookFp, buySide) {
  const fp = orderbookFp || {};
  const bids = buySide === 'yes' ? (fp.no_dollars || []) : (fp.yes_dollars || []);
  const out = [];
  for (const row of bids) {
    const bidPx = parseFloat(Array.isArray(row) ? row[0] : row && row.price);
    const qty = parseFloat(Array.isArray(row) ? row[1] : row && (row.size || row.count));
    if (!isFinite(bidPx) || bidPx <= 0 || bidPx >= 1 || !isFinite(qty) || qty <= 0) continue;
    const askPx = 1 - bidPx;
    const american = probToAmerican(askPx);
    if (american == null) continue;
    // size = dollar STAKE (price × contracts). Face payout = size / askPx.
    out.push({ american, size: askPx * qty });
  }
  return out;
}

async function fetchKalshiSeriesEvents(seriesTicker) {
  return cached(`kalshi:${seriesTicker}`, async () => {
    const events = [];
    let cursor = '';
    for (let page = 0; page < 6; page++) {
      const url = `${KALSHI_BASE}/events?series_ticker=${encodeURIComponent(seriesTicker)}`
        + `&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await fetchJson(url);
      const batch = res.ok && res.json && res.json.events;
      if (Array.isArray(batch)) batch.forEach((e) => events.push(e));
      cursor = (res.json && res.json.cursor) || '';
      if (!cursor) break;
    }
    return events;
  });
}

function matchKalshiMarket(sel, events) {
  const titleHit = (ev) => eventMatchesTeams(`${ev.title || ''} ${ev.sub_title || ''} ${ev.event_ticker || ''}`, sel.away, sel.home);
  const ev = (events || []).find(titleHit);
  if (!ev) return null;
  const markets = ev.markets || [];
  if (sel.market === 'TOT') {
    for (const m of markets) {
      const lab = m.yes_sub_title || m.subtitle || m.title || '';
      const parsed = /over\s+([\d.]+)/i.exec(lab);
      if (!parsed || !lineEqual(parseFloat(parsed[1]), sel.line)) continue;
      return { ticker: m.ticker, buySide: sel.side === 'over' ? 'yes' : 'no' };
    }
    return null;
  }
  if (sel.market === 'ML') {
    const want = nameTokens(sel.team);
    for (const m of markets) {
      const lab = m.yes_sub_title || m.subtitle || m.title || '';
      if (tokensHit(nameTokens(lab), want)) return { ticker: m.ticker, buySide: 'yes' };
    }
    return null;
  }
  if (sel.market === 'SPR') {
    const wantTeam = nameTokens(sel.team);
    for (const m of markets) {
      const lab = m.yes_sub_title || m.subtitle || m.title || '';
      const parsed = /^(.*?)\s+wins by over\s+([\d.]+)/i.exec(lab);
      if (!parsed) continue;
      const favLine = -parseFloat(parsed[2]);
      const dogLine = parseFloat(parsed[2]);
      const favTokens = nameTokens(parsed[1]);
      if (tokensHit(favTokens, wantTeam) && lineEqual(sel.line, favLine)) {
        return { ticker: m.ticker, buySide: 'yes' };
      }
      if (!tokensHit(favTokens, wantTeam) && lineEqual(sel.line, dogLine)) {
        return { ticker: m.ticker, buySide: 'no' };
      }
    }
    return null;
  }
  return null;
}

async function fetchKalshiDepth(sel) {
  const series = (KALSHI_SERIES[sel.sport] || {})[sel.market];
  if (!series) return { levels: [], reason: 'kalshi_series_unknown' };
  const events = await fetchKalshiSeriesEvents(series);
  const hit = matchKalshiMarket(sel, events);
  if (!hit) return { levels: [], reason: 'kalshi_unmatched' };
  const res = await fetchJson(`${KALSHI_BASE}/markets/${encodeURIComponent(hit.ticker)}/orderbook?depth=8`);
  const fp = res.ok && res.json && res.json.orderbook_fp;
  if (!fp) return { levels: [], reason: 'kalshi_orderbook_empty' };
  return { levels: sortAsksBestFirst(kalshiAsksFromOrderbook(fp, hit.buySide), 'kalshi'), reason: 'ok' };
}

function parseJsonField(v, fallback) {
  if (Array.isArray(v) || (v && typeof v === 'object')) return v;
  if (typeof v !== 'string') return fallback;
  try { return JSON.parse(v); } catch (_) { return fallback; }
}

function polyMarketMatches(sel, market) {
  const q = `${market.question || ''} ${market.groupItemTitle || ''} ${market.title || ''}`;
  const ql = q.toLowerCase();
  if (/1h|2h|1st half|2nd half|touchdown|quarter|half/.test(ql)) return false;
  if (sel.market === 'TT') {
    if (!/team total/.test(ql)) return false;
    if (sel.team && !tokensHit(nameTokens(q), nameTokens(sel.team))) return false;
    const m = /o\/u\s*([\d.]+)/i.exec(q);
    return m ? lineEqual(parseFloat(m[1]), sel.line) : false;
  }
  if (sel.market === 'TOT') {
    if (/team total/.test(ql)) return false;
    const m = /o\/u\s*([\d.]+)/i.exec(q);
    return m ? lineEqual(parseFloat(m[1]), sel.line) : false;
  }
  if (sel.market === 'SPR') {
    if (!/spread/i.test(ql)) return false;
    const named = /spread:\s*(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)/i.exec(q);
    if (!named) return false;
    const namedLine = parseFloat(named[2]);
    if (tokensHit(nameTokens(named[1]), nameTokens(sel.team)) && lineEqual(namedLine, sel.line)) return { tokenSide: 'yes' };
    if (!tokensHit(nameTokens(named[1]), nameTokens(sel.team)) && lineEqual(-namedLine, sel.line)) return { tokenSide: 'no' };
    return false;
  }
  if (sel.market === 'ML') {
    if (/spread|o\/u|total/.test(ql)) return false;
    const outcomes = parseJsonField(market.outcomes, []);
    const names = (outcomes || []).map((o) => String(o));
    if (names.some((n) => tokensHit(nameTokens(n), nameTokens(sel.team)))) return { outcomeName: sel.team };
    if (eventMatchesTeams(q, sel.away, sel.home) && names.length >= 2) return { outcomeName: sel.team };
    return false;
  }
  return false;
}

function polyTokenFor(sel, market, match) {
  const outcomes = parseJsonField(market.outcomes, []);
  const tokens = parseJsonField(market.clobTokenIds, []);
  if (!Array.isArray(outcomes) || !Array.isArray(tokens)) return null;
  if (sel.market === 'TOT' || sel.market === 'TT') {
    const want = sel.side === 'over' ? 'over' : 'under';
    const i = outcomes.findIndex((o) => String(o).toLowerCase() === want);
    return i >= 0 ? tokens[i] : null;
  }
  if (match && match.tokenSide === 'yes') {
    const i = outcomes.findIndex((o) => String(o).toLowerCase() === 'yes');
    return i >= 0 ? tokens[i] : tokens[0];
  }
  if (match && match.tokenSide === 'no') {
    const i = outcomes.findIndex((o) => String(o).toLowerCase() === 'no');
    return i >= 0 ? tokens[i] : tokens[1];
  }
  if (match && match.outcomeName) {
    const i = outcomes.findIndex((o) => tokensHit(nameTokens(o), nameTokens(match.outcomeName)));
    return i >= 0 ? tokens[i] : null;
  }
  return null;
}

function polymarketAsksFromBook(book) {
  const out = [];
  for (const a of (book && book.asks) || []) {
    const p = parseFloat(a.price);
    const s = parseFloat(a.size);
    if (!isFinite(p) || p <= 0 || p >= 1 || !isFinite(s) || s <= 0) continue;
    const american = probToAmerican(p);
    if (american == null) continue;
    // size = dollar STAKE (price × shares). Face payout = size / p (contracts × $1).
    out.push({ american, size: p * s });
  }
  return out;
}

function teamSearchPhrases(away, home) {
  const a = nameTokens(away);
  const h = nameTokens(home);
  const compact = (t) => (t.length >= 3 ? t.slice(0, 2) : t).join(' ');
  const first = (t) => t[0] || '';
  return [...new Set([
    `${compact(a)} ${compact(h)}`.trim(),
    `${first(a)} ${compact(h)}`.trim(),
    `${first(a)} ${first(h)}`.trim(),
    `${away} ${home}`.trim(),
  ])].filter(Boolean);
}

async function fetchPolymarketDepth(sel) {
  const phrases = teamSearchPhrases(sel.away, sel.home);
  if (!phrases.length && sel.game) phrases.push(sel.game);
  if (!phrases.length) return { levels: [], reason: 'polymarket_no_query' };
  let ev = null;
  for (const phrase of phrases) {
    const search = await fetchJson(`${POLY_GAMMA}/public-search?q=${encodeURIComponent(phrase)}`);
    const events = (search.ok && search.json && (search.json.events || search.json.data)) || [];
    ev = events.find((e) => eventMatchesTeams(`${e.title || ''} ${e.slug || ''}`, sel.away, sel.home));
    if (ev) break;
  }
  if (!ev) return { levels: [], reason: 'polymarket_unmatched_event' };
  let markets = ev.markets || [];
  if (!markets.length && ev.slug) {
    const full = await fetchJson(`${POLY_GAMMA}/events?slug=${encodeURIComponent(ev.slug)}`);
    const first = Array.isArray(full.json) ? full.json[0] : full.json;
    markets = (first && first.markets) || [];
  }
  let token = null;
  for (const m of markets) {
    const match = polyMarketMatches(sel, m);
    if (!match && match !== true) continue;
    token = polyTokenFor(sel, m, match === true ? {} : match);
    if (token) break;
  }
  if (!token) return { levels: [], reason: 'polymarket_unmatched_market' };
  const book = await fetchJson(`${POLY_CLOB}/book?token_id=${encodeURIComponent(token)}`);
  if (!book.ok || !book.json) return { levels: [], reason: 'polymarket_book_empty' };
  return { levels: sortAsksBestFirst(polymarketAsksFromBook(book.json), 'polymarket'), reason: 'ok' };
}

function flattenProphetXSelections(selections) {
  if (!Array.isArray(selections)) return [];
  const groups = [];
  const looksGrouped = selections.some((x) => Array.isArray(x));
  if (looksGrouped) {
    for (const g of selections) {
      if (Array.isArray(g)) groups.push(g);
      else groups.push([g]);
    }
  } else {
    const bySide = new Map();
    for (const s of selections) {
      const key = `${s && s.name}|${s && s.line}`;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push(s);
    }
    bySide.forEach((g) => groups.push(g));
  }
  return groups;
}

function prophetXGroupMatches(sel, group) {
  const sample = (group || []).find((s) => s && s.name);
  if (!sample) return false;
  const name = String(sample.name || '');
  const line = sample.line;
  if (sel.market === 'TOT' || sel.market === 'TT') {
    const want = sel.side === 'over' ? /over/i : /under/i;
    if (!want.test(name)) return false;
    if (sel.market === 'TT' && sel.team && !tokensHit(nameTokens(name), nameTokens(sel.team))) return false;
    return lineEqual(line, sel.line);
  }
  if (sel.market === 'ML') return tokensHit(nameTokens(name), nameTokens(sel.team));
  if (sel.market === 'SPR') {
    return tokensHit(nameTokens(name), nameTokens(sel.team)) && lineEqual(line, sel.line);
  }
  return false;
}

function prophetXAsksFromGroup(group) {
  const out = [];
  for (const s of group || []) {
    const american = decimalToAmerican(parseFloat(s && s.price));
    const size = parseFloat(s && s.quantity);
    if (american == null || !isFinite(size) || size <= 0) continue;
    // quantity is already treated as dollar stake in the Promo "$ available" line.
    out.push({ american, size });
  }
  return out;
}

async function prophetXAuthHeader() {
  const key = process.env.PROPHETX_API_KEY;
  if (key) return key;
  const access = process.env.PROPHETX_ACCESS_KEY;
  const secret = process.env.PROPHETX_SECRET_KEY;
  if (!access || !secret) return null;
  return cached('prophetx:token', async () => {
    const res = await fetchJson(`${PROPHETX_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access_key: access, secret_key: secret }),
    });
    return (res.ok && res.json && res.json.data && res.json.data.access_token) || null;
  });
}

async function fetchProphetXDepth(sel) {
  const auth = await prophetXAuthHeader();
  if (!auth) return { levels: [], reason: 'prophetx_needs_credentials' };
  const events = await cached('prophetx:events', async () => {
    const res = await fetchJson(`${PROPHETX_BASE}/affiliate/get_sport_events`, {
      headers: { authorization: auth },
    });
    const data = res.ok && res.json && (res.json.data || res.json);
    return (data && (data.sport_events || data.events)) || [];
  });
  const ev = (events || []).find((e) => {
    const away = e.away_team || '';
    const home = e.home_team || '';
    const name = e.name || '';
    return eventMatchesTeams(`${away} ${home} ${name}`, sel.away, sel.home);
  });
  if (!ev || ev.event_id == null) return { levels: [], reason: 'prophetx_unmatched_event' };
  const type = sel.market === 'ML' ? 'moneyline' : sel.market === 'SPR' ? 'spread' : 'total';
  const res = await fetchJson(
    `${PROPHETX_BASE}/v3/affiliate/get_markets?event_id=${encodeURIComponent(ev.event_id)}&market_types=${type}`,
    { headers: { authorization: auth } },
  );
  const markets = (res.ok && res.json && (Array.isArray(res.json.data) ? res.json.data : (res.json.data && res.json.data[ev.event_id]))) || [];
  for (const m of markets) {
    for (const group of flattenProphetXSelections(m.selections)) {
      if (!prophetXGroupMatches(sel, group)) continue;
      const levels = sortAsksBestFirst(prophetXAsksFromGroup(group), 'prophetx');
      if (levels.length) return { levels, reason: 'ok' };
    }
  }
  return { levels: [], reason: 'prophetx_unmatched_market' };
}

async function novigToken() {
  const id = process.env.NOVIG_CLIENT_ID;
  const secret = process.env.NOVIG_CLIENT_SECRET;
  if (!id || !secret) return null;
  return cached('novig:token', async () => {
    const res = await fetchJson(`${NOVIG_BASE}/nbx/v1/auth/emm-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
    });
    return (res.ok && res.json && (res.json.access_token || res.json.token)) || null;
  });
}

function novigAsksFromBook(sel, market) {
  const ladders = (market && market.book && market.book.outcomeLadders) || [];
  const outcomes = market.outcomes || [];
  const wantName = sel.market === 'TOT' || sel.market === 'TT'
    ? (sel.side === 'over' ? /over/i : /under/i)
    : null;
  let ladder = null;
  for (const lad of ladders) {
    const oc = outcomes.find((o) => String(o.id || o.outcomeId) === String(lad.outcomeId));
    const label = (oc && (oc.name || oc.description || oc.label)) || '';
    if (wantName && wantName.test(label)) { ladder = lad; break; }
    if (sel.market === 'ML' && tokensHit(nameTokens(label), nameTokens(sel.team))) { ladder = lad; break; }
    if (sel.market === 'SPR' && tokensHit(nameTokens(label), nameTokens(sel.team))) { ladder = lad; break; }
  }
  if (!ladder) return [];
  // Bids on this outcome are what we match against to buy the other side;
  // asks-to-buy this outcome are the opposing bids. Novig returns bids per outcome.
  // Treat listed bids as resting size we can take (price = decimal probability).
  const out = [];
  for (const o of ladder.bids || ladder.asks || []) {
    const p = parseFloat(o.price);
    const qty = parseFloat(o.qty != null ? o.qty : o.originalQty);
    if (!isFinite(p) || p <= 0 || p >= 1 || !isFinite(qty) || qty <= 0) continue;
    const american = probToAmerican(p);
    if (american == null) continue;
    out.push({ american, size: p * qty });
  }
  return out;
}

async function fetchNovigDepth(sel) {
  const token = await novigToken();
  if (!token) return { levels: [], reason: 'novig_needs_credentials' };
  const headers = { authorization: `Bearer ${token}` };
  const eventsRes = await fetchJson(`${NOVIG_BASE}/nbx/v2/emm/events`, { headers });
  const events = (eventsRes.ok && (Array.isArray(eventsRes.json) ? eventsRes.json : (eventsRes.json && eventsRes.json.events))) || [];
  const ev = events.find((e) => eventMatchesTeams(`${e.name || ''} ${e.description || ''} ${(e.competitors || []).map((c) => c.name || c).join(' ')}`, sel.away, sel.home));
  if (!ev || !ev.id) return { levels: [], reason: 'novig_unmatched_event' };
  const mkRes = await fetchJson(`${NOVIG_BASE}/nbx/v2/emm/events/getMarketsByEvent/${encodeURIComponent(ev.id)}?currency=CASH`, { headers });
  const markets = (mkRes.ok && (Array.isArray(mkRes.json) ? mkRes.json : [])) || [];
  for (const m of markets) {
    const desc = `${m.description || ''} ${m.type || ''}`;
    if (sel.market === 'TOT' && !/total|ou|o\/u/i.test(desc)) continue;
    if (sel.market === 'SPR' && !/spread/i.test(desc)) continue;
    if (sel.market === 'ML' && !/moneyline|h2h|side/i.test(desc)) continue;
    const levels = sortAsksBestFirst(novigAsksFromBook(sel, m), 'novig');
    if (levels.length) return { levels, reason: 'ok' };
  }
  return { levels: [], reason: 'novig_unmatched_market' };
}

async function fetchVenueDepth(sel) {
  if (!sel) return { levels: [], reason: 'unparsed' };
  try {
    if (sel.venue === 'kalshi') return await fetchKalshiDepth(sel);
    if (sel.venue === 'polymarket') return await fetchPolymarketDepth(sel);
    if (sel.venue === 'prophetx') return await fetchProphetXDepth(sel);
    if (sel.venue === 'novig') return await fetchNovigDepth(sel);
    return { levels: [], reason: 'venue_unsupported' };
  } catch (e) {
    return { levels: [], reason: `error:${e && e.message || e}` };
  }
}

function depthKey(leg) {
  return [leg.bestOppBook || leg.venue, leg.sport, leg.game, leg.bestOppName || leg.name, leg.market].join('|');
}

async function resolveLegsDepth(legs) {
  const list = Array.isArray(legs) ? legs.slice(0, MAX_LEGS) : [];
  const results = [];
  await Promise.all(list.map(async (leg, i) => {
    const sel = parseOppSelection(leg);
    const fetched = await fetchVenueDepth(sel);
    results[i] = {
      key: depthKey(leg),
      venue: (sel && sel.venue) || String(leg.bestOppBook || ''),
      levels: fetched.levels || [],
      reason: fetched.reason || 'ok',
    };
  }));
  return results;
}

module.exports = {
  DEPTH_VENUES,
  MAX_LEGS,
  KALSHI_SERIES,
  parseOppSelection,
  eventMatchesTeams,
  lineEqual,
  nameTokens,
  teamsFromGame,
  probToAmerican,
  decimalToAmerican,
  kalshiAsksFromOrderbook,
  polymarketAsksFromBook,
  flattenProphetXSelections,
  prophetXGroupMatches,
  prophetXAsksFromGroup,
  matchKalshiMarket,
  polyMarketMatches,
  sortAsksBestFirst,
  applyVenueFee,
  resolveLegsDepth,
  fetchVenueDepth,
  depthKey,
  teamSearchPhrases,
  _resetCatalogCache() { catalogCache.clear(); },
};
