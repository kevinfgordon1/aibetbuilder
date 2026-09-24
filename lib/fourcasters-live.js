'use strict';

// 4Casters quotes for the New Odds Board. Betstamp is not called here.
//
// Auth: no API key. POST {FOURCASTERS_API_BASE}/user/login with
// FOURCASTERS_USERNAME + FOURCASTERS_PASSWORD. The token is data.user.auth
// and lasts ~30 days. The server caches it and logs in again before expiry
// or after a 401. FOURCASTERS_TOKEN overrides login when already held.
// Unset credentials return null. The stream omits the column. Never invent
// a password. Never read VITE_ names.
//
// REST:  Authorization: Bearer <token>
//        GET /exchange/v2/getOrderbook?league=  (flat best-price-first arrays)
// WS:    wss://streaming-api.4casters.io/price-stream
//        Handshake Authorization is the raw token (docs: no Bearer prefix).
//        After open: { type:'subscribe', gameIDs:[], leagueIDs:[league], sportIDs:[], replace:true }
//        Keepalive: ping every ~10s, close if pong is missing for ~30s.
//
// Price messages are 2-tuples [type, payload]:
//   gameUpdate  — full game (participants + orderbook; arrays or line-keyed objects)
//   orderUpdate — sideOrders replaces one side of the book
//   matchedVolumeUpdate — ignored
// Resting orders are offers. odds is American. The best ask is the price
// with the highest decimal payout and sumUntaken > 0. Moneyline emits each
// side that has a price. Main spread and main total emit only when both
// sides quote that line. Child games, specials, and non-full-time periods
// are skipped.

const FOURCASTERS_BOOK_ID = 197;
const DEFAULT_BASE = 'https://api.4casters.io';
const DEFAULT_WS = 'wss://streaming-api.4casters.io/price-stream';
const WINDOW_BACK_MS = 8 * 3600 * 1000;
const WINDOW_AHEAD_MS = 8 * 24 * 3600 * 1000;
const DEFAULT_TOKEN_MS = 29 * 24 * 3600 * 1000;
const PING_MS = 10_000;
const PONG_STALE_MS = 30_000;

let tokenCache = { token: null, exp: 0, key: '' };
let tokenInflight = null;
let stampClock = 0;

function fourcastersApiBase(deps) {
  const raw = (deps && deps.apiBase) || process.env.FOURCASTERS_API_BASE || DEFAULT_BASE;
  return String(raw || DEFAULT_BASE).replace(/\/+$/, '');
}

function fourcastersWsUrl(deps) {
  const raw = (deps && deps.wsUrl) || process.env.FOURCASTERS_WS_URL || DEFAULT_WS;
  return String(raw || DEFAULT_WS);
}

function readCreds(deps) {
  const fromDeps = deps && (
    Object.prototype.hasOwnProperty.call(deps, 'username')
    || Object.prototype.hasOwnProperty.call(deps, 'password')
    || Object.prototype.hasOwnProperty.call(deps, 'token')
  );
  if (fromDeps) {
    return {
      username: deps.username ? String(deps.username) : '',
      password: deps.password ? String(deps.password) : '',
      token: deps.token ? String(deps.token) : '',
    };
  }
  return {
    username: process.env.FOURCASTERS_USERNAME ? String(process.env.FOURCASTERS_USERNAME) : '',
    password: process.env.FOURCASTERS_PASSWORD ? String(process.env.FOURCASTERS_PASSWORD) : '',
    token: process.env.FOURCASTERS_TOKEN ? String(process.env.FOURCASTERS_TOKEN) : '',
  };
}

function rawToken(token) {
  return String(token || '').replace(/^Bearer\s+/i, '').trim();
}

function fourcastersConfigured(deps) {
  const creds = readCreds(deps);
  return !!((creds.username && creds.password) || rawToken(creds.token));
}

function cacheKey(deps, creds) {
  if (creds.username && creds.password) return `user|${fourcastersApiBase(deps)}|${creds.username}`;
  const token = rawToken(creds.token);
  if (token) return `token|${token.slice(0, 16)}`;
  return '';
}

function tokenTtl(deps) {
  const raw = deps && deps.tokenTtlMs;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_TOKEN_MS;
}

function nowMs(deps) {
  const raw = deps && deps.nowMs;
  if (typeof raw === 'function') return raw();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : Date.now();
}

