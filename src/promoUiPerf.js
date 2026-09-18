// Promo / Odds Board interaction perf.
// Chip clicks must paint before rematch transforms, leg-pool rebuilds, and C(n,k).
// Local filters (date, markets, liquidity, matching books, sport deselect) never
// refetch. Adding a sport that is not loaded yet is the only filter-driven fetch,
// and that refetch is debounced so rapid chip clicks coalesce.

export const PROMO_SPORT_RELOAD_DEBOUNCE_MS = 160;

// Skip layout/paint for off-screen Promo cards (Show more / long lists).
export const PROMO_CARD_LAYER_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "0 220px",
};

export function promoFilterWorkPending(immediate, deferred) {
  if (!immediate || !deferred) return false;
  return immediate.sports !== deferred.sports
    || immediate.dateRange !== deferred.dateRange
    || immediate.marketScope !== deferred.marketScope
    || immediate.promoBook !== deferred.promoBook
    || immediate.matchingBookKeys !== deferred.matchingBookKeys
    || immediate.hideLowLiquidity !== deferred.hideLowLiquidity
    || immediate.numLegs !== deferred.numLegs;
}

// True when a sport-chip change needs a selected-sports fetch. Deselect and
// already-loaded adds stay local.
export function promoSportsNeedNetworkReload(promoSports, loadedSports, promoLoaded) {
  if (!promoLoaded) return false;
  if (!loadedSports) return true;
  for (const key of promoSports) {
    if (!loadedSports.has(key)) return true;
  }
  return false;
}
