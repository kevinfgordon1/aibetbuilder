// Overlay Betstamp Underdog Predict (book id 196) mains onto Odds API Promo events.
// Join is the same unique-pair / commence-window / "fixture must already have a
// 196 row" guard as Bookmaker 642 — do not invent a second matcher.
// Odds API games stay the row identity. A Betstamp blip omits Underdog cells.
//
// New Odds Board shows raw Betstamp American + win% (same as Kalshi / Poly /
// ProphetX columns). Promo true odds apply the UDX fee curve here
// (rate × p × (1−p), added to cost) because Underdog is not on The Odds API
// applyBookAdjustments path.
//
// Betstamp 196 decimals include real cupcake longshots (~87–93.5 → +8600–
// +9250). Those are not a convert bug. Promo still drops inverted tiny-p
// (<5%) and rejects a 2-way whose implieds do not sum to ~1 or any side
// ≥25pts of p off sportsbook consensus, so a 93.5 dog cannot attach −107
// (UDX fee on +100) as the same-selection true. Sign-only Bookmaker 642
// guards stay unchanged. Kevin-only canSeeUnderdogPredict is unchanged.

import {
  asList,
  isMainMarket,
  marketIsOffered,
  marketLine,
  marketSize,
  normalizeBetType,
  toAmericanOdds,
} from "./betstampNormalize.js";
import {
  UNDERDOG_PREDICT_BOOK_ID,
  UNDERDOG_PREDICT_BOOK_KEY,
} from "./betstampBooks.js";
import {
  betstampOverlayConflictsWithEventBooks,
  joinOddsEventToBetstampFixture,
  marketHasBookId,
  oddsApiOutcomeName,
  teamsLikelySame,
} from "./promoBookmaker.js";
import { applyUnderdogPredictFee } from "./underdogPredictFee.js";
import { canSeeUnderdogPredict } from "./comboAccess.js";
import {
  DECISIVE_IMPLIED_DEV,
  impliedFromAmerican,
  quoteLooksAbsurdVsReference,
} from "./promoOppGuard.js";

export { UNDERDOG_PREDICT_BOOK_ID, UNDERDOG_PREDICT_BOOK_KEY };
export const UNDERDOG_PREDICT_TITLE = "Underdog Predict";

// Tiny p in (0, 0.05) is inverted 1/p, not a Betstamp decimal. Real
// longshots arrive as 87–93.5 decimal and convert via (d−1)×100.
export const UNDERDOG_TINY_PROB = 0.05;
export const UNDERDOG_ABSURD_ABS_AMERICAN = 2500;
export const UNDERDOG_TWO_WAY_SUM_MIN = 0.80;
export const UNDERDOG_TWO_WAY_SUM_MAX = 1.22;

export function betstampOddsLooksLikeInvertedLongshot(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return false;
  if (n > 0 && n < UNDERDOG_TINY_PROB) return true;
  return false;
}

export function underdogAmericanLooksImplausible(price) {
  const n = Number(price);
  return Number.isFinite(n) && n !== 0 && Math.abs(n) >= UNDERDOG_ABSURD_ABS_AMERICAN;
}

// Betstamp 196 decimal → American, then UDX fee. 1.12 → −833, 2.87 → +187,
// 93.5 → +9250-class (real longshot). Never 1/p of a tiny contract. Extreme
// Americans still overlay; Promo ranking drops them unless they match true.
export function toUnderdogPredictAmerican(odds) {
  if (betstampOddsLooksLikeInvertedLongshot(odds)) return null;
  const raw = toAmericanOdds(odds);
  if (raw == null) return null;
  const price = applyUnderdogPredictFee(raw);
  if (price == null || !Number.isFinite(Number(price)) || Number(price) === 0) return null;
  return price;
}

