import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOCCER_SPORT_KEYS,
  SOCCER_ML_SIDES,
  SOCCER_PM_NO_BOOK_KEYS,
  SOCCER_EXCHANGE_LAY_BOOK_KEYS,
  SOCCER_ML_EMPTY_HINT,
  isSoccerSport,
  expandSoccerSportKeys,
  isDrawOutcomeName,
  soccerYesName,
  soccerNoName,
  soccerLayOutcomeName,
  outcomeMatchesName,
  preferSoccerBinaryNo,
  soccerMlOppResolveArgs,
  invertAmericanOdds,
  soccerLayPriceToNo,
  pickBestSoccerLay,
  bestSoccerBinaryNo,
  soccerLayBookLabel,
  soccerPromoEmptyDetail,
} from "./soccerPairing.js";
import { transformOddsData } from "./oddsTransform.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cjs = require("../lib/soccer-pairing.js");
const { TRUSTED_BOOK_KEYS, ALL_BOOKS, buildAllLegsForBook } = require("../lib/promo-ev.js");

assert.deepEqual(SOCCER_SPORT_KEYS, ["soccer_epl", "soccer_usa_mls"]);
assert.deepEqual(SOCCER_ML_SIDES, ["away", "draw", "home"]);
assert.equal(isSoccerSport("soccer_epl"), true);
assert.equal(isSoccerSport("soccer_usa_mls"), true);
assert.equal(isSoccerSport("americanfootball_nfl"), false);
assert.equal(isSoccerSport("baseball_mlb"), false);
assert.deepEqual([...expandSoccerSportKeys(new Set(["soccer_epl"]))].sort(), [...SOCCER_SPORT_KEYS].sort());
assert.deepEqual([...expandSoccerSportKeys(["soccer_usa_mls"])].sort(), [...SOCCER_SPORT_KEYS].sort());
assert.deepEqual([...expandSoccerSportKeys(new Set(["baseball_mlb"]))], ["baseball_mlb"]);
assert.equal(typeof cjs.expandSoccerSportKeys, "function");
assert.deepEqual([...cjs.expandSoccerSportKeys(new Set(["soccer_epl"]))].sort(), [...SOCCER_SPORT_KEYS].sort());
assert.equal(isDrawOutcomeName("Draw"), true);
assert.equal(isDrawOutcomeName("tie"), true);
assert.equal(isDrawOutcomeName("Arsenal"), false);

{
  const away = "Chelsea";
  const home = "Arsenal";
  assert.equal(soccerYesName("home", away, home), "Arsenal ML");
  assert.equal(soccerYesName("away", away, home), "Chelsea ML");
  assert.equal(soccerYesName("draw", away, home), "Draw");
  assert.equal(soccerNoName("home", away, home), "Arsenal ML No");
  assert.equal(soccerNoName("away", away, home), "Chelsea ML No");
  assert.equal(soccerNoName("draw", away, home), "Draw No");
  assert.equal(soccerLayOutcomeName("home", away, home), "Arsenal");
  assert.equal(soccerLayOutcomeName("draw", away, home), "Draw");
  assert.equal(outcomeMatchesName("Draw", "Tie"), true);
  assert.equal(outcomeMatchesName("Arsenal", "Arsenal"), true);
  assert.equal(outcomeMatchesName("Chelsea", "Arsenal"), false);
}

// Soft Home Yes ↔ PM Home No. Away Yes must not win even if it is a better price.
{
  const homeNo = { best: -140, bestBook: "kalshi", bestSize: 800, count: 2 };
  const awayYes = { best: 210, bestBook: "polymarket", bestSize: 400, count: 1 };
  const picked = preferSoccerBinaryNo(homeNo, awayYes);
  assert.equal(picked.kind, "same_binary_no");
  assert.equal(picked.best, -140);
  assert.equal(picked.bestBook, "kalshi");
  assert.notEqual(picked.best, awayYes.best);
}

{
  const awayYes = { best: 180, bestBook: "novig", bestSize: 50, count: 1 };
  const picked = preferSoccerBinaryNo(null, awayYes);
  assert.equal(picked.kind, "none");
  assert.equal(picked.best, null);
  assert.equal(picked.bestBook, null);
}

{
  const game = {
    best_home_no: 155,
    best_home_no_book: "polymarket",
    best_home_no_size: 600,
    ml_opp_count_home: 2,
    best_away: 200,
    best_away_book: "kalshi",
    bookOdds: {
      draftkings: { ml_home: -120, ml_away: 280, ml_draw: 240 },
      kalshi: { ml_home_no: 150, ml_home_no_size: 200 },
    },
  };
  const args = soccerMlOppResolveArgs(game, "home", "draftkings");
  assert.equal(args.trustedOpp, 155);
  assert.equal(args.trustedBook, "polymarket");
  assert.equal(args.trustedSize, 600);
  assert.equal(args.sameBookOpp, null, "soft book has no Home No");
  const kalshiOffer = soccerMlOppResolveArgs(game, "home", "kalshi");
  assert.equal(kalshiOffer.sameBookOpp, 150);
  assert.equal(kalshiOffer.sameBookSize, 200);
}

