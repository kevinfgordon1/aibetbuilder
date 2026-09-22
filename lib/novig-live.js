'use strict';

// Novig quotes for the New Odds Board. Betstamp is not called here.
//
// Auth: POST {NOVIG_API_BASE}/nbx/v1/auth/emm-token (client credentials).
// Tokens last ~30 minutes. Unset NOVIG_CLIENT_ID / NOVIG_CLIENT_SECRET
// returns null and the stream omits the column. Never invent a key.
//
// Discovery: GET /nbx/v2/emm/markets/open?league=&marketType=MONEY|SPREAD|TOTAL
// Books:     GET /nbx/v2/emm/events/getMarketsByEvent/{eventId}?currency=CASH
// Tape:      wss://{host}/tape  Authorization: Bearer <access_token>
//            subscribe "tape" (PLACE/CANCEL) and "lifecycle".
//
// The book lists bids per outcome. A bid is an order to buy that outcome.
// The price to buy the other outcome is 1 - best opposite bid. Same-side
// bids are not asks. COIN orders are ignored. Player props are ignored.
// One main spread and one main total per game: isConsensus when set,
// otherwise the two-sided line closest to 50/50.

const NOVIG_BOOK_ID = 195;
const DEFAULT_BASE = 'https://api.novig.us';
const BOARD_TYPES = new Set(['MONEY', 'SPREAD', 'TOTAL']);
const WINDOW_BACK_MS = 8 * 3600 * 1000;
const WINDOW_AHEAD_MS = 8 * 24 * 3600 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;
const DEFAULT_TOKEN_MS = 25 * 60 * 1000;

let tokenCache = { token: null, exp: 0, key: '' };
let tokenInflight = null;
let stampClock = 0;

function novigApiBase(deps) {
  const raw = (deps && deps.apiBase) || process.env.NOVIG_API_BASE || DEFAULT_BASE;
  return String(raw || DEFAULT_BASE).replace(/\/+$/, '');
}

function novigWsUrl(base) {
  const u = new URL(novigApiBase({ apiBase: base }));
  u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
  u.pathname = '/tape';
  u.search = '';
  u.hash = '';
  return u.toString();
}

function readCreds(deps) {
  if (deps && (Object.prototype.hasOwnProperty.call(deps, 'clientId') || Object.prototype.hasOwnProperty.call(deps, 'clientSecret'))) {
    return {
      id: deps.clientId ? String(deps.clientId) : '',
      secret: deps.clientSecret ? String(deps.clientSecret) : '',
    };
  }
  return {
    id: process.env.NOVIG_CLIENT_ID ? String(process.env.NOVIG_CLIENT_ID) : '',
    secret: process.env.NOVIG_CLIENT_SECRET ? String(process.env.NOVIG_CLIENT_SECRET) : '',
  };
}

function novigConfigured(deps) {
  const creds = readCreds(deps);
  return !!(creds.id && creds.secret);
}

function nowMs(deps) {
  const raw = deps && deps.nowMs;
  if (typeof raw === 'function') return raw();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : Date.now();
}

function resetNovigAuthCache() {
  tokenCache = { token: null, exp: 0, key: '' };
  tokenInflight = null;
  stampClock = 0;
}

function nextStamp(at) {
  const n = Number(at);
  const base = Number.isFinite(n) && n > 0 ? n : Date.now();
  stampClock = Math.max(stampClock + 1, base);
  return stampClock;
}

async function fetchJson(fetchFn, url, init) {
  const res = await fetchFn(url, init || {});
  const text = res && typeof res.text === 'function' ? await res.text() : '';
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch (_) { body = null; }
  }
  return { ok: !!(res && res.ok), status: res && res.status, body };
}