function medianAmerican(prices) {
  const s = (prices || []).map(Number).filter((n) => Number.isFinite(n) && n !== 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function h2hOutcomeOnBook(book, teamName) {
  const market = (book?.markets || []).find((m) => m && m.key === "h2h");
  if (!market) return null;
  return (market.outcomes || []).find((o) => o && teamsLikelySame(o.name, teamName)) || null;
}

export function underdogTwoWayLooksIncoherent(bm) {
  const h2h = (bm?.markets || []).find((m) => m && m.key === "h2h");
  const prices = (h2h?.outcomes || []).map((o) => o && o.price).filter((n) => Number.isFinite(Number(n)) && Number(n) !== 0);
  if (prices.length < 2) return false;
  const sum = prices.reduce((acc, n) => acc + (impliedFromAmerican(n) || 0), 0);
  return sum < UNDERDOG_TWO_WAY_SUM_MIN || sum > UNDERDOG_TWO_WAY_SUM_MAX;
}

export function underdogMagnitudeConflictsWithEventBooks(event, bm) {
  const h2h = (bm?.markets || []).find((m) => m && m.key === "h2h");
  if (!h2h) return false;
  const others = (event?.bookmakers || []).filter((b) => b && b.key !== UNDERDOG_PREDICT_BOOK_KEY);
  if (!others.length) return false;
  for (const outcome of h2h.outcomes || []) {
    if (!outcome || outcome.price == null || !outcome.name) continue;
    const consensus = [];
    for (const book of others) {
      const hit = h2hOutcomeOnBook(book, outcome.name);
      if (hit && hit.price != null) consensus.push(hit.price);
    }
    if (!consensus.length) continue;
    const med = medianAmerican(consensus);
    if (med != null && quoteLooksAbsurdVsReference(med, outcome.price, DECISIVE_IMPLIED_DEV)) return true;
  }
  return false;
}

export function underdogPredictConflictsWithEventBooks(event, bm) {
  if (betstampOverlayConflictsWithEventBooks(event, bm, UNDERDOG_PREDICT_BOOK_KEY)) return true;
  if (underdogTwoWayLooksIncoherent(bm)) return true;
  if (underdogMagnitudeConflictsWithEventBooks(event, bm)) return true;
  return false;
}

function pushOutcome(list, outcome) {
  if (!outcome || !outcome.name || outcome.price == null) return;
  const pointKey = outcome.point == null ? "" : String(outcome.point);
  const key = `${outcome.name}\0${pointKey}`;
  const idx = list.findIndex((o) => `${o.name}\0${o.point == null ? "" : String(o.point)}` === key);
  if (idx >= 0) list[idx] = outcome;
  else list.push(outcome);
}

function outcomePayload(name, price, size, point) {
  const out = { name, price };
  if (size != null) out.size = size;
  if (point != null) out.point = point;
  return out;
}

export function marketIsUnderdogPredict(market) {
  return marketHasBookId(market, UNDERDOG_PREDICT_BOOK_ID);
}

export function underdogPredictBookmakerFromSnapshot(event, snapshot, joinHit) {
  const join = joinHit || joinOddsEventToBetstampFixture(event, snapshot, {
    bookId: UNDERDOG_PREDICT_BOOK_ID,
  });
  if (!join) return null;
  const h2h = [];
  const spreads = [];
  const totals = [];

  for (const market of asList(snapshot.markets, ["markets", "data"])) {
    if (market == null || String(market.fixture_id) !== join.fixtureId) continue;
    if (!marketIsUnderdogPredict(market)) continue;
    if (!isMainMarket(market) || !marketIsOffered(market)) continue;
    const price = toUnderdogPredictAmerican(market.odds);
    if (price == null) continue;
    const name = oddsApiOutcomeName(market, event, join);
    if (!name) continue;
    const size = marketSize(market);
    const line = marketLine(market);
    const bt = normalizeBetType(market.bet_type);
    if (bt === "moneyline") {
      pushOutcome(h2h, outcomePayload(name, price, size));
    } else if (bt === "spread" && line != null) {
      pushOutcome(spreads, outcomePayload(name, price, size, line));
    } else if (bt === "total" && line != null) {
      pushOutcome(totals, outcomePayload(name, price, size, line));
    }
  }

  const markets = [];
  if (h2h.length) markets.push({ key: "h2h", outcomes: h2h });
  if (spreads.length) markets.push({ key: "spreads", outcomes: spreads });
  if (totals.length) markets.push({ key: "totals", outcomes: totals });
  if (!markets.length) return null;
  return { key: UNDERDOG_PREDICT_BOOK_KEY, title: UNDERDOG_PREDICT_TITLE, markets };
}

export function overlayUnderdogPredictOnGame(game, snapshot) {
  if (!game || typeof game !== "object") return game;
  const bookmakers = (game.bookmakers || []).filter((b) => b && b.key !== UNDERDOG_PREDICT_BOOK_KEY);
  const stripped = { ...game, bookmakers };
  let bm = snapshot ? underdogPredictBookmakerFromSnapshot(stripped, snapshot) : null;
  if (bm && underdogPredictConflictsWithEventBooks(stripped, bm)) bm = null;
  return { ...stripped, bookmakers: bm ? [...bookmakers, bm] : bookmakers };
}

export function overlayUnderdogPredictOnGames(games, snapshot) {
  if (!Array.isArray(games)) return games;
  return games.map((game) => overlayUnderdogPredictOnGame(game, snapshot));
}

export function overlayUnderdogPredictOnCacheRows(rows, snapshot) {
  return (rows || []).map((row) => {
    if (!row) return row;
    if (Array.isArray(row.data)) {
      return { ...row, data: overlayUnderdogPredictOnGames(row.data, snapshot) };
    }
    if (row.data && typeof row.data === "object") {
      return { ...row, data: overlayUnderdogPredictOnGame(row.data, snapshot) };
    }
    return row;
  });
}

/** Overlay when allowlisted; otherwise strip any leftover underdog_predict cells. */
export function maybeOverlayUnderdogPredictOnCacheRows(rows, snapshot, user, env) {
  return overlayUnderdogPredictOnCacheRows(
    rows,
    canSeeUnderdogPredict(user, env) ? snapshot : null,
  );
}