function resetFourcastersAuthCache() {
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

function headerValue(res, name) {
  const headers = res && res.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || '';
  }
  return headers[name] || headers[name.toLowerCase()] || '';
}

async function fetchJson(fetchFn, url, init) {
  const res = await fetchFn(url, init || {});
  const text = res && typeof res.text === 'function' ? await res.text() : '';
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch (_) { body = null; }
  }
  return {
    ok: !!(res && res.ok),
    status: res && res.status,
    body,
    rotated: rawToken(headerValue(res, 'x-auth-token')),
  };
}

function rememberToken(token, key, at, ttl) {
  if (!token || !key) return;
  tokenCache = { token, exp: at + ttl, key };
}

function absorbRotation(res, deps, key) {
  if (!res || !res.rotated || !key) return;
  rememberToken(res.rotated, key, nowMs(deps), tokenTtl(deps));
}

async function fetchFourcastersToken(deps, opts) {
  const creds = readCreds(deps);
  const override = rawToken(creds.token);
  const canLogin = !!(creds.username && creds.password);
  if (!override && !canLogin) return null;
  const at = nowMs(deps);
  const force = !!(opts && opts.force);
  const key = cacheKey(deps, creds);
  if (!force && tokenCache.token && tokenCache.key === key && tokenCache.exp > at) {
    return tokenCache.token;
  }
  if (!force && override) {
    rememberToken(override, key, at, tokenTtl(deps));
    return override;
  }
  if (!canLogin) return null;
  if (tokenInflight && tokenInflight.key === key && tokenInflight.force === force) {
    return tokenInflight.promise;
  }
  const run = (async () => {
    const fetchFn = (deps && deps.fetchFn) || fetch;
    const res = await fetchJson(fetchFn, `${fourcastersApiBase(deps)}/user/login`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ username: creds.username, password: creds.password }),
    });
    if (!res.ok || !res.body) return null;
    const user = res.body.data && res.body.data.user;
    const token = rawToken((user && user.auth) || res.body.auth || res.body.token);
    if (!token) return null;
    rememberToken(token, key, at, tokenTtl(deps));
    return token;
  })();
  tokenInflight = { key, force, promise: run };
  try {
    return await run;
  } finally {
    if (tokenInflight && tokenInflight.promise === run) tokenInflight = null;
  }
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function lineKey(value) {
  const n = num(value);
  return n == null ? '' : String(n);
}

function validAmerican(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n)) return null;
  if (n >= 100 || n <= -100) return Math.round(n);
  return null;
}

function decimalFromAmerican(american) {
  if (american >= 100) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function bestAsk(orders) {
  let bestDec = -Infinity;
  let bestOdds = null;
  let size = 0;
  for (const order of orders || []) {
    if (!order || order.mockOrder === true) continue;
    const odds = validAmerican(order.odds);
    const avail = Number(order.sumUntaken);
    if (odds == null || !(avail > 0)) continue;
    const dec = decimalFromAmerican(odds);
    if (dec > bestDec + 1e-9) {
      bestDec = dec;
      bestOdds = odds;
      size = avail;
    } else if (Math.abs(dec - bestDec) <= 1e-9) {
      size += avail;
    }
  }
  if (bestOdds == null) return null;
  return { odds: bestOdds, size };
}

function flattenOrders(field, kind) {
  if (Array.isArray(field)) return field.filter(Boolean);
  if (!field || typeof field !== 'object') return [];
  const out = [];
  for (const [key, list] of Object.entries(field)) {
    if (!Array.isArray(list)) continue;
    const line = num(key);
    for (const order of list) {
      if (!order) continue;
      if (kind === 'spread' && order.spread == null && line != null) out.push({ ...order, spread: line });
      else if (kind === 'total' && order.total == null && line != null) out.push({ ...order, total: line });
      else out.push(order);
    }
  }
  return out;
}

function emptyGame(id) {
  return {
    id: String(id),
    league: '',
    sport: '',
    start: null,
    ended: false,
    live: false,
    parentGameID: null,
    periodName: '',
    isSpecials: false,
    participants: [],
    mainHomeSpread: null,
    mainAwaySpread: null,
    mainTotal: null,
    ml: new Map(),
    spread: new Map(),
    total: new Map(),
  };
}

function emptyCatalog(league) {
  return { league: String(league || '').toUpperCase(), games: new Map() };
}

function participantBySide(game, side) {
  const list = game.participants || [];
  const hit = list.find((p) => String(p && p.homeAway || '').toLowerCase() === side);
  if (hit) return hit;
  if (side === 'away') return list[0] || null;
  if (side === 'home') return list[1] || null;
  return null;
}

function teamLabel(participant) {
  if (!participant) return '';
  return String(participant.longName || participant.shortName || '').trim();
}

function pushBucket(map, key, order) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(order);
}