async function fetchNovigToken(deps) {
  const creds = readCreds(deps);
  if (!creds.id || !creds.secret) return null;
  const at = nowMs(deps);
  const key = `${novigApiBase(deps)}|${creds.id}`;
  if (tokenCache.token && tokenCache.key === key && tokenCache.exp > at + 5000) {
    return tokenCache.token;
  }
  if (tokenInflight && tokenInflight.key === key) return tokenInflight.promise;
  const run = (async () => {
    const fetchFn = (deps && deps.fetchFn) || fetch;
    const res = await fetchJson(fetchFn, `${novigApiBase(deps)}/nbx/v1/auth/emm-token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: creds.id,
        client_secret: creds.secret,
      }),
    });
    if (!res.ok || !res.body) return null;
    const token = res.body.access_token || res.body.token || null;
    if (!token) return null;
    const expiresIn = Number(res.body.expires_in);
    const ttl = Number.isFinite(expiresIn) && expiresIn > 0
      ? Math.max(30_000, expiresIn * 1000 - TOKEN_SKEW_MS)
      : DEFAULT_TOKEN_MS;
    tokenCache = { token, exp: at + ttl, key };
    return token;
  })();
  tokenInflight = { key, promise: run };
  try {
    return await run;
  } finally {
    if (tokenInflight && tokenInflight.promise === run) tokenInflight = null;
  }
}

function asList(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.markets)) return body.markets;
  if (body && Array.isArray(body.events)) return body.events;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}

function teamName(team) {
  if (!team) return '';
  if (typeof team === 'string') return team.trim();
  return String(team.name || team.shortName || team.mascot || '').trim();
}

function eventOf(market) {
  return (market && market.event) || null;
}

function teamsFromMarket(market) {
  const ev = eventOf(market);
  const game = ev && ev.game;
  if (!game) return null;
  const away = teamName(game.awayTeam);
  const home = teamName(game.homeTeam);
  if (!away || !home) return null;
  const status = String((ev && ev.status) || '').toUpperCase();
  return {
    away,
    home,
    start: game.scheduledStart || null,
    live: status === 'OPEN_INGAME',
    status,
    eventId: String((ev && ev.id) || market.eventId || ''),
    league: String(market.league || game.league || '').toUpperCase(),
  };
}

function eventInWindow(teams, at) {
  if (!teams) return false;
  if (teams.status === 'FINAL' || teams.status === 'CANCELED' || teams.status === 'CANCELLED') return false;
  if (teams.live || teams.status === 'OPEN_INGAME') return true;
  const start = Date.parse(teams.start || '');
  if (!Number.isFinite(start)) return false;
  return start > at - WINDOW_BACK_MS && start < at + WINDOW_AHEAD_MS;
}

function competitorName(outcome) {
  const c = outcome && outcome.competitor;
  if (!c) return '';
  if (typeof c === 'string') return c.trim();
  return String(c.name || c.shortName || '').trim();
}

function signedNumber(text) {
  const m = String(text || '').match(/([+-]\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function spreadLine(market, outcome) {
  const fromDesc = signedNumber(outcome && outcome.description);
  if (fromDesc != null) return fromDesc;
  const strike = Number(market && market.strike);
  if (!Number.isFinite(strike)) return null;
  if (outcome && outcome.index === 0) return strike;
  if (outcome && outcome.index === 1) return -strike;
  return null;
}

function totalLine(market) {
  const strike = Number(market && market.strike);
  if (Number.isFinite(strike)) return strike;
  const m = String((market && market.description) || '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function totalSide(outcome) {
  const desc = String((outcome && outcome.description) || '').toLowerCase();
  if (desc.includes('under')) return 'Under';
  if (desc.includes('over')) return 'Over';
  if (outcome && outcome.index === 1) return 'Under';
  if (outcome && outcome.index === 0) return 'Over';
  return null;
}

function sideName(market, outcome, teams) {
  const named = competitorName(outcome);
  if (named) return named;
  if (outcome && outcome.index === 0) return teams.home;
  if (outcome && outcome.index === 1) return teams.away;
  const desc = String((outcome && outcome.description) || '').trim();
  if (desc && !/[+-]?\d/.test(desc)) return desc;
  return '';
}

function keepMarket(market, league) {
  if (!market || market.playerId || market.player) return false;
  const type = String(market.type || '').toUpperCase();
  if (!BOARD_TYPES.has(type)) return false;
  const lg = String(market.league || (market.event && market.event.game && market.event.game.league) || '').toUpperCase();
  if (lg && lg !== league) return false;
  const status = String(market.status || '').toUpperCase();
  if (status === 'CLOSED' || status === 'SETTLED') return false;
  return true;
}

function seedOrders(market) {
  const orders = new Map();
  const ladders = (market.book && market.book.outcomeLadders) || market.outcomeLadders || [];
  for (const ladder of ladders) {
    const outcomeId = String(ladder.outcomeId || '');
    const bids = ladder.bids || [];
    bids.forEach((bid, i) => {
      if (!bid) return;
      if (bid.currency && String(bid.currency).toUpperCase() !== 'CASH') return;
      const price = Number(bid.price);
      const qty = Number(bid.qty != null ? bid.qty : bid.originalQty);
      if (!(price > 0 && price < 1) || !(qty > 0)) return;
      const id = String(bid.id || `${outcomeId}:${price}:${i}`);
      orders.set(id, { outcomeId, price, qty });
    });
  }
  return orders;
}

function normalizeOutcome(outcome) {
  if (!outcome) return null;
  const id = String(outcome.id || '');
  if (!id) return null;
  return {
    id,
    index: outcome.index,
    description: outcome.description || '',
    competitorName: competitorName(outcome),
  };
}

function catalogFromMarkets(markets, league, at) {
  const lg = String(league || '').toUpperCase();
  const seenAt = Number(at) || Date.now();
  const events = new Map();
  const byMarket = new Map();
  for (const market of markets || []) {
    if (!keepMarket(market, lg)) continue;
    const teams = teamsFromMarket(market);
    if (!teams || !teams.eventId) continue;
    if (teams.league && teams.league !== lg) continue;
    if (!eventInWindow(teams, seenAt)) continue;
    const outcomes = (market.outcomes || []).map(normalizeOutcome).filter(Boolean);
    if (outcomes.length !== 2) continue;
    events.set(teams.eventId, {
      away: teams.away,
      home: teams.home,
      start: teams.start,
      live: teams.live,
      status: teams.status,
    });
    byMarket.set(String(market.id), {
      id: String(market.id),
      eventId: teams.eventId,
      type: String(market.type || '').toUpperCase(),
      strike: market.strike,
      description: market.description || '',
      isConsensus: market.isConsensus === true,
      outcomes,
      orders: seedOrders(market),
    });
  }
  return { league: lg, events, markets: byMarket };
}

function bestBidOn(market, outcomeId) {
  let best = null;
  for (const order of market.orders.values()) {
    if (order.outcomeId !== outcomeId) continue;
    if (!(order.price > 0 && order.price < 1) || !(order.qty > 0)) continue;
    if (!best || order.price > best.price || (order.price === best.price && order.qty > best.qty)) {
      best = order;
    }
  }
  return best;
}

function askFor(market, outcomeId) {
  const other = (market.outcomes || []).find((o) => o.id !== outcomeId);
  if (!other) return null;
  const bid = bestBidOn(market, other.id);
  if (!bid) return null;
  // Novig prices are 3-decimal probabilities. Round so 1 - 0.715 is 0.285.
  const odds = Math.round((1 - bid.price) * 1000) / 1000;
  if (!(odds > 0 && odds < 1)) return null;
  return { odds, size: bid.qty };
}

function outcomeSide(market, outcome, teams) {
  if (market.type === 'TOTAL') return totalSide(outcome);
  return sideName(market, outcome, teams) || outcome.competitorName || '';
}

function outcomeLine(market, outcome) {
  if (market.type === 'SPREAD') return spreadLine(market, outcome);
  if (market.type === 'TOTAL') return totalLine(market);
  return null;
}

function marketIsQuotable(market, teams) {
  if (!market || !teams || market.outcomes.length !== 2) return false;
  if (market.type === 'MONEY') {
    return market.outcomes.some((o) => askFor(market, o.id) && outcomeSide(market, o, teams));
  }
  if (market.type === 'SPREAD' || market.type === 'TOTAL') {
    return market.outcomes.every((o) => {
      if (!askFor(market, o.id) || !outcomeSide(market, o, teams)) return false;
      return outcomeLine(market, o) != null;
    });
  }
  return false;
}

function balanceScore(market) {
  let score = 0;
  let n = 0;
  for (const outcome of market.outcomes) {
    const ask = askFor(market, outcome.id);
    if (!ask) continue;
    score += Math.abs(ask.odds - 0.5);
    n += 1;
  }
  if (!n) return Infinity;
  return score;
}

function pickMain(markets, teams) {
  const clean = (markets || []).filter((m) => marketIsQuotable(m, teams));
  if (!clean.length) return null;
  const consensus = clean.filter((m) => m.isConsensus);
  const pool = consensus.length ? consensus : clean;
  let best = null;
  let bestScore = Infinity;
  for (const market of pool) {
    const score = balanceScore(market);
    if (score < bestScore) {
      bestScore = score;
      best = market;
    }
  }
  return best;
}

function betTypeOf(type) {
  if (type === 'MONEY') return 'moneyline';
  if (type === 'SPREAD') return 'spread';
  if (type === 'TOTAL') return 'total';
  return '';
}

function quotesFromCatalog(catalog) {
  if (!catalog) return [];
  const byEventType = new Map();
  for (const market of catalog.markets.values()) {
    const key = `${market.eventId}|${market.type}`;
    if (!byEventType.has(key)) byEventType.set(key, []);
    byEventType.get(key).push(market);
  }
  const out = [];
  for (const group of byEventType.values()) {
    const eventId = group[0].eventId;
    const teams = catalog.events.get(eventId);
    const market = pickMain(group, teams);
    if (!market || !teams) continue;
    const betType = betTypeOf(market.type);
    if (!betType) continue;
    for (const outcome of market.outcomes) {
      const ask = askFor(market, outcome.id);
      const side = outcomeSide(market, outcome, teams);
      if (!ask || !side) continue;
      const line = outcomeLine(market, outcome);
      if ((betType === 'spread' || betType === 'total') && line == null) continue;
      const quote = {
        book: 'novig',
        book_id: NOVIG_BOOK_ID,
        league: catalog.league,
        away: teams.away,
        home: teams.home,
        side,
        bet_type: betType,
        odds: ask.odds,
        size: ask.size,
        is_alt: false,
        is_live: teams.live === true,
        token_id: outcome.id,
        market_id: market.id,
        start: teams.start || null,
      };
      if (line != null) {
        quote.line = line;
        quote.side_type = betType === 'total' ? side : undefined;
      }
      out.push(quote);
    }
  }
  return out;
}

function applyNovigMessage(catalog, message) {
  if (!catalog || !message || typeof message !== 'object') return catalog;
  if (message.event) return catalog;
  const type = String(message.type || '');
  if (type === 'PLACE') {
    const order = message.order;
    if (!order || order.id == null) return catalog;
    const marketId = String(order.marketId || (message.market && message.market.id) || '');
    const market = catalog.markets.get(marketId);
    if (!market) return catalog;
    const id = String(order.id);
    if (order.currency && String(order.currency).toUpperCase() !== 'CASH') {
      market.orders.delete(id);
      return catalog;
    }
    const price = Number(order.price);
    const qty = Number(order.qty != null ? order.qty : order.originalQty);
    const status = String(order.status || '').toUpperCase();
    if (!(qty > 0) || !(price > 0 && price < 1) || status === 'CANCELED' || status === 'CANCELLED' || status === 'FILLED') {
      market.orders.delete(id);
      return catalog;
    }
    market.orders.set(id, { outcomeId: String(order.outcomeId || ''), price, qty });
    return catalog;
  }
  if (type === 'CANCEL') {
    const order = message.order || {};
    const id = order.id != null ? String(order.id) : '';
    if (!id) return catalog;
    const marketId = String(order.marketId || (message.market && message.market.id) || '');
    const market = catalog.markets.get(marketId);
    if (market) market.orders.delete(id);
    else {
      for (const row of catalog.markets.values()) row.orders.delete(id);
    }
    return catalog;
  }
  if (type === 'EVENT_GOLIVE' || type === 'EVENT_UNLIVE') {
    const eventId = String((message.market && (message.market.eventId || (message.market.event && message.market.event.id))) || '');
    const ev = eventId && catalog.events.get(eventId);
    if (ev) ev.live = type === 'EVENT_GOLIVE';
    if (type === 'EVENT_GOLIVE' && eventId) {
      for (const row of catalog.markets.values()) {
        if (row.eventId === eventId) row.orders.clear();
      }
    }
    return catalog;
  }
  if (type === 'CLOSE') {
    const id = String((message.market && message.market.id) || '');
    if (id) catalog.markets.delete(id);
  }
  return catalog;
}

function quoteSig(quote) {
  return `${quote.odds}|${quote.line == null ? '' : quote.line}|${quote.is_live ? 1 : 0}`;
}

function diffQuotes(previous, quotes) {
  const changed = [];
  const seen = new Set();
  for (const quote of quotes || []) {
    const key = quote.token_id;
    seen.add(key);
    const sig = quoteSig(quote);
    if (previous.get(key) === sig) continue;
    previous.set(key, sig);
    changed.push(quote);
  }
  for (const key of previous.keys()) {
    if (!seen.has(key)) previous.delete(key);
  }
  return changed;
}

function stampQuotes(quotes, at) {
  const ts = nextStamp(at);
  return (quotes || []).map((quote) => ({ ...quote, updated_at: ts }));
}

async function mapPool(items, limit, fn) {
  const list = items || [];
  const out = new Array(list.length);
  let cursor = 0;
  const workers = [];
  const n = Math.min(limit, list.length);
  for (let w = 0; w < n; w += 1) {
    workers.push((async () => {
      while (cursor < list.length) {
        const idx = cursor;
        cursor += 1;
        out[idx] = await fn(list[idx], idx);
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

async function loadNovigMarkets(league, token, deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const base = novigApiBase(deps);
  const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
  const at = nowMs(deps);
  const eventById = new Map();
  for (const type of ['MONEY', 'SPREAD', 'TOTAL']) {
    const url = `${base}/nbx/v2/emm/markets/open?league=${encodeURIComponent(league)}&marketType=${type}`;
    const res = await fetchJson(fetchFn, url, { headers });
    if (res.status === 401) {
      const err = new Error('novig_unauthorized');
      err.code = 'novig_unauthorized';
      throw err;
    }
    if (!res.ok) continue;
    for (const market of asList(res.body)) {
      const teams = teamsFromMarket(market);
      if (!teams || !teams.eventId || !eventInWindow(teams, at)) continue;
      if (!eventById.has(teams.eventId)) eventById.set(teams.eventId, eventOf(market));
    }
  }
  const ids = [...eventById.keys()].slice(0, 40);
  const batches = await mapPool(ids, 6, async (eventId) => {
    const url = `${base}/nbx/v2/emm/events/getMarketsByEvent/${encodeURIComponent(eventId)}?currency=CASH`;
    const res = await fetchJson(fetchFn, url, { headers });
    if (res.status === 401) {
      const err = new Error('novig_unauthorized');
      err.code = 'novig_unauthorized';
      throw err;
    }
    if (!res.ok) return [];
    const ev = eventById.get(eventId);
    return asList(res.body).map((market) => {
      if (market && market.event && market.event.game) return market;
      return { ...market, eventId, event: ev };
    });
  });
  return batches.flat();
}

function loadWebSocket(deps) {
  if (deps && deps.WebSocket) return deps.WebSocket;
  try {
    return require('ws');
  } catch (_) {
    return null;
  }
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

function openTape(WS, url, token, onMessage) {
  let socket = null;
  try {
    socket = new WS(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (_) {
    return { socket: null, closed: Promise.resolve() };
  }
  const closed = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const on = (name, fn) => {
      if (socket && typeof socket.addEventListener === 'function') socket.addEventListener(name, fn);
      else if (socket && typeof socket.on === 'function') socket.on(name, fn);
    };
    on('close', finish);
    // `ws` emits error when close races the handshake. The listener keeps that
    // from crashing the process; close is what ends the session.
    on('error', () => {});
    on('open', () => {
      try {
        socket.send(JSON.stringify({ event: 'subscribe', data: 'tape' }));
        socket.send(JSON.stringify({ event: 'subscribe', data: 'lifecycle' }));
      } catch (_) { /* closing */ }
    });
    on('message', (ev) => {
      const text = ev && ev.data != null ? ev.data : ev;
      onMessage(text);
    });
  });
  return { socket, closed };
}

function startNovig(league, deps, emit) {
  let stopped = false;
  let socket = null;
  const previous = new Map();
  const refreshMs = deps && deps.refreshMs != null ? deps.refreshMs : 30_000;
  const retryMs = deps && deps.retryMs != null ? deps.retryMs : 5000;
  let booted = false;

  const publish = (quotes, extra) => {
    const stamped = stampQuotes(quotes, nowMs(deps));
    const payload = {
      quotes: booted ? diffQuotes(previous, stamped) : stamped,
      mode: (extra && extra.mode) || 'ws',
      note: extra && extra.note,
    };
    if (!booted) {
      for (const quote of stamped) previous.set(quote.token_id, quoteSig(quote));
      booted = true;
      emit(payload);
      return;
    }
    if (payload.quotes.length || payload.note) emit(payload);
  };

  const loop = (async () => {
    if (!novigConfigured(deps)) {
      emit({ quotes: [], mode: 'needs-credentials', note: 'novig_needs_credentials' });
      return;
    }
    const WS = loadWebSocket(deps);
    while (!stopped) {
      let token = null;
      try {
        token = await fetchNovigToken(deps);
      } catch (_) {
        token = null;
      }
      if (stopped) break;
      if (!token) {
        emit({ quotes: [], mode: 'ws', note: 'novig_unauthorized' });
        await sleep(retryMs, () => stopped);
        continue;
      }
      let catalog = catalogFromMarkets([], league, nowMs(deps));
      try {
        const markets = await loadNovigMarkets(league, token, deps);
        if (stopped) break;
        catalog = catalogFromMarkets(markets, league, nowMs(deps));
        publish(quotesFromCatalog(catalog), { mode: 'ws' });
      } catch (err) {
        const code = err && err.code;
        emit({
          quotes: [],
          mode: 'ws',
          note: code === 'novig_unauthorized' ? 'novig_unauthorized' : 'novig_unavailable',
        });
        await sleep(retryMs, () => stopped);
        continue;
      }
      if (stopped) break;
      if (!WS) {
        await sleep(refreshMs || retryMs, () => stopped);
        continue;
      }
      const session = openTape(WS, novigWsUrl(novigApiBase(deps)), token, (raw) => {
        const text = String(raw == null ? '' : raw);
        if (!text || text === 'PONG') return;
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { return; }
        applyNovigMessage(catalog, parsed);
        publish(quotesFromCatalog(catalog), { mode: 'ws' });
      });
      socket = session.socket;
      if (deps && deps.onSocket && socket) deps.onSocket(socket);
      let refreshTimer = null;
      if (refreshMs > 0) {
        refreshTimer = setInterval(() => {
          if (stopped) return;
          fetchNovigToken(deps).then((fresh) => {
            if (!fresh || stopped) return null;
            return loadNovigMarkets(league, fresh, deps);
          }).then((markets) => {
            if (!markets || stopped) return;
            const next = catalogFromMarkets(markets, league, nowMs(deps));
            for (const [id, ev] of catalog.events) {
              const row = next.events.get(id);
              if (row && ev.live) row.live = true;
            }
            catalog = next;
            publish(quotesFromCatalog(catalog), { mode: 'ws' });
          }).catch(() => { /* next reconnect reconciles */ });
        }, refreshMs);
      }
      await session.closed;
      if (refreshTimer) clearInterval(refreshTimer);
      socket = null;
      if (stopped) break;
      await sleep(retryMs, () => stopped);
    }
  })();
  loop.catch(() => {
    if (!stopped) emit({ quotes: [], mode: 'ws', note: 'novig_unavailable' });
  });

  return {
    ready: loop,
    stop() {
      stopped = true;
      try { if (socket && socket.close) socket.close(); } catch (_) { /* ignore */ }
    },
  };
}

module.exports = {
  NOVIG_BOOK_ID,
  novigApiBase,
  novigWsUrl,
  novigConfigured,
  resetNovigAuthCache,
  fetchNovigToken,
  catalogFromMarkets,
  quotesFromCatalog,
  applyNovigMessage,
  askFor,
  spreadLine,
  loadNovigMarkets,
  startNovig,
};
