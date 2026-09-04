// Promo Builder vs +EV / Odds Board load plans.
// Promo fetches all featured boards (header Today slate on first visit / hard
// refresh) plus selected-sport event odds. No futures, no +EV-tab 20k-leg scan.

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
  const allFeatured = [...(featuredSportKeys || [])];
  const promoEvents = sportKeysForPromoLoad(promoSports, featuredSportKeys);
  return {
    mode: isFull ? "full" : "promo",
    // Promo still skips futures / the +EV-tab scan, but featured boards are
    // the full slate so header StatCards can show Today's numbers on first
    // visit / hard refresh without opening +EV or Odds.
    featuredSports: allFeatured,
    eventSports: isFull ? allFeatured : promoEvents,
    eventSince: isFull ? null : new Date(now.getTime() - lookbackMs).toISOString(),
    futures: isFull,
    futuresKeys: isFull ? [...(futuresKeys || [])] : [],
    computeEv: isFull,
  };
}

export function shouldRunEvScan(mode) {
  return mode === "full";
}

// Header +EV slate. Promo hard-refresh uses this against the promo board so
// the three StatCards populate without waiting for a full-board fetch.
export const DEFAULT_EV_DATE_RANGE = "today";

export function evHeaderSlateLabel(dateRange = DEFAULT_EV_DATE_RANGE) {
  return dateRange === "today" ? "today's slate" : "all sports & books";
}

export function shouldComputePromoHeaderScan({ fullBoardLoaded, promoLoaded }) {
  return !fullBoardLoaded && !!promoLoaded;
}

export function selectEvScanView({ fullBoardLoaded, liveEvScan, cachedEvScan, promoHeaderScan }) {
  if (fullBoardLoaded) return liveEvScan || cachedEvScan || null;
  return liveEvScan || cachedEvScan || promoHeaderScan || null;
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

export function evHeaderShowLoading({
  fullBoardLoaded,
  fullBoardLoading,
  promoLoaded,
  promoLoading,
  activeTab,
} = {}) {
  const initialOddsInFlight = !fullBoardLoaded && !promoLoaded && !!promoLoading;
  const fullBoardInFlight = !!fullBoardLoading && (activeTab === "ev" || activeTab === "odds");
  return initialOddsInFlight || fullBoardInFlight;
}

export function evHeaderValues({ evScan, showLoading, dateRange = DEFAULT_EV_DATE_RANGE }) {
  const slateSub = evHeaderSlateLabel(dateRange);
  if (showLoading) {
    return { total: "...", plusEv: "...", bestValue: "...", bestSub: "", slateSub };
  }
  if (!evScan) {
    return { total: "—", plusEv: "—", bestValue: "—", bestSub: "", slateSub };
  }
  const best = evScan.evBets[0];
  return {
    total: evScan.allEvLegs.length,
    plusEv: evScan.positiveEV.length,
    bestValue: best ? `+$${best.ev.toFixed(2)}` : "--",
    bestSub: best ? best.name : "",
    slateSub,
  };
}
