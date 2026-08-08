// ──────────────────────────────────────────────────────────────────────────
// api/kalshi-games.js — same-origin feed of Kalshi single-game markets for the
// Combo Locks tab. Proxies Kalshi (public, keyless) so the browser avoids CORS.
//
// Pulls three series per game and groups them under one game key:
//   side  = KXMLBGAME    (moneyline, per team)
//   spread= KXMLBSPREAD  (run line — full alt ladder, per team+line)
//   total = KXMLBTOTAL   (over/under — full alt ladder, per line)
// All share the game key `<SERIES>-<DATE><TIME><TEAMS>` (group on the part after
// the series prefix, e.g. 26AUG071840TORPHI).
//
// Kalshi lists only ONE side of each spread/total as a market; the OTHER side is
// that market's NO. We expand every market into BOTH selectable legs with clean
// labels so a leg carries the exact (ticker, side) an RFQ will contain:
//   total "Over 7.5 runs scored"          -> Over 7.5 (yes) / Under 7.5 (no)
//   spread "Philadelphia wins by over 1.5" -> PHI -1.5 (yes) / <opp> +1.5 (no)
//
// IDENTITY ONLY — no prices/odds. CJS (api/package.json commonjs).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const KALSHI_BASE = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const COMBO_COLLECTION = process.env.KALSHI_COMBO_COLLECTION || 'KXMVESPORTSMULTIGAMEEXTENDED-R';
const MARKET_SERIES = { mlb: { side: 'KXMLBGAME', spread: 'KXMLBSPREAD', total: 'KXMLBTOTAL' } };

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; } finally { clearTimeout(t); }
}

const gameKeyOf = (t) => { const i = String(t || '').indexOf('-'); return i === -1 ? t : t.slice(i + 1); };
const marketLabel = (m) => m.yes_sub_title || m.subtitle || m.title || m.ticker;

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

async function fetchSportGames(seriesByType) {
  const byKey = new Map(); // key -> { key, title, date, raw:{side,spread,total} }
  for (const [type, series] of Object.entries(seriesByType)) {
    for (const ev of await fetchSeriesEvents(series)) {
      const key = gameKeyOf(ev.event_ticker || ev.ticker); if (!key) continue;
      let g = byKey.get(key);
      if (!g) { g = { key, title: null, date: null, raw: { side: [], spread: [], total: [] } }; byKey.set(key, g); }
      if (type === 'side' || !g.title) { g.title = ev.title || g.title; g.date = ev.sub_title || g.date; }
      (ev.markets || []).forEach(m => { if (m.ticker) g.raw[type].push({ ticker: m.ticker, label: marketLabel(m) }); });
    }
  }
  const games = [];
  for (const g of byKey.values()) {
    if (g.raw.side.length < 2) continue; // needs a real moneyline pair
    const teamNames = g.raw.side.map(m => m.label);
    games.push({
      key: g.key, title: g.title, date: g.date,
      markets: {
        side: g.raw.side.map(m => ({ ticker: m.ticker, side: 'yes', label: m.label })),
        spread: expandSpreads(g.raw.spread, teamNames),
        total: expandTotals(g.raw.total),
      },
    });
  }
  return games;
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  try {
    const sports = {};
    for (const [sport, seriesByType] of Object.entries(MARKET_SERIES)) sports[sport] = await fetchSportGames(seriesByType);
    res.status(200).json({ comboCollection: COMBO_COLLECTION, updatedAt: new Date().toISOString(), sports });
  } catch (e) {
    res.status(200).json({ comboCollection: COMBO_COLLECTION, updatedAt: null, sports: {}, error: String(e && e.message || e) });
  }
}

module.exports = handler;
module.exports._helpers = { parseTotal, parseSpread, expandTotals, expandSpreads, gameKeyOf };

