// Promo Builder "Min depth per leg" (owner-only, canSeeOwnerTools).
//
// PER-VENUE depth (Kevin, 2026-10-27: a hedge is placed in ONE account, so
// venues are never summed). Each depth venue (Kalshi / Polymarket / Novig /
// ProphetX) walks its OWN opposing ladder, best fee-adjusted American first,
// adding up potential PROFIT (Kevin: depth = what the bet can win, not the
// stake; sizes are $ stake, see lib/book-depth.js, so each level counts
// size × (1 − p) / p, e.g. $3,000 at −200 = $1,500 depth) until the
// minimum is reached. Prices are already net of each venue's own fee
// (Novig pregame $0, Polymarket US maker $0, ProphetX 2%, Kalshi series fee).
// Venues that cannot reach the minimum alone are discarded; the leg is
// priced at the best (highest VWAP) venue that can, and moves to that venue.
// Only when no single venue reaches the minimum is the leg dropped — two
// venues that reach it only together do not count.
// Sportsbook-best legs (no depth feed) fall back to the exchange venues
// quoting the same side (bestOppVenues) instead of dropping.
// 0 / blank = off: nothing here runs and the inverse method is untouched.

import { resolvePmBookLevels, isPmBlendVenue, blendAskLadderToPayout, americanToImpliedProb } from "./blendAskLadder.js";
import { oppQuoteLooksInverted, quoteLooksWrongSideOf, ladderTopLooksRogue } from "./promoOppGuard.js";
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

// One ladder per depth venue. A PM best venue uses its live → stored →
// top-of-book ladder; every other depth venue in bestOppVenues uses its live
// ladder when loaded, else its feed top-of-book quote. Levels on the wrong
// side of the quoted best (or that would invert the leg) are ignored.
// Sportsbook-best legs get only the exchange venues (fallback).
export function venueLadders(leg, levels, laddersByKey, keyOf) {
  if (!leg) return [];
  const quoted = Number(quotedOpp(leg));
  const clean = (lvls) => {
    const out = [];
    for (const l of lvls || []) {
      const american = Number(l && l.american);
      const size = Number(l && l.size);
      if (!isFinite(american) || american === 0 || !(size > 0)) continue;
      if (isFinite(quoted) && quoted !== 0 && quoteLooksWrongSideOf(quoted, american)) continue;
      if (oppQuoteLooksInverted(leg.dk, american)) continue;
      out.push({ american, size });
    }
    return out.sort((x, y) => y.american - x.american);
  };
  const bestBook = String(leg.bestOppBook || "").toLowerCase();
  const out = [];
  const seen = new Set();
  if (isPmBlendVenue(bestBook)) {
    const lv = clean(resolvePmBookLevels(leg, levels));
    out.push({ book: bestBook, levels: ladderTopLooksRogue(quoted, lv) ? [] : lv, best: true });
    seen.add(bestBook);
  }
  for (const v of Array.isArray(leg.bestOppVenues) ? leg.bestOppVenues : []) {
    const book = String((v && v.book) || "").toLowerCase();
    if (!isPmBlendVenue(book) || seen.has(book)) continue;
    seen.add(book);
    const alt = venueDepthLeg(leg, book);
    const live = laddersByKey && keyOf ? laddersByKey[keyOf(alt)] : null;
    const lv = clean(Array.isArray(live) && live.length ? live : [{ american: v.american, size: v.size }]);
    out.push({ book, levels: ladderTopLooksRogue(Number(v.american), lv) ? [] : lv, best: false });
  }
  return out;
}

// Back-compat: every venue's levels in one list (display / diagnostics only;
// never summed for the minimum).
export function crossVenueLadder(leg, levels, laddersByKey, keyOf) {
  const out = [];
  for (const v of venueLadders(leg, levels, laddersByKey, keyOf)) for (const l of v.levels) out.push({ book: v.book, ...l });
  return out.sort((a, b) => b.american - a.american);
}

