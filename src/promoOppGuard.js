// Promo true-odds sanity: reject inverted / wrong-side opponent quotes.
//
// 2-way ML true prob is 1 − implied(opponent Yes). If Kalshi (or any book)
// attaches the favorite's own Yes to the other team, that inverse becomes a
// huge underdog "true" (+2000-class vs a −20000 book) and EV collapses to ~−95%.
//
// A real +EV dog (book +150 vs fair −110) flips signs too — only absurd
// |edge| / same-sign heavy favorites are rejected.

export const ABSURD_TRUE_EDGE = 0.40;
export const DECISIVE_IMPLIED_DEV = 0.25; // ~−200 / +200

export function impliedFromAmerican(odds) {
  const n = Number(odds);
  if (!isFinite(n) || n === 0) return null;
  if (n < 0) return Math.abs(n) / (Math.abs(n) + 100);
  return 100 / (n + 100);
}

export function probToAmericanOdds(prob) {
  if (prob == null || !isFinite(prob) || prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob));
  return Math.round((100 * (1 - prob)) / prob);
}

function americanSign(odds) {
  const n = Number(odds);
  if (!isFinite(n) || n === 0) return 0;
  return n > 0 ? 1 : -1;
}

// Same-selection quotes: Fanatics Iowa −20000 vs Kalshi Iowa +2042.
export function quoteLooksWrongSideOf(reference, candidate) {
  const a = Number(reference);
  const b = Number(candidate);
  if (!isFinite(a) || a === 0 || !isFinite(b) || b === 0) return false;
  if (americanSign(a) === americanSign(b)) return false;
  const pa = impliedFromAmerican(a);
  const pb = impliedFromAmerican(b);
  if (pa == null || pb == null) return false;
  return Math.abs(pa - pb) >= ABSURD_TRUE_EDGE;
}

// Sign-agnostic implied gap. +8628 vs +110 is the same side but 46pts of p —
// the sign-only guard lets that rank as a free-bet BEST PICK.
export function quoteLooksAbsurdVsReference(reference, candidate, edge = ABSURD_TRUE_EDGE) {
  const pa = impliedFromAmerican(reference);
  const pb = impliedFromAmerican(candidate);
  if (pa == null || pb == null) return false;
  return Math.abs(pa - pb) >= edge;
}

// bookOdds = our sportsbook price; oppOdds = other-side Yes used as the inverse.
export function oppQuoteLooksInverted(bookOdds, oppOdds) {
  const book = Number(bookOdds);
  const opp = Number(oppOdds);
  if (!isFinite(book) || book === 0 || !isFinite(opp) || opp === 0) return false;

  const bookImp = impliedFromAmerican(book);
  const oppImp = impliedFromAmerican(opp);
  if (bookImp == null || oppImp == null) return false;
  const ourTrue = 1 - oppImp;
  const edge = ourTrue - bookImp;
  const trueAm = probToAmericanOdds(ourTrue);
  if (trueAm != null && americanSign(book) !== 0 && americanSign(trueAm) !== 0
    && americanSign(book) !== americanSign(trueAm)
    && Math.abs(edge) >= ABSURD_TRUE_EDGE) {
    return true;
  }
  // Heavy favorite whose "opponent" is also a favorite — not 2-way juice.
  if (americanSign(book) === americanSign(opp) && Math.abs(bookImp - 0.5) >= DECISIVE_IMPLIED_DEV) {
    return true;
  }
  return false;
}

function medianAmerican(prices) {
  const s = prices.filter((p) => isFinite(Number(p)) && Number(p) !== 0).map(Number)
    .sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function isExchangeBookKey(bookKey, allBooks) {
  const meta = (allBooks || []).find((b) => b.key === bookKey);
  return !!(meta && meta.exchange);
}

export function quoteConflictsWithSportsbookConsensus(price, sportsbookPrices) {
  const ref = medianAmerican(sportsbookPrices);
  if (ref == null) return false;
  return quoteLooksWrongSideOf(ref, price);
}

export function quoteMagnitudeConflictsWithSportsbookConsensus(price, sportsbookPrices, edge = DECISIVE_IMPLIED_DEV) {
  const ref = medianAmerican(sportsbookPrices);
  if (ref == null) return false;
  return quoteLooksAbsurdVsReference(ref, price, edge);
}

// Highest American among quotes that are not sign-flipped vs sportsbook consensus.
export function pickBestAmericanQuote(quotes, { allBooks } = {}) {
  const list = (quotes || []).filter((q) => q && isFinite(Number(q.price)) && Number(q.price) !== 0);
  if (!list.length) return { best: null, bestBook: null, bestSize: null };
  const sbPrices = list
    .filter((q) => !isExchangeBookKey(q.book, allBooks))
    .map((q) => q.price);
  const usable = list.filter((q) => !quoteConflictsWithSportsbookConsensus(q.price, sbPrices));
  const pool = usable.length ? usable : list;
  let best = null;
  for (const q of pool) {
    if (best == null || q.price > best.price) best = q;
  }
  return {
    best: best.price,
    bestBook: best.book,
    bestSize: best.size ?? null,
  };
}

export function resolveOppWithSideGuard({
  trustedOpp,
  trustedBook,
  trustedCount,
  trustedSize,
  sameBookOpp,
  sameBookKey,
  sameBookSize,
  bookOdds,
} = {}) {
  const trustedOk = trustedOpp != null && !oppQuoteLooksInverted(bookOdds, trustedOpp);
  if (trustedOk) {
    return {
      bestOpp: trustedOpp,
      bestOppBook: trustedBook,
      bestOppCount: trustedCount,
      bestOppSize: trustedSize ?? null,
      sameBookFallback: false,
    };
  }
  const sameOk = sameBookOpp != null && !oppQuoteLooksInverted(bookOdds, sameBookOpp);
  if (sameOk) {
    return {
      bestOpp: sameBookOpp,
      bestOppBook: sameBookKey,
      bestOppCount: 1,
      bestOppSize: sameBookSize ?? null,
      sameBookFallback: true,
    };
  }
  return {
    bestOpp: null,
    bestOppBook: trustedBook || sameBookKey || null,
    bestOppCount: trustedCount || 0,
    bestOppSize: trustedSize ?? null,
    sameBookFallback: false,
  };
}

export function pickHasInvertedOpp(legs) {
  return (legs || []).some((l) => l && oppQuoteLooksInverted(l.dk, l.bestOpp));
}

// After $500 blend overlay, drop inverted-opp parlays when a sane one exists,
// then rank by EV so a −95% overlay cannot stay ★ BEST PICK.
export function rankPicksAfterOppGuard(picks) {
  const list = picks || [];
  const sane = list.filter((p) => !pickHasInvertedOpp(p && p.legs));
  const pool = sane.length ? sane : list;
  return [...pool].sort((a, b) => (Number(b && b.ev) || 0) - (Number(a && a.ev) || 0));
}
