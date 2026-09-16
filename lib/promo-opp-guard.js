// CJS copy of src/promoOppGuard.js for the EV-scanner / promo-ev pipeline.
// Keep behavior pinned by src/promoOppGuard.test.js + lib/promo-ev.test.js.

const ABSURD_TRUE_EDGE = 0.40;
const DECISIVE_IMPLIED_DEV = 0.25;

function impliedFromAmerican(odds) {
  const n = Number(odds);
  if (!isFinite(n) || n === 0) return null;
  if (n < 0) return Math.abs(n) / (Math.abs(n) + 100);
  return 100 / (n + 100);
}

function probToAmericanOdds(prob) {
  if (prob == null || !isFinite(prob) || prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) return Math.round((-100 * prob) / (1 - prob));
  return Math.round((100 * (1 - prob)) / prob);
}

function americanSign(odds) {
  const n = Number(odds);
  if (!isFinite(n) || n === 0) return 0;
  return n > 0 ? 1 : -1;
}

function quoteLooksWrongSideOf(reference, candidate) {
  const a = Number(reference);
  const b = Number(candidate);
  if (!isFinite(a) || a === 0 || !isFinite(b) || b === 0) return false;
  if (americanSign(a) === americanSign(b)) return false;
  const pa = impliedFromAmerican(a);
  const pb = impliedFromAmerican(b);
  if (pa == null || pb == null) return false;
  return Math.abs(pa - pb) >= ABSURD_TRUE_EDGE;
}

function oppQuoteLooksInverted(bookOdds, oppOdds) {
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

function isExchangeBookKey(bookKey, allBooks) {
  const meta = (allBooks || []).find((b) => b.key === bookKey);
  return !!(meta && meta.exchange);
}

function quoteConflictsWithSportsbookConsensus(price, sportsbookPrices) {
  const ref = medianAmerican(sportsbookPrices);
  if (ref == null) return false;
  return quoteLooksWrongSideOf(ref, price);
}

function pickBestAmericanQuote(quotes, { allBooks } = {}) {
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

function resolveOppWithSideGuard({
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

function pickHasInvertedOpp(legs) {
  return (legs || []).some((l) => l && oppQuoteLooksInverted(l.dk, l.bestOpp));
}

function rankPicksAfterOppGuard(picks) {
  const list = picks || [];
  const sane = list.filter((p) => !pickHasInvertedOpp(p && p.legs));
  const pool = sane.length ? sane : list;
  return [...pool].sort((a, b) => (Number(b && b.ev) || 0) - (Number(a && a.ev) || 0));
}

module.exports = {
  ABSURD_TRUE_EDGE,
  DECISIVE_IMPLIED_DEV,
  impliedFromAmerican,
  probToAmericanOdds,
  quoteLooksWrongSideOf,
  oppQuoteLooksInverted,
  isExchangeBookKey,
  quoteConflictsWithSportsbookConsensus,
  pickBestAmericanQuote,
  resolveOppWithSideGuard,
  pickHasInvertedOpp,
  rankPicksAfterOppGuard,
};