function indexMoneylines(orders, fallbackPid) {
  const map = new Map();
  for (const order of orders || []) {
    const pid = String((order && order.participantID) || fallbackPid || '');
    pushBucket(map, pid, order);
  }
  return map;
}

function indexSpreads(orders, fallbackPid) {
  const map = new Map();
  for (const order of orders || []) {
    const pid = String((order && order.participantID) || fallbackPid || '');
    const line = num(order && order.spread);
    if (!pid || line == null) continue;
    pushBucket(map, `${pid}|${lineKey(line)}`, order);
  }
  return map;
}

function indexTotals(orders, fallbackOu) {
  const map = new Map();
  for (const order of orders || []) {
    const ou = String((order && (order.OU || order.side)) || fallbackOu || '').toLowerCase();
    const line = num(order && order.total);
    if ((ou !== 'over' && ou !== 'under') || line == null) continue;
    pushBucket(map, `${ou}|${lineKey(line)}`, order);
  }
  return map;
}

function mergeMaps(target, incoming) {
  for (const [key, orders] of incoming) target.set(key, orders);
}

function bookFieldsPresent(game) {
  return !!(game && (
    Object.prototype.hasOwnProperty.call(game, 'awayMoneylines')
    || Object.prototype.hasOwnProperty.call(game, 'homeMoneylines')
    || Object.prototype.hasOwnProperty.call(game, 'awaySpreads')
    || Object.prototype.hasOwnProperty.call(game, 'homeSpreads')
    || Object.prototype.hasOwnProperty.call(game, 'over')
    || Object.prototype.hasOwnProperty.call(game, 'under')
  ));
}

function ingestGame(catalog, raw) {
  if (!catalog || !raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw.gameID || '');
  if (!id) return null;
  const game = catalog.games.get(id) || emptyGame(id);
  if (raw.league) game.league = String(raw.league).toUpperCase();
  if (raw.sport) game.sport = String(raw.sport);
  if (raw.start) game.start = raw.start;
  if (raw.ended != null) game.ended = raw.ended === true;
  if (raw.live != null) game.live = raw.live === true;
  if (Object.prototype.hasOwnProperty.call(raw, 'parentGameID')) game.parentGameID = raw.parentGameID || null;
  if (raw.periodName != null) game.periodName = String(raw.periodName || '');
  if (raw.isSpecials != null) game.isSpecials = raw.isSpecials === true;
  if (Array.isArray(raw.participants) && raw.participants.length) game.participants = raw.participants;
  if (raw.mainHomeSpread != null) game.mainHomeSpread = num(raw.mainHomeSpread);
  if (raw.mainAwaySpread != null) game.mainAwaySpread = num(raw.mainAwaySpread);
  if (raw.mainTotal != null) game.mainTotal = num(raw.mainTotal);
  if (bookFieldsPresent(raw)) {
    const away = participantBySide(game, 'away');
    const home = participantBySide(game, 'home');
    const awayId = away && away.id;
    const homeId = home && home.id;
    game.ml = new Map();
    game.spread = new Map();
    game.total = new Map();
    mergeMaps(game.ml, indexMoneylines(flattenOrders(raw.awayMoneylines, 'moneyline'), awayId));
    mergeMaps(game.ml, indexMoneylines(flattenOrders(raw.homeMoneylines, 'moneyline'), homeId));
    mergeMaps(game.spread, indexSpreads(flattenOrders(raw.awaySpreads, 'spread'), awayId));
    mergeMaps(game.spread, indexSpreads(flattenOrders(raw.homeSpreads, 'spread'), homeId));
    mergeMaps(game.total, indexTotals(flattenOrders(raw.over, 'total'), 'over'));
    mergeMaps(game.total, indexTotals(flattenOrders(raw.under, 'total'), 'under'));
  }
  catalog.games.set(id, game);
  return game;
}

