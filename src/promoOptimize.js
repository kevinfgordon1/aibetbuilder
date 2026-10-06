// Optimize! jumps Promo results to the current ★ Best Pick (index 0 of the
// post-blend EV ranking). It does not re-run a different scan — same list,
// same rankPromoPicks order — it just expands + scrolls that card into view
// after clearing any manual leg exclusions so the unconstrained best shows.

import { encodePromoCardId } from "./shareCard.js";

export function activePromoList(promoType, { boost, nosweat, freebet }) {
  if (promoType === "nosweat") return Array.isArray(nosweat) ? nosweat : [];
  if (promoType === "freebet") return Array.isArray(freebet) ? freebet : [];
  return Array.isArray(boost) ? boost : [];
}

/** Card id for the current Best Pick, or null when the list is empty. */
export function bestPromoCardId(list, { promoType, book, stake } = {}) {
  const best = Array.isArray(list) && list[0];
  if (!best || !Array.isArray(best.legs)) return null;
  return encodePromoCardId({
    promoType: promoType || "boost",
    book: book || "draftkings",
    stake: stake == null ? 100 : stake,
    legs: best.legs,
  });
}
