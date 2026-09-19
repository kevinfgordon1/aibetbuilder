import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BOOKS, TRUSTED_BOOK_KEYS } from "../lib/promo-ev.js";
import { matchingBookList } from "./promoMatchingBooks.js";
import { bookKeyForMarket, isPmWinProbBook } from "./betstampNormalize.js";
import { transformOddsData } from "./oddsTransform.js";
import {
  joinOddsEventToBetstampFixture,
  bookmakerSnapshotUrl,
  marketIsBookmaker,
} from "./promoBookmaker.js";
import {
  UNDERDOG_PREDICT_BOOK_ID,
  UNDERDOG_PREDICT_BOOK_KEY,
  UNDERDOG_PREDICT_TITLE,
  marketIsUnderdogPredict,
  maybeOverlayUnderdogPredictOnCacheRows,
  overlayUnderdogPredictOnCacheRows,
  overlayUnderdogPredictOnGame,
  overlayUnderdogPredictOnGames,
  underdogPredictBookmakerFromSnapshot,
} from "./promoUnderdogPredict.js";
import { applyUnderdogPredictFee } from "./underdogPredictFee.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

function nflEvent(overrides = {}) {
  return {
    id: "odds-den-kc",
    sport_key: "americanfootball_nfl",
    sport: "americanfootball_nfl",
    commence_time: future,
    away_team: "Denver Broncos",
    home_team: "Kansas City Chiefs",
    bookmakers: [
      {
        key: "draftkings",
        markets: [
          { key: "h2h", outcomes: [{ name: "Denver Broncos", price: -110 }, { name: "Kansas City Chiefs", price: -110 }] },
        ],
      },
    ],
    ...overrides,
  };
}

function underdogSnapshot({ fixtureId = "fix-den-kc", commence = future, extraFixtures = [], extraMarkets = [] } = {}) {
  const den = { id: "team-den", name: "Denver Broncos", abbreviation: "DEN" };
  const kc = { id: "team-kc", name: "Kansas City Chiefs", abbreviation: "KC" };
  return {
    ok: true,
    fixtures: [
      {
        id: fixtureId,
        league: "NFL",
        start_date: commence,
        home_team_id: kc.id,
        away_team_id: den.id,
      },
      ...extraFixtures,
    ],
    teams: [den, kc],
    markets: [
      { odds: 2.00, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: fixtureId, team_id: den.id, size: 400 },
      { odds: 1.91, side: "KC", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: fixtureId, team_id: kc.id },
      { odds: 1.91, number: 2.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: fixtureId },
      { odds: 1.91, number: -2.5, side: "KC", side_type: "Home", bet_type: "Spread", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: fixtureId },
      { odds: 1.50, number: -7.5, side: "DEN", side_type: "Away", bet_type: "Spread", period: "FT", is_alt: true, odd_provider_id: 196, fixture_id: fixtureId },
      { odds: 2.00, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 642, fixture_id: fixtureId, team_id: den.id },
      ...extraMarkets,
    ],
  };
}

{
  assert.equal(UNDERDOG_PREDICT_BOOK_ID, 196);
  assert.equal(UNDERDOG_PREDICT_BOOK_KEY, "underdog_predict");
  assert.equal(UNDERDOG_PREDICT_TITLE, "Underdog Predict");
  assert.equal(TRUSTED_BOOK_KEYS.has("underdog_predict"), true);
  assert.equal(ALL_BOOKS.find((b) => b.key === "underdog_predict")?.label, "Underdog Predict");
  assert.equal(ALL_BOOKS.find((b) => b.key === "underdog_predict")?.exchange, true);
  assert.equal(isPmWinProbBook("underdog_predict"), true);
  assert.equal(matchingBookList(ALL_BOOKS, TRUSTED_BOOK_KEYS).some((b) => b.key === "underdog_predict"), true);
}

{
  assert.equal(marketIsUnderdogPredict({ odd_provider_id: 196 }), true);
  assert.equal(marketIsUnderdogPredict({ odd_provider_id: 642 }), false);
  assert.equal(marketIsBookmaker({ odd_provider_id: 196 }), false);
  assert.equal(bookKeyForMarket({ odd_provider_id: 196 }), "underdog_predict");
}

