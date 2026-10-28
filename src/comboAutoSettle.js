// Combo Locks settlement planner — the ONE copy of the logic the Combo Locks page
// runs on every poll (refreshSettlements) and the server auto-settle job runs for
// every allowlisted user (api/combo-auto-settle.js). Pure apart from getJson.
//
// getJson(url) is called with the same relative URLs the page has always used
// (/api/kalshi-games?tickers=..., /api/espn-scores?queries=...) and must resolve
// to the parsed JSON body, or null when the response was not ok. It may throw;
// the ESPN read swallows its own errors exactly like the page did.
//
// Returns { rowPatch, livePatch } (both keyed by parlay id). rowPatch holds the
// combo_parlays columns to stamp (combo_ticker, kalshi_result, kalshi_status,
// settled_at, underlying_result, underlying_source, underlying_settled_at,
// leg_results). Nothing here changes P/L math: History reads these stamps through
// buildComboStatement, unchanged.
import { resolveComboTicker, marketSettlement, lockResultFromMarket } from "./comboSettlement.js";
import { settleLegs, uniqueEspnQueries, needsUnderlyingStamp } from "./comboLegResult.js";

const empty = () => ({ rowPatch: {}, livePatch: {}, idle: true });

export async function planSettlementPatches({ living, archived, fills, outcomes, matchesByParlay, submissions, filledById } = {}, { getJson, now = () => Date.now() } = {}) {
  const tickerOf = (row) => resolveComboTicker({
    parlay: row,
    fills,
    outcomes,
    matches: (matchesByParlay && matchesByParlay[row.id]) || [],
    submissions,
  });
  const candidates = [];
  const foundTickers = [];
  (living || []).forEach((row) => {
    if (!row) return;
    const ticker = tickerOf(row);
    if (ticker && !row.combo_ticker) foundTickers.push({ row, ticker });
    if (row.kalshi_result === "yes" || row.kalshi_result === "no") return;
    if (!((filledById && filledById[row.id]) > 0)) return;
    if (ticker) candidates.push({ row, ticker });
  });
  (archived || []).forEach((row) => {
    if (!row) return;
    const ticker = tickerOf(row);
    if (ticker && !row.combo_ticker) foundTickers.push({ row, ticker });
    if (row.kalshi_result === "yes" || row.kalshi_result === "no") return;
    if (ticker) candidates.push({ row, ticker });
  });
  const needUnderlying = [];
  [...(living || []), ...(archived || [])].forEach((row) => {
    if (needsUnderlyingStamp(row)) needUnderlying.push(row);
  });
  // Unfilled locks often have no combo ticker. Still stamp risk won / risk lost
  // from Kalshi single-game legs or ESPN — do not wait for a combo market.
  if (!candidates.length && !foundTickers.length && !needUnderlying.length
    && !(living || []).some((r) => r && !r.archived_at && !r.merged_into_id && isFinalLock(r, (filledById && filledById[r.id]) || 0))) return empty();
  const tickers = [...new Set(candidates.map((c) => c.ticker))];
  const livePatch = {};
  const rowPatch = {};
  const stampTicker = ({ row, ticker }) => {
    if (!ticker || row.combo_ticker || (rowPatch[row.id] && rowPatch[row.id].combo_ticker)) return;
    rowPatch[row.id] = { ...(rowPatch[row.id] || {}), combo_ticker: ticker };
  };
  foundTickers.forEach(stampTicker);
  candidates.forEach(stampTicker);
  if (tickers.length) {
    const d = await getJson("/api/kalshi-games?tickers=" + encodeURIComponent(tickers.join(",")));
    if (d) {
      const markets = (d && d.markets) || {};
      for (const { row, ticker } of candidates) {
        const m = markets[ticker];
        if (!m) continue;
        const official = marketSettlement(m);
        if (!official) continue;
        const next = rowPatch[row.id] || {};
        next.kalshi_result = lockResultFromMarket(row, official.result);
        next.kalshi_status = m.status || null;
        next.settled_at = new Date(now()).toISOString();
        rowPatch[row.id] = next;
        livePatch[row.id] = { result: official.result, status: m.status, ticker };
      }
    }
  }
  if (needUnderlying.length) {
    const started = needUnderlying.filter((p) => {
      if (!p.starts_at) return true;
      const t = Date.parse(p.starts_at);
      return !Number.isFinite(t) || t <= now();
    });
    const tickerRows = started.length ? started : needUnderlying;
    const legTickers = [...new Set(tickerRows.flatMap((p) => (p.legs || []).map((l) => l && l.ticker).filter(Boolean)))].slice(0, 50);
    const markets = {};
    for (let i = 0; i < legTickers.length; i += 25) {
      const batch = legTickers.slice(i, i + 25);
      const d = await getJson("/api/kalshi-games?tickers=" + encodeURIComponent(batch.join(",")));
      if (d) Object.assign(markets, (d && d.markets) || {});
    }
    let espnGames = [];
    const queries = uniqueEspnQueries(started).slice(0, 12);
    if (queries.length) {
      try {
        const d = await getJson("/api/espn-scores?queries=" + encodeURIComponent(queries.map((q) => q.sport + ":" + q.date).join(",")));
        if (d) espnGames = (d && d.games) || [];
      } catch (_) {}
    }
    for (const row of needUnderlying) {
      const settled = settleLegs({ legs: row.legs, kalshiMarkets: markets, espnGames });
      if (settled.outcome !== "won" && settled.outcome !== "lost" && settled.outcome !== "push") continue;
      const src = settled.source === "espn" || settled.source === "kalshi_legs" ? settled.source : null;
      if (!src) continue;
      const next = rowPatch[row.id] || {};
      next.underlying_result = settled.outcome;
      next.underlying_source = src;
      next.underlying_settled_at = new Date(now()).toISOString();
      next.leg_results = settled.legs;
      rowPatch[row.id] = next;
    }
  }
  // A lock whose Kalshi combo market is final (or, with no fills, whose legs are
  // final) is done: stop the worker watching it and move it to History, so the
  // card stops showing live "If it hits / misses".
  const nowIso = new Date(now()).toISOString();
  for (const row of living || []) {
    if (!row || row.archived_at || row.merged_into_id) continue;
    const next = rowPatch[row.id] || {};
    const merged = { ...row, ...next };
    if (!isFinalLock(merged, (filledById && filledById[row.id]) || 0)) continue;
    next.active = false;
    next.archived_at = nowIso;
    rowPatch[row.id] = next;
  }
  return { rowPatch, livePatch, idle: false };
}

/** True when a lock can no longer change: Kalshi settled it, or it never filled and its legs settled. */
export function isFinalLock(row, filled = 0) {
  if (!row) return false;
  if (row.kalshi_result === "yes" || row.kalshi_result === "no") return true;
  const u = row.underlying_result;
  return !(filled > 0) && (u === "won" || u === "lost" || u === "push");
}

/** Browser getJson: same fetch + headers the page always used. */
export function browserGetJson(fetchImpl = (...a) => fetch(...a)) {
  return async (url) => {
    const r = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    return r.json();
  };
}