for (const key of Object.keys(cjs)) {
  if (typeof cjs[key] === "function") {
    assert.equal(typeof cjs[key], "function", `CJS missing ${key}`);
  }
}
assert.deepEqual(cjs.SOCCER_SPORT_KEYS, SOCCER_SPORT_KEYS);
assert.equal(cjs.preferSoccerBinaryNo({ best: 100 }, { best: 999 }).best, 100);
assert.equal(cjs.preferSoccerBinaryNo(null, { best: 999 }).best, null);
assert.ok(SOCCER_EXCHANGE_LAY_BOOK_KEYS.has("betfair_ex_eu"));
assert.ok(SOCCER_EXCHANGE_LAY_BOOK_KEYS.has("matchbook"));
assert.ok(SOCCER_PM_NO_BOOK_KEYS.has("kalshi"));
assert.ok(!SOCCER_PM_NO_BOOK_KEYS.has("betfair_ex_eu"));
assert.equal(soccerLayBookLabel("betfair_ex_eu"), "Betfair");
assert.equal(soccerLayBookLabel("matchbook"), "Matchbook");
assert.equal(invertAmericanOdds(138), -138);
assert.equal(invertAmericanOdds(-150), 150);
assert.equal(soccerLayPriceToNo("betfair_ex_eu", 138), -138);
assert.equal(soccerLayPriceToNo("matchbook", 245), -245);
assert.equal(soccerLayPriceToNo("kalshi", 155), 155, "PM h2h_lay is already a No price");
assert.equal(soccerPromoEmptyDetail({ soccerSelected: true, soccerMlLegCount: 0 }), SOCCER_ML_EMPTY_HINT);
assert.equal(soccerPromoEmptyDetail({ soccerSelected: true, soccerMlLegCount: 2 }), null);
assert.equal(soccerPromoEmptyDetail({ soccerSelected: false, soccerMlLegCount: 0 }), null);

{
  const quotes = [
    { book: "betfair_ex_eu", price: -138, size: 14 },
    { book: "matchbook", price: -140, size: 2 },
    { book: "kalshi", price: 155, size: 900 },
  ];
  const pmFirst = pickBestSoccerLay(quotes);
  assert.equal(pmFirst.bestBook, "kalshi");
  assert.equal(pmFirst.best, 155);
  const exchangeOnly = pickBestSoccerLay(quotes.filter((q) => q.book !== "kalshi"));
  assert.equal(exchangeOnly.bestBook, "betfair_ex_eu");
  assert.equal(exchangeOnly.best, -138);
}

{
  const bookmakers = [
    {
      key: "kalshi",
      markets: [{
        key: "h2h",
        outcomes: [
          { name: "Arsenal", price: -115 },
          { name: "Chelsea", price: 260 },
          { name: "Draw", price: 230 },
        ],
      }],
    },
    {
      key: "betfair_ex_eu",
      markets: [{
        key: "h2h_lay",
        outcomes: [
          { name: "Arsenal", price: 138, bet_limit: 14 },
          { name: "Chelsea", price: 245, bet_limit: 956 },
          { name: "Draw", price: 250, bet_limit: 4593 },
        ],
      }],
    },
    {
      key: "matchbook",
      markets: [{
        key: "h2h_lay",
        outcomes: [
          { name: "Arsenal", price: 140, bet_limit: 2 },
          { name: "Chelsea", price: 250, bet_limit: 391 },
          { name: "Draw", price: 255, bet_limit: 920 },
        ],
      }],
    },
  ];
  const homeNo = bestSoccerBinaryNo(bookmakers, "Arsenal", { sizeOf: (o) => o.bet_limit });
  assert.equal(homeNo.bestBook, "betfair_ex_eu");
  assert.equal(homeNo.best, -138, "exchange lay +138 is No −138");
  assert.equal(homeNo.bestSize, 14);
  assert.equal(homeNo.count, 2);
  const awayYes = { best: 260, bestBook: "kalshi" };
  const picked = preferSoccerBinaryNo(homeNo, awayYes);
  assert.equal(picked.kind, "same_binary_no");
  assert.equal(picked.best, -138);
  assert.notEqual(picked.best, awayYes.best);

  const withKalshiNo = bestSoccerBinaryNo([
    ...bookmakers,
    {
      key: "kalshi",
      markets: [{
        key: "h2h_lay",
        outcomes: [{ name: "Arsenal", price: 155, bet_limit: 900 }],
      }],
    },
  ], "Arsenal", { sizeOf: (o) => o.bet_limit });
  assert.equal(withKalshiNo.bestBook, "kalshi");
  assert.equal(withKalshiNo.best, 155);

  const kalshiExcluded = bestSoccerBinaryNo(bookmakers.concat([{
    key: "kalshi",
    markets: [{ key: "h2h_lay", outcomes: [{ name: "Arsenal", price: 155, bet_limit: 900 }] }],
  }]), "Arsenal", {
    sizeOf: (o) => o.bet_limit,
    trustedBookKeys: new Set(["draftkings", "fanduel"]),
  });
  assert.equal(kalshiExcluded.bestBook, "betfair_ex_eu", "matching-books can drop PM No; exchange lay still used");
}

