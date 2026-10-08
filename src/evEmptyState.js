// Plain-English empty state for the +EV Bets list. When the date window is
// short (Today / Next 24h), offer a one-tap jump to the next 7 days instead
// of a dead "No bets" line. With a single-book filter on a wide window,
// offer "Show all books" instead.

const WINDOW_PHRASE = {
  today: "for the rest of today",
  "24h": "in the next 24 hours",
  "7d": "in the next 7 days",
};

export function evEmptyState({ dateRange, bookFilter = "all", bookLabel = "" } = {}) {
  const phrase = WINDOW_PHRASE[dateRange] || "";
  const single = bookFilter && bookFilter !== "all";
  const who = single ? `${bookLabel || "this sportsbook"} bets` : "bets";
  const message = phrase
    ? `No ${who} ${phrase} right now.`
    : `No ${who} right now.`;
  if (dateRange === "today" || dateRange === "24h") {
    return {
      message,
      hint: "Games later this week already have odds.",
      action: { label: "See the next 7 days", dateRange: "7d" },
    };
  }
  if (single) {
    return {
      message,
      hint: "Other sportsbooks may have bets in this window.",
      action: { label: "Show all books", bookFilter: "all" },
    };
  }
  return {
    message,
    hint: "Odds refresh every 5 minutes. Check back soon.",
    action: null,
  };
}
