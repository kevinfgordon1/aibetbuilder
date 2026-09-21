import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ALL_BOOKS, TRUSTED_BOOK_KEYS } from "../lib/promo-ev.js";
import { matchingBookList } from "./promoMatchingBooks.js";
import { bookKeyForMarket, isPmWinProbBook, toAmericanOdds } from "./betstampNormalize.js";
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
  betstampOddsLooksLikeInvertedLongshot,
  marketIsUnderdogPredict,
  maybeOverlayUnderdogPredictOnCacheRows,
  overlayUnderdogPredictOnCacheRows,
  overlayUnderdogPredictOnGame,
  overlayUnderdogPredictOnGames,
  toUnderdogPredictAmerican,
  underdogPredictBookmakerFromSnapshot,
  underdogPredictConflictsWithEventBooks,
  underdogTwoWayLooksIncoherent,
} from "./promoUnderdogPredict.js";
import { applyUnderdogPredictFee } from "./underdogPredictFee.js";
import { calcFreeBetParlayEV } from "./promoFreeBet.js";
import {
  oppQuoteLooksInverted,
  pickBestAmericanQuote,
  trueAmericanFromOpp,
} from "./promoOppGuard.js";

const require = createRequire(import.meta.url);
const { buildAllLegsForBook, calcParlayEV } = require("../lib/promo-ev.js");

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
  assert.equal(den.price, 100);
  assert.equal(kc.price, -110);
  assert.equal(den.size, 400);
  assert.notEqual(den.price, applyUnderdogPredictFee(100), "Promo must not apply the UDX cost-add");
  assert.notEqual(den.price, -107, "Promo sticker is +100, not fee-true −107");
  assert.notEqual(den.price, -108, "flat $0.02/contract haircut stays gone");
}

{
  const overlaid = overlayUnderdogPredictOnGame(nflEvent(), underdogSnapshot());
  assert.equal(overlaid.bookmakers.some((b) => b.key === "draftkings"), true);
  assert.equal(overlaid.bookmakers.filter((b) => b.key === "underdog_predict").length, 1);
  assert.equal(overlaid.bookmakers.some((b) => b.key === "bookmaker"), false);
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.equal(ml.bookOdds.underdog_predict.ml_away, 100);
  assert.equal(ml.bookOdds.underdog_predict.ml_home, -110);
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
  assert.doesNotMatch(app, /after UDX exchange fee/);
  assert.match(app, /underdogCash: true/);
  assert.doesNotMatch(app, /underdogCash: promoType !== "freebet"/);
  assert.equal((app.match(/predictionOnly: true/g) || []).length, 2, "Promo overlay accepts prediction-only phone lines; Odds Board does not");
  assert.match(app, /stampUnderdogPredictionLegs/);
  assert.match(ev, /applyUnderdogCashLegPrices/);
  assert.match(ev, /stampUnderdogPredictionLegs/);
  const worker = fs.readFileSync(path.join(dir, "../lib/ev-parlay-alert.js"), "utf8");
  assert.match(worker, /underdogCash: true/);
  assert.doesNotMatch(app, /after \$0\.02\/contract fee/);
  assert.doesNotMatch(app, /label: "Fanatics Markets"/);
  assert.ok(app.includes("underdog_predict"));
  assert.ok(ev.includes("underdog_predict"));
  const appTrusted = app.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(appTrusted[1].includes("underdog_predict"));
}

