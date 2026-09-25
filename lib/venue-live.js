'use strict';

// First-party quotes for the New Odds Board. Betstamp is not called here.
// The board builds its own fixture list from these quotes plus Underdog.
//
// Polymarket: public CLOB market channel (no key).
//   wss://ws-subscriptions-clob.polymarket.com/ws/market
// Kalshi: public REST yes_ask on the game series (no key). The trade
//   WebSocket (wss://external-api-ws.kalshi.com/trade-api/ws/v2) is real
//   and tick-level, but the handshake is the same RSA-PSS key as combo
//   probe. Without that key we poll REST. With it, the hub prefers WS.
// Underdog is not streamed here. Phone REST already includes live games
// (status "scoring"); the safe origin interval is 30s (their Cache-Control).

const POLY_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const POLY_GAMMA = 'https://gamma-api.polymarket.com';
const POLY_CLOB = 'https://clob.polymarket.com';
const KALSHI_REST = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const KALSHI_WS_URL = process.env.KALSHI_WS_URL || 'wss://external-api-ws.kalshi.com/trade-api/ws/v2';
const KALSHI_WS_SIGN_PATH = '/trade-api/ws/v2';

const BOOK_IDS = Object.freeze({ polymarket: 193, kalshi: 194 });

// Gamma /sports series ids, confirmed 2026-09-22.
const POLY_SERIES = Object.freeze({
  NFL: '12185',
  NCAAF: '12756',
  MLB: '3',
});

const KALSHI_GAME_SERIES = Object.freeze({
  NFL: 'KXNFLGAME',
  NCAAF: 'KXNCAAFGAME',
  MLB: 'KXMLBGAME',
});

const LEAGUES = new Set(['NFL', 'NCAAF', 'MLB']);

// One upstream poll / socket per league per process, fanned out to SSE clients.
const defaultHubs = new Map();

function parseLeague(raw) {
  const league = String(raw || 'NFL').trim().toUpperCase();
  return LEAGUES.has(league) ? league : null;
}

