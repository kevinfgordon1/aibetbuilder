// Shared true-odds / best-opp book line: price + book + optional exchange size.
// Size is never invented — only `size` (direct Kalshi/Polymarket) or `bet_limit`
// (The Odds API includeBetLimits) when a finite positive number is present.

import {
  blendAskLadderToPayout,
  formatBlendedPayoutFlag,
  TARGET_PAYOUT_USD,
} from "./blendAskLadder.js";

export {
  blendAskLadderToPayout,
  formatBlendedPayoutFlag,
  TARGET_PAYOUT_USD,
};

export function outcomeSize(outcome) {
  if (!outcome || typeof outcome !== "object") return null;
  const raw = outcome.size ?? outcome.bet_limit;
  const n = typeof raw === "number" ? raw : parseFloat(raw);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

// American odds: +120 / -105 / -101. Never "+-105" (a leading + on a negative).
export function formatAmericanOdds(odds) {
  if (odds == null || odds === "") return "—";
  const n = typeof odds === "number" ? odds : Number(String(odds).trim().replace(/^\+/, ""));
  if (!isFinite(n) || n === 0) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

// Promo Builder Total-row sportsbook cell: boosted final odds, not raw book odds.
export function formatPromoTotalBookOdds(boostedOdds) {
  return formatAmericanOdds(boostedOdds);
}

export function formatAvailableDollars(size) {
  const n = typeof size === "number" ? size : parseFloat(size);
  if (!isFinite(n) || n <= 0) return null;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function formatAvailableSizeClause(size) {
  const dollars = formatAvailableDollars(size);
  return dollars ? ` · ${dollars} currently available` : "";
}

export function formatTrueOddsBookLine({ odds, bookLabel, size, blendFlag } = {}) {
  const book = bookLabel || "Book";
  const flag = blendFlag ? ` · ${blendFlag}` : "";
  return `${formatAmericanOdds(odds)} on ${book}${formatAvailableSizeClause(size)}${flag}`;
}

// Precomputed `blend` wins (1-leg hedge $ or multi-leg $500 payout).
// If `blend` is omitted, a raw ladder still defaults to the $500-payout walk.
// Passing `blend: null` means "do not re-walk" (sportsbook / no PM book).
// Primary line is the blended VWAP American; top size / thin top stay secondary.
export function formatTrueOddsWithBlend({ odds, bookLabel, size, levels, blend: blendIn } = {}) {
  const blend = blendIn !== undefined
    ? blendIn
    : (Array.isArray(levels) && levels.length ? blendAskLadderToPayout(levels) : null);
  const shownOdds = blend?.american ?? odds;
  const flag = blend ? (blend.flag || formatBlendedPayoutFlag(blend)) : "";
  const text = formatTrueOddsBookLine({
    odds: shownOdds,
    bookLabel,
    size: blend ? null : size,
    blendFlag: flag,
  });
  let secondary = "";
  if (blend) {
    const bits = [];
    if (odds != null && Number(odds) !== 0 && isFinite(Number(odds))) {
      bits.push(`top ${formatAmericanOdds(odds)}`);
    }
    const dollars = formatAvailableDollars(size);
    if (dollars) bits.push(`${dollars} currently available`);
    secondary = bits.join(" · ");
  }
  return {
    text,
    secondary,
    blend,
    odds: shownOdds,
    lowLiquidity: !!(blend && blend.lowLiquidity),
  };
}

// Rest of book past the displayed top (best American first). Never invents levels.
// `topAmerican` is the already-shown price; only strictly worse prices are kept.
export function restLevelsFromLadder(levels, { topAmerican, max = 2 } = {}) {
  const cap = Number.isFinite(max) && max > 0 ? Math.min(8, Math.floor(max)) : 2;
  const clean = [];
  const seen = new Set();
  for (const raw of levels || []) {
    const american = typeof raw?.american === "number" ? raw.american : Number(raw?.american);
    const size = typeof raw?.size === "number" ? raw.size : parseFloat(raw?.size);
    if (!isFinite(american) || american === 0 || !isFinite(size) || size <= 0) continue;
    if (seen.has(american)) continue;
    seen.add(american);
    clean.push({ american, size });
  }
  clean.sort((a, b) => b.american - a.american);
  let rest = clean;
  if (topAmerican != null && isFinite(Number(topAmerican))) {
    rest = clean.filter((l) => l.american < Number(topAmerican));
  } else {
    rest = clean.slice(1);
  }
  return rest.slice(0, cap);
}

export function formatDepthTrail(levels, { topAmerican, max = 2 } = {}) {
  const rest = restLevelsFromLadder(levels, { topAmerican, max });
  if (!rest.length) return "";
  return rest
    .map((l) => {
      const dollars = formatAvailableDollars(l.size);
      return dollars ? `then ${formatAmericanOdds(l.american)} · ${dollars}` : null;
    })
    .filter(Boolean)
    .join(" · ");
}