{
  // Decimal favorites use −100/(d−1), never (d−1)×100 and never 1/tiny-p.
  assert.equal(toAmericanOdds(1.12), -833);
  assert.equal(toAmericanOdds(2.87), 187);
  assert.equal(toAmericanOdds(93.5), 9250, "live Betstamp 196 longshot is a real decimal");
  assert.notEqual(toAmericanOdds(1.12), 8628);
  assert.equal(betstampOddsLooksLikeInvertedLongshot(0.01146), true, "tiny p is inverted 1/p, not a decimal");
  assert.equal(betstampOddsLooksLikeInvertedLongshot(87.28), false, "87–93.5 is a real Betstamp decimal longshot");
  assert.equal(betstampOddsLooksLikeInvertedLongshot(93.5), false);
  assert.equal(betstampOddsLooksLikeInvertedLongshot(1.12), false);
  assert.equal(betstampOddsLooksLikeInvertedLongshot(2.87), false);
  assert.equal(toUnderdogPredictAmerican(0.01146), null);
  assert.equal(toUnderdogPredictAmerican(1.12), -833);
  assert.equal(toUnderdogPredictAmerican(2.87), 187);
  assert.equal(toUnderdogPredictAmerican(93.5), 9250);
  assert.equal(toUnderdogPredictAmerican(1.05), -2000);
  assert.equal(toUnderdogPredictAmerican(1.01), -10000);
  assert.equal(toUnderdogPredictAmerican(1.02), -5000);
  assert.ok(toUnderdogPredictAmerican(1.12) < 0, "1.12 stays a favorite");
  assert.ok(toUnderdogPredictAmerican(1.12) > -1200 && toUnderdogPredictAmerican(1.12) < -700);
  assert.ok(toUnderdogPredictAmerican(2.87) > 150 && toUnderdogPredictAmerican(2.87) < 200);
  assert.ok(toUnderdogPredictAmerican(93.5) > 7000, "93.5 stays a longshot");
  assert.notEqual(toUnderdogPredictAmerican(93.5), -107);
  assert.notEqual(toUnderdogPredictAmerican(1.05), -107);
  assert.ok(toUnderdogPredictAmerican(1.05) < 0, "1.05 stays a favorite");
  assert.notEqual(toUnderdogPredictAmerican(1.12), applyUnderdogPredictFee(-833), "Promo does not UDX-haircut 1.12");
  assert.notEqual(applyUnderdogPredictFee(1.12), 8628);
  assert.notEqual(applyUnderdogPredictFee(2), -5387, "decimal 2.00 must not be read as American +2");
  assert.equal(applyUnderdogPredictFee(2), applyUnderdogPredictFee(100));
  assert.equal(applyUnderdogPredictFee(100), -107, "−107 is UDX fee on +100, not on a 93.5 longshot");
  assert.equal(applyUnderdogPredictFee(87.28), null, "fee helper still refuses raw 87.28; convert first");
}

