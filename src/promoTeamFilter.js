// Promo Builder team-name Extra Filter.
// Session-only (same as Markets / date / odds bounds). Not in profile or hash.
//
// Contains / substring, case-insensitive, against card fields (name, game, title).
// Multiple tokens: comma-separated.
// Include: AND — every include token must be matched by at least one leg
// ("Lions, Packers" needs a Lions leg and a Packers leg; one leg such as a
// Lions/Packers game total can cover both).
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

// Include rule (AND): every include token is matched by at least one leg.
export function pickMatchesTeamInclude(pickOrLegs, includeTokens) {
  const tokens = Array.isArray(includeTokens) ? includeTokens : [];
  if (!tokens.length) return true;
  const legs = pickLegs(pickOrLegs);
  if (!legs.length) return false;
  const hays = legs.map(promoLegSearchText);
  return tokens.every((token) => {
    const needle = String(token || "").trim().toLowerCase();
    return !needle || hays.some((hay) => hay && hay.includes(needle));
  });
}

export function legMatchesAllTeamTokens(leg, tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  if (!list.length) return false;
  return list.every((token) => legMatchesTeamTokens(leg, [token]));
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
  // Used for 1-leg scans: the single leg must cover every token.
  return list.filter((leg) => legMatchesAllTeamTokens(leg, tokens));
}

export function filterPicksByTeamName(picks, includeTokens, excludeTokens) {
  const list = Array.isArray(picks) ? picks : [];
  const include = Array.isArray(includeTokens) ? includeTokens : [];
  const exclude = Array.isArray(excludeTokens) ? excludeTokens : [];
  if (!include.length && !exclude.length) return list;
  return list.filter((pick) => pickPassesTeamFilter(pick, include, exclude));
}

// Keep include-matching legs inside the 200-leg scan cap so "lions" is not
// sliced off when those legs are not in the top-EV slice. With several tokens
// the pinned legs are interleaved per token (legs matching all tokens first)
// so every token keeps legs inside the cap and AND combos stay findable.
export function pinTeamIncludeLegs(legs, includeTokens, cap) {
  const list = Array.isArray(legs) ? legs : [];
  const limit = Number(cap);
  const capped = Number.isFinite(limit) && limit >= 0;
  const tokens = Array.isArray(includeTokens) ? includeTokens : [];
  if (!tokens.length) return capped ? list.slice(0, limit) : list.slice();
  const all = [];
  const perToken = tokens.map(() => []);
  const rest = [];
  for (const leg of list) {
    if (tokens.length > 1 && legMatchesAllTeamTokens(leg, tokens)) { all.push(leg); continue; }
    const idx = tokens.findIndex((t) => legMatchesTeamTokens(leg, [t]));
    if (idx >= 0) perToken[idx].push(leg); else rest.push(leg);
  }
  const interleaved = [];
  const maxLen = Math.max(0, ...perToken.map((a) => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of perToken) if (i < arr.length) interleaved.push(arr[i]);
  }
  const pinned = all.concat(interleaved, rest);
  return capped ? pinned.slice(0, limit) : pinned;
}

export function teamFilterSummary(includeTokens, excludeTokens) {
  const include = Array.isArray(includeTokens) ? includeTokens : [];
  const exclude = Array.isArray(excludeTokens) ? excludeTokens : [];
  const parts = [];
  if (include.length) parts.push(`include ${include.join(", ")}`);
  if (exclude.length) parts.push(`exclude ${exclude.join(", ")}`);
  return parts.join(" · ");
}
