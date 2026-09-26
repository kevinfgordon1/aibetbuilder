// Promo Builder Markets Extra Filter.
// Session-only (same as date / odds bounds). Multi-select: the scope is an
// array of MARKET_SCOPES values. ["all"] (the default) means no filter.
// Main is non-alt game lines only (no player props); ML is h2h only.
// Specific picks combine as a union, e.g. ["main", "props"] = main game
// lines plus player props (NFL anytime TD + MLB 1+ HR), so multi-leg
// parlays can mix both.

export const MARKET_SCOPES = [
  { val: "all", label: "All" },
  { val: "main", label: "Main" },
  { val: "ml", label: "Moneylines" },
  { val: "alt", label: "Alt" },
  { val: "props", label: "Player Props" },
];

export const DEFAULT_MARKET_SCOPE = Object.freeze(["all"]);

const SPECIFIC_SCOPES = MARKET_SCOPES.map((o) => o.val).filter((v) => v !== "all");

export function isMoneylineLeg(leg) {
  return !!(leg && leg.market === "ML");
}

// Sportsbook player-prop legs from playerTdLegsForBook: NFL anytime TD
// (market "TD") and MLB 1+ home run (market "HR"). Both carry playerTd.
export function isPlayerPropLeg(leg) {
  return !!(leg && (leg.playerTd || leg.playerProp || leg.market === "TD" || leg.market === "HR"));
}

// Accepts the new array form or an old single string ("main", "props", ...)
// and returns a clean array in MARKET_SCOPES order. Unknown values drop out;
// nothing specific left (or "all" picked) falls back to ["all"].
export function normalizeMarketScope(scope) {
  const raw = Array.isArray(scope) ? scope : (typeof scope === "string" && scope ? [scope] : []);
  const picked = new Set(raw.filter((v) => typeof v === "string"));
  if (picked.has("all")) return [...DEFAULT_MARKET_SCOPE];
  const out = SPECIFIC_SCOPES.filter((v) => picked.has(v));
  return out.length ? out : [...DEFAULT_MARKET_SCOPE];
}

export function isAllMarketScope(scope) {
  const s = normalizeMarketScope(scope);
  return s.length === 1 && s[0] === "all";
}

// True when Player Props legs are in play: an explicit "props" pick, or All
// (which includes everything). Use scopeHasExplicitProps for UI that should
// only show when the user asked for props.
export function scopeIncludesProps(scope) {
  const s = normalizeMarketScope(scope);
  return s.includes("props") || s.includes("all");
}

export function scopeHasExplicitProps(scope) {
  return normalizeMarketScope(scope).includes("props");
}

// Chip click: All clears the others; a specific chip toggles and turns All
// off; deselecting the last specific chip falls back to All.
export function toggleMarketScope(scope, val) {
  const cur = normalizeMarketScope(scope);
  if (val === "all") return [...DEFAULT_MARKET_SCOPE];
  if (!SPECIFIC_SCOPES.includes(val)) return cur;
  const specific = cur.filter((v) => v !== "all");
  const next = specific.includes(val) ? specific.filter((v) => v !== val) : [...specific, val];
  return normalizeMarketScope(next);
}

export function isMarketScopeSelected(scope, val) {
  return normalizeMarketScope(scope).includes(val);
}

const LEG_MATCHERS = {
  main: (l) => !l.isAlt && !isPlayerPropLeg(l),
  ml: isMoneylineLeg,
  alt: (l) => !!l.isAlt,
  props: isPlayerPropLeg,
};

export function scopePromoLegs(legs, marketScope) {
  const list = Array.isArray(legs) ? legs : [];
  const scope = normalizeMarketScope(marketScope);
  if (scope.includes("all")) return list;
  const matchers = scope.map((v) => LEG_MATCHERS[v]).filter(Boolean);
  if (!matchers.length) return list;
  return list.filter((l) => l && matchers.some((m) => m(l)));
}

const SUMMARY_LABELS = { main: "mains", ml: "moneylines", alt: "alts", props: "player props" };

export function marketScopeSummary(marketScope) {
  const scope = normalizeMarketScope(marketScope);
  if (scope.includes("all")) return "all";
  return scope.map((v) => SUMMARY_LABELS[v]).join(" + ");
}
