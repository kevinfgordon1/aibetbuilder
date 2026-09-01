// ─────────────────────────────────────────────────────────────────────────
// api/kalshi-games.js — same-origin feed of Kalshi single-game markets for the
// Combo Locks tab. Proxies Kalshi (public, keyless) so the browser avoids CORS.
//
// Pulls three series per sport and groups them under one game key:
//   MLB   side=KXMLBGAME    spread=KXMLBSPREAD   total=KXMLBTOTAL
//   NFL   side=KXNFLGAME    spread=KXNFLSPREAD   total=KXNFLTOTAL
//   NCAAF side=KXNCAAFGAME  spread=KXNCAAFSPREAD total=KXNCAAFTOTAL
// Series tickers were confirmed against the live Kalshi series catalog; if a
// type 404s later, that ladder is simply empty (moneyline still ships).
// All share the game key `<SERIES>-<DATE[TIME]><TEAMS>` (group on the part after
// the series prefix). MLB keys include HHMM (e.g. 26AUG071840TORPHI); NFL/NCAAF
// keys are date-only (e.g. 26SEP09NESEA, 26SEP03MASSRUTG).
//
// Kalshi lists only ONE side of each spread/total as a market; the OTHER side is
// that market's NO. We expand every market into BOTH selectable legs with clean
// labels so a leg carries the exact (ticker, side) an RFQ will contain:
//   total "Over 7.5 runs scored"          -> Over 7.5 (yes) / Under 7.5 (no)
//   spread "Philadelphia wins by over 1.5" -> PHI -1.5 (yes) / <opp> +1.5 (no)
//
// IDENTITY ONLY — no prices/odds. CJS (api/package.json commonjs).
// Also proxies GET /markets/{ticker} when called as /api/kalshi-games?tickers=A,B
// so Combo Locks can show official combo settlement (status/result) without CORS.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const KALSHI_BASE = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const COMBO_COLLECTION = process.env.KALSHI_COMBO_COLLECTION || 'KXMVESPORTSMULTIGAMEEXTENDED-R';
const MARKET_SERIES = {
  mlb: { side: 'KXMLBGAME', spread: 'KXMLBSPREAD', total: 'KXMLBTOTAL' },
  nfl: { side: 'KXNFLGAME', spread: 'KXNFLSPREAD', total: 'KXNFLTOTAL' },
  ncaaf: { side: 'KXNCAAFGAME', spread: 'KXNCAAFSPREAD', total: 'KXNCAAFTOTAL' },
};

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; } finally { clearTimeout(t); }
}

// Combo Locks settlement: GET /api/kalshi-games?tickers=A,B returns official
// market status/result (public, keyless). Tickers are Kalshi market ids only.
const TICKER_RE = /^[A-Za-z0-9]+-[A-Za-z0-9_-]{1,70}$/;
function tickersFromReq(req) {
  let raw = '';
  if (req && req.query) {
    const q = req.query.tickers || req.query.ticker || '';
    raw = Array.isArray(q) ? q.join(',') : String(q);
  }
  if (!raw && req && req.url) {
    try {
      const u = new URL(req.url, 'http://localhost');
      raw = u.searchParams.get('tickers') || u.searchParams.get('ticker') || '';
    } catch (_) {}
  }
  return [...new Set(String(raw).split(/[,\s]+/).map((s) => s.trim()).filter((s) => TICKER_RE.test(s)))].slice(0, 25);
}
function slimMarket(market) {
  if (!market || !market.ticker) return null;
  return {
    ticker: market.ticker,
    status: market.status || null,
    result: market.result == null ? '' : String(market.result),
  };
}
async function fetchMarketSettlements(tickers) {
  const markets = {};
  await Promise.all((tickers || []).map(async (ticker) => {
    const data = await fetchJson(`${KALSHI_BASE}/markets/${encodeURIComponent(ticker)}`);
    const slim = slimMarket(data && data.market);
    if (slim) markets[slim.ticker] = slim;
  }));
  return markets;
}

const gameKeyOf = (t) => { const i = String(t || '').indexOf('-'); return i === -1 ? t : t.slice(i + 1); };
const marketLabel = (m) => m.yes_sub_title || m.subtitle || m.title || m.ticker;

