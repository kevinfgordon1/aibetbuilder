import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  oppQuoteLooksInverted,
  quoteLooksWrongSideOf,
  quoteLooksAbsurdVsReference,
  twoWayQuotesLookIncoherent,
  trueAmericanFromOpp,
  pickBestAmericanQuote,
  resolveOppWithSideGuard,
  pickHasInvertedOpp,
  rankPicksAfterOppGuard,
} from "./promoOppGuard.js";
import { formatSignedEvMoney, formatSignedEvPct, formatAmericanOdds } from "./trueOddsLine.js";
import { transformOddsData } from "./oddsTransform.js";
import { applyPmBlendToLeg } from "./blendAskLadder.js";
import { applyUnderdogPredictFee } from "./underdogPredictFee.js";

const require = createRequire(import.meta.url);
const {
  ALL_BOOKS,
  TRUSTED_BOOK_KEYS,
  buildAllLegsForBook,
  resolveOpp,
  ourTrueProb,
  calcParlayEV,
  findTopParlays,
} = require("../lib/promo-ev.js");
const cjsGuard = require("../lib/promo-opp-guard.js");

// ── Kevin Iowa screenshot: Fanatics −20000 vs Kalshi −2042 (same-side favorite)
{
  assert.equal(oppQuoteLooksInverted(-20000, -2042), true, "Iowa favorite vs favorite 'opp' is inverted");
  assert.equal(oppQuoteLooksInverted(-20000, 2042), false, "Iowa vs real underdog inverse is OK");
  assert.equal(quoteLooksWrongSideOf(-20000, 2042), true, "same-team Kalshi +2042 vs Fanatics −20000");
  assert.equal(quoteLooksWrongSideOf(-20000, -1800), false, "shorter same-side favorite is not a flip");
}

// ── Washington +3.5 screenshot: −255 vs opp +251 is a sane inverse
{
  assert.equal(oppQuoteLooksInverted(-255, 251), false);
  assert.equal(oppQuoteLooksInverted(-110, -110), false, "pick'em juice both favorites");
}

// ── Real +EV dog: book +150 vs fair −110 must not be rejected
{
  assert.equal(oppQuoteLooksInverted(150, -110), false);
  assert.equal(quoteLooksWrongSideOf(150, -110), false, "12pt edge is not absurd");
  assert.equal(quoteLooksWrongSideOf(8628, 105), false, "same-sign +8628 vs +105 is not a flip");
  assert.equal(quoteLooksAbsurdVsReference(105, 8628), true, "same-sign +8628 vs +105 is still garbage");
  assert.equal(quoteLooksAbsurdVsReference(187, 150), false, "real +187 vs +150 is fine");
  assert.equal(cjsGuard.quoteLooksAbsurdVsReference(105, 8628), true);
}

// ── Kevin WKU screenshot: +8628 book vs −107 Underdog true (UDX fee on +100)
{
  assert.equal(applyUnderdogPredictFee(100), -107);
  assert.equal(twoWayQuotesLookIncoherent(8628, -107), true, "+8628 and −107 are not one 2-way");
  assert.equal(oppQuoteLooksInverted(8628, -107), true, "WKU +8628 cannot use −107 as true");
  assert.equal(cjsGuard.oppQuoteLooksInverted(8628, -107), true);
  const shownTrue = trueAmericanFromOpp(-107);
  assert.ok(shownTrue > 0 && shownTrue < 150, `inverse of −107 is even-money class, got ${shownTrue}`);
  assert.notEqual(shownTrue, 8628);
  assert.equal(quoteLooksAbsurdVsReference(8628, shownTrue), true);
  assert.equal(oppQuoteLooksInverted(150, -110), false, "real +EV dog still resolves");
  assert.equal(twoWayQuotesLookIncoherent(150, -110), false);
  assert.equal(oppQuoteLooksInverted(200, 200), false, "same-selection PM +200 vs +200 is not a 2-way");
}

// ── Texas −6000 vs Kalshi dog +3021 stays (user: same direction, fine)
{
  assert.equal(oppQuoteLooksInverted(-6000, 3021), false);
}

// ── CJS / ESM parity
{
  assert.equal(cjsGuard.oppQuoteLooksInverted(-20000, -2042), true);
  assert.equal(cjsGuard.oppQuoteLooksInverted(150, -110), false);
}

// ── pickBestAmericanQuote skips inverted Kalshi vs sportsbook consensus
{
  const picked = pickBestAmericanQuote([
    { price: -20000, book: "fanatics", size: null },
    { price: -15000, book: "draftkings", size: null },
    { price: 2042, book: "kalshi", size: 50000 },
  ], { allBooks: ALL_BOOKS });
  assert.notEqual(picked.bestBook, "kalshi");
  assert.equal(picked.best, -15000, "best remaining favorite, not inverted +2042");
}