function applyOrderUpdate(game, payload) {
  if (!game || !payload) return;
  if (payload.league) game.league = String(payload.league).toUpperCase();
  if (payload.live != null) game.live = payload.live === true;
  if (payload.mainHomeSpread != null) game.mainHomeSpread = num(payload.mainHomeSpread);
  if (payload.mainAwaySpread != null) game.mainAwaySpread = num(payload.mainAwaySpread);
  if (payload.mainTotal != null) game.mainTotal = num(payload.mainTotal);
  if (payload.parentGameID) game.parentGameID = payload.parentGameID;
  const type = String(payload.type || '').toLowerCase();
  const orders = Array.isArray(payload.sideOrders) ? payload.sideOrders : [];
  if (type === 'moneyline') {
    const pid = String(payload.participantID || (orders[0] && orders[0].participantID) || '');
    if (pid) game.ml.set(pid, orders);
    return;
  }
  if (type === 'spread') {
    const pid = String(payload.participantID || (orders[0] && orders[0].participantID) || '');
    const line = num(payload.spread != null ? payload.spread : (orders[0] && orders[0].spread));
    if (pid && line != null) game.spread.set(`${pid}|${lineKey(line)}`, orders);
    return;
  }
  if (type === 'total') {
    const ou = String(payload.OU || payload.side || (orders[0] && (orders[0].OU || orders[0].side)) || '').toLowerCase();
    const line = num(payload.total != null ? payload.total : (orders[0] && orders[0].total));
    if ((ou === 'over' || ou === 'under') && line != null) game.total.set(`${ou}|${lineKey(line)}`, orders);
  }
}

function parsePriceMessage(raw) {
  let text = raw && typeof raw === 'object' && raw.data != null ? raw.data : raw;
  if (text && typeof text !== 'string') {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(text)) text = text.toString('utf8');
    else text = String(text);
  } else {
    text = String(text == null ? '' : text);
  }
  if (!text || text === 'PONG' || text === 'pong') return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { return null; }
  if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') return null;
  const payload = parsed[1];
  return { type: parsed[0], payload: payload && typeof payload === 'object' ? payload : null };
}

function applyPriceMessage(catalog, message) {
  if (!catalog || !message) return catalog;
  const type = message.type;
  const payload = message.payload;
  if (!payload) return catalog;
  if (type === 'gameUpdate') {
    ingestGame(catalog, payload);
    return catalog;
  }
  if (type === 'orderUpdate') {
    const id = String(payload.gameID || payload.id || '');
    if (!id) return catalog;
    const game = catalog.games.get(id) || emptyGame(id);
    catalog.games.set(id, game);
    applyOrderUpdate(game, payload);
  }
  return catalog;
}

function fullTime(game) {
  const period = String(game.periodName || '').trim().toLowerCase();
  if (!period) return true;
  return period === 'full time' || period === 'fulltime' || period === 'ft' || period === 'game';
}

function gameInWindow(game, league, at) {
  if (!game || game.ended || game.isSpecials || game.parentGameID) return false;
  if (!fullTime(game)) return false;
  const lg = String(game.league || '').toUpperCase();
  if (lg && lg !== league) return false;
  if (game.live) return true;
  const start = Date.parse(game.start || '');
  if (!Number.isFinite(start)) return false;
  return start > at - WINDOW_BACK_MS && start < at + WINDOW_AHEAD_MS;
}

function quoteBase(game, league) {
  const away = teamLabel(participantBySide(game, 'away'));
  const home = teamLabel(participantBySide(game, 'home'));
  if (!away || !home) return null;
  return {
    book: 'fourcasters',
    book_id: FOURCASTERS_BOOK_ID,
    league,
    away,
    home,
    is_alt: false,
    is_live: game.live === true,
    start: game.start || null,
  };
}

