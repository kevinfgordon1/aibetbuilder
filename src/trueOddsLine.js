// Shared true-odds / best-opp book line: price + book + optional exchange size.
// Size is never invented — only `size` (direct Kalshi/Polymarket) or `bet_limit`
// (The Odds API includeBetLimits) when a finite positive number is present.

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

export function formatTrueOddsBookLine({ odds, bookLabel, size } = {}) {
  const book = bookLabel || "Book";
  return `${formatAmericanOdds(odds)} on ${book}${formatAvailableSizeClause(size)}`;
}
