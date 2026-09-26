// MLB 1+ HR legs in the Promo Builder: Markets scoping (All / Main /
// Player Props = TD + HR), the $500 No-ladder blend, Hide low liquidity,
// and same-game correlation in the parlay scan helpers.
import assert from "node:assert/strict";
import * as playerTd from "../lib/player-td.mjs";
import { scopePromoLegs, isPlayerPropLeg } from "./promoMarketScope.js";
import { preBlendStoredLadderLegs, applyPmBlendToLeg } from "./blendAskLadder.js";
import { filterLowLiquidityLegs } from "./promoLiquidityFilter.js";
import { buildOddsQueryPlan } from "./oddsLoad.js";

const { playerTdsFromCacheRows, playerTdLegsForBook, promoLegsCorrelate, conflictsWithAny } = playerTd;
const NOW = Date.parse("2026-09-26T15:00:00Z");
const COMMENCE = "2026-09-26T23:10:00Z";

const slot = (dk, noLevels, extra = {}) => ({
  offers: [{ book: "draftkings", price: dk }, { book: "fliff", price: dk + 300 }],
  opp: { price: noLevels[0].american, book: "kalshi", count: 1, source: "exchange", size: noLevels[0].size },
  opps: [{ price: noLevels[0].american, book: "kalshi", source: "exchange", size: noLevels[0].size, levels: noLevels }],
  ...extra,
});

const mlbRow = {
  event_id: "mlb-1",
  sport: "baseball_mlb",
  away_team: "Cleveland Guardians",
  home_team: "Kansas City Royals",
  commence_time: COMMENCE,
  data: {
    gameKey: "MLB|CLE|KC|2026-09-26",
    players: [
      // Deep book: $500 profit on the No fills inside the ladder.
      { name: "Bobby Witt Jr.", team: "KC", markets: { hr: slot(430, [{ american: -560, size: 2000 }, { american: -600, size: 5000 }]) } },
      // Thin book: $40 at the top, nothing behind it.
      { name: "Jo Adell", team: "CLE", markets: { hr: slot(480, [{ american: -520, size: 40 }]) } },
      // A stray TD slot on an MLB row is never read.
      { name: "Steven Kwan", team: "CLE", markets: { anytime: slot(900, [{ american: -2000, size: 5000 }]) } },
    ],
  },
};
const nflRow = {
  event_id: "nfl-1",
  sport: "americanfootball_nfl",
  away_team: "Kansas City Chiefs",
  home_team: "Miami Dolphins",
  commence_time: "2026-09-27T17:00:00Z",
  data: { gameKey: "KC|MIA|2026-09-27", players: [{ name: "Travis Kelce", markets: { anytime: slot(160, [{ american: -140, size: 5000 }]) } }] },
};

const props = playerTdsFromCacheRows([mlbRow, nflRow]);
const legs = playerTdLegsForBook(props, "draftkings", { now: NOW });
const hr = legs.filter((l) => l.market === "HR");
const tds = legs.filter((l) => l.market === "TD");
assert.equal(hr.length, 2);
assert.equal(tds.length, 1);
assert.deepEqual(hr.map((l) => l.name).sort(), ["Bobby Witt Jr. 1+ HR", "Jo Adell 1+ HR"]);
assert.ok(hr.every((l) => l.sport === "baseball_mlb" && l.playerProp === "hr" && isPlayerPropLeg(l)));
assert.equal(playerTdLegsForBook(props, "fliff", { now: NOW }).length, 0, "Fliff never a leg");

// Markets scoping with a game line from the same slate.
const ml = { name: "Kansas City Royals ML", market: "ML", isAlt: false, game: "Cleveland Guardians @ Kansas City Royals", sport: "baseball_mlb" };
const pool = [ml, ...legs];
assert.equal(scopePromoLegs(pool, ["all"]).length, 4, "All mixes HR legs with game lines");
assert.deepEqual(scopePromoLegs(pool, ["main"]), [ml], "Main excludes HR");
assert.deepEqual(scopePromoLegs(pool, ["props"]).map((l) => l.market).sort(), ["HR", "HR", "TD"], "Player Props = TD + HR");
assert.equal(scopePromoLegs(pool, ["ml", "props"]).length, 4);

// MLB-only Promo loads player props; sport filter keeps NFL TDs out.
assert.equal(buildOddsQueryPlan({ mode: "promo", promoSports: new Set(["baseball_mlb"]), featuredSportKeys: ["baseball_mlb", "americanfootball_nfl"] }).includePlayerProps, true);
assert.deepEqual(playerTdLegsForBook(props, "draftkings", { now: NOW, sportFilter: ["baseball_mlb"] }).map((l) => l.market), ["HR", "HR"]);

// $500 blend on the stored ladder, and Hide low liquidity.
const witt = hr.find((l) => l.name.startsWith("Bobby"));
const adell = hr.find((l) => l.name.startsWith("Jo"));
const blended = preBlendStoredLadderLegs([witt, adell], { promoType: "boost", numLegs: 1 });
const wittB = blended[0];
assert.ok(wittB.pmBlend, "deep HR leg is blended");
assert.equal(wittB.bestOppQuoted, -560);
assert.ok(wittB.bestOpp <= -560 && wittB.bestOpp >= -600, `blended No ${wittB.bestOpp} sits between the ladder levels`);
assert.equal(wittB.lowLiquidity, false);
assert.equal(applyPmBlendToLeg(adell, null, {}).lowLiquidity, true, "thin HR book is low liquidity");
assert.deepEqual(filterLowLiquidityLegs([witt, adell], true, { promoType: "boost", numLegs: 1 }).map((l) => l.name), ["Bobby Witt Jr. 1+ HR"]);
assert.equal(filterLowLiquidityLegs([witt, adell], false).length, 2);

// Correlation: two HR legs from one game conflict (so the same player can
// never appear twice either); an HR leg conflicts with that game's ML; the
// NFL TD leg does not conflict with MLB legs.
assert.ok(promoLegsCorrelate(witt, adell));
assert.ok(promoLegsCorrelate(witt, ml));
assert.ok(!promoLegsCorrelate(witt, tds[0]));
assert.ok(conflictsWithAny({ ...witt }, [witt]));

// Matching books with only a sportsbook checked: no exchange No, no HR leg.
assert.equal(playerTdLegsForBook(props, "draftkings", { now: NOW, matchingBooks: ["draftkings"], sportFilter: ["baseball_mlb"] }).length, 0);

console.log("playerHrPromo.test.js ok");
