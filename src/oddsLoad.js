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

export async function queryOddsCaches(client, plan) {
  const featured = client.from("odds_cache").select("*").in("sport", plan.featuredSports);
  let events = client.from("event_odds_cache").select("*").in("sport", plan.eventSports);
  if (plan.eventSince) events = events.gte("commence_time", plan.eventSince);
  const jobs = [featured, events];
  if (plan.futures) {
    jobs.push(client.from("odds_cache").select("*").in("sport", plan.futuresKeys));
  }
  const [featuredRes, eventRes, futuresRes] = await Promise.all(jobs);
  return {
    featured: featuredRes,
    events: eventRes,
    futures: futuresRes || { data: [], error: null },
  };
}