function parseJsonList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function splitVersus(title) {
  const parts = String(title || '').split(/\s+vs\.?\s+/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { away: '', home: '' };
  return { away: parts[0], home: parts[1] };
}

function asProb(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null;
  return n;
}

// Exchange clocks arrive as unix seconds or milliseconds. A seconds value
// treated as ms lands in 1970 and then loses every comparison to a REST poll.
function epochMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function isoFromMs(raw) {
  const ms = epochMs(raw);
  const d = new Date(ms == null ? Date.now() : ms);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function quoteUpdatedMs(quote) {
  if (!quote || quote.updated_at == null || quote.updated_at === '') return 0;
  const parsed = Date.parse(String(quote.updated_at));
  if (Number.isFinite(parsed)) return parsed;
  return epochMs(quote.updated_at) || 0;
}

// Keep the quote already applied when the incoming frame is older, or the
// same instant with a different print. That is what stops a bid and an ask
// (or a late poll) from painting over each other.
function keepNewerQuote(prev, incoming) {
  if (!incoming) return prev || null;
  if (!prev) return incoming;
  const tNew = quoteUpdatedMs(incoming);
  const tOld = quoteUpdatedMs(prev);
  if (tOld && (!tNew || tNew <= tOld)) return prev;
  return incoming;
}

// CLOB /book and the Kalshi orderbook both list the worst price first.
// bids[0] is the lowest bid (0.01), asks[0] is the highest ask (0.99).
// The price to buy is the minimum ask that still has size.
function levelPriceSize(row) {
  if (Array.isArray(row)) return { price: Number(row[0]), size: Number(row[1]) };
  if (row && typeof row === 'object') {
    return {
      price: Number(row.price),
      size: Number(row.size != null ? row.size : row.count),
    };
  }
  return { price: NaN, size: NaN };
}

function bestPricedLevel(levels, wantMax) {
  let best = null;
  for (const row of levels || []) {
    const { price, size } = levelPriceSize(row);
    if (!Number.isFinite(price) || price <= 0 || price >= 1) continue;
    if (!Number.isFinite(size) || size <= 0) continue;
    if (best == null || (wantMax ? price > best : price < best)) best = price;
  }
  return best;
}

function bestBidFromLevels(levels) {
  return bestPricedLevel(levels, true);
}

function bestAskFromLevels(levels) {
  return bestPricedLevel(levels, false);
}

// Kalshi publishes bids only. The yes ask is the cost to buy yes, which is
// one minus the highest no bid that still has size. Index 0 is the 1c no bid.
function kalshiYesAskFromNoBids(noBids) {
  const bestNo = bestBidFromLevels(noBids);
  if (bestNo == null) return null;
  return Math.round((1 - bestNo) * 10000) / 10000;
}

function emptyPolymarketBook() {
  return { bids: new Map(), asks: new Map(), seeded: false, ts: 0 };
}

function setPolymarketLevel(map, price, size) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return;
  const key = n.toFixed(4);
  const sz = Number(size);
  if (!Number.isFinite(sz) || sz <= 0) map.delete(key);
  else map.set(key, sz);
}

function seedPolymarketSide(map, levels) {
  map.clear();
  for (const row of levels || []) {
    const { price, size } = levelPriceSize(row);
    setPolymarketLevel(map, price, size);
  }
}

function bestFromPolymarketMap(map, wantMax) {
  let best = null;
  for (const [price, size] of map) {
    if (!(size > 0)) continue;
    const n = Number(price);
    if (best == null || (wantMax ? n > best : n < best)) best = n;
  }
  return best;
}

function applyPolymarketBookSnapshot(state, snapshot) {
  seedPolymarketSide(state.bids, snapshot && snapshot.bids);
  seedPolymarketSide(state.asks, snapshot && snapshot.asks);
  state.seeded = true;
  return bestFromPolymarketMap(state.asks, false);
}

// price_change is a level delta. size 0 deletes that level. BUY writes the
// bid book and SELL writes the ask book. The message's best_ask is not used:
// a stale best_ask (or the changed level's own price) is how a 15c print
// landed on a book whose real ask was 31c.
function applyPolymarketPriceLevel(state, change) {
  const side = String(change && change.side || '').toUpperCase();
  const map = side === 'SELL' ? state.asks : side === 'BUY' ? state.bids : null;
  if (!map) return bestFromPolymarketMap(state.asks, false);
  setPolymarketLevel(map, change.price, change.size);
  return bestFromPolymarketMap(state.asks, false);
}

function applyPolymarketStreamMessage(store, message) {
  const list = Array.isArray(message) ? message : [message];
  const out = [];
  for (const msg of list) {
    if (!msg || typeof msg !== 'object') continue;
    const type = String(msg.event_type || msg.type || '');
    if (type === 'book') {
      const id = String(msg.asset_id || '');
      if (!id) continue;
      const state = store.get(id) || emptyPolymarketBook();
      const ts = epochMs(msg.timestamp) || 0;
      if (state.seeded && state.ts && ts && ts < state.ts) continue;
      const ask = applyPolymarketBookSnapshot(state, msg);
      state.ts = ts || state.ts;
      store.set(id, state);
      if (ask != null) out.push({ assetId: id, bestAsk: ask, ts: msg.timestamp || state.ts });
      continue;
    }
    if (type !== 'price_change') continue;
    const changes = msg.price_changes || msg.changes || [];
    for (const change of changes) {
      const id = String(change && change.asset_id || '');
      if (!id) continue;
      const state = store.get(id) || emptyPolymarketBook();
      // One deep level is not a book. Wait for the snapshot, which carries
      // every level, instead of painting that level as the ask.
      if (!state.seeded) continue;
      const ts = epochMs(msg.timestamp) || 0;
      if (state.ts && ts && ts < state.ts) continue;
      const ask = applyPolymarketPriceLevel(state, change);
      if (ts) state.ts = ts;
      store.set(id, state);
      if (ask != null) out.push({ assetId: id, bestAsk: ask, ts: msg.timestamp || state.ts });
    }
  }
  return out;
}

function eventInWindow(ev, nowMs) {
  if (ev && ev.live === true) return true;
  const start = Date.parse(ev && (ev.startTime || ev.startDate || ev.gameStartTime));
  if (!Number.isFinite(start)) return false;
  const now = Number(nowMs) || Date.now();
  // Next slate, not the whole season. A Tuesday poll still reaches Sunday NFL.
  return start > now - 8 * 3600 * 1000 && start < now + 8 * 24 * 3600 * 1000;
}

function moneylineEntriesFromEvent(ev, league) {
  if (!ev || ev.closed === true) return [];
  const ordering = String(ev.ordering || 'away').toLowerCase();
  const titleSides = splitVersus(ev.title || ev.name || '');
  let away = titleSides.away;
  let home = titleSides.home;
  if (ordering === 'home') {
    away = titleSides.home;
    home = titleSides.away;
  }
  const live = ev.live === true;
  const out = [];
  for (const market of ev.markets || []) {
    if (!market || market.closed === true) continue;
    const kind = String(market.sportsMarketType || '').toLowerCase();
    if (kind !== 'moneyline') continue;
    const outcomes = parseJsonList(market.outcomes).map((s) => String(s));
    const tokens = parseJsonList(market.clobTokenIds).map((s) => String(s));
    const lower = outcomes.map((s) => s.toLowerCase());
    // "Will X win?" Yes/No contracts are a different shape (3-way soccer).
    // NFL/NCAAF/MLB game moneylines list the two team names.
    if (lower.includes('yes') && lower.includes('no')) continue;
    const prices = parseJsonList(market.outcomePrices);
    const start = ev.startTime || ev.startDate || ev.gameStartTime || null;
    outcomes.forEach((side, i) => {
      const tokenId = tokens[i];
      if (!tokenId || !side) return;
      out.push({
        tokenId,
        league,
        away,
        home,
        side,
        bet_type: 'moneyline',
        live,
        slug: ev.slug || '',
        outcomePrice: asProb(prices[i]),
        start: start || null,
      });
    });
  }
  return out;
}

function quoteFromAsk(entry, ask, ts) {
  const odds = asProb(ask);
  if (!entry || odds == null) return null;
  const quote = {
    book: 'polymarket',
    book_id: BOOK_IDS.polymarket,
    league: entry.league,
    away: entry.away,
    home: entry.home,
    side: entry.side,
    bet_type: 'moneyline',
    odds,
    is_live: entry.live === true,
    updated_at: isoFromMs(ts),
    token_id: entry.tokenId,
  };
  if (entry.start) quote.start = entry.start;
  return quote;
}

function quotesFromPolymarketMessage(message, catalog) {
  const byToken = catalog instanceof Map ? catalog : new Map(catalog || []);
  const list = Array.isArray(message) ? message : [message];
  const out = [];
  for (const msg of list) {
    if (!msg || typeof msg !== 'object') continue;
    const type = String(msg.event_type || msg.type || '');
    if (type === 'best_bid_ask') {
      const entry = byToken.get(String(msg.asset_id || ''));
      const quote = quoteFromAsk(entry, msg.best_ask, msg.timestamp);
      if (quote) out.push(quote);
      continue;
    }
    if (type === 'price_change') {
      const changes = msg.price_changes || msg.changes || [];
      for (const change of changes) {
        const entry = byToken.get(String(change && change.asset_id || ''));
        const ask = change && (change.best_ask != null ? change.best_ask : null);
        const quote = quoteFromAsk(entry, ask, msg.timestamp);
        if (quote) out.push(quote);
      }
    }
  }
  return out;
}

function changedQuotes(previous, quotes, keyOf) {
  const next = [];
  for (const quote of quotes || []) {
    const key = keyOf(quote);
    const prev = previous.get(key);
    if (prev === quote.odds) continue;
    previous.set(key, quote.odds);
    next.push(quote);
  }
  return next;
}

// The HTTP/REST load is the only full snapshot. A websocket frame is always
// a delta, even when it arrives first — a one-token book must not replace
// the rest of the board. A quiet poll must not re-send the book.
function createQuoteEmitter(book, keyOf, emit) {
  const seen = new Map();
  let snapshotted = false;
  const changedSince = (mode) => {
    const quotes = [...book.values()].filter(Boolean);
    const changed = [];
    for (const quote of quotes) {
      const key = keyOf(quote);
      if (!key || seen.get(key) === quote.odds) continue;
      seen.set(key, quote.odds);
      changed.push(quote);
    }
    if (changed.length) emit({ quotes: changed, complete: false, mode: mode || 'ws' });
  };
  return {
    get ready() { return snapshotted; },
    push(mode) {
      const quotes = [...book.values()].filter(Boolean);
      if (!quotes.length) return;
      // Websocket pushes stay deltas. Only an explicit snapshot (the first
      // REST/HTTP book) is the full catalog.
      if (mode === 'ws' || snapshotted) {
        changedSince(mode);
        return;
      }
      snapshotted = true;
      for (const quote of quotes) seen.set(keyOf(quote), quote.odds);
      emit({ quotes, complete: true, mode: 'snapshot' });
    },
  };
}

function formatQuoteSse(quotes, ingestTs, extra) {
  const payload = { source: extra && extra.source, quotes: quotes || [] };
  if (extra && extra.note) payload.note = extra.note;
  if (extra && extra.mode) payload.mode = extra.mode;
  // complete: this event carries the whole moneyline book. The board still
  // drops any quote in it that is older than the print already on screen.
  if (extra && (extra.complete === true || extra.complete === false)) payload.complete = extra.complete;
  return `event: quote\ndata: ${JSON.stringify({ ingest_ts: ingestTs, payload })}\n\n`;
}

function kalshiSubscribeMessage(tickers, id = 1) {
  return {
    id,
    cmd: 'subscribe',
    params: {
      channels: ['ticker', 'orderbook_delta'],
      market_tickers: tickers,
    },
  };
}

function eventStart(ev) {
  if (!ev) return null;
  return ev.start_time || ev.startTime || ev.open_time || ev.strike_date || null;
}

function quotesFromKalshiMarket(market, league, teams, nowMs) {
  if (!market || !market.ticker) return null;
  const odds = asProb(market.yes_ask_dollars != null ? market.yes_ask_dollars : market.yes_ask);
  if (odds == null) return null;
  const side = market.yes_sub_title || market.subtitle || '';
  if (!side) return null;
  const size = Number(market.yes_ask_size_fp != null ? market.yes_ask_size_fp : market.yes_ask_size);
  const quote = {
    book: 'kalshi',
    book_id: BOOK_IDS.kalshi,
    league,
    away: teams.away || '',
    home: teams.home || '',
    side,
    bet_type: 'moneyline',
    // Kalshi does not flag in-game. The same market stays open through
    // the game; yes_ask is the price to buy that side. Callers mark the fixture live.
    is_live: false,
    odds,
    size: Number.isFinite(size) && size > 0 ? size : null,
    updated_at: new Date(nowMs || Date.now()).toISOString(),
    ticker: market.ticker,
  };
  // occurrence_datetime is kickoff. open_time is when the market listed.
  const start = (teams && teams.start) || market.occurrence_datetime || null;
  if (start) quote.start = start;
  return quote;
}

function quotesFromKalshiEvents(events, league, nowMs) {
  const out = [];
  for (const ev of events || []) {
    const teams = splitVersus(ev.title || ev.sub_title || '');
    teams.start = eventStart(ev);
    for (const market of ev.markets || []) {
      const ticker = String(market.ticker || '');
      // Series root is the game moneyline. Spread/total series are separate
      // and are not requested here. Skip anything that is not the side market.
      if (!ticker.startsWith(`${KALSHI_GAME_SERIES[league]}-`)) continue;
      const quote = quotesFromKalshiMarket(market, league, teams, nowMs);
      if (quote) out.push(quote);
    }
  }
  return out;
}

// Ticker frames use yes_ask_dollars (0–1) or yes_ask in cents (1–99).
function kalshiAskProb(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const dollars = msg.yes_ask_dollars != null ? msg.yes_ask_dollars : msg.yes_ask_dollar;
  const fromDollars = asProb(dollars);
  if (fromDollars != null) return fromDollars;
  const raw = Number(msg.yes_ask);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw < 1) return raw;
  if (raw < 100) return raw / 100;
  return null;
}

