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
//   spread "Philadelphia wins by over 1.5" -> Philadelphia −1.5 (yes) / opponent +1.5 (no)
// NFL spread titles use abbreviated names ("SF 49ers wins by over 8.5 points")
// while moneyline labels are cities ("San Francisco", "Arizona"). The opponent
// is the other moneyline team by ticker code (SF9 → SF), not the first city
// whose name isn't an exact string match — that mislabeled every NO as the
// first side (San Francisco +8.5) and dropped Arizona +8.5.
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

function normTeamLabel(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tickerTail(ticker) {
  const s = String(ticker || '');
  const i = s.lastIndexOf('-');
  return i === -1 ? s : s.slice(i + 1);
}
// Spread suffixes are <TEAM><strike> (SF9 = SF wins by over 8.5, ARI10, RUTG36).
// Moneyline suffixes are the team code alone (SF, ARI, RUTG).
function teamCodeOf(tail) {
  const m = /^([A-Z]+)(\d*)$/.exec(String(tail || '').toUpperCase());
  return m ? m[1] : '';
}
function sideRoster(teamNamesOrSides) {
  const codeToName = {};
  const names = [];
  for (const s of teamNamesOrSides || []) {
    const label = typeof s === 'string' ? s : (s && s.label) || '';
    const ticker = typeof s === 'string' ? '' : (s && s.ticker) || '';
    if (label) names.push(label);
    const code = teamCodeOf(tickerTail(ticker));
    if (code && label && !codeToName[code]) codeToName[code] = label;
  }
  return { codeToName, names };
}
function nameHit(favLabel, names) {
  const favNorm = normTeamLabel(favLabel);
  if (!favNorm) return null;
  const exact = (names || []).find((n) => normTeamLabel(n) === favNorm);
  if (exact) return exact;
  return (names || []).find((n) => {
    const nn = normTeamLabel(n);
    return nn && (favNorm.includes(nn) || nn.includes(favNorm));
  }) || null;
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
function expandSpreads(raw, teamNamesOrSides) {
  const { codeToName, names } = sideRoster(teamNamesOrSides);
  const codes = Object.keys(codeToName);
  const favoriteName = (favLabel, favCode) => {
    if (favCode && codeToName[favCode]) return codeToName[favCode];
    return nameHit(favLabel, names) || favLabel;
  };
  // Opponent is the other moneyline team. Exact string inequality against the
  // abbreviated spread title ("SF 49ers" !== "San Francisco") used to pick
  // whichever city was listed first and stamp that name on every NO leg.
  const opponentName = (favLabel, favCode) => {
    if (favCode && codeToName[favCode] && codes.length >= 2) {
      const otherCode = codes.find((c) => c !== favCode);
      if (otherCode && codeToName[otherCode]) return codeToName[otherCode];
    }
    const fav = nameHit(favLabel, names);
    if (fav) {
      const other = names.find((n) => n !== fav);
      if (other) return other;
    }
    return 'Other';
  };
  const legs = [];
  for (const m of raw) {
    const p = parseSpread(m.label);
    if (!p) { legs.push({ ticker: m.ticker, side: 'yes', label: m.label }); continue; }
    const favCode = teamCodeOf(tickerTail(m.ticker));
    const fav = favoriteName(p.team, favCode);
    const dog = opponentName(p.team, favCode);
    legs.push({ ticker: m.ticker, side: 'yes', label: `${fav} \u2212${p.line}`, sort: parseFloat(p.line) });
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
    games.push({
      key: g.key, title: g.title, date: g.date, startTime: new Date(startMs).toISOString(),
      markets: {
        side: g.raw.side.map(m => ({ ticker: m.ticker, side: 'yes', label: m.label })),
        spread: expandSpreads(g.raw.spread || [], g.raw.side),
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

// Combo eligibility: Kalshi only builds combos from events listed in the combo
// collection. A game whose moneyline event is missing there gets a 400
// invalid_parameters on Probe / RFQ, so flag it (null = unknown, fail open).
async function fetchCollectionEventSet(collection) {
  const data = await fetchJson(`${KALSHI_BASE}/multivariate_event_collections/${encodeURIComponent(collection)}`);
  const c = data && data.multivariate_contract;
  if (!c) return null;
  const set = new Set();
  (c.associated_event_tickers || []).forEach((t) => t && set.add(String(t).toUpperCase()));
  (c.associated_events || []).forEach((e) => e && e.ticker && set.add(String(e.ticker).toUpperCase()));
  return set.size ? set : null;
}
function markComboEligible(games, sideSeries, eventSet) {
  return (games || []).map((g) => ({
    ...g,
    comboEligible: eventSet ? eventSet.has(`${sideSeries}-${g.key}`.toUpperCase()) : null,
  }));
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
    const eventSetP = fetchCollectionEventSet(COMBO_COLLECTION).catch(() => null);
    await Promise.all(Object.entries(MARKET_SERIES).map(async ([sport, seriesByType]) => {
      const games = await fetchSportGames(seriesByType);
      sports[sport] = markComboEligible(games, seriesByType.side, await eventSetP).map((g) => ({ ...g, sport }));
    }));
    res.status(200).json({ comboCollection: COMBO_COLLECTION, updatedAt: new Date().toISOString(), sports });
  } catch (e) {
    res.status(200).json({ comboCollection: COMBO_COLLECTION, updatedAt: null, sports: {}, error: String(e && e.message || e) });
  }
}

module.exports = handler;
module.exports.MARKET_SERIES = MARKET_SERIES;
module.exports._helpers = {
  parseTotal, parseSpread, expandTotals, expandSpreads, teamCodeOf, tickerTail,
  gameKeyOf, tickersFromReq, slimMarket,
  groupSportGames, markComboEligible, gameStartUtcMs, firstPitchUtcMs, dateOnlyUtcMs, isUpcomingGame,
};
