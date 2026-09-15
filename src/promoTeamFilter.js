// Promo Builder team-name Extra Filter.
// Session-only (same as Markets / date / odds bounds). Not in profile or hash.
//
// Contains / substring, case-insensitive, against card fields (name, game, title).
// Multiple tokens: comma-separated.
// Include: OR — pick kept if at least one leg contains any include token.
// Exclude: drop pick if any leg contains any exclude token.
// Per-leg X hide stays in promoLegExclude.js (identity). This is the text filter.

import { formatPromoLegTitle } from "./soccerPairing.js";

export function parseTeamFilterTokens(raw) {
  if (raw == null) return [];
  const parts = String(raw).split(/[,]+/);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const token = part.trim().toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function promoLegSearchText(leg) {
  if (leg == null) return "";
  if (typeof leg === "string") return leg.trim().toLowerCase();
  const title = formatPromoLegTitle(leg);
  return [leg.name, leg.label, leg.game, title]
    .filter((s) => s != null && String(s).trim())
    .join(" ")
    .toLowerCase();
}

export function legMatchesTeamTokens(leg, tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  if (!list.length) return false;
  const hay = promoLegSearchText(leg);
  if (!hay) return false;
  return list.some((token) => {
    const needle = String(token || "").trim().toLowerCase();
    return !!needle && hay.includes(needle);
  });
}

function pickLegs(pickOrLegs) {
  if (Array.isArray(pickOrLegs)) return pickOrLegs;
  return (pickOrLegs && pickOrLegs.legs) || [];
}

// Include rule: at least one leg contains any include token (OR).
export function pickMatchesTeamInclude(pickOrLegs, includeTokens) {
  const tokens = Array.isArray(includeTokens) ? includeTokens : [];
  if (!tokens.length) return true;
  return pickLegs(pickOrLegs).some((leg) => legMatchesTeamTokens(leg, tokens));
}

// Exclude rule: drop if any leg contains any exclude token.
export function pickPassesTeamExclude(pickOrLegs, excludeTokens) {
  const tokens = Array.isArray(excludeTokens) ? excludeTokens : [];
  if (!tokens.length) return true;
  return !pickLegs(pickOrLegs).some((leg) => legMatchesTeamTokens(leg, tokens));
}

export function pickPassesTeamFilter(pickOrLegs, includeTokens, excludeTokens) {
  return pickMatchesTeamInclude(pickOrLegs, includeTokens)
    && pickPassesTeamExclude(pickOrLegs, excludeTokens);
}

export function filterLegsByTeamExclude(legs, excludeTokens) {
  const list = Array.isArray(legs) ? legs : [];
  const tokens = Array.isArray(excludeTokens) ? excludeTokens : [];
  if (!tokens.length) return list;
  return list.filter((leg) => !legMatchesTeamTokens(leg, tokens));
}

export function filterLegsByTeamInclude(legs, includeTokens) {
  const list = Array.isArray(legs) ? legs : [];
  const tokens = Array.isArray(includeTokens) ? includeTokens : [];
  if (!tokens.length) return list;
  return list.filter((leg) => legMatchesTeamTokens(leg, tokens));
}

export function filterPicksByTeamName(picks, includeTokens, excludeTokens) {
  const list = Array.isArray(picks) ? picks : [];
  const include = Array.isArray(includeTokens) ? includeTokens : [];
  const exclude = Array.isArray(excludeTokens) ? excludeTokens : [];
  if (!include.length && !exclude.length) return list;
  return list.filter((pick) => pickPassesTeamFilter(pick, include, exclude));
}

// Keep include-matching legs inside the 200-leg scan cap so "lions" is not
// sliced off when those legs are not in the top-EV slice.
export function pinTeamIncludeLegs(legs, includeTokens, cap) {
  const list = Array.isArray(legs) ? legs : [];
  const limit = Number(cap);
  const sliced = Number.isFinite(limit) && limit >= 0 ? list.slice(0, limit) : list.slice();
  const tokens = Array.isArray(includeTokens) ? includeTokens : [];
  if (!tokens.length) return sliced;
  const matched = [];
  const rest = [];
  for (const leg of list) {
    (legMatchesTeamTokens(leg, tokens) ? matched : rest).push(leg);
  }
  const pinned = matched.concat(rest);
  return Number.isFinite(limit) && limit >= 0 ? pinned.slice(0, limit) : pinned;
}

export function teamFilterSummary(includeTokens, excludeTokens) {
  const include = Array.isArray(includeTokens) ? includeTokens : [];
  const exclude = Array.isArray(excludeTokens) ? excludeTokens : [];
  const parts = [];
  if (include.length) parts.push(`include ${include.join(", ")}`);
  if (exclude.length) parts.push(`exclude ${exclude.join(", ")}`);
  return parts.join(" · ");
}
