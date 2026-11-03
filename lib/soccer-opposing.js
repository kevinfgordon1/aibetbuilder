'use strict';

// Inverse-bet opposing books for a UCL leg: the cost to buy No on that same
// binary (team does not win, or the draw does not happen). Not the other
// team's Yes — that is only the inverse in a 2-way sport.
//
// Venues: Polymarket US, Novig (pregame, $0 fee — the caller adds fees),
// ProphetX when affiliate credentials exist. Kalshi No is already on the
// order book the root-for pricer loads. Raw prices, no fee baked in.
//
// $500 depth and the 15s stale cutoff stay in src/rootForPrices.js.

const bd = require('./book-depth');
const clubs = require('./soccer-clubs.mjs');

const NOVIG_BASE = (process.env.NOVIG_API_BASE || 'https://api.novig.com').replace(/\/+$/, '');
const POLY_US = 'https://gateway.polymarket.us';
const POLY_GAMMA = 'https://gamma-api.polymarket.com';
const PROPHETX_BASE = process.env.PROPHETX_API_BASE || 'https://cash.api.prophetx.co/partner';
const FETCH_MS = 8000;

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || FETCH_MS);
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { accept: 'application/json', 'user-agent': 'aibetbuilder/1.0', ...(opts.headers || {}) },
      body: opts.body,
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (_) { json = null; } }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: String(e && e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function parseUclTicker(ticker) {
  const parts = String(ticker || '').toUpperCase().split('-');
  if (parts[0] !== 'KXUCLGAME' || parts.length < 3) return null;
  const m = /^(\d{2})([A-Z]{3})(\d{2})([A-Z0-9]+)$/.exec(parts[1]);
  if (!m || MONTHS[m[2]] == null) return null;
  const codes = clubs.splitUclCodes(m[4]);
  if (!codes) return null;
  const selection = parts[2];
  if (selection !== 'TIE' && selection !== codes[0] && selection !== codes[1]) return null;
  // Noon ET of the ticker date, as a kickoff hint. The real kickoff is within
  // a few hours; venue matching still requires the same two clubs.
  const noon = Date.UTC(2000 + Number(m[1]), MONTHS[m[2]], Number(m[3]), 17);
  return {
    event: `${parts[0]}-${parts[1]}`,
    codes,
    selection,
    commence: new Date(noon).toISOString(),
  };
}

function selectionName(parsed) {
  if (parsed.selection === 'TIE') return 'Draw';
  return clubs.uclCodeName(parsed.selection) || parsed.selection;
}

function legSel(parsed) {
  return {
    sport: 'soccer_uefa_champs_league',
    market: 'ML',
    away: clubs.uclCodeName(parsed.codes[0]) || parsed.codes[0],
    home: clubs.uclCodeName(parsed.codes[1]) || parsed.codes[1],
    team: selectionName(parsed),
    buySide: 'no',
    commence_time: parsed.commence,
  };
}

let novigEventsP = null;
function novigEvents() {
  if (!novigEventsP) {
    novigEventsP = (async () => {
      const out = [];
      let after = '';
      for (let page = 0; page < 4; page += 1) {
        const res = await fetchJson(`${NOVIG_BASE}/v3/public/catalog/events?league=${encodeURIComponent('Champions League')}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`);
        const items = res.ok && res.json && Array.isArray(res.json.items) ? res.json.items : null;
        if (!items) break;
        out.push(...items);
        const next = res.json.next;
        if (!next || !items.length || next === after) break;
        after = next;
      }
      return out;
    })();
  }
  return novigEventsP;
}

function bestEvents(events, titleOf, away, home) {
  let top = 0;
  const scored = [];
  for (const e of events || []) {
    const sc = bd.eventMatchScore(titleOf(e), away, home);
    if (sc > 0) {
      scored.push({ e, sc });
      if (sc > top) top = sc;
    }
  }
  return scored.filter((x) => x.sc === top).map((x) => x.e);
}

// Novig qty is cent-contracts (stake = ask * qty / 100). The inverse walk
// wants contracts that pay $1.
function novigNoLevels(book, market, outcomeId) {
  const other = (market.outcomes || []).find((o) => String(o.outcomeId) !== String(outcomeId));
  if (!other || !book || !book.orders) return [];
  const out = [];
  for (const o of book.orders[other.outcomeId] || []) {
    const bid = parseFloat(o.price);
    const qty = Number(o.qty);
    if (!(bid > 0) || !(bid < 1) || !(qty > 0)) continue;
    const ask = Math.round((1 - bid) * 1000) / 1000;
    out.push([ask, qty / 100]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

async function novigNoAsks(sel) {
  const events = await novigEvents();
  const live = (events || []).filter((e) => e && (e.status === 'OPEN_PREGAME' || e.status === 'OPEN_INGAME'));
  const ev = bd.pickEventByStart(
    bestEvents(live, (e) => e.description || '', sel.away, sel.home),
    sel.commence_time,
    (e) => Number(e.startsTs),
  );
  if (!ev) return [];
  // Pregame takes are $0. Skip in-game books here so a live Novig price is
  // not treated as fee-free (the walk's Novig fee stays 0).
  if (String(ev.status || '').toUpperCase() !== 'OPEN_PREGAME') return [];
  const res = await fetchJson(`${NOVIG_BASE}/v3/public/catalog/markets?event=${encodeURIComponent(ev.eventId)}&marketType=MONEYLINE_3_WAY_WIN,MONEYLINE_3_WAY_DRAW&limit=20`);
  const markets = res.ok && res.json && Array.isArray(res.json.items) ? res.json.items : [];
  const hit = bd.pickNovigThreeWay(sel, markets);
  if (!hit) return [];
  const book = await fetchJson(`${NOVIG_BASE}/v3/public/catalog/markets/${encodeURIComponent(hit.market.marketId)}/book`);
  if (!book.ok || !book.json) return [];
  return novigNoLevels(book.json, hit.market, hit.outcome.outcomeId);
}

function polyRawNo(book) {
  const data = (book && (book.marketData || book)) || {};
  const out = [];
  for (const row of data.bids || []) {
    const px = row && row.px;
    const raw = px && typeof px === 'object' ? px.value : (px != null ? px : row.price);
    const bid = parseFloat(raw);
    const qty = parseFloat(row.qty != null ? row.qty : row.size);
    if (!(bid > 0) || !(bid < 1) || !(qty > 0)) continue;
    out.push([Math.round((1 - bid) * 10000) / 10000, qty]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

async function polymarketUsNoAsks(sel) {
  const q = `${sel.away} ${sel.home}`.trim();
  const search = await fetchJson(`${POLY_GAMMA}/public-search?q=${encodeURIComponent(q)}&events_status=active&limit_per_type=10`);
  const events = (search.ok && search.json && (search.json.events || [])) || [];
  const hits = bestEvents(
    events.filter((e) => e && String(e.slug || '').startsWith('ucl-') && e.closed !== true),
    (e) => `${e.title || ''} ${e.slug || ''}`,
    sel.away,
    sel.home,
  );
  const ev = bd.pickEventByStart(hits, sel.commence_time, (e) => e.startTime || e.endDate || e.startDate);
  if (!ev || !ev.slug) return [];
  const full = await fetchJson(`${POLY_US}/v1/events/slug/${encodeURIComponent(ev.slug)}`);
  const body = full.ok && full.json ? (full.json.event || full.json) : null;
  const markets = ((body && body.markets) || []).filter((m) => m && m.sportsMarketType === 'soccer_team_full_time_winner' && m.closed !== true);
  let picked = null;
  if (/^draw$/i.test(sel.team)) picked = markets.find((m) => /^draw$/i.test(bd.polymarketUsWinnerLabel(m)));
  else picked = bd.pickBestTeamMatch(sel.team, markets, bd.polymarketUsWinnerLabel);
  if (!picked || !picked.slug) return [];
  const book = await fetchJson(`${POLY_US}/v1/markets/${encodeURIComponent(picked.slug)}/book`);
  if (!book.ok || !book.json) return [];
  return polyRawNo(book.json);
}

async function prophetXAuth() {
  const key = process.env.PROPHETX_API_KEY;
  if (key) return key;
  const access = process.env.PROPHETX_ACCESS_KEY;
  const secret = process.env.PROPHETX_SECRET_KEY;
  if (!access || !secret) return null;
  const res = await fetchJson(`${PROPHETX_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access_key: access, secret_key: secret }),
  });
  return (res.ok && res.json && res.json.data && res.json.data.access_token) || null;
}

function prophetXRaw(group) {
  const out = [];
  for (const s of group || []) {
    const dec = parseFloat(s && s.price);
    const qty = parseFloat(s && s.quantity);
    if (!(dec > 1) || !(qty > 0)) continue;
    const p = 1 / dec;
    if (!(p > 0) || !(p < 1)) continue;
    // quantity is dollar stake (same as book-depth). $1-payout contracts = stake / price.
    out.push([p, qty / p]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

async function prophetXNoAsks(sel) {
  const auth = await prophetXAuth();
  if (!auth) return [];
  const res = await fetchJson(`${PROPHETX_BASE}/affiliate/get_sport_events`, { headers: { authorization: auth } });
  const data = res.ok && res.json && (res.json.data || res.json);
  const events = (data && (data.sport_events || data.events)) || [];
  const ev = (events || []).find((e) => bd.eventMatchScore(`${e.away_team || ''} ${e.home_team || ''} ${e.name || ''}`, sel.away, sel.home) > 0);
  if (!ev || ev.event_id == null) return [];
  const mk = await fetchJson(
    `${PROPHETX_BASE}/v3/affiliate/get_markets?event_id=${encodeURIComponent(ev.event_id)}&market_types=moneyline`,
    { headers: { authorization: auth } },
  );
  const markets = (mk.ok && mk.json && (Array.isArray(mk.json.data) ? mk.json.data : (mk.json.data && mk.json.data[ev.event_id]))) || [];
  const candidates = [];
  for (const m of markets) {
    for (const group of bd.flattenProphetXSelections(m.selections)) {
      const sample = (group || []).find((s) => s && s.name);
      if (!sample) continue;
      const name = String(sample.name || '');
      if (/^draw$/i.test(sel.team)) {
        if (!/\b(draw|tie)\b/i.test(name)) continue;
        return prophetXRaw(group);
      }
      candidates.push({ group, label: name });
    }
  }
  const picked = bd.pickBestTeamMatch(sel.team, candidates, (c) => c.label);
  return picked ? prophetXRaw(picked.group) : [];
}

// → { [kalshiEvent]: { [teamCode|'TIE']: { polymarket?, novig?, prophetx? } } }
// each venue value is { levels: [[prob, contracts]], at }.
async function loadUclNoLadders(tickers, { now = Date.now() } = {}) {
  const parsed = [];
  const seen = new Set();
  for (const t of tickers || []) {
    const p = parseUclTicker(t);
    if (!p || seen.has(`${p.event}:${p.selection}`)) continue;
    seen.add(`${p.event}:${p.selection}`);
    parsed.push(p);
  }
  const out = {};
  await Promise.all(parsed.map(async (p) => {
    const sel = legSel(p);
    const [novig, polymarket, prophetx] = await Promise.all([
      novigNoAsks(sel).catch(() => []),
      polymarketUsNoAsks(sel).catch(() => []),
      prophetXNoAsks(sel).catch(() => []),
    ]);
    const slot = {};
    if (novig.length) slot.novig = { levels: novig, at: now };
    if (polymarket.length) slot.polymarket = { levels: polymarket, at: now };
    if (prophetx.length) slot.prophetx = { levels: prophetx, at: now };
    if (!Object.keys(slot).length) return;
    if (!out[p.event]) out[p.event] = {};
    out[p.event][p.selection] = slot;
  }));
  return out;
}

module.exports = {
  parseUclTicker,
  novigNoLevels,
  polyRawNo,
  loadUclNoLadders,
};
