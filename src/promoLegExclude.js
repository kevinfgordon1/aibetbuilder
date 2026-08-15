// Promo Builder session exclusions: same identity parlayLegKey already uses
// (game + name). Not persisted. Cleared on odds refresh.

export function promoLegIdentity(leg) {
  return `${leg.game}\0${leg.name}`;
}

export function filterExcludedLegs(legs, excluded) {
  if (!excluded || excluded.size === 0) return legs;
  return legs.filter((l) => !excluded.has(promoLegIdentity(l)));
}

export function filterParlaysByExcluded(parlays, excluded) {
  if (!excluded || excluded.size === 0) return parlays;
  return parlays.filter((p) => !(p.legs || []).some((l) => excluded.has(promoLegIdentity(l))));
}