{
  const opp = pickBestAmericanQuote([
    { price: 8000, book: "fanatics", size: null },
    { price: 5000, book: "draftkings", size: null },
    { price: -2042, book: "kalshi", size: 50000 },
  ], { allBooks: ALL_BOOKS });
  assert.notEqual(opp.bestBook, "kalshi");
  assert.equal(opp.best, 8000);
}

{
  const wku = pickBestAmericanQuote([
    { price: 105, book: "draftkings", size: null },
    { price: 100, book: "fanduel", size: null },
    { price: 8628, book: "underdog_predict", size: 400 },
  ], { allBooks: ALL_BOOKS });
  assert.notEqual(wku.bestBook, "underdog_predict");
  assert.equal(wku.best, 105, "UD +8628 must not be the same-selection true for WKU");
  assert.equal(cjsGuard.pickBestAmericanQuote([
    { price: 105, book: "draftkings", size: null },
    { price: 8628, book: "underdog_predict", size: 400 },
  ], { allBooks: ALL_BOOKS }).best, 105);
}

// ── resolveOpp falls back to same-book when trusted Kalshi is inverted
{
  const r = resolveOppWithSideGuard({
    trustedOpp: -2042,
    trustedBook: "kalshi",
    trustedCount: 1,
    trustedSize: 50000,
    sameBookOpp: 8000,
    sameBookKey: "fanatics",
    sameBookSize: null,
    bookOdds: -20000,
  });
  assert.equal(r.bestOpp, 8000);
  assert.equal(r.bestOppBook, "fanatics");
  assert.equal(r.sameBookFallback, true);
  assert.ok(ourTrueProb(r.bestOpp) > 0.9, "Iowa remains a heavy favorite");
  assert.equal(resolveOpp({
    trustedOpp: -2042,
    trustedBook: "kalshi",
    sameBookOpp: 8000,
    sameBookKey: "fanatics",
    bookOdds: -20000,
  }).bestOpp, 8000);
}

{
  const omitted = resolveOppWithSideGuard({
    trustedOpp: -2042,
    trustedBook: "kalshi",
    sameBookOpp: -1800,
    sameBookKey: "fanatics",
    bookOdds: -20000,
  });
  assert.equal(omitted.bestOpp, null, "omit rather than invent inverted true odds");
}

{
  const wku = resolveOppWithSideGuard({
    trustedOpp: -107,
    trustedBook: "underdog_predict",
    sameBookOpp: -107,
    sameBookKey: "underdog_predict",
    bookOdds: 8628,
  });
  assert.equal(wku.bestOpp, null, "omit WKU +8628 vs Underdog −107 rather than cite the other contract");
}

// ── transform + buildAllLegs: Iowa cannot resolve to +2000-class true
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const games = [{
    commence_time: future,
    away_team: "Iowa Hawkeyes",
    home_team: "Cupcake State",
    bookmakers: [
      {
        key: "fanatics",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Iowa Hawkeyes", price: -20000 },
            { name: "Cupcake State", price: 8000 },
          ],
        }],
      },
      {
        key: "kalshi",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Iowa Hawkeyes", price: 2042, size: 50000 },
            { name: "Cupcake State", price: -2042, size: 50000 },
          ],
        }],
      },
    ],
  }];
  const data = transformOddsData(games, "americanfootball_ncaaf", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  const legs = buildAllLegsForBook(data, "fanatics");
  const iowa = legs.find((l) => l.name === "Iowa Hawkeyes ML");
  assert.ok(iowa, "Iowa ML still exists via same-book fallback or SB opp");
  assert.notEqual(iowa.bestOppBook, "kalshi");
  assert.ok(iowa.bestOpp > 0, "opponent of a −20000 favorite must be a dog");
  const trueAm = Math.round((100 * (1 - ourTrueProb(iowa.bestOpp))) / ourTrueProb(iowa.bestOpp));
  // displayed true = probToAmerican(ourTrueProb) is a favorite, not +2042
  const displayedTrue = ourTrueProb(iowa.bestOpp) >= 0.5
    ? Math.round(-100 * ourTrueProb(iowa.bestOpp) / (1 - ourTrueProb(iowa.bestOpp)))
    : Math.round(100 * (1 - ourTrueProb(iowa.bestOpp)) / ourTrueProb(iowa.bestOpp));
  assert.ok(displayedTrue < 0, `true odds must stay favorite-class, got ${displayedTrue}`);
  assert.ok(displayedTrue !== 2042);
  assert.ok(trueAm !== 2042);
}

