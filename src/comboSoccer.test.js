import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mapPromoLegsToKalshi, soccerNameMatches, flattenComboGames, formatGameOption } from "./comboPrefill.js";
const require = createRequire(import.meta.url);
const kg = require("../api/kalshi-games.js");

// Kalshi KXMLSGAME events: three yes markets (team, team, TIE); key is the ET match day.
const ev = (key, a, b, an, bn) => ({
  event_ticker: `KXMLSGAME-${key}`, title: `${an} vs ${bn}`, sub_title: `${a} vs ${b}`,
  markets: [
    { ticker: `KXMLSGAME-${key}-${a}`, yes_sub_title: an, occurrence_datetime: "2026-10-18T05:30:00Z" },
    { ticker: `KXMLSGAME-${key}-${b}`, yes_sub_title: bn, occurrence_datetime: "2026-10-18T05:30:00Z" },
    { ticker: `KXMLSGAME-${key}-TIE`, yes_sub_title: "Tie", occurrence_datetime: "2026-10-18T05:30:00Z" },
  ],
});
const now = Date.parse("2026-10-12T18:00:00Z");
const mls = kg._helpers.groupSportGames({ side: [ev("26OCT14SDHOU", "SD", "HOU", "San Diego FC", "Houston"), ev("26OCT17LAGSD", "LAG", "SD", "Los Angeles G", "San Diego FC")] }, now, { dateOnlyStart: true })
  .map((g) => ({ ...g, sport: "mls" }));
assert.equal(mls.length, 2);
assert.equal(mls[0].startTime, "2026-10-14T04:00:00.000Z"); // ET day, not settlement time
assert.deepEqual(mls[0].markets.side.map((m) => m.label), ["San Diego FC", "Houston", "Draw"]);
assert.equal(mls[0].markets.spread.length, 0);
assert.ok(kg.MARKET_SERIES.mls && kg.MARKET_SERIES.epl && kg.MARKET_SERIES.ucl);
assert.ok(flattenComboGames({ mls }).every((g) => g.sportLabel === "MLS"));
assert.equal(formatGameOption({ sport: "ucl", sportLabel: "UCL", title: "Villarreal vs PSG", date: "Nov 3" }), "Soccer · UCL · Villarreal vs PSG · Nov 3");
assert.equal(formatGameOption({ sport: "mls", sportLabel: "MLS", title: "LAFC vs Miami" }), "Soccer · MLS · LAFC vs Miami");
assert.equal(formatGameOption({ sport: "epl", sportLabel: "EPL", title: "Arsenal vs Chelsea" }), "Soccer · EPL · Arsenal vs Chelsea");

const leg = (name, game, t) => ({ name, market: "ML", game, commence_time: t, sport: "soccer_usa_mls" });
const { rows, unmatched } = mapPromoLegsToKalshi([
  leg("San Diego FC ML", "San Diego FC @ Houston Dynamo FC", "2026-10-15T02:30:00Z"),
  leg("LA Galaxy ML", "San Diego FC @ LA Galaxy", "2026-10-18T02:30:00Z"),
  leg("San Diego FC ML", "San Diego FC @ LA Galaxy", "2026-10-18T02:30:00Z"),
  leg("Draw", "San Diego FC @ Houston Dynamo FC", "2026-10-15T02:30:00Z"),
  leg("San Diego FC ML", "San Diego FC @ Houston Dynamo FC", "2026-10-21T02:30:00Z"), // different day → not mapped
], { mls });
assert.deepEqual(rows.slice(0, 4).map((r) => r.marketVal), [
  "KXMLSGAME-26OCT14SDHOU-SD|yes",
  "KXMLSGAME-26OCT17LAGSD-LAG|yes",
  "KXMLSGAME-26OCT17LAGSD-SD|yes",
  "KXMLSGAME-26OCT14SDHOU-TIE|yes",
]);
assert.equal(rows[4].marketVal, "");
assert.equal(unmatched.length, 1);

for (const [a, b, ok] of [
  ["New York Red Bulls", "New York RB", true], ["New York City FC", "New York RB", false],
  ["Los Angeles FC", "Los Angeles F", true], ["LA Galaxy", "Los Angeles F", false],
  ["St. Louis City SC", "Saint Louis", true], ["CF Montréal", "Montreal", true],
  ["Manchester United", "Manchester City", false],
  ["PSG", "Paris Saint-Germain", true],
  ["Paris Saint-Germain FC", "PSG", true],
  ["Bayern Munich", "FC Bayern München", true],
  ["FC Bayern Munchen", "Bayern", true],
  ["Inter", "Internazionale", true],
  ["Inter", "FC Internazionale Milano", true],
  ["Inter", "Inter Miami CF", false],
  ["Inter Miami", "Internazionale", false],
  ["Sporting CP", "Sporting Clube de Portugal", true],
  ["Club Atlético de Madrid", "Atletico", true],
]) assert.equal(soccerNameMatches(a, b), ok, `${a} vs ${b}`);

// This week's UCL slate: promo leg "PSG ML" maps onto Kalshi's PSG yes, not Villarreal.
const uclEv = (key, a, b, an, bn) => ({
  event_ticker: `KXUCLGAME-${key}`, title: `${an} vs ${bn}`, sub_title: `${a} vs ${b}`,
  markets: [
    { ticker: `KXUCLGAME-${key}-${a}`, yes_sub_title: an, occurrence_datetime: "2026-11-03T23:00:00Z" },
    { ticker: `KXUCLGAME-${key}-${b}`, yes_sub_title: bn, occurrence_datetime: "2026-11-03T23:00:00Z" },
    { ticker: `KXUCLGAME-${key}-TIE`, yes_sub_title: "Tie", occurrence_datetime: "2026-11-03T23:00:00Z" },
  ],
});
const ucl = kg._helpers.groupSportGames({
  side: [
    uclEv("26NOV03VILPSG", "VIL", "PSG", "Villarreal", "PSG"),
    uclEv("26NOV03FEYINT", "FEY", "INT", "Feyenoord", "Inter"),
    uclEv("26NOV03ATMBMU", "ATM", "BMU", "Atletico", "Bayern Munich"),
  ],
}, Date.parse("2026-11-03T16:00:00Z"), { dateOnlyStart: true }).map((g) => ({ ...g, sport: "ucl" }));
const uclLeg = (name, game) => ({ name, market: "ML", game, commence_time: "2026-11-03T20:00:00Z", sport: "soccer_uefa_champs_league" });
const mapped = mapPromoLegsToKalshi([
  uclLeg("PSG ML", "Villarreal CF @ Paris Saint-Germain"),
  uclLeg("Draw", "FC Internazionale Milano @ Feyenoord Rotterdam"),
  uclLeg("Bayern Munich ML", "Atletico Madrid @ FC Bayern München"),
  uclLeg("Inter Miami CF ML", "Inter Miami CF @ Orlando City SC"),
], { ucl });
assert.equal(mapped.rows[0].marketVal, "KXUCLGAME-26NOV03VILPSG-PSG|yes");
assert.equal(mapped.rows[1].marketVal, "KXUCLGAME-26NOV03FEYINT-TIE|yes");
assert.equal(mapped.rows[2].marketVal, "KXUCLGAME-26NOV03ATMBMU-BMU|yes");
assert.equal(mapped.rows[3].marketVal, "");
assert.equal(mapped.unmatched.length, 1);
console.log("combo soccer tests passed");