// Game start (UTC ms) from the key's leading YYMONDD[HHMM], interpreted as US Eastern —
// Kalshi tickers + market rules_primary use ET (e.g. MLB "...071840..." = Aug 7 at
// 6:40 PM EDT). NFL/NCAAF keys omit HHMM (e.g. 26SEP09NESEA) — those resolve to the
// start of that ET calendar day. NOTE: occurrence_datetime / expected_expiration_time
// are the game END/settlement (~3h later) on MLB, so they are not used for the
// pre-game cutoff. Returns NaN if unparseable.
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function etWallToUtcMs(y, mon, d, hh, mm) {
  const asUTC = Date.UTC(y, mon, d, hh, mm);
  // Shift the ET wall-clock time to true UTC using the America/New_York offset at that instant (handles EDT/EST).
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(asUTC));
  const p = {}; parts.forEach((x) => (p[x.type] = x.value));
  const etAsIfUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return asUTC + (asUTC - etAsIfUTC);
}
function firstPitchUtcMs(gameKey) {
  const m = /^(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})/.exec(gameKey || '');
  if (!m) return NaN;
  const y = 2000 + Number(m[1]), mon = MONTHS[m[2]], d = Number(m[3]), hh = Number(m[4]), mm = Number(m[5]);
  if (mon == null) return NaN;
  return etWallToUtcMs(y, mon, d, hh, mm);
}
function dateOnlyUtcMs(gameKey) {
  if (Number.isFinite(firstPitchUtcMs(gameKey))) return NaN;
  const m = /^(\d{2})([A-Z]{3})(\d{2})(?![0-9])/.exec(gameKey || '');
  if (!m) return NaN;
  const y = 2000 + Number(m[1]), mon = MONTHS[m[2]], d = Number(m[3]);
  if (mon == null) return NaN;
  return etWallToUtcMs(y, mon, d, 0, 0);
}
function gameStartUtcMs(gameKey) {
  const timed = firstPitchUtcMs(gameKey);
  if (Number.isFinite(timed)) return timed;
  return dateOnlyUtcMs(gameKey);
}
function isUpcomingGame(gameKey, nowMs) {
  const timed = firstPitchUtcMs(gameKey);
  if (Number.isFinite(timed)) return timed > nowMs;
  const dayStart = dateOnlyUtcMs(gameKey);
  if (!Number.isFinite(dayStart)) return false;
  // Date-only football keys: keep the slate through the end of that ET day.
  return dayStart + 24 * 3600 * 1000 > nowMs;
}
function occurrenceMsOf(ev) {
  let best = Infinity;
  for (const m of ev && ev.markets || []) {
    const t = Date.parse(m.occurrence_datetime);
    if (Number.isFinite(t) && t < best) best = t;
  }
  return best === Infinity ? NaN : best;
}

// ── label parsers (validated against Kalshi's real strings in the test) ──
function parseTotal(label) {
  const m = /over\s+([\d.]+)/i.exec(label || '');
  return m ? { line: m[1] } : null;
}
function parseSpread(label) {
  const m = /^(.*?)\s+wins by over\s+([\d.]+)/i.exec(label || '');
  return m ? { team: m[1].trim(), line: m[2] } : null;
}

