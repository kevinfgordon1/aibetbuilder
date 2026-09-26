// Promo Builder empty-state detail for Player Props.
// Mirrors soccerPromoEmptyDetail: only when the scan is empty and a filter
// (Hide low liquidity or Matching books) removed player-prop legs.
// Player TD fair prices are Kalshi / Polymarket / Underdog "No" quotes. Many
// have too little depth for the $500-profit walk, so Hide low liquidity can
// empty the list even though the legs exist.

import { scopeHasExplicitProps } from "./promoMarketScope.js";

function plural(n, one, many) {
  return n === 1 ? one : many;
}

// Pure count of legs a filter removed. Inputs are leg arrays (or counts).
function sizeOf(v) {
  if (Array.isArray(v)) return v.length;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function playerPropHiddenCounts({ unfiltered, matched, liquid } = {}) {
  const all = sizeOf(unfiltered);
  const m = sizeOf(matched);
  const l = sizeOf(liquid);
  return {
    matching: Math.max(0, all - m),
    liquidity: Math.max(0, m - l),
  };
}

export function playerPropEmptyDetail({ marketScope, resultCount, hidden } = {}) {
  // Shown whenever Player Props is one of the Markets picks (alone or with
  // Main / Moneylines / Alt), and the whole scan came back empty.
  if (!scopeHasExplicitProps(marketScope)) return null;
  if ((resultCount || 0) > 0) return null;
  const liquidity = sizeOf(hidden && hidden.liquidity);
  const matching = sizeOf(hidden && hidden.matching);
  if (!liquidity && !matching) return null;
  const parts = [];
  if (liquidity) {
    parts.push(`${liquidity} player-prop ${plural(liquidity, "leg is", "legs are")} hidden by Hide low liquidity (not enough Kalshi/Polymarket No depth for the $500 walk). Set Liquidity to All to see ${plural(liquidity, "it", "them")}.`);
  }
  if (matching) {
    parts.push(`${matching} player-prop ${plural(matching, "leg is", "legs are")} hidden because ${plural(matching, "its", "their")} only fair price comes from a book unchecked in Matching books.`);
  }
  return parts.join(" ");
}
