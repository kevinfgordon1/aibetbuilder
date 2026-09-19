// Overlay Betstamp Underdog Predict (book id 196) mains onto Odds API Promo events.
// Join is the same unique-pair / commence-window / "fixture must already have a
// 196 row" guard as Bookmaker 642 — do not invent a second matcher.
// Odds API games stay the row identity. A Betstamp blip omits Underdog cells.
//
// New Odds Board shows raw Betstamp American + win% (same as Kalshi / Poly /
// ProphetX columns). Promo true odds apply the $0.02/contract face fee here
// because Underdog is not on The Odds API applyBookAdjustments path.

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
} from "./promoBookmaker.js";
import { applyUnderdogPredictFee } from "./underdogPredictFee.js";
import { canSeeUnderdogPredict } from "./comboAccess.js";

export { UNDERDOG_PREDICT_BOOK_ID, UNDERDOG_PREDICT_BOOK_KEY };
export const UNDERDOG_PREDICT_TITLE = "Underdog Predict";

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
    const raw = toAmericanOdds(market.odds);
    if (raw == null) continue;
    const price = applyUnderdogPredictFee(raw);
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
  if (bm && betstampOverlayConflictsWithEventBooks(stripped, bm, UNDERDOG_PREDICT_BOOK_KEY)) bm = null;
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
