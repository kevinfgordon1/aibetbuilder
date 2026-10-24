// Promo Builder "Min depth per leg" (owner-only, canSeeOwnerTools).
//
// BLENDED depth: walk the opposing price levels across every depth venue
// (Kalshi / Polymarket / Novig / ProphetX), best fee-adjusted American first,
// adding up potential PROFIT (Kevin: depth = what the bet can win, not the
// stake; sizes are $ stake, see lib/book-depth.js, so each level counts
// size × (1 − p) / p, e.g. $3,000 at −200 = $1,500 depth) until the
// minimum is reached. Prices are already net of each venue's own fee
// (Novig pregame $0, Polymarket US maker $0, ProphetX 2%, Kalshi series fee),
// exactly as the inverse method sees them. If the minimum is reachable the
// leg stays and its opposing price becomes the depth-weighted (VWAP) blend
// of the levels walked — never better than the best quote. Only when total
// blendable depth across venues is below the minimum is the leg dropped.
// Sportsbook-best legs (no depth feed) drop while a minimum is set.
// 0 / blank = off: nothing here runs and the inverse method is untouched.

import { resolvePmBookLevels, isPmBlendVenue, blendAskLadderToPayout, americanToImpliedProb } from "./blendAskLadder.js";
import { oppQuoteLooksInverted, quoteLooksWrongSideOf } from "./promoOppGuard.js";
import { depthCacheKey } from "./promoBookDepth.js";

export const MIN_LEG_DEPTH_LABEL = "Min depth per leg";
const STORAGE_PREFIX = "abb.promoMinLegDepth.";

