// Promo Builder "Hide low liquidity" Extra Filter.
// Session-only (same as Markets / date / odds bounds). Default off.
//
// Reuses pickHasLowLiquidity / applyPmBlendToLeg — no second definition.
// Multi-leg: incomplete $500-profit walk (win excl. stake, #96).
// 1-leg: incomplete required-hedge $ walk (perfect lock).
// Sportsbooks never set lowLiquidity; only Kalshi/Polymarket/Novig/ProphetX.

import { applyPmBlendToLeg, pickHasLowLiquidity } from "./blendAskLadder.js";

export const HIDE_LOW_LIQUIDITY_LABEL = "Hide low liquidity";
export const LIQUIDITY_FILTER_ALL_LABEL = "All";

export function liquidityFilterSummary(hideLowLiquidity) {
  return hideLowLiquidity ? "hide low liquidity" : "";
}

// Drop individual legs that already fail the PM liquidity bar (scan pool).
// Returns the original legs that pass — does not replace them with blended copies.
export function filterLowLiquidityLegs(legs, hideLowLiquidity, ctx = {}) {
  const list = Array.isArray(legs) ? legs : [];
  if (!hideLowLiquidity) return list;
  return list.filter((leg) => {
    const blended = applyPmBlendToLeg(leg, null, ctx);
    return !blended.lowLiquidity;
  });
}

// Drop finished picks that contain any low-liquidity PM leg (ranked list).
export function filterLowLiquidityPicks(picks, hideLowLiquidity) {
  const list = Array.isArray(picks) ? picks : [];
  if (!hideLowLiquidity) return list;
  return list.filter((p) => !pickHasLowLiquidity(p && p.legs));
}
