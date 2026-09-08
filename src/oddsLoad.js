// Promo Builder vs +EV / Odds Board load plans.
// Promo fetches selected featured sports only (no futures, no 20k-leg EV scan).

export const EVENT_ODDS_LOOKBACK_MS = 30 * 60 * 1000;

export function loadModeForTab(tab) {
  if (tab === "ev" || tab === "odds") return "full";
  return "promo";
}

export function sportKeysForPromoLoad(promoSports, featuredSportKeys) {
  const keys = featuredSportKeys || [];
  if (!promoSports || promoSports.size === 0) return [...keys];
  if (promoSports.size === keys.length && keys.every((k) => promoSports.has(k))) {
    return [...keys];
  }
  return keys.filter((k) => promoSports.has(k));
}

export function buildOddsQueryPlan({
  mode,
  promoSports,
  now = new Date(),
  featuredSportKeys,
  futuresKeys,
  lookbackMs = EVENT_ODDS_LOOKBACK_MS,
} = {}) {
  const isFull = mode === "full";
  const sports = isFull
    ? [...(featuredSportKeys || [])]
    : sportKeysForPromoLoad(promoSports, featuredSportKeys);
  return {
    mode: isFull ? "full" : "promo",
    featuredSports: sports,
    eventSports: sports,
    eventSince: isFull ? null : new Date(now.getTime() - lookbackMs).toISOString(),
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

// Browser PostgREST can hang (statement timeout, Warp thread kill) with no HTTP
// error. Promo default sports (MLB+NFL+NCAAF) are ~2.8MB combined — one
// `.in("sport", …)` select never finishes. Cap each query and load one sport
// at a time; Promo prefers /api/odds-cache (selected sports, cache then live).
export const ODDS_QUERY_TIMEOUT_MS = 12000;
export const ODDS_CACHE_COLUMNS = "sport,data,fetched_at";
export const ODDS_CACHE_API_TIMEOUT_MS = 20000;

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
  if (err.name === "TimeoutError" || err.name === "AbortError" || /timed out/i.test(msg)) {
    return "Live odds timed out waiting for the odds cache. This is not The Odds API quota — the cache request never finished. Tap Retry.";
  }
  if (/401|403|JWT|invalid api key|invalid API key/i.test(msg)) {
    return "Odds cache access denied. Check the Supabase anon key.";
  }
  if (/429|quota|rate limit/i.test(msg)) {
    return "Odds provider rate limit or quota exceeded.";
  }
  return `Could not load live odds: ${msg}`;
}

export function oddsCacheApiUrl(plan) {
  const sports = (plan && plan.featuredSports) || [];
  const params = new URLSearchParams({ sports: sports.join(",") });
  if (plan && plan.eventSince) params.set("eventSince", plan.eventSince);
  return `/api/odds-cache?${params}`;
}

function emptyCaches(error = null, timedOut = false) {
  return {
    featured: { data: [], error, timedOut },
    events: { data: [], error, timedOut },
    futures: { data: [], error: null, timedOut: false },
  };
}

export async function fetchOddsCacheFromApi(plan, {
  fetchImpl = globalThis.fetch,
  timeoutMs = ODDS_CACHE_API_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") return emptyCaches(new Error("fetch unavailable"));
  const sports = (plan && plan.featuredSports) || [];
  if (!sports.length) return emptyCaches();
  try {
    const json = await withTimeout(
      (signal) => fetchImpl(oddsCacheApiUrl(plan), { signal }).then(async (res) => {
        if (!res || !res.ok) {
          const err = new Error(`odds-cache ${res ? res.status : "failed"}`);
          err.status = res && res.status;
          throw err;
        }
        return res.json();
      }),
      { timeoutMs, label: "odds-cache api" },
    );
    const featuredData = Array.isArray(json.featured) ? json.featured : [];
    const eventData = Array.isArray(json.events) ? json.events : [];
    const firstErr = json.errors && json.errors[0] && json.errors[0].error;
    return {
      featured: {
        data: featuredData,
        error: featuredData.length ? null : (firstErr ? new Error(firstErr) : new Error("odds cache empty")),
        timedOut: false,
      },
      events: { data: eventData, error: null, timedOut: false },
      futures: { data: [], error: null, timedOut: false },
    };
  } catch (err) {
    const timedOut = !!(err && (err.name === "TimeoutError" || err.name === "AbortError"));
    return emptyCaches(err, timedOut);
  }
}

async function queryFeaturedBySport(client, sports, timeoutMs) {
  const rows = [];
  let lastError = null;
  let timedOut = false;
  for (const sport of sports || []) {
    const res = await runCacheQuery(
      () => client.from("odds_cache").select(ODDS_CACHE_COLUMNS).eq("sport", sport),
      { timeoutMs, label: `odds_cache ${sport}` },
    );
    if (res.timedOut) {
      timedOut = true;
      lastError = res.error;
      continue;
    }
    if (res.error) {
      lastError = res.error;
      continue;
    }
    if (Array.isArray(res.data)) rows.push(...res.data.filter(Boolean));
    else if (res.data) rows.push(res.data);
  }
  return {
    data: rows,
    error: rows.length ? null : lastError,
    timedOut: rows.length ? false : timedOut,
  };
}

export async function queryOddsCachesFromClient(client, plan, { timeoutMs = ODDS_QUERY_TIMEOUT_MS } = {}) {
  const featured = await queryFeaturedBySport(client, plan.featuredSports, timeoutMs);
  const events = await runCacheQuery(
    () => {
      let q = client.from("event_odds_cache").select("*").in("sport", plan.eventSports);
      if (plan.eventSince) q = q.gte("commence_time", plan.eventSince);
      return q;
    },
    { timeoutMs, label: "event_odds_cache" },
  );
  let futures = { data: [], error: null, timedOut: false };
  if (plan.futures) {
    futures = await queryFeaturedBySport(client, plan.futuresKeys, timeoutMs);
  }
  return { featured, events, futures };
}

export async function queryOddsCaches(client, plan, opts = {}) {
  const preferApi = opts.preferApi ?? plan.mode === "promo";
  if (preferApi) {
    const api = await fetchOddsCacheFromApi(plan, opts);
    if (api && featuredRowsUsable(api.featured) && api.featured.data.length) return api;
  }
  if (client) return queryOddsCachesFromClient(client, plan, opts);
  if (preferApi) return fetchOddsCacheFromApi(plan, opts);
  return emptyCaches(new Error("odds cache unavailable"));
}