function quotesFromGame(game, league) {
  const base = quoteBase(game, league);
  if (!base) return [];
  const awayP = participantBySide(game, 'away');
  const homeP = participantBySide(game, 'home');
  const awayId = awayP && String(awayP.id || '');
  const homeId = homeP && String(homeP.id || '');
  const out = [];
  const awayMl = awayId ? bestAsk(game.ml.get(awayId)) : null;
  const homeMl = homeId ? bestAsk(game.ml.get(homeId)) : null;
  if (awayMl) {
    out.push({
      ...base,
      side: base.away,
      bet_type: 'moneyline',
      odds: awayMl.odds,
      size: awayMl.size,
      token_id: `fc:${game.id}:ml:away`,
    });
  }
  if (homeMl) {
    out.push({
      ...base,
      side: base.home,
      bet_type: 'moneyline',
      odds: homeMl.odds,
      size: homeMl.size,
      token_id: `fc:${game.id}:ml:home`,
    });
  }
  const mainAway = num(game.mainAwaySpread);
  const mainHome = num(game.mainHomeSpread);
  if (awayId && homeId && mainAway != null && mainHome != null) {
    const awaySpr = bestAsk(game.spread.get(`${awayId}|${lineKey(mainAway)}`));
    const homeSpr = bestAsk(game.spread.get(`${homeId}|${lineKey(mainHome)}`));
    if (awaySpr && homeSpr) {
      out.push({
        ...base,
        side: base.away,
        bet_type: 'spread',
        odds: awaySpr.odds,
        size: awaySpr.size,
        line: mainAway,
        token_id: `fc:${game.id}:spr:away`,
      });
      out.push({
        ...base,
        side: base.home,
        bet_type: 'spread',
        odds: homeSpr.odds,
        size: homeSpr.size,
        line: mainHome,
        token_id: `fc:${game.id}:spr:home`,
      });
    }
  }
  const mainTotal = num(game.mainTotal);
  if (mainTotal != null) {
    const over = bestAsk(game.total.get(`over|${lineKey(mainTotal)}`));
    const under = bestAsk(game.total.get(`under|${lineKey(mainTotal)}`));
    if (over && under) {
      out.push({
        ...base,
        side: 'Over',
        bet_type: 'total',
        odds: over.odds,
        size: over.size,
        line: mainTotal,
        token_id: `fc:${game.id}:tot:over`,
      });
      out.push({
        ...base,
        side: 'Under',
        bet_type: 'total',
        odds: under.odds,
        size: under.size,
        line: mainTotal,
        token_id: `fc:${game.id}:tot:under`,
      });
    }
  }
  return out;
}

function quotesFromCatalog(catalog, at) {
  if (!catalog) return [];
  const seenAt = Number(at) || Date.now();
  const out = [];
  for (const game of catalog.games.values()) {
    if (!gameInWindow(game, catalog.league, seenAt)) continue;
    out.push(...quotesFromGame(game, catalog.league));
  }
  return out;
}