export function parseMinLegDepth(v) {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function storageKey(user) {
  const id = user && (user.email || user.id);
  return id ? STORAGE_PREFIX + String(id).trim().toLowerCase() : null;
}

export function loadMinLegDepth(user, storage = globalThis.localStorage) {
  const key = storageKey(user);
  if (!key || !storage) return 0;
  try { return parseMinLegDepth(storage.getItem(key)); } catch { return 0; }
}

export function saveMinLegDepth(user, value, storage = globalThis.localStorage) {
  const key = storageKey(user);
  if (!key || !storage) return;
  try {
    const n = parseMinLegDepth(value);
    if (n > 0) storage.setItem(key, String(n));
    else storage.removeItem(key);
  } catch { /* private mode */ }
}

import { profitAtAmerican } from "./depthProfit.js";
export { profitAtAmerican };

// Potential profit ($) at the top American band of the best opposing venue, or null when
// unknown (sportsbook / no ladder / no bestOppSize).
export function topBandDepthUsd(leg, levels) {
  if (!leg || !isPmBlendVenue(leg.bestOppBook)) return null;
  const ladder = resolvePmBookLevels(leg, levels);
  if (!ladder.length) return null;
  const topAm = ladder[0].american;
  let size = 0;
  for (const lvl of ladder) {
    if (lvl.american !== topAm) break;
    size += profitAtAmerican(lvl.size, lvl.american);
  }
  return size;
}

function quotedOpp(leg) {
  return leg.bestOppQuoted != null ? leg.bestOppQuoted : leg.bestOpp;
}

// Depth ladder lookup key for the same selection on another venue.
export function venueDepthLeg(leg, book) {
  return { ...leg, bestOppBook: book, bestOppLevels: undefined, bestOppSize: undefined, pmBlend: undefined };
}

// Combined ladder across venues: best venue's full ladder (live → stored →
// top-of-book size), plus every other depth venue's live ladder when loaded,
// else its feed top-of-book quote. Levels on the wrong side of the quoted
// best (or that would invert the leg) are ignored.
export function crossVenueLadder(leg, levels, laddersByKey, keyOf) {
  if (!leg || !isPmBlendVenue(leg.bestOppBook)) return [];
  const quoted = Number(quotedOpp(leg));
  const out = [];
  const push = (book, lvls) => {
    for (const l of lvls || []) {
      const american = Number(l && l.american);
      const size = Number(l && l.size);
      if (!isFinite(american) || american === 0 || !(size > 0)) continue;
      if (isFinite(quoted) && quoted !== 0 && quoteLooksWrongSideOf(quoted, american)) continue;
      if (oppQuoteLooksInverted(leg.dk, american)) continue;
      out.push({ book, american, size });
    }
  };
  const bestBook = String(leg.bestOppBook).toLowerCase();
  push(bestBook, resolvePmBookLevels(leg, levels));
  const seen = new Set([bestBook]);
  for (const v of Array.isArray(leg.bestOppVenues) ? leg.bestOppVenues : []) {
    const book = String(v && v.book || "").toLowerCase();
    if (!isPmBlendVenue(book) || seen.has(book)) continue;
    seen.add(book);
    const alt = venueDepthLeg(leg, book);
    const live = laddersByKey && keyOf ? laddersByKey[keyOf(alt)] : null;
    if (Array.isArray(live) && live.length) push(book, live);
    else push(book, [{ american: v.american, size: v.size }]);
  }
  out.sort((a, b) => b.american - a.american);
  return out;
}

// { american, stakeFilled, profitFilled, venues, levelsUsed, complete } or null (drop).
// `minDepth`, `available` and `target` are potential PROFIT in $.
export function blendLegToMinDepth(leg, minDepth, levels, laddersByKey, keyOf = depthCacheKey) {
  const min = parseMinLegDepth(minDepth);
  if (!min || !leg || !isPmBlendVenue(leg.bestOppBook)) return null;
  const ladder = crossVenueLadder(leg, levels, laddersByKey, keyOf);
  if (!ladder.length) return null;
  const total = ladder.reduce((s, l) => s + profitAtAmerican(l.size, l.american), 0);
  if (total + 0.5 < min) return { complete: false, available: total };
  const blend = blendAskLadderToPayout(ladder, { targetPayout: min });
  if (!blend || !blend.complete || blend.american == null) return { complete: false, available: total };
  let left = min;
  const venues = [];
  for (const l of ladder) {
    if (left <= 1e-9) break;
    const take = Math.min(profitAtAmerican(l.size, l.american), left);
    if (!(take > 0)) continue;
    left -= take;
    if (!venues.includes(l.book)) venues.push(l.book);
  }
  // Never better than the best quote (rounding guard).
  const top = ladder[0].american;
  const american = blend.american > top ? top : blend.american;
  return { complete: true, american, top, topBook: ladder[0].book, stakeFilled: blend.stakeFilled, profitFilled: min, venues, levelsUsed: blend.levelsUsed, available: total, target: min };
}

export function legMeetsMinDepth(leg, minDepth, levels, laddersByKey) {
  const min = parseMinLegDepth(minDepth);
  if (!min) return true;
  const b = blendLegToMinDepth(leg, min, levels, laddersByKey);
  return !!(b && b.complete);
}

// Reprice one leg to the blended min-depth opposing price. Keeps the more
// conservative (lower American) of the current display opp and the blend so
// the $500 payout walk is never undone. Returns null when it cannot fill.
export function applyMinDepthToLeg(leg, minDepth, levels, laddersByKey) {
  const min = parseMinLegDepth(minDepth);
  if (!min) return leg;
  const b = blendLegToMinDepth(leg, min, levels, laddersByKey);
  if (!b || !b.complete) return null;
  const cur = Number(leg.bestOpp);
  const next = isFinite(cur) && cur !== 0 && cur < b.american ? cur : b.american;
  return {
    ...leg,
    bestOppQuoted: quotedOpp(leg),
    bestOpp: next,
    minDepthBlend: { ...b, american: next, impliedProb: americanToImpliedProb(next) },
  };
}

// Scan pool: drop legs that cannot fill the minimum across venues.
export function filterLegsByMinDepth(legs, minDepth) {
  const list = Array.isArray(legs) ? legs : [];
  if (!parseMinLegDepth(minDepth)) return list;
  return list.filter((l) => legMeetsMinDepth(l, minDepth, null, null));
}

// Scan pool: reprice surviving legs to their blended price (after the
// stored-ladder pre-blend) so the scan ranks on the min-depth fair.
export function repriceLegsForMinDepth(legs, minDepth) {
  const list = Array.isArray(legs) ? legs : [];
  if (!parseMinLegDepth(minDepth)) return list;
  return list.map((l) => applyMinDepthToLeg(l, minDepth, null, null)).filter(Boolean);
}

// Ranked picks: reprice every leg with live page ladders; null = drop pick.
export function applyMinDepthToPick(p, minDepth, laddersByKey) {
  if (!parseMinLegDepth(minDepth)) return p;
  const legs = (p && p.legs) || [];
  const next = [];
  for (const l of legs) {
    const lv = laddersByKey ? laddersByKey[depthCacheKey({ ...l, bestOpp: quotedOpp(l) })] : null;
    const r = applyMinDepthToLeg(l, minDepth, lv, laddersByKey);
    if (!r) return null;
    next.push(r);
  }
  return { ...p, legs: next };
}

export function filterPicksByMinDepth(picks, minDepth, laddersByKey) {
  const list = Array.isArray(picks) ? picks : [];
  if (!parseMinLegDepth(minDepth)) return list;
  return list.filter((p) => applyMinDepthToPick(p, minDepth, laddersByKey) != null);
}

// Extra ladders to fetch for the visible page: the same selection on each
// other depth venue. Only when a minimum is set.
export function minDepthAltVenueLegs(legs, minDepth) {
  if (!parseMinLegDepth(minDepth)) return [];
  const out = [];
  for (const l of legs || []) {
    if (!l || !isPmBlendVenue(l.bestOppBook)) continue;
    for (const v of Array.isArray(l.bestOppVenues) ? l.bestOppVenues : []) {
      const book = String(v && v.book || "").toLowerCase();
      if (!isPmBlendVenue(book) || book === String(l.bestOppBook).toLowerCase()) continue;
      out.push(venueDepthLeg(l, book));
    }
  }
  return out;
}
