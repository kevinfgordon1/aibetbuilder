// Promo list order uses the same depth blend the cards display.
// Top-of-book ranking (empty ladders) can put a thin price first; walking
// the ~$500 payout ladder then lowers that pick's EV. Re-rank the visible
// page with those ladders so ★ BEST PICK is index 0 of the EV on the card.

import { rankPicksAfterOppGuard } from "./promoOppGuard.js";
import { applyBlendToLegs, depthCacheKey, venueHasDepthApi } from "./promoBookDepth.js";
import { preferCompletePmHedge } from "./blendAskLadder.js";
import { filterLowLiquidityPicks } from "./promoLiquidityFilter.js";
import { filterPicksByTeamName } from "./promoTeamFilter.js";

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

export function rankPromoPicks(picks, ctx, attachLock, overlayParlayMetrics, laddersByKey) {
  const tagged = (picks || []).map((p) => attachLock(attachPmBlendToPick(p, ctx, overlayParlayMetrics, laddersByKey)));
  const guarded = rankPicksAfterOppGuard(tagged);
  const ranked = Number(ctx.numLegs) === 1 ? preferCompletePmHedge(guarded) : guarded;
  const liquid = filterLowLiquidityPicks(ranked, ctx.hideLowLiquidity);
  return filterPicksByTeamName(liquid, ctx.includeTeamTokens, ctx.excludeTeamTokens);
}

// PM legs on the visible page. Sportsbooks are skipped (no depth API).
export function collectPromoDepthLegs(picks) {
  const out = [];
  const seen = new Set();
  for (const p of picks || []) {
    for (const leg of (p && p.legs) || []) {
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
export function visiblePromoAfterDepth(ranked, pageSize, laddersByKey, rankPage, windowSize) {
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
  return {
    visible,
    rest,
    hidden: Math.max(0, head.length - ok.length),
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
export function maskUncheckedWhileHidingThin(rank, hideLowLiquidity) {
  if (!rank || !rank.pending || !hideLowLiquidity) return rank;
  return { ...rank, visible: [], rest: [], checking: true };
}