assert.deepEqual([...cjs.SOCCER_EXCHANGE_LAY_BOOK_KEYS].sort(), [...SOCCER_EXCHANGE_LAY_BOOK_KEYS].sort());
assert.equal(cjs.soccerLayPriceToNo("betfair_ex_eu", 138), -138);
assert.equal(cjs.bestSoccerBinaryNo([{
  key: "matchbook",
  markets: [{ key: "h2h_lay", outcomes: [{ name: "Arsenal", price: 140 }] }],
}], "Arsenal").best, -140);

{
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const app = fs.readFileSync(path.join(dir, "App.jsx"), "utf8");
  assert.match(app, /key: "soccer_epl", label: "EPL"/);
  assert.match(app, /key: "soccer_usa_mls", label: "MLS"/);
  assert.match(app, /SPORT_CHIPS = sportChipOptions\(SPORTS\)/);
  assert.match(app, /function pushSoccerMlLegs/);
  assert.match(app, /isSoccerSport\(g\.sport\)/);
  assert.match(app, /soccerPromoEmptyDetail/);
  assert.match(app, /soccerLayBookLabel/);
  assert.match(app, /soccerKeysSelected/);
  const appTrusted = app.match(/const TRUSTED_BOOK_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(appTrusted, "App.jsx TRUSTED_BOOK_KEYS block");
  assert.ok(!appTrusted[1].includes("betfair_ex_eu"));
  assert.ok(!appTrusted[1].includes("matchbook"));
  assert.doesNotMatch(app, /DEFAULT_PROFILE_SPORTS = \[[^\]]*soccer/);
  assert.doesNotMatch(app, /label: "EPL"[\s\S]{0,80}togglePromoSport/);
  assert.doesNotMatch(app, /label: "MLS"[\s\S]{0,80}togglePromoSport/);
  const profile = fs.readFileSync(path.join(dir, "userProfile.js"), "utf8");
  assert.match(profile, /DEFAULT_PROFILE_SPORTS = \["baseball_mlb", "americanfootball_nfl", "americanfootball_ncaaf"\]/);
  const fetchJob = fs.readFileSync(path.join(dir, "../lib/odds-fetch-job.js"), "utf8");
  assert.match(fetchJob, /h2h,h2h_lay,spreads,totals/);
  assert.match(fetchJob, /Do not pull alt props/);
}

{
  const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const games = [{
    commence_time: future,
    away_team: "Chelsea",
    home_team: "Arsenal",
    bookmakers: [
      {
        key: "draftkings",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Chelsea", price: 280 },
            { name: "Draw", price: 240 },
            { name: "Arsenal", price: -120 },
          ],
        }],
      },
      {
        key: "kalshi",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: "Chelsea", price: 260 },
            { name: "Draw", price: 230 },
            { name: "Arsenal", price: -115 },
          ],
        }],
      },
      {
        key: "betfair_ex_eu",
        markets: [{
          key: "h2h_lay",
          outcomes: [
            { name: "Chelsea", price: 245, bet_limit: 956 },
            { name: "Draw", price: 250, bet_limit: 4593 },
            { name: "Arsenal", price: 138, bet_limit: 14 },
          ],
        }],
      },
    ],
  }];
  const data = transformOddsData(games, "soccer_epl", TRUSTED_BOOK_KEYS, ALL_BOOKS);
  assert.equal(data.moneylines[0].best_home_no, -138);
  assert.equal(data.moneylines[0].best_home_no_book, "betfair_ex_eu");
  const dkLegs = buildAllLegsForBook(data, "draftkings");
  const home = dkLegs.find((l) => l.name === "Arsenal ML");
  assert.equal(home.bestOpp, -138);
  assert.equal(home.bestOppBook, "betfair_ex_eu");
  assert.equal(home.bestOppName, "Arsenal ML No");
}

console.log("soccerPairing.test.js ok");
