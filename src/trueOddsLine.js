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

export function formatAmericanOdds(odds) {
  if (!odds) return "—";
  return odds > 0 ? `+${odds}` : `${odds}`;
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