const KALSHI_TWO_LETTER = new Set(['NE', 'SF', 'GB', 'KC', 'TB', 'LV', 'NO', 'AZ']);

function splitTeamCode(code) {
  const s = String(code || '').toUpperCase();
  if (s.length === 6) return [s.slice(0, 3), s.slice(3)];
  if (s.length === 4) return [s.slice(0, 2), s.slice(2)];
  if (s.length === 5) {
    if (KALSHI_TWO_LETTER.has(s.slice(0, 2))) return [s.slice(0, 2), s.slice(2)];
    if (KALSHI_TWO_LETTER.has(s.slice(-2))) return [s.slice(0, 3), s.slice(-2)];
  }
  return [];
}

// KXNFLGAME-26SEP24ATLGB-ATL → ATL/GB.
// KXMLBGAME-26SEP241905TBNYY-TB → TB/NYY. MLB inserts HHMM after the date,
// so the date strip has to leave the club codes, then the side suffix splits them.
function pairFromTicker(ticker) {
  const parts = String(ticker || '').split('-');
  if (parts.length < 3) return [];
  const side = String(parts[parts.length - 1] || '').toUpperCase();
  const slug = parts[parts.length - 2] || '';
  const teams = slug.replace(/^\d{2}[A-Z]{3}\d{2}(?:\d{4})?/, '').toUpperCase();
  if (!teams) return [];
  if (side && teams.startsWith(side) && teams.length > side.length) {
    return [side, teams.slice(side.length)];
  }
  if (side && teams.endsWith(side) && teams.length > side.length) {
    return [teams.slice(0, -side.length), side];
  }
  return splitTeamCode(teams);
}

function scheduleFromEspn(body) {
  const out = [];
  for (const ev of (body && body.events) || []) {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const abbrs = [];
    let away = '';
    let home = '';
    for (const side of comp.competitors || []) {
      const abbr = side && side.team && side.team.abbreviation;
      if (abbr) abbrs.push(String(abbr).toUpperCase());
      const name = side && side.team && (side.team.displayName || side.team.shortDisplayName || '');
      if (side && side.homeAway === 'home') home = name;
      if (side && side.homeAway === 'away') away = name;
    }
    const state = comp.status && comp.status.type && comp.status.type.state;
    out.push({
      abbrs,
      away,
      home,
      start: ev.date || null,
      live: state === 'in',
    });
  }
  return out;
}

function applyKalshiSchedule(quotes, schedule, nowMs) {
  const now = Number(nowMs) || Date.now();
  const games = schedule || [];
  for (const quote of quotes || []) {
    if (!quote) continue;
    const codes = pairFromTicker(quote.ticker);
    const hit = codes.length === 2
      ? games.find((game) => game && codes.every((code) => (game.abbrs || []).includes(code)))
      : null;
    if (hit && hit.start) quote.start = hit.start;
    if (hit && hit.away) quote.away = hit.away;
    if (hit && hit.home) quote.home = hit.home;
    if (hit) {
      quote.is_live = hit.live === true;
      continue;
    }
    const startMs = Date.parse(quote.start || '');
    if (Number.isFinite(startMs) && startMs <= now && now - startMs < 6 * 3600 * 1000) quote.is_live = true;
  }
  return quotes;
}

const ESPN_SCOREBOARD = Object.freeze({
  NFL: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  NCAAF: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
  MLB: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
});

const espnCache = new Map();

async function espnSchedule(league, fetchFn) {
  const boardUrl = ESPN_SCOREBOARD[league];
  if (!boardUrl) return [];
  const hit = espnCache.get(league);
  const now = Date.now();
  if (hit && now - hit.at < 15_000) return hit.games;
  try {
    const sched = await fetchJson(fetchFn, boardUrl, { timeoutMs: 2500 });
    const games = scheduleFromEspn(sched && sched.body);
    espnCache.set(league, { at: now, games });
    return games;
  } catch (_) {
    return hit ? hit.games : [];
  }
}