{
  // WKU / Kennesaw: 87.28 on the named dog + 1.93 on the favorite. Sign-only
  // consensus (+105 vs +8628) would keep the overlay and mint +$179k EV.
  const kick = future;
  const event = {
    id: "odds-wku-kennesaw",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "Western Kentucky Hilltoppers",
    home_team: "Kennesaw State Owls",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Western Kentucky Hilltoppers", price: 105 },
            { name: "Kennesaw State Owls", price: -125 },
          ],
        }],
      },
      {
        key: "fanduel",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Western Kentucky Hilltoppers", price: 100 },
            { name: "Kennesaw State Owls", price: -120 },
          ],
        }],
      },
    ],
  };
  const wkuId = "team-wku";
  const kenId = "team-kennesaw";
  const snap = {
    ok: true,
    fixtures: [{
      id: "fix-wku-kennesaw",
      league: "NCAAF",
      start_date: kick,
      home_team_id: kenId,
      away_team_id: wkuId,
    }],
    teams: [
      { id: wkuId, name: "Western Kentucky Hilltoppers", abbreviation: "WKU" },
      { id: kenId, name: "Kennesaw State Owls", abbreviation: "KENN" },
    ],
    markets: [
      { odds: 87.28, side: "WKU", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-wku-kennesaw", team_id: wkuId },
      { odds: 1.93, side: "KENN", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-wku-kennesaw", team_id: kenId },
    ],
  };
  const rawBm = {
    key: UNDERDOG_PREDICT_BOOK_KEY,
    title: UNDERDOG_PREDICT_TITLE,
    markets: [{
      key: "h2h",
      outcomes: [
        { name: "Western Kentucky Hilltoppers", price: 8628 },
        { name: "Kennesaw State Owls", price: applyUnderdogPredictFee(-108) },
      ],
    }],
  };
  assert.equal(underdogTwoWayLooksIncoherent(rawBm), true, "+8628 and −107 are not a 2-way market");
  assert.equal(underdogPredictConflictsWithEventBooks(event, rawBm), true);

  const overlaid = overlayUnderdogPredictOnGame(event, snap);
  const udp = overlaid.bookmakers.find((b) => b.key === "underdog_predict");
  const wkuPrice = udp?.markets?.find((m) => m.key === "h2h")?.outcomes?.find((o) => o.name === "Western Kentucky Hilltoppers")?.price;
  assert.notEqual(wkuPrice, 8628);
  assert.notEqual(wkuPrice, 8044);
  if (udp) {
    const h2h = udp.markets.find((m) => m.key === "h2h");
    for (const o of h2h?.outcomes || []) {
      assert.ok(Math.abs(o.price) < 2500, `Underdog ${o.name} ${o.price} must stay in a real ML range`);
    }
  }
  const data = transformOddsData([overlaid], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.notEqual(ml.bookOdds.underdog_predict?.ml_away, 8628);
  assert.notEqual(ml.best_away, 8628);

  const legs = buildAllLegsForBook(data, "underdog_predict");
  const wkuLeg = legs.find((l) => /western kentucky/i.test(l.name));
  assert.equal(wkuLeg, undefined, "WKU +8628 must not become an Underdog promo leg");
  const phantom = calcFreeBetParlayEV(
    [{ dk: 8628, bestOpp: -107 }, { dk: 8790, bestOpp: -107 }],
    100,
  );
  assert.ok(phantom.ev > 100000, "precondition: unguarded pair is the +$179k phantom");
  assert.ok(
    !legs.some((l) => Math.abs(l.dk) > 2500),
    "no Underdog promo leg may carry a six-figure-EV American",
  );
}

{
  // Live Betstamp 196 NCAAF probe: WKU Away 93.5 / Home 1.05 are real
  // decimals, not a convert bug. Overlay still dies vs SB +105/−125, and
  // a surviving +9250 cell must not cite −107 as the same-selection true.
  const kick = future;
  const event = {
    id: "odds-wku-live-93",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "Western Kentucky Hilltoppers",
    home_team: "Kennesaw State Owls",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Western Kentucky Hilltoppers", price: 105 },
            { name: "Kennesaw State Owls", price: -125 },
          ],
        }],
      },
      {
        key: "fanduel",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Western Kentucky Hilltoppers", price: 100 },
            { name: "Kennesaw State Owls", price: -120 },
          ],
        }],
      },
    ],
  };
  const snap = {
    ok: true,
    fixtures: [{
      id: "fix-wku-live-93",
      league: "NCAAF",
      start_date: kick,
      home_team_id: "ken-live",
      away_team_id: "wku-live",
    }],
    teams: [
      { id: "wku-live", name: "Western Kentucky Hilltoppers", abbreviation: "WKU" },
      { id: "ken-live", name: "Kennesaw State Owls", abbreviation: "KENN" },
    ],
    markets: [
      { odds: 93.5, side: "WKU", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-wku-live-93", team_id: "wku-live" },
      { odds: 1.05, side: "KENN", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-wku-live-93", team_id: "ken-live" },
    ],
  };
  const rawPrice = toUnderdogPredictAmerican(93.5);
  assert.ok(rawPrice > 7000);
  assert.notEqual(rawPrice, applyUnderdogPredictFee(100));
  const overlaid = overlayUnderdogPredictOnGame(event, snap);
  assert.equal(overlaid.bookmakers.some((b) => b.key === "underdog_predict"), false, "93.5 vs SB +105 is ≥25pts off");

  const forced = {
    ...event,
    bookmakers: [
      ...event.bookmakers,
      {
        key: UNDERDOG_PREDICT_BOOK_KEY,
        title: UNDERDOG_PREDICT_TITLE,
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Western Kentucky Hilltoppers", price: rawPrice },
            { name: "Kennesaw State Owls", price: applyUnderdogPredictFee(100) },
          ],
        }],
      },
    ],
  };
  const data = transformOddsData([forced], "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.notEqual(ml.best_away, rawPrice, "same-selection true for WKU is the sportsbook, not +9250");
  assert.notEqual(ml.best_away_book, "underdog_predict");
  assert.ok(ml.best_away > 0 && ml.best_away < 200);
  const bestWku = pickBestAmericanQuote([
    { price: 105, book: "draftkings" },
    { price: 100, book: "fanduel" },
    { price: rawPrice, book: "underdog_predict" },
  ], { allBooks: ALL_BOOKS });
  assert.equal(bestWku.bestBook, "draftkings");

  const legs = buildAllLegsForBook(data, "underdog_predict");
  const wkuLeg = legs.find((l) => /western kentucky/i.test(l.name));
  assert.equal(wkuLeg, undefined, "93.5 longshot without matching true is not an Underdog promo leg");
  if (wkuLeg) {
    assert.notEqual(wkuLeg.bestOpp, -107);
    assert.equal(oppQuoteLooksInverted(wkuLeg.dk, wkuLeg.bestOpp), false);
    const noteAm = trueAmericanFromOpp(wkuLeg.bestOpp);
    assert.ok(Math.abs((noteAm || 0) - wkuLeg.dk) < 5000 || wkuLeg.bestOppBook !== "underdog_predict");
  }
}

