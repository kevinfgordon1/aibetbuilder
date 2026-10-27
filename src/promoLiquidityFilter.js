// Promo Builder "Hide low liquidity" Extra Filter.
// Session-only (same as Markets / date / odds bounds). Default on.
//
// Reuses pickHasLowLiquidity / applyPmBlendToLeg — no second definition.
// 1-leg and multi-leg: a leg is low liquidity only when NO single venue's
// own ladder walks to $500 profit (win excl. stake). Venues are not blended
// together (one hedge, one account). Sportsbooks never set lowLiquidity; only
// Kalshi/Polymarket/Novig/ProphetX. Unproven PM books (empty ladder / missing
// bestOppSize) are low liquidity — do not treat "unknown / no ladder" as OK.
// A positive bestOppSize still counts as a one-level book (complete fill
// stays, shortfall drops).

import { applyPmBlendToLeg, pickHasLowLiquidity } from "./blendAskLadder.js";

export const HIDE_LOW_LIQUIDITY_LABEL = "Hide low liquidity";
export const LIQUIDITY_FILTER_ALL_LABEL = "All";

export function liquidityFilterSummary(hideLowLiquidity) {
  return hideLowLiquidity ? "hide low liquidity" : "";
}

// Drop individual legs that already fail the PM liquidity bar (scan pool).
// Returns the original legs that pass, except a leg whose hedge moved to
// another venue (best venue too thin alone) comes back on that venue so the
// scan ranks on the price the hedge can actually be placed at.
export function filterLowLiquidityLegs(legs, hideLowLiquidity, ctx = {}) {
  const list = Array.isArray(legs) ? legs : [];
  if (!hideLowLiquidity) return list;
  const out = [];
  for (const leg of list) {
    const blended = applyPmBlendToLeg(leg, null, ctx);
    if (blended.lowLiquidity) continue;
    out.push(blended.hedgeVenueFrom ? blended : leg);
  }
  return out;
}

// Drop finished picks that contain any low-liquidity PM leg (ranked list).
export function filterLowLiquidityPicks(picks, hideLowLiquidity) {
  const list = Array.isArray(picks) ? picks : [];
  if (!hideLowLiquidity) return list;
  return list.filter((p) => !pickHasLowLiquidity(p && p.legs));
}