{
  const url = bookmakerSnapshotUrl({ leagues: ["NFL"] });
  assert.match(url, /book_ids=642/);
  assert.match(url, /196/);
  const publicUrl = bookmakerSnapshotUrl({ leagues: ["NFL"], includeUnderdog: false });
  assert.match(publicUrl, /book_ids=642/);
  assert.doesNotMatch(publicUrl, /196/);
}

{
  const event = nflEvent();
  const snap = underdogSnapshot();
  const join196 = joinOddsEventToBetstampFixture(event, snap, { bookId: 196 });
  const join642 = joinOddsEventToBetstampFixture(event, snap);
  assert.equal(join196.fixtureId, "fix-den-kc");
  assert.equal(join642.fixtureId, "fix-den-kc");
}

{
  const event = nflEvent();
  const snap642Only = {
    ...underdogSnapshot(),
    markets: underdogSnapshot().markets.filter((m) => m.odd_provider_id === 642),
  };
  assert.equal(joinOddsEventToBetstampFixture(event, snap642Only, { bookId: 196 }), null);
  assert.equal(underdogPredictBookmakerFromSnapshot(event, snap642Only), null);
}

{
  const event = nflEvent();
  const bm = underdogPredictBookmakerFromSnapshot(event, underdogSnapshot());
  assert.equal(bm.key, "underdog_predict");
  assert.equal(bm.title, "Underdog Predict");
  const h2h = bm.markets.find((m) => m.key === "h2h");
  const den = h2h.outcomes.find((o) => o.name === "Denver Broncos");
  const kc = h2h.outcomes.find((o) => o.name === "Kansas City Chiefs");
  assert.equal(den.price, applyUnderdogPredictFee(100));
  assert.equal(kc.price, applyUnderdogPredictFee(-110));
  assert.equal(den.size, 400);
  assert.notEqual(den.price, 100, "Promo true odds must apply the UDX exchange fee");
  assert.equal(den.price, -107, "Promo overlay uses the 0.072 UDX curve, not flat $0.02 (−108)");
  assert.ok(!bm.markets.some((m) => m.outcomes.some((o) => o.price === 100 && o.name === "Denver Broncos")));
}

{
  const overlaid = overlayUnderdogPredictOnGame(nflEvent(), underdogSnapshot());
  assert.equal(overlaid.bookmakers.some((b) => b.key === "draftkings"), true);
  assert.equal(overlaid.bookmakers.filter((b) => b.key === "underdog_predict").length, 1);
  assert.equal(overlaid.bookmakers.some((b) => b.key === "bookmaker"), false);
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.equal(ml.bookOdds.underdog_predict.ml_away, applyUnderdogPredictFee(100));
  assert.equal(ml.bookOdds.underdog_predict.ml_home, applyUnderdogPredictFee(-110));
  assert.equal(ml.best_away_book, "underdog_predict");
}

{
  const far = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(underdogPredictBookmakerFromSnapshot(nflEvent(), underdogSnapshot({ commence: far })), null);
}