// ── Blend of the favorite ladder must not overwrite a sane dog quote
{
  const blended = applyPmBlendToLeg(
    { dk: -20000, bestOpp: 2042, bestOppBook: "kalshi", bestOppSize: 400, bestOppQuoted: 2042 },
    [{ american: -2042, size: 20000 }, { american: -2500, size: 20000 }],
  );
  assert.equal(blended.bestOpp, 2042, "keep quoted dog inverse");
  assert.equal(blended.pmBlend, null);
}

// ── Ranking: −95% inverted parlay is not BEST PICK ahead of sane −EV
{
  const inverted = {
    ev: -95.45,
    legs: [{ dk: -20000, bestOpp: -2042, name: "Iowa Hawkeyes ML" }],
  };
  const sane = {
    ev: -3.78,
    legs: [{ dk: -175, bestOpp: 163, name: "Nationals +3.5" }],
  };
  const ranked = rankPicksAfterOppGuard([inverted, sane]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].ev, -3.78);
  assert.equal(pickHasInvertedOpp(inverted.legs), true);
}

{
  const a = { ev: -3.78, legs: [{ dk: -110, bestOpp: 100 }] };
  const b = { ev: -95.45, legs: [{ dk: -20000, bestOpp: 2042 }] };
  const ranked = rankPicksAfterOppGuard([b, a]);
  assert.equal(ranked[0].ev, -3.78, "re-sort by EV after overlay");
}

{
  const phantom = {
    ev: 179000,
    legs: [{ dk: 8628, bestOpp: -107, name: "Western Kentucky Hilltoppers ML", bookKey: "underdog_predict", bestOppBook: "underdog_predict" }],
  };
  const sane = {
    ev: 12.4,
    legs: [{ dk: 150, bestOpp: -110, name: "Sane dog ML" }],
  };
  const ranked = rankPicksAfterOppGuard([phantom, sane]);
  assert.equal(pickHasInvertedOpp(phantom.legs), true);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].ev, 12.4, "extreme UD longshot without matching true is not BEST PICK");
}

// ── EV format: never +- or +$-
{
  assert.equal(formatSignedEvMoney(-95.45), "-$95.45");
  assert.equal(formatSignedEvMoney(95.45), "+$95.45");
  assert.equal(formatSignedEvMoney(0), "$0.00");
  assert.equal(formatSignedEvPct(-95.5), "-95.5%");
  assert.equal(formatSignedEvPct(2.9), "+2.9%");
  assert.ok(!formatSignedEvMoney(-95.45).includes("+-"));
  assert.ok(!formatSignedEvMoney(-95.45).includes("+$-"));
  assert.ok(!formatSignedEvPct(-95.5).includes("+-"));
  assert.equal(formatAmericanOdds(-2042), "-2042");
  assert.ok(!formatAmericanOdds(-2042).includes("+-"));
}

// ── Kalshi-only matching books: still fall back to Fanatics inverse
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const games = [{
    commence_time: future,
    away_team: "Iowa Hawkeyes",
    home_team: "Cupcake State",
    bookmakers: [
      {
        key: "fanatics",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Iowa Hawkeyes", price: -20000 },
            { name: "Cupcake State", price: 8000 },
          ],
        }],
      },
      {
        key: "kalshi",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Iowa Hawkeyes", price: 2042, size: 50000 },
            { name: "Cupcake State", price: -2042, size: 50000 },
          ],
        }],
      },
    ],
  }];
  const kalshiOnly = new Set(["kalshi"]);
  const data = transformOddsData(games, "americanfootball_ncaaf", kalshiOnly, ALL_BOOKS);
  const legs = buildAllLegsForBook(data, "fanatics");
  const iowa = legs.find((l) => l.name === "Iowa Hawkeyes ML");
  assert.ok(iowa);
  assert.equal(iowa.bestOpp, 8000);
  assert.equal(iowa.bestOppBook, "fanatics");
  assert.equal(iowa.sameBookFallback, true);
}

// ── Sane 4-leg EV stays far from −95%
{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const mk = (name, game, dk, bestOpp) => ({
    name, dk, bestOpp, game, commence_time: future, sport: "americanfootball_ncaaf",
  });
  const pool = [
    mk("Nats +3.5", "WSH @ NYM", -255, 251),
    mk("BYU ML", "BYU @ X", -950, 850),
    mk("Texas ML", "TEX @ Y", -6000, 3021),
    mk("Sane 4th", "A @ B", -110, 100),
  ];
  const top = findTopParlays(pool, 4, 0, 100, 5);
  assert.ok(top.length >= 1);
  assert.ok(top[0].ev > -50, "sane 4-leg is not −95% EV");
  const r = calcParlayEV(pool, 0, 100);
  assert.ok(r.combinedProb > 0.2);
}

console.log("promoOppGuard.test.js ok");