function kalshiLevelPrice(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.price_dollars != null) return asProb(msg.price_dollars) || (Number(msg.price_dollars) > 0 && Number(msg.price_dollars) < 1 ? Number(msg.price_dollars) : null);
  const raw = Number(msg.price);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (raw < 1) return raw;
  if (raw < 100) return raw / 100;
  return null;
}

function kalshiLevelDelta(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.delta_fp != null && msg.delta_fp !== '') return Number(msg.delta_fp);
  if (msg.delta != null && msg.delta !== '') return Number(msg.delta);
  return null;
}

// Live orderbook_snapshot uses no_dollars_fp. REST still sends no_dollars.
// Legacy cent ladders use no. Missing the fp field leaves an empty ladder,
// and each following delta then looks like the whole book.
function kalshiNoRows(msg) {
  if (!msg || typeof msg !== 'object') return [];
  if (Array.isArray(msg.no_dollars_fp)) return msg.no_dollars_fp;
  if (Array.isArray(msg.no_dollars)) return msg.no_dollars;
  if (Array.isArray(msg.no)) return msg.no;
  return [];
}

function loadKalshiNoLevels(rows) {
  const no = new Map();
  for (const row of rows || []) {
    const price = Array.isArray(row) ? Number(row[0]) : kalshiLevelPrice(row);
    const size = Array.isArray(row) ? Number(row[1]) : Number(row && (row.size || row.count));
    const px = price > 1 && price < 100 ? price / 100 : price;
    if (!Number.isFinite(px) || px <= 0 || px >= 1) continue;
    if (Number.isFinite(size) && size > 0) no.set(px.toFixed(4), size);
  }
  return no;
}

function createKalshiOrderbook() {
  return {
    levels: new Map(),
    built: new Set(),
    // Tickers that have had a snapshot. A seq gap clears the ladder but
    // ticker frames still must not replace that price.
    sourced: new Set(),
    seqBySid: new Map(),
    tickersBySid: new Map(),
  };
}

function classifyKalshiSeq(state, sid, seq) {
  if (sid == null || sid === '' || !Number.isFinite(Number(seq))) return 'unsequenced';
  const key = Number(sid);
  const n = Number(seq);
  if (!state.seqBySid.has(key) || state.seqBySid.get(key) == null) return 'baseline';
  const last = state.seqBySid.get(key);
  if (n === last + 1) return 'next';
  if (n <= last) return 'dup';
  return 'gap';
}

function rememberKalshiTicker(state, sid, ticker) {
  if (sid == null || !Number.isFinite(Number(sid)) || !ticker) return;
  const key = Number(sid);
  let set = state.tickersBySid.get(key);
  if (!set) {
    set = new Set();
    state.tickersBySid.set(key, set);
  }
  set.add(ticker);
}

function invalidateKalshiSid(state, sid, ticker) {
  const key = Number(sid);
  const tickers = [...(state.tickersBySid.get(key) || [])];
  if (ticker && !tickers.includes(ticker)) tickers.push(ticker);
  for (const item of tickers) {
    state.built.delete(item);
    state.levels.delete(item);
  }
  state.seqBySid.set(key, null);
  return tickers;
}

function quoteFromKalshiNoBook(ticker, levels, meta, ts) {
  const ladder = [...(levels || new Map()).entries()].map(([price, size]) => [price, size]);
  const odds = asProb(kalshiYesAskFromNoBids(ladder));
  if (odds == null || !meta) return null;
  return {
    ...meta,
    odds,
    is_live: meta.is_live === true,
    updated_at: isoFromMs(ts),
    ticker,
  };
}

// Snapshot replaces the no-bid ladder and is the only moment the book is
// fully built. Deltas add a signed size. Seq is per sid: a gap drops the
// delta, clears that sid's ladders, and asks for get_snapshot. Yes ask =
// 1 − best no bid, so a yes-side delta only advances seq.
function applyKalshiOrderbookFrame(state, message, metaByTicker) {
  const empty = { quotes: [], resnapshot: null };
  const msg = message && message.msg && typeof message.msg === 'object' ? message.msg : message;
  const type = String((message && message.type) || '');
  if (type !== 'orderbook_snapshot' && type !== 'orderbook_delta') return empty;
  const ticker = msg && (msg.market_ticker || msg.ticker);
  const meta = metaByTicker && metaByTicker.get(ticker);
  if (!meta || !ticker || !state) return empty;
  const sid = message && message.sid != null && message.sid !== '' ? Number(message.sid) : null;
  const seq = message && message.seq != null && message.seq !== '' ? Number(message.seq) : null;
  const kind = classifyKalshiSeq(state, sid, seq);
  const ts = (msg && (msg.ts_ms || msg.ts)) || (message && message.ts);
  if (kind === 'dup') return empty;

  if (type === 'orderbook_snapshot') {
    const levels = loadKalshiNoLevels(kalshiNoRows(msg));
    state.levels.set(ticker, levels);
    state.built.add(ticker);
    state.sourced.add(ticker);
    rememberKalshiTicker(state, sid, ticker);
    if (kind !== 'unsequenced') state.seqBySid.set(sid, seq);
    const quote = quoteFromKalshiNoBook(ticker, levels, meta, ts);
    return { quotes: quote ? [quote] : [], resnapshot: null };
  }

  if (kind === 'gap') {
    const tickers = invalidateKalshiSid(state, sid, ticker);
    return { quotes: [], resnapshot: { sid, market_tickers: tickers } };
  }
  if (kind === 'baseline') {
    rememberKalshiTicker(state, sid, ticker);
    return { quotes: [], resnapshot: { sid, market_tickers: [ticker] } };
  }
  if (kind === 'next') state.seqBySid.set(sid, seq);
  if (!state.built.has(ticker)) {
    rememberKalshiTicker(state, sid, ticker);
    if (sid != null && Number.isFinite(sid)) {
      return { quotes: [], resnapshot: { sid, market_tickers: [ticker] } };
    }
    return empty;
  }

  const side = String(msg.side || '').toLowerCase();
  if (side === 'no') {
    const no = state.levels.get(ticker);
    const px = kalshiLevelPrice(msg);
    const delta = kalshiLevelDelta(msg);
    if (no && px != null && Number.isFinite(delta)) {
      const key = px.toFixed(4);
      const next = (no.get(key) || 0) + delta;
      if (next <= 0) no.delete(key);
      else no.set(key, next);
    }
  } else if (side !== 'yes') {
    return empty;
  }
  const quote = quoteFromKalshiNoBook(ticker, state.levels.get(ticker), meta, ts);
  return { quotes: quote ? [quote] : [], resnapshot: null };
}

