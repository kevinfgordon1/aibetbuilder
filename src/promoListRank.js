// Promo list order uses the same depth blend the cards display.
// Top-of-book ranking (empty ladders) can put a thin price first; walking
// the ~$500 payout ladder then lowers that pick's EV. Re-rank the visible
// page with those ladders so ★ BEST PICK is index 0 of the EV on the card.

import { rankPicksAfterOppGuard } from "./promoOppGuard.js";
import { applyBlendToLegs, depthCacheKey, venueHasDepthApi, unknownDepthKeys } from "./promoBookDepth.js";
import { preferCompletePmHedge } from "./blendAskLadder.js";
import { filterLowLiquidityPicks } from "./promoLiquidityFilter.js";
import { filterPicksByTeamName } from "./promoTeamFilter.js";
import { applyMinDepthToPick, minDepthAltVenueLegs, parseMinLegDepth } from "./promoMinDepth.js";

export function overlayBlendedParlay(p, displayLegs, ctx, calcs) {
  const prev = p.legs || [];
  const next = displayLegs || prev;
  const changed = prev.some((l, i) => next[i] && next[i].bestOpp !== l.bestOpp);
  if (!changed) return p;
  if (ctx.promoType === "nosweat") {
    return { ...p, ...calcs.calcNoSweatFromLegs(next, ctx.stake, ctx.refundPct, ctx.creditConversionPct) };
  }
  if (ctx.promoType === "freebet") return { ...p, ...calcs.calcFreeBetParlayEV(next, ctx.stake) };
  return { ...p, ...calcs.calcParlayEV(next, ctx.boostPct, ctx.stake) };
}

function attachPmBlendToPick(p, ctx, overlayParlayMetrics, laddersByKey) {
  const nLegs = (p.legs || []).length;
  const { displayLegs } = applyBlendToLegs(p.legs || [], laddersByKey || {}, { ...ctx, numLegs: nLegs });
  const next = overlayParlayMetrics(p, displayLegs, ctx);
  return { ...next, legs: displayLegs };
}

// Min depth per leg (owner-only): reprice each leg to its cross-venue blended
// price for the minimum, recompute the parlay EV, or drop the pick.
function attachMinDepthToPick(p, ctx, overlayParlayMetrics, laddersByKey) {
  if (!parseMinLegDepth(ctx.minLegDepth)) return p;
  const next = applyMinDepthToPick(p, ctx.minLegDepth, laddersByKey);
  if (!next) return null;
  return { ...overlayParlayMetrics(p, next.legs, ctx), legs: next.legs };
}

export function rankPromoPicks(picks, ctx, attachLock, overlayParlayMetrics, laddersByKey) {
  const tagged = (picks || [])
    .map((p) => attachMinDepthToPick(attachPmBlendToPick(p, ctx, overlayParlayMetrics, laddersByKey), ctx, overlayParlayMetrics, laddersByKey))
    .filter(Boolean)
    .map((p) => attachLock(p));
  const guarded = rankPicksAfterOppGuard(tagged);
  const ranked = Number(ctx.numLegs) === 1 ? preferCompletePmHedge(guarded) : guarded;
  const liquidAll = filterLowLiquidityPicks(ranked, ctx.hideLowLiquidity);
  return filterPicksByTeamName(liquidAll, ctx.includeTeamTokens, ctx.excludeTeamTokens);
}

