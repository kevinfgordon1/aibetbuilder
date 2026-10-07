// Promo Builder types. "No Promo" is a profit boost at 0%: same scan, rank,
// and EV math, with the boost % control hidden and no boost applied.

export const PROMO_TYPE_NOPROMO = "nopromo";
export const PROMO_TYPE_BOOST = "boost";
export const PROMO_TYPE_FREEBET = "freebet";
export const PROMO_TYPE_NOSWEAT = "nosweat";

/** Everyone starts on Profit Boost. No Promo is a menu option, not the default. */
export const DEFAULT_PROMO_TYPE = PROMO_TYPE_BOOST;

export const PROMO_TYPE_ORDER = Object.freeze([
  PROMO_TYPE_NOPROMO,
  PROMO_TYPE_BOOST,
  PROMO_TYPE_FREEBET,
  PROMO_TYPE_NOSWEAT,
]);

export function isParlayPromoType(promoType) {
  return promoType === PROMO_TYPE_BOOST
    || promoType === PROMO_TYPE_NOPROMO
    || promoType === PROMO_TYPE_NOSWEAT
    || promoType === PROMO_TYPE_FREEBET;
}

/** Profit Boost and No Promo share calcParlayEV. No Promo forces 0%. */
export function isBoostLikePromo(promoType) {
  return promoType === PROMO_TYPE_BOOST || promoType === PROMO_TYPE_NOPROMO;
}

export function effectiveBoostPct(promoType, boostPct) {
  if (promoType === PROMO_TYPE_NOPROMO) return 0;
  const n = Number(boostPct);
  return Number.isFinite(n) ? n : 0;
}