const kalshiBookStates = new WeakMap();

function kalshiBookState(books) {
  if (books && books.levels && books.seqBySid) return books;
  if (!(books instanceof Map)) return createKalshiOrderbook();
  let state = kalshiBookStates.get(books);
  if (!state) {
    state = createKalshiOrderbook();
    kalshiBookStates.set(books, state);
  }
  return state;
}

function quotesFromKalshiOrderbook(message, books, metaByTicker) {
  return applyKalshiOrderbookFrame(kalshiBookState(books), message, metaByTicker).quotes;
}

function kalshiSnapshotRequest(sid, tickers, id) {
  return {
    id,
    cmd: 'update_subscription',
    params: {
      sids: [Number(sid)],
      market_tickers: tickers,
      action: 'get_snapshot',
    },
  };
}

function quotesFromKalshiTicker(message, metaByTicker) {
  const msg = message && message.msg && typeof message.msg === 'object' ? message.msg : message;
  const type = String((message && (message.type || message.event_type)) || '');
  if (type && type !== 'ticker') return [];
  const ticker = msg && (msg.market_ticker || msg.ticker);
  const meta = metaByTicker && metaByTicker.get(ticker);
  if (!meta) return [];
  const odds = kalshiAskProb(msg);
  if (odds == null) return [];
  return [{
    ...meta,
    odds,
    is_live: meta.is_live === true,
    updated_at: isoFromMs(msg.ts || message.ts),
    ticker,
  }];
}

function fanoutHasSnapshot(last) {
  if (last == null) return false;
  if (Array.isArray(last)) return last.length > 0;
  // A packet ({ quotes, mode, note }) must replay even when quotes are empty
  // so a late subscriber still learns needs-credentials.
  return typeof last === 'object';
}

function quoteIdentity(quote) {
  if (!quote || typeof quote !== 'object') return '';
  if (quote.token_id) return `t:${quote.token_id}`;
  if (quote.ticker) return `k:${quote.ticker}`;
  return [
    'q',
    quote.book || '',
    quote.league || '',
    quote.away || '',
    quote.home || '',
    quote.side || '',
    quote.bet_type || 'moneyline',
    quote.line == null ? '' : quote.line,
  ].join('|');
}

function mergeQuoteLists(prev, incoming) {
  const map = new Map();
  for (const quote of prev || []) {
    const key = quoteIdentity(quote);
    if (key) map.set(key, quote);
  }
  for (const quote of incoming || []) {
    const key = quoteIdentity(quote);
    if (key) map.set(key, quote);
  }
  return [...map.values()];
}

function quotesOf(snapshot) {
  if (Array.isArray(snapshot)) return snapshot;
  if (snapshot && typeof snapshot === 'object' && Array.isArray(snapshot.quotes)) return snapshot.quotes;
  return [];
}

// The hub replays `last` to clients that attach after the upstream loop is
// already running. Producers often emit only the contracts that just moved.
// Fold those into the book we already have so a one-ticker tick cannot
// replace the snapshot a late subscriber will paint.
function mergeQuoteSnapshot(prev, incoming) {
  if (Array.isArray(incoming)) {
    if (!incoming.length) return quotesOf(prev).length ? prev : incoming;
    return mergeQuoteLists(quotesOf(prev), incoming);
  }
  if (incoming && typeof incoming === 'object' && Array.isArray(incoming.quotes)) {
    if (!incoming.quotes.length) return incoming;
    return { ...incoming, quotes: mergeQuoteLists(quotesOf(prev), incoming.quotes) };
  }
  return incoming == null ? (prev || []) : incoming;
}

// A new SSE client needs the whole book once. Later frames are deltas, so
// the stored packet's complete flag follows the last tick. Replay forces
// the snapshot shape without dropping contracts the tick did not mention.
function replaySnapshot(last) {
  if (Array.isArray(last)) return { quotes: last, complete: true, mode: 'snapshot' };
  if (!last || typeof last !== 'object' || !Array.isArray(last.quotes)) return last;
  if (last.mode === 'needs-credentials' || (last.note && !last.quotes.length)) return last;
  return { ...last, complete: true, mode: 'snapshot' };
}

function createFanout() {
  const listeners = new Set();
  let last = [];
  let stopFn = null;
  let starting = false;
  let generation = 0;
  return {
    get size() { return listeners.size; },
    listen(onQuotes, start) {
      listeners.add(onQuotes);
      if (fanoutHasSnapshot(last)) {
        try { onQuotes(replaySnapshot(last)); } catch (_) { /* listener gone */ }
      }
      if (!stopFn && !starting) {
        starting = true;
        const gen = ++generation;
        Promise.resolve().then(() => start((incoming) => {
          last = mergeQuoteSnapshot(last, incoming);
          const live = incoming == null ? [] : incoming;
          for (const fn of listeners) {
            try { fn(live); } catch (_) { /* ignore */ }
          }
        })).then((stop) => {
          if (gen !== generation) {
            if (typeof stop === 'function') stop();
            return;
          }
          stopFn = typeof stop === 'function' ? stop : null;
          starting = false;
          if (!listeners.size && stopFn) {
            const stopNow = stopFn;
            stopFn = null;
            stopNow();
          }
        }).catch(() => {
          if (gen === generation) starting = false;
        });
      }
      return () => {
        listeners.delete(onQuotes);
        if (listeners.size) return false;
        generation += 1;
        const stop = stopFn;
        stopFn = null;
        starting = false;
        last = [];
        if (typeof stop === 'function') stop();
        return true;
      };
    },
  };
}

function hubFor(map, key) {
  let hub = map.get(key);
  if (!hub) {
    hub = createFanout();
    map.set(key, hub);
  }
  return hub;
}

async function fetchJson(fetchFn, url, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 8000;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const headers = {
      accept: 'application/json',
      'user-agent': 'aibetbuilder-odds-board',
    };
    if (opts && opts.body) headers['content-type'] = 'application/json';
    const res = await fetchFn(url, {
      method: (opts && opts.method) || 'GET',
      headers,
      body: opts && opts.body,
      signal: ctrl ? ctrl.signal : undefined,
    });
    const text = res && typeof res.text === 'function' ? await res.text() : '';
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch (_) { body = null; }
    }
    return { ok: !!(res && res.ok), status: res && res.status, body };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function discoverPolymarket(league, deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const now = (deps && deps.now) || Date.now();
  const series = POLY_SERIES[league];
  const url = `${POLY_GAMMA}/events?series_id=${series}&active=true&closed=false&limit=50&order=startTime&ascending=true`;
  const listed = await fetchJson(fetchFn, url);
  const events = Array.isArray(listed.body) ? listed.body : [];
  const entries = [];
  for (const ev of events) {
    if (!eventInWindow(ev, now)) continue;
    entries.push(...moneylineEntriesFromEvent(ev, league));
  }
  return entries.slice(0, 80);
}