{
  // Sane 196 decimals still overlay: 1.12 favorite / ~+750 dog, sticker American.
  const kick = future;
  const event = {
    id: "odds-wku-sane",
    sport_key: "americanfootball_ncaaf",
    sport: "americanfootball_ncaaf",
    commence_time: kick,
    away_team: "Western Kentucky Hilltoppers",
    home_team: "Kennesaw State Owls",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Western Kentucky Hilltoppers", price: -800 },
            { name: "Kennesaw State Owls", price: 650 },
          ],
        }],
      },
      {
        key: "fanduel",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Western Kentucky Hilltoppers", price: -820 },
            { name: "Kennesaw State Owls", price: 640 },
          ],
        }],
      },
    ],
  };
  const snap = {
    ok: true,
    fixtures: [{
      id: "fix-wku-sane",
      league: "NCAAF",
      start_date: kick,
      home_team_id: "ken-sane",
      away_team_id: "wku-sane",
    }],
    teams: [
      { id: "wku-sane", name: "Western Kentucky Hilltoppers", abbreviation: "WKU" },
      { id: "ken-sane", name: "Kennesaw State Owls", abbreviation: "KENN" },
    ],
    markets: [
      { odds: 1.12, side: "WKU", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-wku-sane", team_id: "wku-sane" },
      { odds: 8.50, side: "KENN", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-wku-sane", team_id: "ken-sane" },
    ],
  };
  const overlaid = overlayUnderdogPredictOnGame(event, snap);
  const udp = overlaid.bookmakers.find((b) => b.key === "underdog_predict");
  assert.ok(udp, "sane 1.12 favorite / ~+750 dog must still overlay");
  const h2h = udp.markets.find((m) => m.key === "h2h");
  const wku = h2h.outcomes.find((o) => o.name === "Western Kentucky Hilltoppers");
  const ken = h2h.outcomes.find((o) => o.name === "Kennesaw State Owls");
  assert.equal(wku.price, -833);
  assert.equal(ken.price, 750);
  assert.ok(wku.price < 0 && wku.price > -1200);
  assert.ok(ken.price > 500 && ken.price < 900);
}

{
  // Kevin Browns $1000 bonus: Betstamp / cash slip 4.31x → $4310.12; bonus
  // confirm 3.31x → $3310.12 to-win (= sticker profit = American +331).
  // UDX 0.072×p×(1−p) cost-add would print +308 and double-count.
  assert.equal(toAmericanOdds(4.31), 331);
  assert.equal(toUnderdogPredictAmerican(4.31), 331);
  assert.equal(applyUnderdogPredictFee(331), 308, "precondition: fee-true of +331 is +308");
  assert.notEqual(toUnderdogPredictAmerican(4.31), 308);

  const kick = future;
  const event = {
    id: "odds-cle-browns",
    sport_key: "americanfootball_nfl",
    sport: "americanfootball_nfl",
    commence_time: kick,
    away_team: "Cleveland Browns",
    home_team: "Baltimore Ravens",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Cleveland Browns", price: 280 },
            { name: "Baltimore Ravens", price: -340 },
          ],
        }],
      },
      {
        key: "fanduel",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Cleveland Browns", price: 270 },
            { name: "Baltimore Ravens", price: -330 },
          ],
        }],
      },
    ],
  };
  const snap = {
    ok: true,
    fixtures: [{
      id: "fix-cle-bal",
      league: "NFL",
      start_date: kick,
      home_team_id: "team-bal",
      away_team_id: "team-cle",
    }],
    teams: [
      { id: "team-cle", name: "Cleveland Browns", abbreviation: "CLE" },
      { id: "team-bal", name: "Baltimore Ravens", abbreviation: "BAL" },
    ],
    markets: [
      { odds: 4.31, side: "CLE", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-cle-bal", team_id: "team-cle", size: 1000 },
      { odds: 1.30, side: "BAL", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-cle-bal", team_id: "team-bal" },
    ],
  };
  const overlaid = overlayUnderdogPredictOnGame(event, snap);
  const udp = overlaid.bookmakers.find((b) => b.key === "underdog_predict");
  assert.ok(udp, "Browns 4.31 vs SB +280 must still overlay");
  const cle = udp.markets.find((m) => m.key === "h2h")?.outcomes?.find((o) => o.name === "Cleveland Browns");
  assert.equal(cle.price, 331);
  assert.notEqual(cle.price, 308);
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.equal(ml.bookOdds.underdog_predict.ml_away, 331);
  assert.notEqual(ml.bookOdds.underdog_predict.ml_away, 308);
  const legs = buildAllLegsForBook(data, "underdog_predict");
  const phoneLegs = buildAllLegsForBook(data, "underdog_predict", null, null, "any", null, { underdogCash: true });
  assert.equal(legs.find((l) => /browns/i.test(l.name)), undefined, "missing prediction omits the Browns promo leg");
  assert.equal(phoneLegs.find((l) => /browns/i.test(l.name)), undefined);
  assert.ok(!legs.some((l) => l.bookKey === "underdog_predict" && (l.dk === 331 || l.dk === 308)));
  assert.ok(!phoneLegs.some((l) => l.dk === 331 || l.dk === 308));
}

{
  // Giants ML: the promo row still stores the Betstamp sticker. Without
  // odds.prediction, Promo must not show +252 or a fee-adjusted +244.
  // New Odds Board omits book 196 (see betstampNormalize.test.js).
  assert.equal(toUnderdogPredictAmerican(3.52), 252);

  const kick = future;
  const event = {
    id: "odds-nyg-lar",
    sport_key: "americanfootball_nfl",
    sport: "americanfootball_nfl",
    commence_time: kick,
    away_team: "New York Giants",
    home_team: "Los Angeles Rams",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "New York Giants", price: 240 },
            { name: "Los Angeles Rams", price: -280 },
          ],
        }],
      },
      {
        key: "fanduel",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "New York Giants", price: 235 },
            { name: "Los Angeles Rams", price: -270 },
          ],
        }],
      },
    ],
  };
  const snap = {
    ok: true,
    fixtures: [{
      id: "fix-nyg-lar",
      league: "NFL",
      start_date: kick,
      home_team_id: "team-lar",
      away_team_id: "team-nyg",
    }],
    teams: [
      { id: "team-nyg", name: "New York Giants", abbreviation: "NYG" },
      { id: "team-lar", name: "Los Angeles Rams", abbreviation: "LAR" },
    ],
    markets: [
      { odds: 3.52, side: "NYG", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-nyg-lar", team_id: "team-nyg", size: 400 },
      { odds: 1.39, side: "LAR", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-nyg-lar", team_id: "team-lar" },
    ],
  };
  const overlaid = overlayUnderdogPredictOnGame(event, snap);
  const udp = overlaid.bookmakers.find((b) => b.key === "underdog_predict");
  assert.ok(udp, "Giants 3.52 must overlay as sticker");
  const giantsOutcome = udp.markets.find((m) => m.key === "h2h")?.outcomes?.find((o) => o.name === "New York Giants");
  assert.equal(giantsOutcome.price, 252, "overlay keeps the gross sticker");
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const ml = data.moneylines[0];
  assert.equal(ml.bookOdds.underdog_predict.ml_away, 252);
  assert.equal(ml.bookOdds.draftkings.ml_away, 240);
  const stickerLegs = buildAllLegsForBook(data, "underdog_predict");
  const cashLegs = buildAllLegsForBook(data, "underdog_predict", null, null, "any", null, { underdogCash: true });
  assert.equal(stickerLegs.find((l) => /giants/i.test(l.name)), undefined, "missing prediction is not a free-bet sticker leg");
  assert.equal(cashLegs.find((l) => /giants/i.test(l.name)), undefined, "missing prediction is not a cash fee fallback");
  assert.ok(!stickerLegs.concat(cashLegs).some((l) => l.bookKey === "underdog_predict" && (l.dk === 252 || l.dk === 244)));
  const dkPlain = buildAllLegsForBook(data, "draftkings");
  const dkCashFlag = buildAllLegsForBook(data, "draftkings", null, null, "any", null, { underdogCash: true });
  const dkGiants = dkPlain.find((l) => /giants/i.test(l.name));
  const dkGiantsFlag = dkCashFlag.find((l) => /giants/i.test(l.name));
  assert.equal(dkGiants.dk, 240);
  assert.equal(dkGiantsFlag.dk, dkGiants.dk);
  assert.equal(dkGiantsFlag.bestOpp, dkGiants.bestOpp);
}

{
  // Logged-in scaffold match_id 178911: odds.prediction is the phone price.
  // Fantasy/Betstamp gross stays on the stored promo row, not on the New
  // Odds Board. Promo free bets and cash both display and price the phone American.
  const kick = future;
  const event = {
    id: "odds-nyg-lar-pred",
    sport_key: "americanfootball_nfl",
    sport: "americanfootball_nfl",
    commence_time: kick,
    away_team: "New York Giants",
    home_team: "Los Angeles Rams",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "New York Giants", price: 240 },
            { name: "Los Angeles Rams", price: -280 },
          ],
        }],
      },
    ],
  };
  const snap = {
    ok: true,
    fixtures: [{
      id: "fix-nyg-lar-pred",
      league: "NFL",
      start_date: kick,
      home_team_id: "team-lar",
      away_team_id: "team-nyg",
    }],
    teams: [
      { id: "team-nyg", name: "New York Giants", abbreviation: "NYG" },
      { id: "team-lar", name: "Los Angeles Rams", abbreviation: "LAR" },
    ],
    markets: [
      { odds: 3.52, side: "NYG", side_type: "Away", bet_type: "Moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-nyg-lar-pred", team_id: "team-nyg" },
      { odds: 1.39, side: "LAR", side_type: "Home", bet_type: "moneyline", period: "FT", is_alt: false, odd_provider_id: 196, fixture_id: "fix-nyg-lar-pred", team_id: "team-lar" },
    ],
  };
  const lobby = {
    match_grouped_lines: [
      {
        title: "Moneyline",
        options: [
          {
            selection_header: "New York Giants",
            choice_display: "New York Giants",
            american_price: "+245",
            decimal_price: "3.45",
            odds: {
              prediction: { american: "+245", decimal: "3.45", probability: 27 },
              fantasy: { american: "+252", decimal: "3.52", probability: "27" },
            },
          },
          {
            selection_header: "Los Angeles Rams",
            choice_display: "Los Angeles Rams",
            american_price: "-313",
            decimal_price: "1.32",
            odds: {
              prediction: { american: "-313", decimal: "1.32", probability: "74" },
              fantasy: { american: "-280", decimal: "1.36", probability: "74" },
            },
          },
        ],
      },
      {
        title: "2026/27 NFC Champion",
        over_under: { title: "2026/27 NFC Champion", category: "future" },
        options: [
          {
            selection_header: "New York Giants",
            american_price: "+1500",
            decimal_price: "16.0",
            odds: { prediction: { american: "+1500", decimal: "16.0", probability: "6" }, fantasy: null },
          },
        ],
      },
    ],
  };
  const overlaid = overlayUnderdogPredictOnGame(event, snap, lobby);
  const udp = overlaid.bookmakers.find((b) => b.key === "underdog_predict");
  const h2h = udp.markets.find((m) => m.key === "h2h").outcomes;
  const giantsOutcome = h2h.find((o) => o.name === "New York Giants");
  const ramsOutcome = h2h.find((o) => o.name === "Los Angeles Rams");
  assert.equal(giantsOutcome.price, 252, "board/overlay sticker stays Betstamp gross");
  assert.equal(giantsOutcome.predictionAmerican, 245);
  assert.equal(giantsOutcome.contractProbability, 0.27);
  assert.equal(ramsOutcome.price, toAmericanOdds(1.39));
  assert.equal(ramsOutcome.predictionAmerican, -313);
  const data = transformOddsData([overlaid], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  assert.equal(data.moneylines[0].bookOdds.underdog_predict.ml_away, 252);
  assert.equal(data.moneylines[0].bookOdds.underdog_predict.ml_away_prediction, 245);
  assert.equal(data.moneylines[0].bookOdds.draftkings.ml_away, 240);
  const freeLegs = buildAllLegsForBook(data, "underdog_predict");
  const promoLegs = buildAllLegsForBook(data, "underdog_predict", null, null, "any", null, { underdogCash: true });
  const freeGiants = freeLegs.find((l) => /giants/i.test(l.name));
  const promoGiants = promoLegs.find((l) => /giants/i.test(l.name));
  const promoRams = promoLegs.find((l) => /rams/i.test(l.name));
  const freeRams = freeLegs.find((l) => /rams/i.test(l.name));
  assert.equal(freeGiants.dk, 245, "free bet uses the phone price");
  assert.equal(promoGiants.dk, 245, "cash uses the same phone price");
  assert.equal(freeRams.dk, -313);
  assert.equal(promoRams.dk, -313);
  assert.notEqual(promoGiants.dk, 252);
  assert.notEqual(promoGiants.dk, 244);
  assert.equal(promoGiants.bestOpp, freeGiants.bestOpp);
  assert.equal(calcFreeBetParlayEV([freeGiants], 100).parlayDec, calcParlayEV([promoGiants], 0, 100).parlayDec, "free-bet formula is unchanged; both paths share +245");
  const atPhone = buildAllLegsForBook(data, "underdog_predict", null, 245, "any", null, { underdogCash: true });
  assert.equal(atPhone.find((l) => /giants/i.test(l.name)).dk, 245);
  const belowPhone = buildAllLegsForBook(data, "underdog_predict", null, null, "any", 244, { underdogCash: true });
  assert.equal(belowPhone.find((l) => /giants/i.test(l.name)), undefined);
  const withFlag = overlayUnderdogPredictOnGame(event, snap, lobby, { predictionOnly: true });
  const flagged = withFlag.bookmakers.find((b) => b.key === "underdog_predict").markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "New York Giants");
  assert.equal(flagged.price, 252, "a joined sticker stays the board price even when prediction-only is allowed");
  assert.equal(flagged.predictionAmerican, 245);
}

