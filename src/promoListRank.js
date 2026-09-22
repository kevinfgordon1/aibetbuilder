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
export function visiblePromoAfterDepth(ranked, pageSize, laddersByKey, rankPage) {
  const list = Array.isArray(ranked) ? ranked : [];
  const n = Math.min(list.length, Math.max(0, pageSize | 0));
  const head = list.slice(0, n);
  const rest = list.slice(n);
  if (laddersByKey == null) return { visible: head, rest };
  const visible = rankPage(head, laddersByKey);
  return { visible: Array.isArray(visible) ? visible : [], rest };
}
