// Soccer 3-way moneyline ↔ prediction-market Yes/No pairing.
// Soft-book / PM "Home wins" pairs with the same binary's No — never Away Yes.
// 2-way sports (NFL/MLB/…) keep other-team Yes as the inverse.

export const SOCCER_SPORT_KEYS = ["soccer_epl", "soccer_usa_mls"];
// League labels for game badges / cache rows. Filter chips collapse these to Soccer.
export const SOCCER_SPORTS = [
  { key: "soccer_epl", label: "EPL" },
  { key: "soccer_usa_mls", label: "MLS" },
];
export const SOCCER_ML_SIDES = ["away", "draw", "home"];
export const DRAW_OUTCOME_NAMES = ["Draw", "Tie"];

const DRAW_LOOKUP = new Set(DRAW_OUTCOME_NAMES.map((n) => n.toLowerCase()));

export function isSoccerSport(sportKey) {
  return SOCCER_SPORT_KEYS.includes(String(sportKey || ""));
}

// If any soccer league key is present, include both Odds API keys (featured fetch / filter).
export function expandSoccerSportKeys(selected) {
  const set = selected instanceof Set ? new Set(selected) : new Set(selected || []);
  if (SOCCER_SPORT_KEYS.some((k) => set.has(k))) {
    for (const k of SOCCER_SPORT_KEYS) set.add(k);
  }
  return set;
}

export function isDrawOutcomeName(name) {
  return DRAW_LOOKUP.has(String(name || "").trim().toLowerCase());
}

export function soccerSideTeam(side, away, home) {
  if (side === "away") return away;
  if (side === "home") return home;
  return "Draw";
}

export function soccerYesName(side, away, home) {
  if (side === "draw") return "Draw";
  return `${soccerSideTeam(side, away, home)} ML`;
}

export function soccerNoName(side, away, home) {
  if (side === "draw") return "Draw No";
  return `${soccerSideTeam(side, away, home)} ML No`;
}

// Odds API h2h_lay uses the same outcome name as h2h Yes (team or Draw).
export function soccerLayOutcomeName(side, away, home) {
  return soccerSideTeam(side, away, home);
}

// PM venues that may later quote a true soccer No (h2h_lay or a separate binary).
// Preferred over exchange lays when they actually post No — Kalshi today is Yes-only.
export const SOCCER_PM_NO_BOOK_KEYS = new Set([
  "kalshi", "polymarket", "novig", "prophetx", "betopenly",
]);

// Odds API books that currently supply soccer h2h_lay. Not added to TRUSTED_BOOK_KEYS —
// used only for same-binary No, never as a Yes inverse.
export const SOCCER_EXCHANGE_LAY_BOOK_KEYS = new Set([
  "betfair_ex_eu", "matchbook",
]);

export const SOCCER_LAY_BOOK_LABELS = {
  betfair_ex_eu: "Betfair",
  matchbook: "Matchbook",
};

export const SOCCER_ML_EMPTY_HINT =
  "Soccer moneylines need a matching No on the same team (Betfair, Matchbook, or a prediction-market No). The other team's Yes is never used as the hedge.";

export function isSoccerPmNoBook(bookKey) {
  return SOCCER_PM_NO_BOOK_KEYS.has(String(bookKey || ""));
}

export function isSoccerExchangeLayBook(bookKey) {
  return SOCCER_EXCHANGE_LAY_BOOK_KEYS.has(String(bookKey || ""));
}

export function soccerLayBookLabel(bookKey) {
  return SOCCER_LAY_BOOK_LABELS[bookKey] || null;
}

// Exchange h2h_lay is the lay PRICE (backer's American). The layer's No is the inverse:
// lay +138 → No −138. PM h2h_lay, when present, is already a No contract price.
export function invertAmericanOdds(american) {
  const n = typeof american === "number" ? american : Number(american);
  if (!isFinite(n) || n === 0) return null;
  return n > 0 ? -n : Math.abs(n);
}

export function soccerLayPriceToNo(bookKey, layAmerican) {
  if (layAmerican == null) return null;
  if (isSoccerPmNoBook(bookKey)) return layAmerican;
  return invertAmericanOdds(layAmerican);
}

export function pickBestSoccerLay(quotes) {
  const list = (quotes || []).filter((q) => q && q.price != null);
  if (!list.length) {
    return { best: null, bestBook: null, bestSize: null, count: 0 };
  }
  const pm = list.filter((q) => isSoccerPmNoBook(q.book));
  const pool = pm.length ? pm : list;
  let best = pool[0];
  for (const q of pool) {
    if (q.price > best.price) best = q;
  }
  return {
    best: best.price,
    bestBook: best.book,
    bestSize: best.size ?? null,
    count: list.length,
  };
}

// Any bookmaker quoting h2h_lay is eligible. PM books honor the matching-books
// subset when provided; exchange / other lay books are soccer-No-only.
export function bestSoccerBinaryNo(bookmakers, teamName, { sizeOf, trustedBookKeys } = {}) {
  const quotes = [];
  for (const book of bookmakers || []) {
    const market = (book.markets || []).find((m) => m.key === "h2h_lay");
    if (!market) continue;
    if (isSoccerPmNoBook(book.key) && trustedBookKeys && !trustedBookKeys.has(book.key)) continue;
    const outcome = (market.outcomes || []).find((o) => outcomeMatchesName(o.name, teamName));
    if (!outcome || outcome.price == null) continue;
    const noPrice = soccerLayPriceToNo(book.key, outcome.price);
    if (noPrice == null) continue;
    quotes.push({
      book: book.key,
      price: noPrice,
      size: typeof sizeOf === "function" ? sizeOf(outcome) : null,
    });
  }
  return pickBestSoccerLay(quotes);
}

export function soccerPromoEmptyDetail({ soccerSelected, soccerMlLegCount } = {}) {
  if (!soccerSelected) return null;
  if ((soccerMlLegCount || 0) > 0) return null;
  return SOCCER_ML_EMPTY_HINT;
}

export function outcomeMatchesName(outcomeName, wantedName) {
  if (isDrawOutcomeName(wantedName)) return isDrawOutcomeName(outcomeName);
  return String(outcomeName || "") === String(wantedName || "");
}

// Kevin's soccer-only rule: prefer same-binary No. Do not fall back to the
// other team's Yes (that inverse is only valid for 2-way sports).
export function preferSoccerBinaryNo(sameBinaryNo, _otherTeamYes) {
  if (sameBinaryNo && sameBinaryNo.best != null) {
    return { ...sameBinaryNo, kind: "same_binary_no" };
  }
  return { best: null, bestBook: null, bestSize: null, count: 0, kind: "none" };
}

export function soccerMlOppResolveArgs(game, side, bookKey) {
  const book = (game && game.bookOdds && game.bookOdds[bookKey]) || {};
  return {
    trustedOpp: game[`best_${side}_no`] ?? null,
    trustedBook: game[`best_${side}_no_book`] ?? null,
    trustedCount: game[`ml_opp_count_${side}`] ?? 0,
    trustedSize: game[`best_${side}_no_size`] ?? null,
    sameBookOpp: book[`ml_${side}_no`] ?? null,
    sameBookKey: bookKey,
    sameBookSize: book[`ml_${side}_no_size`] ?? null,
  };
}
