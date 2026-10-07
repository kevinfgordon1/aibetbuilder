// Optimize! searches every leg count 1..MAX_PROMO_LEGS for the highest
// post-scan EV pick (same calc as the Promo scan / pre-depth rank), then
// switches Legs to that count and focuses the winning combo so its legs
// fill the Best Pick card. Promo type, book, stake, boost, sports, markets,
// liquidity, matching books, team filters, and odds bounds stay put.

import { encodePromoCardId } from "./shareCard.js";

export function activePromoList(promoType, { boost, nosweat, freebet, nopromo }) {
  if (promoType === "nosweat") return Array.isArray(nosweat) ? nosweat : [];
  if (promoType === "freebet") return Array.isArray(freebet) ? freebet : [];
  if (promoType === "nopromo") return Array.isArray(nopromo) ? nopromo : [];
  return Array.isArray(boost) ? boost : [];
}

/** Card id for a pick's legs, or null when legs are missing. */
export function promoPickCardId(pick, { promoType, book, stake } = {}) {
  if (!pick || !Array.isArray(pick.legs) || !pick.legs.length) return null;
  return encodePromoCardId({
    promoType: promoType || "boost",
    book: book || "draftkings",
    stake: stake == null ? 100 : stake,
    legs: pick.legs,
  });
}

/** Card id for the current Best Pick (index 0), or null when the list is empty. */
export function bestPromoCardId(list, opts = {}) {
  const best = Array.isArray(list) && list[0];
  return promoPickCardId(best, opts);
}

/**
 * After a cross-leg Optimize scan, prefer the exact winning combo in the
 * refreshed list for that numLegs; fall back to ★ Best Pick (index 0).
 */
export function resolveOptimizeFocusId(list, targetCardId, opts = {}) {
  if (!Array.isArray(list) || !list.length) return null;
  if (targetCardId) {
    const hit = list.find((p) => promoPickCardId(p, opts) === targetCardId);
    if (hit) return targetCardId;
  }
  return bestPromoCardId(list, opts);
}