function catalogFromGames(games, league, at) {
  const catalog = emptyCatalog(league);
  for (const game of games || []) ingestGame(catalog, game);
  catalog.seenAt = Number(at) || Date.now();
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

function gamesFromOrderbook(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  if (Array.isArray(data.games)) return data.games;
  if (Array.isArray(data.game)) return data.game;
  return [];
}

async function loadFourcastersOrderbook(league, token, deps) {
  const fetchFn = (deps && deps.fetchFn) || fetch;
  const url = `${fourcastersApiBase(deps)}/exchange/v2/getOrderbook?league=${encodeURIComponent(league)}`;
  const key = cacheKey(deps, readCreds(deps));
  const run = (auth) => fetchJson(fetchFn, url, {
    headers: { accept: 'application/json', authorization: `Bearer ${rawToken(auth)}` },
  });
  let res = await run(token);
  absorbRotation(res, deps, key);
  if (res.status === 401) {
    tokenCache = { token: null, exp: 0, key: '' };
    const fresh = await fetchFourcastersToken(deps, { force: true });
    if (!fresh) {
      const err = new Error('fourcasters_unauthorized');
      err.code = 'fourcasters_unauthorized';
      throw err;
    }
    res = await run(fresh);
    absorbRotation(res, deps, cacheKey(deps, readCreds(deps)));
    if (res.status === 401) {
      const err = new Error('fourcasters_unauthorized');
      err.code = 'fourcasters_unauthorized';
      throw err;
    }
  }
  if (!res.ok) {
    const err = new Error('fourcasters_unavailable');
    err.code = 'fourcasters_unavailable';
    throw err;
  }
  return gamesFromOrderbook(res.body);
}

function priceSubscribeMessage(league) {
  return {
    type: 'subscribe',
    gameIDs: [],
    leagueIDs: [String(league || '').toUpperCase()],
    sportIDs: [],
    replace: true,
  };
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

function onSocket(socket, name, fn) {
  if (!socket) return;
  if (typeof socket.addEventListener === 'function') socket.addEventListener(name, fn);
  else if (typeof socket.on === 'function') socket.on(name, fn);
}

function openPriceStream(WS, url, token, league, deps, onMessage) {
  let socket = null;
  const pingMs = deps && deps.pingMs != null ? deps.pingMs : PING_MS;
  const staleMs = deps && deps.pongStaleMs != null ? deps.pongStaleMs : PONG_STALE_MS;
  try {
    socket = new WS(url, { headers: { Authorization: rawToken(token) } });
  } catch (_) {
    return { socket: null, closed: Promise.resolve() };
  }
  const closed = new Promise((resolve) => {
    let done = false;
    let pingTimer = null;
    let lastPong = Date.now();
    const finish = () => {
      if (done) return;
      done = true;
      if (pingTimer) clearInterval(pingTimer);
      resolve();
    };
    onSocket(socket, 'close', finish);
    onSocket(socket, 'error', () => {});
    onSocket(socket, 'pong', () => { lastPong = Date.now(); });
    onSocket(socket, 'open', () => {
      lastPong = Date.now();
      try { socket.send(JSON.stringify(priceSubscribeMessage(league))); } catch (_) { /* closing */ }
      if (pingMs > 0) {
        pingTimer = setInterval(() => {
          if (Date.now() - lastPong > staleMs) {
            try { if (socket.terminate) socket.terminate(); else if (socket.close) socket.close(); } catch (_) { /* ignore */ }
            return;
          }
          if (typeof socket.ping === 'function') {
            try { socket.ping(); } catch (_) { /* closing */ }
          }
        }, pingMs);
      }
    });
    onSocket(socket, 'message', (ev) => {
      const text = ev && ev.data != null ? ev.data : ev;
      onMessage(text);
    });
  });
  return { socket, closed };
}

function startFourcasters(league, deps, emit) {
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
    if (!fourcastersConfigured(deps)) {
      emit({ quotes: [], mode: 'needs-credentials', note: 'fourcasters_needs_credentials' });
      return;
    }
    const WS = loadWebSocket(deps);
    while (!stopped) {
      let token = null;
      try {
        token = await fetchFourcastersToken(deps);
      } catch (_) {
        token = null;
      }
      if (stopped) break;
      if (!token) {
        emit({ quotes: [], mode: 'ws', note: 'fourcasters_unauthorized' });
        await sleep(retryMs, () => stopped);
        continue;
      }
      let catalog = emptyCatalog(league);
      try {
        const games = await loadFourcastersOrderbook(league, token, deps);
        if (stopped) break;
        catalog = catalogFromGames(games, league, nowMs(deps));
        publish(quotesFromCatalog(catalog, nowMs(deps)), { mode: 'ws' });
      } catch (err) {
        const code = err && err.code;
        emit({
          quotes: [],
          mode: 'ws',
          note: code === 'fourcasters_unauthorized' ? 'fourcasters_unauthorized' : 'fourcasters_unavailable',
        });
        await sleep(retryMs, () => stopped);
        continue;
      }
      if (stopped) break;
      if (!WS) {
        await sleep(refreshMs || retryMs, () => stopped);
        continue;
      }
      const session = openPriceStream(WS, fourcastersWsUrl(deps), token, league, deps, (raw) => {
        const message = parsePriceMessage(raw);
        if (!message) return;
        applyPriceMessage(catalog, message);
        publish(quotesFromCatalog(catalog, nowMs(deps)), { mode: 'ws' });
      });
      socket = session.socket;
      if (deps && deps.onSocket && socket) deps.onSocket(socket);
      let refreshTimer = null;
      if (refreshMs > 0) {
        refreshTimer = setInterval(() => {
          if (stopped) return;
          fetchFourcastersToken(deps).then((fresh) => {
            if (!fresh || stopped) return null;
            return loadFourcastersOrderbook(league, fresh, deps);
          }).then((games) => {
            if (!games || stopped) return;
            const next = catalogFromGames(games, league, nowMs(deps));
            for (const [id, prev] of catalog.games) {
              const row = next.games.get(id);
              if (row && prev.live) row.live = true;
            }
            catalog = next;
            publish(quotesFromCatalog(catalog, nowMs(deps)), { mode: 'ws' });
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
    if (!stopped) emit({ quotes: [], mode: 'ws', note: 'fourcasters_unavailable' });
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
  FOURCASTERS_BOOK_ID,
  DEFAULT_WS,
  fourcastersApiBase,
  fourcastersWsUrl,
  fourcastersConfigured,
  resetFourcastersAuthCache,
  fetchFourcastersToken,
  bestAsk,
  parsePriceMessage,
  catalogFromGames,
  quotesFromCatalog,
  applyPriceMessage,
  priceSubscribeMessage,
  loadFourcastersOrderbook,
  startFourcasters,
};