{
  // No Betstamp 196 row. Promo still forms the leg from odds.prediction.
  const kick = future;
  const event = {
    id: "odds-nyg-lar-phone-only",
    sport_key: "americanfootball_nfl",
    sport: "americanfootball_nfl",
    commence_time: kick,
    away_team: "New York Giants",
    home_team: "Los Angeles Rams",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "New York Giants", price: 240 },
            { name: "Los Angeles Rams", price: -280 },
          ],
        }],
      },
      {
        key: "fanduel",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "New York Giants", price: 235 },
            { name: "Los Angeles Rams", price: -270 },
          ],
        }],
      },
    ],
  };
  const lobby = {
    match_grouped_lines: [{
      title: "Moneyline",
      options: [
        {
          selection_header: "New York Giants",
          choice_display: "New York Giants",
          odds: { prediction: { american: "+245", decimal: "3.45", probability: 27 }, fantasy: { american: "+252", decimal: "3.52" } },
        },
        {
          selection_header: "Los Angeles Rams",
          choice_display: "Los Angeles Rams",
          odds: { prediction: { american: "-313", decimal: "1.32", probability: "74" }, fantasy: null },
        },
      ],
    }],
  };
  const board = overlayUnderdogPredictOnGame(event, null, lobby);
  assert.equal(board.bookmakers.some((b) => b.key === "underdog_predict"), false, "Odds Board does not invent a prediction-only book");
  const promo = overlayUnderdogPredictOnGame(event, null, lobby, { predictionOnly: true });
  const udp = promo.bookmakers.find((b) => b.key === "underdog_predict");
  assert.ok(udp, "Promo forms an Underdog book from the phone quote alone");
  const giantsOutcome = udp.markets.find((m) => m.key === "h2h").outcomes.find((o) => o.name === "New York Giants");
  assert.equal(giantsOutcome.price, 245);
  assert.equal(giantsOutcome.predictionAmerican, 245);
  const data = transformOddsData([promo], "americanfootball_nfl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const legs = buildAllLegsForBook(data, "underdog_predict", null, null, "any", null, { underdogCash: true });
  const giants = legs.find((l) => /giants/i.test(l.name));
  assert.ok(giants, "prediction-only phone quote is a promo leg");
  assert.equal(giants.dk, 245);
  assert.notEqual(giants.dk, 252);
  assert.equal(calcFreeBetParlayEV([giants], 100).parlayDec, calcParlayEV([giants], 0, 100).parlayDec);
}

console.log("promoUnderdogPredict.test.js ok");
