// Promo Builder vs +EV / Odds Board load plans.
// Promo fetches selected featured sports + a 30-min event_odds_cache lookback.
// Odds Board / +EV (mode "full") load featured odds_cache main lines + futures
// only — they skip event_odds_cache so Chrome does not freeze on a 12MB+ transform.

import { isSupabaseDownError, isTimeoutError, describeSupabaseUnhealthy } from "./dataSourceHealth.js";
import { expandSoccerSportKeys } from "./soccerPairing.js";

export { isSupabaseDownError, isSupabaseUnhealthy } from "./dataSourceHealth.js";

export const EVENT_ODDS_LOOKBACK_MS = 30 * 60 * 1000;

export function loadModeForTab(tab) {
  if (tab === "ev" || tab === "odds") return "full";
  return "promo";
}

export function sportKeysForPromoLoad(promoSports, featuredSportKeys) {
  const keys = featuredSportKeys || [];
  const expanded = expandSoccerSportKeys(promoSports);
  if (!expanded.size) return [...keys];
  if (keys.length && keys.every((k) => expanded.has(k))) {
    return [...keys];
  }
  return keys.filter((k) => expanded.has(k));
}

export function buildOddsQueryPlan({
  mode,
  promoSports,
  now = new Date(),
  featuredSportKeys,
  futuresKeys,
  lookbackMs = EVENT_ODDS_LOOKBACK_MS,
  includeEventOdds,
} = {}) {
  const isFull = mode === "full";
  const sports = isFull
    ? [...(featuredSportKeys || [])]
    : sportKeysForPromoLoad(promoSports, featuredSportKeys);
  // Weekend band-aid: Odds Board / +EV skip event_odds_cache (alt lines).
  // Featured odds_cache main lines are enough to paint; Promo still uses lookback.
  // Pass includeEventOdds: true to restore the old unbounded full-board event pull.
  const loadEvents = includeEventOdds ?? !isFull;
  return {
    mode: isFull ? "full" : "promo",
    featuredSports: sports,
    eventSports: loadEvents ? sports : [],
    eventSince: loadEvents && !isFull
      ? new Date(now.getTime() - lookbackMs).toISOString()
      : null,
    includeEventOdds: loadEvents,
    futures: isFull,
    futuresKeys: isFull ? [...(futuresKeys || [])] : [],
    computeEv: isFull,
  };
}

export function shouldRunEvScan(mode) {
  return mode === "full";
}

export const DEFAULT_EV_DATE_RANGE = "today";

export function selectEvScanView({ liveEvScan, cachedEvScan }) {
  return liveEvScan || cachedEvScan || null;
}

export function evScanFromLegs(allEvLegs, calcEV) {
  const legs = allEvLegs || [];
  const evBets = legs.map((l) => {
    const { prob, ev, profit } = calcEV(l.dk, l.bestOpp);
    return { ...l, prob, ev, profit };
  }).sort((a, b) => b.ev - a.ev);
  return { allEvLegs: legs, evBets, positiveEV: evBets.filter((b) => b.ev > 0) };
}

export function shouldFetchFullBoard({ tab, fullBoardLoaded, forceRefresh }) {
  if (tab !== "ev" && tab !== "odds") return false;
  if (forceRefresh) return true;
  return !fullBoardLoaded;
}

export function shouldFetchPromoOdds({ tab, forceRefresh, promoLoaded }) {
  if (tab === "ev" || tab === "odds") return false;
  if (forceRefresh) return true;
  return !promoLoaded;
}

export function promoNeedsReload(promoSports, loadedSports) {
  if (!loadedSports) return true;
  for (const key of promoSports) {
    if (!loadedSports.has(key)) return true;
  }
  return false;
}

// Client reads go to Supabase odds_cache / event_odds_cache — not /api/odds.
// PostgREST can hang (statement timeout, Warp thread kill) with no HTTP error;
// without a wall-clock cap the Promo spinner stays on "Loading live odds..." forever.
export const ODDS_QUERY_TIMEOUT_MS = 12000;

export function timeoutError(label, ms) {
  const err = new Error(`${label} timed out after ${ms}ms`);
  err.name = "TimeoutError";
  return err;
}

export function applyAbortSignal(builder, signal) {
  if (builder && typeof builder.abortSignal === "function" && signal) {
    return builder.abortSignal(signal);
  }
  return builder;
}

export async function withTimeout(run, { timeoutMs = ODDS_QUERY_TIMEOUT_MS, label } = {}) {
  const ctrl = new AbortController();
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        try { ctrl.abort(); } catch (_) { /* ignore */ }
        reject(timeoutError(label || "odds query", timeoutMs));
      }, timeoutMs);
      Promise.resolve()
        .then(() => run(ctrl.signal))
        .then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
  }
}

async function runCacheQuery(build, { timeoutMs = ODDS_QUERY_TIMEOUT_MS, label } = {}) {
  try {
    const result = await withTimeout(
      (signal) => applyAbortSignal(build(), signal),
      { timeoutMs, label },
    );
    if (result && result.error) {
      return { data: result.data ?? [], error: result.error, timedOut: false };
    }
    return { data: result?.data ?? [], error: null, timedOut: false };
  } catch (err) {
    const timedOut = !!(err && (err.name === "TimeoutError" || err.name === "AbortError"));
    return { data: [], error: err, timedOut };
  }
}

export function featuredRowsUsable(featured) {
  return !!(featured && !featured.error && Array.isArray(featured.data));
}

export function describeOddsLoadError(err) {
  if (!err) return null;
  const msg = err.message || String(err);
  if (isSupabaseDownError(err)) {
    return `${describeSupabaseUnhealthy(err, { context: "odds" })} Tap Retry after the database recovers.`;
  }
  if (isTimeoutError(err) || /timed out/i.test(msg)) {
    return `${describeSupabaseUnhealthy(err, { context: "odds" })} If Retry keeps failing, the database is likely still down.`;
  }
  if (/401|403|JWT|invalid api key|invalid API key/i.test(msg)) {
    return "Odds cache access denied. Check the Supabase anon key.";
  }
  if (/429|quota|rate limit/i.test(msg)) {
    return "Odds provider rate limit or quota exceeded.";
  }
  return `Could not load live odds: ${msg}`;
}

function emptyCacheResult() {
  return { data: [], error: null, timedOut: false };
}

export async function queryOddsCaches(client, plan, { timeoutMs = ODDS_QUERY_TIMEOUT_MS } = {}) {
  const jobs = [
    runCacheQuery(
      () => client.from("odds_cache").select("*").in("sport", plan.featuredSports),
      { timeoutMs, label: "odds_cache" },
    ),
  ];
  const skipEvents = !plan.eventSports?.length;
  if (!skipEvents) {
    jobs.push(runCacheQuery(
      () => {
        let events = client.from("event_odds_cache").select("*").in("sport", plan.eventSports);
        if (plan.eventSince) events = events.gte("commence_time", plan.eventSince);
        return events;
      },
      { timeoutMs, label: "event_odds_cache" },
    ));
  }
  if (plan.futures) {
    jobs.push(runCacheQuery(
      () => client.from("odds_cache").select("*").in("sport", plan.futuresKeys),
      { timeoutMs, label: "odds_cache futures" },
    ));
  }
  const results = await Promise.all(jobs);
  return {
    featured: results[0],
    events: skipEvents ? emptyCacheResult() : results[1],
    futures: plan.futures ? results[skipEvents ? 1 : 2] : emptyCacheResult(),
  };
}