// { complete, american, venue, top, topBook, stakeFilled, profitFilled,
//   venues, parts, levelsUsed, available, target, skippedVenues } or
// { complete: false, available } / null. `minDepth`, `available` and
// `target` are potential PROFIT in $; `available` is the deepest single
// venue (venues are never summed).
export function blendLegToMinDepth(leg, minDepth, levels, laddersByKey, keyOf = depthCacheKey) {
  const min = parseMinLegDepth(minDepth);
  if (!min || !leg) return null;
  const venues = venueLadders(leg, levels, laddersByKey, keyOf).filter((v) => v.levels.length);
  if (!venues.length) return null;
  let best = null;
  let deepest = 0;
  const skippedVenues = [];
  for (const v of venues) {
    const total = v.levels.reduce((s, l) => s + profitAtAmerican(l.size, l.american), 0);
    deepest = Math.max(deepest, total);
    if (total + 0.5 < min) { skippedVenues.push(v.book); continue; }
    const blend = blendAskLadderToPayout(v.levels, { targetPayout: min });
    if (!blend || !blend.complete || blend.american == null) { skippedVenues.push(v.book); continue; }
    const top = v.levels[0].american;
    const american = blend.american > top ? top : blend.american; // never better than the venue's best
    if (!best || american > best.american) best = { v, blend, american, top, total };
  }
  if (!best) return { complete: false, available: deepest, skippedVenues };
  const { v, blend, american, top, total } = best;
  let left = min;
  const parts = [];
  for (const l of v.levels) {
    if (left <= 1e-9) break;
    const take = Math.min(profitAtAmerican(l.size, l.american), left);
    if (!(take > 0)) continue;
    left -= take;
    const last = parts[parts.length - 1];
    if (last && last.american === l.american) last.profit += take;
    else parts.push({ book: v.book, american: l.american, profit: take });
  }
  let topSize = 0;
  for (const l of v.levels) { if (l.american !== top) break; topSize += l.size; }
  return {
    complete: true, american, venue: v.book, venueIsBest: !!v.best, top, topSize, topBook: v.book,
    stakeFilled: blend.stakeFilled, profitFilled: min, venues: [v.book], parts,
    levelsUsed: blend.levelsUsed, available: total, target: min,
    skippedVenues: skippedVenues.filter((b) => b !== v.book),
  };
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
  const sameVenue = String(leg.bestOppBook || "").toLowerCase() === b.venue;
  if (!sameVenue) {
    // The hedge moves to the one venue that covers the minimum alone
    // (thin best venue, or sportsbook-best fallback to an exchange).
    return {
      ...leg,
      bestOppBook: b.venue,
      bestOppQuoted: b.top,
      bestOpp: b.american,
      bestOppSize: b.topSize,
      bestOppLevels: undefined,
      hedgeVenueFrom: leg.hedgeVenueFrom || String(leg.bestOppBook || "").toLowerCase(),
      minDepthBlend: { ...b, impliedProb: americanToImpliedProb(b.american) },
    };
  }
  const cur = Number(leg.bestOpp);
  const next = isFinite(cur) && cur !== 0 && cur < b.american ? cur : b.american;
  return {
    ...leg,
    bestOppQuoted: quotedOpp(leg),
    bestOpp: next,
    minDepthBlend: { ...b, american: next, impliedProb: americanToImpliedProb(next) },
  };
}

// Scan pool: drop legs no single venue can fill to the minimum.
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
// other depth venue (all exchange venues for a sportsbook-best leg). Only
// when a minimum is set.
export function minDepthAltVenueLegs(legs, minDepth) {
  if (!parseMinLegDepth(minDepth)) return [];
  const out = [];
  for (const l of legs || []) {
    if (!l) continue;
    for (const v of Array.isArray(l.bestOppVenues) ? l.bestOppVenues : []) {
      const book = String(v && v.book || "").toLowerCase();
      if (!isPmBlendVenue(book) || book === String(l.bestOppBook).toLowerCase()) continue;
      out.push(venueDepthLeg(l, book));
    }
  }
  return out;
}

const VENUE_LABELS = { novig: "Novig", kalshi: "Kalshi", polymarket: "Polymarket", prophetx: "ProphetX" };
const fmtAm = (n) => (n > 0 ? `+${n}` : `${n}`);
const fmtUsd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

// "blended to $2,000 to win (Novig +336 $649, then Novig +317 $1,351)" —
// always one venue now (venues are never summed).
export function formatMinDepthBlendFlag(md) {
  if (!md || !md.complete || md.target == null) return "";
  const parts = Array.isArray(md.parts) ? md.parts : [];
  const trail = parts.map((p, i) => `${i ? "then " : ""}${VENUE_LABELS[p.book] || p.book} ${fmtAm(p.american)} ${fmtUsd(p.profit)}`).join(", ");
  return `blended to ${fmtUsd(md.target)} to win${trail ? ` (${trail})` : ""}`;
}