function gammaQuotes(entries, nowMs) {
  const now = nowMs || Date.now();
  const out = [];
  for (const entry of entries || []) {
    const quote = quoteFromAsk(entry, entry.outcomePrice, now);
    if (quote) out.push(quote);
  }
  return out;
}

// The price to buy an outcome is the cheapest ask that still has size.
// POST /books returns the same ladder as GET /book. Index 0 is the worst
// level, so the ask is min(price) over size > 0, not asks[0] and not the
// /prices BUY number (that one is the bid).
async function fetchPolymarketBooks(entries, deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const list = (entries || []).filter((entry) => entry && entry.tokenId);
  if (!list.length) return [];
  const res = await fetchJson(fetchFn, `${POLY_CLOB}/books`, {
    method: 'POST',
    body: JSON.stringify(list.map((entry) => ({ token_id: entry.tokenId }))),
  });
  const body = res && res.body;
  if (!res || !res.ok) return [];
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.books)) return body.books;
  return [];
}

function quotesFromPolymarketBooks(entries, books, fallbackNow) {
  const byAsset = new Map();
  for (const book of books || []) {
    const id = String(book && (book.asset_id || book.token_id) || '');
    if (id) byAsset.set(id, book);
  }
  const out = [];
  for (const entry of entries || []) {
    if (!entry || !entry.tokenId) continue;
    const book = byAsset.get(String(entry.tokenId));
    if (!book) continue;
    const ask = bestAskFromLevels(book.asks);
    const quote = quoteFromAsk(entry, ask, book.timestamp || fallbackNow);
    if (quote) out.push(quote);
  }
  return out;
}

function seedPolymarketStore(store, books) {
  for (const book of books || []) {
    const id = String(book && (book.asset_id || book.token_id) || '');
    if (!id) continue;
    const state = store.get(id) || emptyPolymarketBook();
    const ts = epochMs(book.timestamp) || 0;
    if (state.seeded && state.ts && ts && ts < state.ts) continue;
    applyPolymarketBookSnapshot(state, book);
    state.ts = ts || state.ts;
    store.set(id, state);
  }
}

async function loadPolymarketAsks(entries, deps) {
  const books = await fetchPolymarketBooks(entries, deps);
  return quotesFromPolymarketBooks(entries, books, (deps && deps.now) || Date.now());
}

async function loadPolymarketQuotes(league, deps) {
  const entries = await discoverPolymarket(league, deps);
  let quotes = [];
  try {
    quotes = await loadPolymarketAsks(entries, deps);
  } catch (_) {
    quotes = [];
  }
  if (quotes.length) return quotes;
  return gammaQuotes(entries, (deps && deps.now) || Date.now());
}

function startPolymarket(league, deps, emit) {
  const WS = (deps && deps.WebSocket) || globalThis.WebSocket;
  let stopped = false;
  let ws = null;
  let ping = null;
  let retry = null;
  const book = new Map();
  const levelBooks = new Map();
  let entries = [];
  // HTTP /books only heals a missed frame. The market socket is the push.
  const pollMs = (deps && deps.pollMs) || 10000;
  const maxPolls = deps && deps.maxPolls;
  const emitQuotes = createQuoteEmitter(book, (q) => q.token_id, emit);

  const putQuotes = (quotes) => {
    for (const quote of quotes || []) {
      if (!quote || !quote.token_id) continue;
      const prev = book.get(quote.token_id);
      const next = keepNewerQuote(prev, quote);
      if (next && next !== prev) book.set(quote.token_id, next);
    }
  };

  const openWs = () => {
    if (stopped || !WS || !entries.length) return;
    try { if (ws && ws.close) ws.close(); } catch (_) { /* ignore */ }
    ws = new WS(POLY_WS_URL);
    if (deps && deps.onSocket) deps.onSocket(ws);
    const catalog = () => new Map(entries.map((entry) => [entry.tokenId, entry]));
    ws.addEventListener('open', () => {
      if (stopped) return;
      try {
        ws.send(JSON.stringify({
          assets_ids: entries.map((entry) => entry.tokenId),
          type: 'market',
          custom_feature_enabled: true,
        }));
      } catch (_) { /* closing */ }
      if (ping) clearInterval(ping);
      ping = setInterval(() => {
        try { ws.send('PING'); } catch (_) { /* closing */ }
      }, 10000);
    });
    ws.addEventListener('message', (ev) => {
      const text = String(ev && ev.data != null ? ev.data : '');
      if (!text || text === 'PONG') return;
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) { return; }
      const applied = applyPolymarketStreamMessage(levelBooks, parsed);
      if (!applied.length) return;
      const cat = catalog();
      const quotes = [];
      for (const row of applied) {
        const entry = cat.get(row.assetId);
        const quote = quoteFromAsk(entry, row.bestAsk, row.ts);
        if (quote) quotes.push(quote);
      }
      if (!quotes.length) return;
      putQuotes(quotes);
      emitQuotes.push('ws');
    });
    const reopen = () => {
      if (stopped) return;
      if (ping) clearInterval(ping);
      ping = null;
      if (retry) return;
      retry = setTimeout(() => {
        retry = null;
        if (!stopped) openWs();
      }, 1000);
    };
    ws.addEventListener('close', reopen);
    ws.addEventListener('error', reopen);
  };

  const run = (async () => {
    let polls = 0;
    while (!stopped) {
      try {
        entries = await discoverPolymarket(league, deps);
      } catch (_) {
        entries = entries || [];
      }
      if (stopped) break;
      if (entries.length && !ws) openWs();
      // Stamp the refresh with the time it started. A websocket tick that
      // lands while the HTTP call is in flight is newer and must win.
      const fetchedAt = Date.now();
      let priced = [];
      try {
        const snapshots = await fetchPolymarketBooks(entries, deps);
        seedPolymarketStore(levelBooks, snapshots);
        priced = quotesFromPolymarketBooks(entries, snapshots, fetchedAt);
      } catch (_) {
        priced = [];
      }
      // Gamma is a cached mid. It may fill a token we have never priced.
      // It must not rewind a websocket ask already in the book.
      if (!priced.length) {
        priced = gammaQuotes(entries, fetchedAt).filter((quote) => quote && !book.has(quote.token_id));
      }
      putQuotes(priced);
      emitQuotes.push(emitQuotes.ready ? 'rest' : 'snapshot');
      polls += 1;
      if (maxPolls != null && polls >= maxPolls) break;
      if (!entries.length && book.size === 0) break;
      await sleep(pollMs, () => stopped);
    }
  })();
  run.catch(() => { if (!stopped && book.size === 0) emit([]); });
  return {
    ready: run,
    stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      if (ping) clearInterval(ping);
      ping = null;
      try { if (ws && ws.close) ws.close(); } catch (_) { /* ignore */ }
    },
  };
}

