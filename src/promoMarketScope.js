// Promo Builder Markets Extra Filter.
// Session-only (same as date / odds bounds). Main stays non-alt; ML is h2h only.

export const MARKET_SCOPES = [
  { val: "all", label: "All" },
  { val: "main", label: "Main" },
  { val: "ml", label: "Moneylines" },
  { val: "alt", label: "Alt" },
  { val: "props", label: "Player Props" },
];

export function isMoneylineLeg(leg) {
  return !!(leg && leg.market === "ML");
}

// Sportsbook anytime TD legs from playerTdLegsForBook. Add other prop
// markets here when Promo grows past anytime touchdowns.
export function isPlayerPropLeg(leg) {
  return !!(leg && (leg.playerTd || leg.market === "TD"));
}

export function scopePromoLegs(legs, marketScope) {
  const list = Array.isArray(legs) ? legs : [];
  if (marketScope === "main") return list.filter((l) => !l.isAlt);
  if (marketScope === "alt") return list.filter((l) => l.isAlt);
  if (marketScope === "ml") return list.filter(isMoneylineLeg);
  if (marketScope === "props") return list.filter(isPlayerPropLeg);
  return list;
}

export function marketScopeSummary(marketScope) {
  if (marketScope === "main") return "mains";
  if (marketScope === "alt") return "alts";
  if (marketScope === "ml") return "moneylines";
  if (marketScope === "props") return "player props";
  return "all";
}