// ── expand raw markets into both-side legs ──
function expandTotals(raw) {
  const legs = [];
  for (const m of raw) {
    const p = parseTotal(m.label);
    if (!p) { legs.push({ ticker: m.ticker, side: 'yes', label: m.label }); continue; } // fallback: raw yes
    legs.push({ ticker: m.ticker, side: 'yes', label: `Over ${p.line}`, sort: parseFloat(p.line) });
    legs.push({ ticker: m.ticker, side: 'no',  label: `Under ${p.line}`, sort: parseFloat(p.line) + 0.001 });
  }
  return legs.sort((a, b) => (a.sort || 0) - (b.sort || 0));
}
function expandSpreads(raw, teamNames) {
  const other = (name) => teamNames.find(t => t && t !== name) || 'Other';
  const legs = [];
  for (const m of raw) {
    const p = parseSpread(m.label);
    if (!p) { legs.push({ ticker: m.ticker, side: 'yes', label: m.label }); continue; }
    const fav = p.team, dog = other(fav);
    legs.push({ ticker: m.ticker, side: 'yes', label: `${fav} −${p.line}`, sort: parseFloat(p.line) });
    legs.push({ ticker: m.ticker, side: 'no',  label: `${dog} +${p.line}`, sort: parseFloat(p.line) + 0.001 });
  }
  return legs.sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

async function fetchSeriesEvents(seriesTicker) {
  const events = []; let cursor = '';
  for (let page = 0; page < 6; page++) {
    const url = `${KALSHI_BASE}/events?series_ticker=${encodeURIComponent(seriesTicker)}` +
      `&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await fetchJson(url);
    (data && data.events || []).forEach(e => events.push(e));
    cursor = (data && data.cursor) || ''; if (!cursor) break;
  }
  return events;
}

function groupSportGames(eventsByType, nowMs = Date.now()) {
  const byKey = new Map(); // key -> { key, title, date, occurrenceMs, raw:{side,spread,total} }
  for (const [type, events] of Object.entries(eventsByType || {})) {
    if (!events) continue;
    for (const ev of events) {
      const key = gameKeyOf(ev.event_ticker || ev.ticker); if (!key) continue;
      let g = byKey.get(key);
      if (!g) { g = { key, title: null, date: null, occurrenceMs: NaN, raw: { side: [], spread: [], total: [] } }; byKey.set(key, g); }
      if (type === 'side' || !g.title) { g.title = ev.title || g.title; g.date = ev.sub_title || g.date; }
      const occ = occurrenceMsOf(ev);
      if (Number.isFinite(occ) && (!Number.isFinite(g.occurrenceMs) || occ < g.occurrenceMs)) g.occurrenceMs = occ;
      if (!g.raw[type]) g.raw[type] = [];
      (ev.markets || []).forEach(m => { if (m.ticker) g.raw[type].push({ ticker: m.ticker, label: marketLabel(m) }); });
    }
  }
  const games = [];
  for (const g of byKey.values()) {
    if (g.raw.side.length < 2) continue; // needs a real moneyline pair
    // PRE-GAME: MLB (datetime key) drops once first pitch has passed. Football
    // (date-only key) stays through the end of that ET calendar day.
    if (!isUpcomingGame(g.key, nowMs)) continue;
    const timed = firstPitchUtcMs(g.key);
    const startMs = Number.isFinite(timed) ? timed
      : (Number.isFinite(g.occurrenceMs) ? g.occurrenceMs : dateOnlyUtcMs(g.key));
    if (!Number.isFinite(startMs)) continue;
    const teamNames = g.raw.side.map(m => m.label);
    games.push({
      key: g.key, title: g.title, date: g.date, startTime: new Date(startMs).toISOString(),
      markets: {
        side: g.raw.side.map(m => ({ ticker: m.ticker, side: 'yes', label: m.label })),
        spread: expandSpreads(g.raw.spread || [], teamNames),
        total: expandTotals(g.raw.total || []),
      },
    });
  }
  return games;
}

async function fetchSportGames(seriesByType) {
  const eventsByType = {};
  await Promise.all(Object.entries(seriesByType || {}).map(async ([type, series]) => {
    eventsByType[type] = await fetchSeriesEvents(series);
  }));
  return groupSportGames(eventsByType);
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  try {
    const tickers = tickersFromReq(req);
    if (tickers.length) {
      const markets = await fetchMarketSettlements(tickers);
      res.status(200).json({ markets, updatedAt: new Date().toISOString() });
      return;
    }
    const sports = {};
    await Promise.all(Object.entries(MARKET_SERIES).map(async ([sport, seriesByType]) => {
      const games = await fetchSportGames(seriesByType);
      sports[sport] = games.map((g) => ({ ...g, sport }));
    }));
    res.status(200).json({ comboCollection: COMBO_COLLECTION, updatedAt: new Date().toISOString(), sports });
  } catch (e) {
    res.status(200).json({ comboCollection: COMBO_COLLECTION, updatedAt: null, sports: {}, error: String(e && e.message || e) });
  }
}

module.exports = handler;
module.exports.MARKET_SERIES = MARKET_SERIES;
module.exports._helpers = {
  parseTotal, parseSpread, expandTotals, expandSpreads, gameKeyOf, tickersFromReq, slimMarket,
  groupSportGames, gameStartUtcMs, firstPitchUtcMs, dateOnlyUtcMs, isUpcomingGame,
};