async function loadKalshiQuotes(league, deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const base = (deps && deps.kalshiBase) || KALSHI_REST;
  const series = KALSHI_GAME_SERIES[league];
  const events = [];
  let cursor = '';
  // Scoreboard fetch overlaps the events pages. A stall must not hold the snapshot.
  const scheduleP = espnSchedule(league, fetchFn);
  for (let page = 0; page < 3; page += 1) {
    const url = `${base}/events?series_ticker=${encodeURIComponent(series)}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchJson(fetchFn, url);
    const batch = (res.body && res.body.events) || [];
    events.push(...batch);
    cursor = (res.body && res.body.cursor) || '';
    if (!cursor) break;
  }
  const quotes = quotesFromKalshiEvents(events, league, deps && deps.now);
  try {
    const games = await scheduleP;
    applyKalshiSchedule(quotes, games, (deps && deps.now) || Date.now());
  } catch (_) { /* keep the market timestamp */ }
  await overlayLiveKalshiAsks(quotes, deps);
  return quotes;
}

// The events list's yes_ask can lag the live ladder. For a game in the
// window, replace it with 1 − the best no bid. A size-0 level is not a bid.
async function overlayLiveKalshiAsks(quotes, deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const base = (deps && deps.kalshiBase) || KALSHI_REST;
  const now = (deps && deps.now) || Date.now();
  const live = (quotes || []).filter((quote) => {
    const start = Date.parse(quote && quote.start || '');
    if (!Number.isFinite(start) || !quote.ticker) return false;
    return start >= now - 12 * 3600 * 1000 && start <= now + 12 * 3600 * 1000;
  });
  await Promise.all(live.map(async (quote) => {
    try {
      const url = `${base}/markets/${encodeURIComponent(quote.ticker)}/orderbook`;
      const res = await fetchJson(fetchFn, url);
      const noBids = res && res.body && res.body.orderbook_fp && res.body.orderbook_fp.no_dollars;
      const ask = kalshiYesAskFromNoBids(noBids);
      const odds = asProb(ask);
      if (odds == null) return;
      quote.odds = odds;
      quote.updated_at = new Date(now).toISOString();
    } catch (_) { /* keep the ticker yes_ask */ }
  }));
  return quotes;
}

function sleep(ms, isStopped) {
  const step = 50;
  let left = ms;
  return new Promise((resolve) => {
    const tick = () => {
      if (isStopped()) { resolve(); return; }
      if (left <= 0) { resolve(); return; }
      const n = Math.min(step, left);
      left -= n;
      setTimeout(tick, n);
    };
    tick();
  });
}

function loadKalshiCreds(deps) {
  if (deps && deps.kalshiCreds) return deps.kalshiCreds;
  try {
    return require('../api/kalshi-sign').readKalshiCreds(deps && deps.env);
  } catch (_) {
    return { ok: false, missing: ['KALSHI_KEY_ID', 'Kalshi_combo_key'] };
  }
}

function kalshiWsAuthHeaders(deps, creds) {
  if (deps && deps.wsHeaders) return deps.wsHeaders;
  if (!creds || !creds.ok) return null;
  try {
    const { authHeaders } = require('../api/kalshi-sign');
    return authHeaders({
      keyId: creds.keyId,
      pem: creds.pem,
      method: 'GET',
      signPath: KALSHI_WS_SIGN_PATH,
    });
  } catch (_) {
    return null;
  }
}

function kalshiSocket(deps) {
  if (deps && deps.WebSocket) return deps.WebSocket;
  try { return require('ws'); } catch (_) { return globalThis.WebSocket; }
}

// Hold one SSE response inside the function budget, then drop it so the
// browser opens a new one. Vercel kills the invocation at maxDuration 300s.
const SSE_HOLD_MS = 240000;

function startKalshiPoll(league, deps, emit) {
  let stopped = false;
  let ws = null;
  let retry = null;
  let wsFailures = 0;
  const creds = loadKalshiCreds(deps);
  const keyed = !!(creds && creds.ok && kalshiWsAuthHeaders(deps, creds));
  // Keyed: ticker WS is the fast path, REST heals every pollMs.
  // Keyless: REST itself has to stay inside the 2s board target.
  // Keyed: ticker / orderbook_delta is the push. REST only heals.
  // Keyless: there is no public Kalshi socket, so REST is the quote path
  // and it emits a contract only when its ask changes.
  const pollMs = (deps && deps.pollMs) || (keyed ? 10000 : 1000);
  const maxPolls = deps && deps.maxPolls;
  const book = new Map();
  const ob = createKalshiOrderbook();
  const emitQuotes = createQuoteEmitter(book, (q) => q.ticker, emit);
  let cmdId = 1000;
  const pendingSnap = new Set();

  const putQuotes = (quotes) => {
    for (const quote of quotes || []) {
      if (!quote || !quote.ticker) continue;
      const prev = book.get(quote.ticker);
      const next = keepNewerQuote(prev, quote);
      if (next && next !== prev) book.set(quote.ticker, next);
    }
  };

  const openWs = () => {
    if (stopped || wsFailures >= 3) return;
    const headers = kalshiWsAuthHeaders(deps, creds);
    const WS = kalshiSocket(deps);
    const tickers = [...book.keys()];
    if (!headers || !WS || !tickers.length) return;
    const prev = ws;
    try {
      ws = new WS(KALSHI_WS_URL, { headers });
    } catch (_) {
      wsFailures += 1;
      ws = prev;
      return;
    }
    const socket = ws;
    if (prev && prev.close) {
      try { prev.close(); } catch (_) { /* ignore */ }
    }
    if (deps && deps.onSocket) deps.onSocket(socket);
    socket.addEventListener('open', () => {
      if (stopped || socket !== ws) return;
      wsFailures = 0;
      // A new socket gets new sids. Drop seq and ladders so a reused sid
      // cannot apply deltas onto the previous book. sourced stays set, so
      // ticker frames still cannot override a price we already built.
      ob.seqBySid.clear();
      ob.built.clear();
      ob.levels.clear();
      ob.tickersBySid.clear();
      pendingSnap.clear();
      try {
        const list = [...book.keys()];
        for (let i = 0; i < list.length; i += 100) {
          socket.send(JSON.stringify(kalshiSubscribeMessage(list.slice(i, i + 100), (i / 100) + 1)));
        }
      } catch (_) { /* closing */ }
    });
    const requestResnapshot = (req) => {
      if (!req || req.sid == null || socket !== ws) return;
      const sid = Number(req.sid);
      if (pendingSnap.has(sid)) return;
      const tickers = [...new Set((req.market_tickers || []).filter(Boolean))];
      if (!tickers.length) return;
      pendingSnap.add(sid);
      try {
        for (let i = 0; i < tickers.length; i += 100) {
          socket.send(JSON.stringify(kalshiSnapshotRequest(sid, tickers.slice(i, i + 100), cmdId)));
          cmdId += 1;
        }
      } catch (_) {
        pendingSnap.delete(sid);
      }
    };
    socket.addEventListener('message', (ev) => {
      if (socket !== ws) return;
      const text = String(ev && ev.data != null ? ev.data : ev || '');
      if (!text || text === 'PONG') return;
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) { return; }
      const applied = applyKalshiOrderbookFrame(ob, parsed, book);
      if (parsed && parsed.type === 'orderbook_snapshot' && parsed.sid != null) {
        pendingSnap.delete(Number(parsed.sid));
      }
      if (applied.resnapshot) requestResnapshot(applied.resnapshot);
      // Ticker yes_ask races the ladder (a 17c print on a book whose ask
      // is 9c). Once a snapshot has built the book, the ladder is the price.
      const tickerQuotes = quotesFromKalshiTicker(parsed, book)
        .filter((quote) => quote && !ob.sourced.has(quote.ticker));
      const updates = applied.quotes.concat(tickerQuotes);
      if (!updates.length) return;
      // Advance the clock even when the ask is unchanged, so a REST poll
      // that started earlier cannot rewind this contract.
      let oddsChanged = false;
      for (const quote of updates) {
        const prior = book.get(quote.ticker);
        const next = keepNewerQuote(prior, quote);
        if (!next || next === prior) continue;
        book.set(quote.ticker, next);
        if (!prior || prior.odds !== next.odds) oddsChanged = true;
      }
      if (oddsChanged && emitQuotes.ready) emitQuotes.push('ws');
    });
    const reopen = () => {
      if (stopped || socket !== ws) return;
      wsFailures += 1;
      if (retry || wsFailures >= 3) return;
      retry = setTimeout(() => {
        retry = null;
        if (!stopped) openWs();
      }, 1000);
    };
    socket.addEventListener('close', reopen);
    socket.addEventListener('error', reopen);
  };

  const loop = (async () => {
    let polls = 0;
    while (!stopped) {
      let quotes = [];
      const fetchedAt = Date.now();
      try {
        quotes = await loadKalshiQuotes(league, Object.assign({}, deps, { now: fetchedAt }));
      } catch (_) {
        quotes = [];
      }
      if (stopped) break;
      // First REST result is the snapshot. Later polls emit only asks that moved.
      if (quotes.length) {
        putQuotes(quotes);
        emitQuotes.push(emitQuotes.ready ? 'rest' : 'snapshot');
      }
      polls += 1;
      if (polls === 1) openWs();
      if (maxPolls != null && polls >= maxPolls) break;
      await sleep(pollMs, () => stopped);
    }
  })();
  return {
    ready: loop,
    stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      try { if (ws && ws.close) ws.close(); } catch (_) { /* ignore */ }
    },
  };
}

function ssePacket(value, fallbackMode) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.quotes)) {
    return {
      quotes: value.quotes,
      mode: value.mode || fallbackMode,
      note: value.note,
      complete: value.complete === true,
    };
  }
  const quotes = Array.isArray(value) ? value : [];
  // Kalshi and Polymarket emit a plain array that is the full book.
  return {
    quotes,
    mode: fallbackMode,
    note: undefined,
    complete: quotes.length > 0,
  };
}

function attachHub(res, req, { hubs, key, source, mode, start, sseHoldMs }) {
  const map = hubs || defaultHubs;
  const hub = hubFor(map, key);
  let closed = false;
  const holdMs = sseHoldMs != null ? sseHoldMs : SSE_HOLD_MS;
  let holdTimer = null;
  const write = (incoming) => {
    if (closed) return;
    const packet = ssePacket(incoming, mode);
    try {
      res.write(formatQuoteSse(packet.quotes, Date.now(), {
        source,
        mode: packet.mode,
        note: packet.note,
        complete: packet.complete === true,
      }));
      if (typeof res.flush === 'function') res.flush();
    } catch (_) {
      closed = true;
    }
  };
  const remove = hub.listen(write, (emit) => {
    // stop() is synchronous. The upstream loop runs on its own and checks it.
    const handle = start(emit);
    return handle.stop;
  });
  const abort = () => {
    if (closed) return;
    closed = true;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    const idle = remove();
    if (idle) map.delete(key);
    try { res.end(); } catch (_) { /* ignore */ }
  };
  if (holdMs > 0) holdTimer = setTimeout(abort, holdMs);
  if (req && typeof req.on === 'function') {
    req.on('close', abort);
    req.on('aborted', abort);
  }
  return abort;
}

function beginSse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

module.exports = {
  BOOK_IDS,
  POLY_SERIES,
  POLY_WS_URL,
  POLY_GAMMA,
  POLY_CLOB,
  KALSHI_GAME_SERIES,
  KALSHI_WS_URL,
  KALSHI_WS_SIGN_PATH,
  KALSHI_REST,
  LEAGUES,
  defaultHubs,
  parseLeague,
  splitVersus,
  asProb,
  eventInWindow,
  moneylineEntriesFromEvent,
  quotesFromPolymarketMessage,
  keepNewerQuote,
  quoteUpdatedMs,
  bestBidFromLevels,
  bestAskFromLevels,
  kalshiYesAskFromNoBids,
  applyPolymarketStreamMessage,
  emptyPolymarketBook,
  quotesFromKalshiEvents,
  quotesFromKalshiMarket,
  quotesFromKalshiTicker,
  quotesFromKalshiOrderbook,
  createKalshiOrderbook,
  applyKalshiOrderbookFrame,
  kalshiSnapshotRequest,
  kalshiSubscribeMessage,
  pairFromTicker,
  scheduleFromEspn,
  applyKalshiSchedule,
  changedQuotes,
  formatQuoteSse,
  createFanout,
  discoverPolymarket,
  loadPolymarketAsks,
  loadPolymarketQuotes,
  loadKalshiQuotes,
  startPolymarket,
  startKalshiPoll,
  attachHub,
  beginSse,
  SSE_HOLD_MS,
  kalshiAskProb,
};