// Scan pool at the live depth price (Kevin, 2026-10-28: Moneylines alone
// showed +$36.35 while Main + Moneylines showed +$34.02). The scan used to
// rank combos on stored / feed top-of-book ladders, keep the top 1,000, trim
// to 150, and only then walk live ladders. Live depth can move a leg's price
// either way, so the combo that is best after depth could sit outside that
// cut — and a bigger pool (Main adds spreads and totals) pushes it out more.
// Pricing every pool leg with the SAME per-leg depth walk rankPromoPicks
// uses (each venue on its own ladder, $500 payout walk, then Min depth per
// leg) makes scan EV = card EV, so the exact scan is monotonic: a superset of
// legs can never show a worse Best Pick. Returns the input unchanged while
// ladders are still loading (null). A leg whose venue read failed
// (unknownDepthKeys) keeps its stored price instead of being dropped as thin.
export function depthPricePoolLegs(legs, ctx, laddersByKey) {
  const list = Array.isArray(legs) ? legs : [];
  if (laddersByKey == null) return list;
  const unknown = unknownDepthKeys(laddersByKey);
  const identity = (p, displayLegs) => ({ ...p, legs: displayLegs });
  const out = [];
  for (const leg of list) {
    if (!leg) continue;
    const keys = collectPromoDepthLegs([{ legs: [leg] }], ctx.minLegDepth, ctx.hideLowLiquidity).map(depthCacheKey);
    // Not fetched (over the pool budget) or the venue read failed: keep the
    // stored price, exactly as before this change.
    if (keys.some((k) => unknown.has(k) || !Object.prototype.hasOwnProperty.call(laddersByKey, k))) { out.push(leg); continue; }
    const one = { legs: [leg] };
    const blended = attachPmBlendToPick(one, { ...ctx, numLegs: ctx.numLegs }, identity, laddersByKey);
    const priced = attachMinDepthToPick(blended, ctx, identity, laddersByKey);
    if (!priced) continue; // no single venue fills Min depth per leg
    const next = priced.legs[0];
    if (ctx.hideLowLiquidity && next.lowLiquidity) continue;
    out.push(next);
  }
  return out;
}

// Pool legs to depth-check before the scan, best single-leg edge first,
// until POOL_DEPTH_MAX_KEYS venue ladders (one /api/book-depth POST per 8).
// A full NBA Main + Moneylines slate is ~200 keys; the visible-page fetch
// already reads most of them, and the 45 s cache shares them.
export const POOL_DEPTH_MAX_KEYS = 400;
export function poolDepthPicks(legs, minLegDepth, hideLowLiquidity, edgeOf, maxKeys = POOL_DEPTH_MAX_KEYS) {
  const list = (Array.isArray(legs) ? legs : []).filter(Boolean);
  const order = typeof edgeOf === "function"
    ? list.map((l, i) => ({ l, i, e: Number(edgeOf(l)) || 0 })).sort((a, b) => (b.e - a.e) || (a.i - b.i)).map((x) => x.l)
    : list;
  const out = [];
  const seen = new Set();
  for (const leg of order) {
    const keys = collectPromoDepthLegs([{ legs: [leg] }], minLegDepth, hideLowLiquidity).map(depthCacheKey);
    const fresh = keys.filter((k) => !seen.has(k));
    if (seen.size + fresh.length > maxKeys) continue;
    for (const k of fresh) seen.add(k);
    out.push({ legs: [leg] });
  }
  return out;
}

// PM legs on the visible page. Sportsbooks are skipped (no depth API).
// Other venues' ladders are fetched too when a minimum is set or Hide low
// liquidity is on (each venue is checked on its own ladder).
export function collectPromoDepthLegs(picks, minLegDepth, hideLowLiquidity = false) {
  const out = [];
  const seen = new Set();
  for (const p of picks || []) {
    const legs = (p && p.legs) || [];
    const alt = minDepthAltVenueLegs(legs, parseMinLegDepth(minLegDepth) ? minLegDepth : (hideLowLiquidity ? 1 : 0));
    for (const leg of legs.concat(alt)) {
      if (!venueHasDepthApi(leg && leg.bestOppBook)) continue;
      const key = depthCacheKey(leg);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(leg);
    }
  }
  return out;
}