{
  const jayhawks = {
    id: "odds-ku-ksu",
    sport_key: "americanfootball_ncaaf",
    commence_time: future,
    away_team: "Kansas Jayhawks",
    home_team: "Kansas State Wildcats",
    bookmakers: [],
  };
  const ksuOnly = {
    ok: true,
    fixtures: [{
      id: "fix-ksu-iowa",
      league: "NCAAF",
      start_date: future,
      home_team_id: "iowa",
      away_team_id: "ksu",
    }],
    teams: [
      { id: "ksu", name: "Kansas State Wildcats", abbreviation: "KSU" },
      { id: "iowa", name: "Iowa Hawkeyes", abbreviation: "IOWA" },
    ],
    markets: [
      { odds: 1.53, side: "KSU", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-ksu-iowa", team_id: "ksu" },
    ],
  };
  assert.equal(underdogPredictBookmakerFromSnapshot(jayhawks, ksuOnly), null);
  assert.equal(overlayUnderdogPredictOnGame(jayhawks, ksuOnly).bookmakers.some((b) => b.key === "underdog_predict"), false);
}

{
  const event = nflEvent({
    bookmakers: [
      {
        key: "draftkings",
        markets: [{ key: "h2h", outcomes: [{ name: "Denver Broncos", price: -150 }, { name: "Kansas City Chiefs", price: 130 }] }],
      },
      {
        key: "fanduel",
        markets: [{ key: "h2h", outcomes: [{ name: "Denver Broncos", price: -145 }, { name: "Kansas City Chiefs", price: 125 }] }],
      },
    ],
  });
  const inverted = {
    ...underdogSnapshot(),
    markets: [
      { odds: 2.63, side: "DEN", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-den-kc", team_id: "team-den" },
      { odds: 1.50, side: "KC", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-den-kc", team_id: "team-kc" },
    ],
  };
  // Consensus Denver is a favorite; attaching Underdog +163 on Denver is inverted.
  const flipped = overlayUnderdogPredictOnGame(event, inverted);
  assert.equal(flipped.bookmakers.some((b) => b.key === "underdog_predict"), false);
}

{
  const rows = overlayUnderdogPredictOnCacheRows([
    { sport: "americanfootball_nfl", data: [nflEvent()] },
    { sport: "baseball_mlb", data: [{ id: "mlb", sport_key: "baseball_mlb", commence_time: future, away_team: "Yankees", home_team: "Red Sox", bookmakers: [] }] },
  ], underdogSnapshot());
  assert.equal(rows[0].data[0].bookmakers.some((b) => b.key === "underdog_predict"), true);
  assert.equal(rows[1].data[0].bookmakers.some((b) => b.key === "underdog_predict"), false);
  assert.equal(overlayUnderdogPredictOnGames(null, underdogSnapshot()), null);
}

{
  const kevin = { email: "Kev120909@gmail.com", id: "supabase-kevin" };
  const stranger = { email: "stranger@gmail.com", id: "u2" };
  const seeded = [{
    sport: "americanfootball_nfl",
    data: [nflEvent({
      bookmakers: [
        ...nflEvent().bookmakers,
        { key: "underdog_predict", title: "Underdog Predict", markets: [] },
      ],
    })],
  }];
  const allowed = maybeOverlayUnderdogPredictOnCacheRows(seeded, underdogSnapshot(), kevin);
  const denied = maybeOverlayUnderdogPredictOnCacheRows(seeded, underdogSnapshot(), stranger);
  const loggedOut = maybeOverlayUnderdogPredictOnCacheRows(seeded, underdogSnapshot(), null);
  assert.equal(allowed[0].data[0].bookmakers.some((b) => b.key === "underdog_predict"), true);
  assert.equal(denied[0].data[0].bookmakers.some((b) => b.key === "underdog_predict"), false);
  assert.equal(loggedOut[0].data[0].bookmakers.some((b) => b.key === "underdog_predict"), false);
  assert.equal(denied[0].data[0].bookmakers.some((b) => b.key === "draftkings"), true);
}

{
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  const ev = fs.readFileSync(path.join(dir, "../lib/promo-ev.js"), "utf8");
  assert.match(app, /maybeOverlayUnderdogPredictOnCacheRows/);
  assert.match(app, /from "\.\/promoUnderdogPredict\.js"/);
  assert.match(app, /canSeeUnderdogPredict\(user\)/);
  assert.match(app, /includeUnderdog/);
  assert.match(app, /key: "underdog_predict", label: "Underdog Predict"/);
  assert.match(app, /after UDX exchange fee/);
  assert.doesNotMatch(app, /after \$0\.02\/contract fee/);
  assert.doesNotMatch(app, /label: "Fanatics Markets"/);
  assert.ok(app.includes("underdog_predict"));
  assert.ok(ev.includes("underdog_predict"));
  const appTrusted = app.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(appTrusted[1].includes("underdog_predict"));
}

console.log("promoUnderdogPredict.test.js ok");
