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

function isoFromMs(raw) {
  const n = Number(raw);
  const ms = Number.isFinite(n) && n > 0 ? n : Date.now();
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
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

function formatQuoteSse(quotes, ingestTs, extra) {
  const payload = { source: extra && extra.source, quotes: quotes || [] };
  if (extra && extra.note) payload.note = extra.note;
  if (extra && extra.mode) payload.mode = extra.mode;
  // complete: this event is the whole moneyline book, not the one contract
  // that just moved. The board replaces its quotes instead of merging.
  if (extra && extra.complete === true) payload.complete = true;
  return `event: quote\ndata: ${JSON.stringify({ ingest_ts: ingestTs, payload })}\n\n`;
}

function kalshiSubscribeMessage(tickers, id = 1) {
  return {
    id,
    cmd: 'subscribe',
    params: {
      channels: ['ticker'],
      market_tickers: tickers,
    },
  };
}

function eventStart(ev) {
  if (!ev) return null;
  return ev.start_time || ev.startTime || ev.open_time || ev.strike_date || null;
}

function quotesFromKalshiMarket(market, league, teams) {
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
    // the game; yes_ask is the price. Callers mark the fixture live.
    is_live: false,
    odds,
    size: Number.isFinite(size) && size > 0 ? size : null,
    updated_at: new Date().toISOString(),
    ticker: market.ticker,
  };
  // occurrence_datetime is kickoff. open_time is when the market listed.
  const start = (teams && teams.start) || market.occurrence_datetime || null;
  if (start) quote.start = start;
  return quote;
}

function quotesFromKalshiEvents(events, league) {
  const out = [];
  for (const ev of events || []) {
    const teams = splitVersus(ev.title || ev.sub_title || '');
    teams.start = eventStart(ev);
    for (const market of ev.markets || []) {
      const ticker = String(market.ticker || '');
      // Series root is the game moneyline. Spread/total series are separate
      // and are not requested here. Skip anything that is not the side market.
      if (!ticker.startsWith(`${KALSHI_GAME_SERIES[league]}-`)) continue;
      const quote = quotesFromKalshiMarket(market, league, teams);
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
        try { onQuotes(last); } catch (_) { /* listener gone */ }
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

// CLOB /prices side=BUY is the best ask. Gamma outcomePrices are cached
// (max-age=300) and go stale in-game; they are only a fallback.
async function loadPolymarketAsks(entries, deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const list = (entries || []).filter((entry) => entry && entry.tokenId);
  if (!list.length) return [];
  const res = await fetchJson(fetchFn, `${POLY_CLOB}/prices`, {
    method: 'POST',
    body: JSON.stringify(list.map((entry) => ({ token_id: entry.tokenId, side: 'BUY' }))),
  });
  const body = res && res.body;
  if (!res || !res.ok || !body || typeof body !== 'object' || Array.isArray(body)) return [];
  const now = (deps && deps.now) || Date.now();
  const out = [];
  for (const entry of list) {
    const row = body[entry.tokenId];
    const ask = row && typeof row === 'object' ? (row.BUY != null ? row.BUY : row.buy) : row;
    const quote = quoteFromAsk(entry, ask, now);
    if (quote) out.push(quote);
  }
  return out;
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
  const previous = new Map();
  const book = new Map();
  let entries = [];
  const pollMs = (deps && deps.pollMs) || 2000;
  const maxPolls = deps && deps.maxPolls;

  const emitBook = (force) => {
    const quotes = [...book.values()];
    if (!quotes.length) return;
    const changed = changedQuotes(previous, quotes, (q) => q.token_id);
    // A CLOB refresh always ships the whole book. A one-token WS frame
    // must not become the snapshot a client paints.
    if (force || changed.length) emit(quotes);
  };

  const putQuotes = (quotes) => {
    for (const quote of quotes || []) {
      if (quote && quote.token_id) book.set(quote.token_id, quote);
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
      const quotes = quotesFromPolymarketMessage(parsed, catalog());
      if (!quotes.length) return;
      putQuotes(quotes);
      emitBook(false);
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
      let priced = [];
      try {
        priced = await loadPolymarketAsks(entries, deps);
      } catch (_) {
        priced = [];
      }
      if (!priced.length) priced = gammaQuotes(entries, (deps && deps.now) || Date.now());
      putQuotes(priced);
      emitBook(true);
      polls += 1;
      if (maxPolls != null && polls >= maxPolls) break;
      if (!entries.length && book.size === 0) break;
      if (polls === 1 && entries.length) openWs();
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
  for (let page = 0; page < 3; page += 1) {
    const url = `${base}/events?series_ticker=${encodeURIComponent(series)}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchJson(fetchFn, url);
    const batch = (res.body && res.body.events) || [];
    events.push(...batch);
    cursor = (res.body && res.body.cursor) || '';
    if (!cursor) break;
  }
  return quotesFromKalshiEvents(events, league);
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
  const pollMs = (deps && deps.pollMs) || (keyed ? 2000 : 1000);
  const maxPolls = deps && deps.maxPolls;
  const book = new Map();

  const emitBook = (mode) => {
    const quotes = [...book.values()];
    if (!quotes.length) return;
    emit({ quotes, complete: true, mode });
  };

  const putQuotes = (quotes) => {
    for (const quote of quotes || []) {
      if (quote && quote.ticker) book.set(quote.ticker, quote);
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
      try {
        const list = [...book.keys()];
        for (let i = 0; i < list.length; i += 100) {
          socket.send(JSON.stringify(kalshiSubscribeMessage(list.slice(i, i + 100), (i / 100) + 1)));
        }
      } catch (_) { /* closing */ }
    });
    socket.addEventListener('message', (ev) => {
      if (socket !== ws) return;
      const text = String(ev && ev.data != null ? ev.data : ev || '');
      if (!text || text === 'PONG') return;
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) { return; }
      const updates = quotesFromKalshiTicker(parsed, book);
      if (!updates.length) return;
      const changed = updates.filter((quote) => {
        const prior = book.get(quote.ticker);
        return !prior || prior.odds !== quote.odds;
      });
      if (!changed.length) return;
      putQuotes(updates);
      emitBook('ws');
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
      try {
        quotes = await loadKalshiQuotes(league, deps);
      } catch (_) {
        quotes = [];
      }
      if (stopped) break;
      // Whole book every poll, not the ticker that moved. A one-contract
      // event left every other moneyline on the pregame print.
      if (quotes.length) {
        putQuotes(quotes);
        emitBook(ws ? 'ws' : 'rest-poll');
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
  quotesFromKalshiEvents,
  quotesFromKalshiMarket,
  quotesFromKalshiTicker,
  kalshiSubscribeMessage,
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