// laddersByKey == null → page is still the top-of-book order (depth not in yet).
// An object (including {}) re-ranks only that page; picks below stay in place
// until Show more brings them into the blend window.
// windowSize (>= pageSize) is how many top-of-book picks get depth-checked.
// Hide low liquidity can drop most of the page once ladders load; backfill the
// visible page from the rest of the checked window so the page never shows
// "Show more (N remaining)" with zero cards. `hidden` = checked picks the
// depth walk removed; `needsWiderWindow` asks the caller to check more.
// opts.keysOfPick(p) → depth keys the pick needs. Picks the depth walk drops
// while one of their keys is in unknownDepthKeys(laddersByKey) (venue could
// not be read) count as `unknown`, not `hidden`: we do not know they are thin.
export function visiblePromoAfterDepth(ranked, pageSize, laddersByKey, rankPage, windowSize, opts = {}) {
  const list = Array.isArray(ranked) ? ranked : [];
  const size = Math.max(0, pageSize | 0);
  const win = Math.min(list.length, Math.max(size, windowSize | 0));
  if (laddersByKey == null) {
    const n = Math.min(list.length, size);
    return { visible: list.slice(0, n), rest: list.slice(n), hidden: 0, pending: true, needsWiderWindow: false };
  }
  const head = list.slice(0, win);
  const unchecked = list.slice(win);
  const passed = rankPage(head, laddersByKey);
  const ok = Array.isArray(passed) ? passed : [];
  const visible = ok.slice(0, size);
  const rest = ok.slice(size).concat(unchecked);
  const dropped = Math.max(0, head.length - ok.length);
  let unknown = 0;
  const unknownKeys = unknownDepthKeys(laddersByKey);
  if (dropped > 0 && unknownKeys.size && typeof opts.keysOfPick === "function") {
    const touch = head.filter((p) => (opts.keysOfPick(p) || []).some((k) => unknownKeys.has(k)));
    if (touch.length) {
      const okTouch = rankPage(touch, laddersByKey);
      unknown = Math.min(dropped, Math.max(0, touch.length - (Array.isArray(okTouch) ? okTouch.length : 0)));
    }
  }
  return {
    visible,
    rest,
    hidden: dropped - unknown,
    unknown,
    pending: false,
    needsWiderWindow: visible.length < size && unchecked.length > 0,
  };
}

// Next depth window when the checked window could not fill the page.
export const PROMO_DEPTH_WINDOW_MAX = 150;
export function nextPromoDepthWindow(current, pageSize, total) {
  const cur = Math.max(current | 0, pageSize | 0);
  return Math.min(Math.max(0, total | 0), PROMO_DEPTH_WINDOW_MAX, cur + 15);
}

// Stale-while-revalidate for the depth-ranked page. While a new page's
// ladders are still loading (laddersByKey == null), keep showing the last
// depth-checked result for the same filters instead of the raw top-of-book
// list. Otherwise picks the depth walk will hide pop up, then vanish, on
// every odds refresh.
export function holdDepthRankWhilePending(next, laddersByKey, prev, filtersKey) {
  if (laddersByKey == null && prev && prev.filtersKey === filtersKey) return prev.result;
  return next;
}

// First load with Hide low liquidity on: raw top-of-book picks would show,
// then most vanish when ladders land. Show nothing (pending) instead.
// Notice to show under the list. "thin" only when every dropped pick was
// actually measured below the bar; "unavailable" when venue reads failed.
export function promoDepthNoticeKind(rank, { allChecked = true } = {}) {
  if (!rank) return null;
  if (rank.checking) return "checking";
  if (rank.pending || (rank.visible && rank.visible.length > 0)) return null;
  if ((rank.unknown || 0) > 0) return "unavailable";
  if ((rank.hidden || 0) > 0 && allChecked) return "thin";
  return null;
}

export function maskUncheckedWhileHidingThin(rank, hideLowLiquidity) {
  if (!rank || !rank.pending || !hideLowLiquidity) return rank;
  return { ...rank, visible: [], rest: [], checking: true };
}
