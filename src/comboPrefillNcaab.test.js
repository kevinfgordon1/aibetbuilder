import assert from "node:assert/strict";
import { mapPromoLegsToKalshi, encVal, COMBO_SPORT_ORDER, COMBO_SPORT_LABEL, COLLEGE_COMBO_SPORTS, flattenComboGames } from "./comboPrefill.js";
import { sportFromTicker, espnQueryForLeg } from "./comboLegResult.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const espn = require("../api/espn-scores.js")._helpers;

// NCAAB (men's college basketball) on Combo Locks, Kevin Oct 30 2026.
assert.ok(COMBO_SPORT_ORDER.includes("ncaab"));
assert.equal(COMBO_SPORT_LABEL.ncaab, "NCAAB");
assert.ok(COLLEGE_COMBO_SPORTS.has("ncaab") && COLLEGE_COMBO_SPORTS.has("ncaaf"));

const ndVill = {
  key: "26NOV01NDVILL", sport: "ncaab", title: "Notre Dame vs Villanova", date: "ND vs VILL (Nov 1)",
  startTime: "2026-11-01T14:30:00.000Z", startExact: true,
  markets: {
    side: [
      { ticker: "KXNCAAMBGAME-26NOV01NDVILL-VILL", side: "yes", label: "Villanova" },
      { ticker: "KXNCAAMBGAME-26NOV01NDVILL-ND", side: "yes", label: "Notre Dame" },
    ],
    spread: [
      { ticker: "KXNCAAMBSPREAD-26NOV01NDVILL-VILL8", side: "yes", label: "Villanova \u22127.5" },
      { ticker: "KXNCAAMBSPREAD-26NOV01NDVILL-VILL8", side: "no", label: "Notre Dame +7.5" },
    ],
    total: [
      { ticker: "KXNCAAMBTOTAL-26NOV01NDVILL-140", side: "yes", label: "Over 139.5" },
      { ticker: "KXNCAAMBTOTAL-26NOV01NDVILL-140", side: "no", label: "Under 139.5" },
    ],
  },
};
const SPORTS = { ncaab: [ndVill] };
const game = "Villanova Wildcats @ Notre Dame Fighting Irish";
const legs = [
  { name: "Villanova Wildcats ML", market: "ML", game, sport: "basketball_ncaab", commence_time: "2026-11-01T14:30:00Z" },
  { name: "Notre Dame Fighting Irish +7.5", market: "SPR", game, sport: "basketball_ncaab", commence_time: "2026-11-01T14:30:00Z" },
  { name: "Over 139.5", market: "TOT", game, sport: "basketball_ncaab", commence_time: "2026-11-01T14:30:00Z" },
];
const out = mapPromoLegsToKalshi(legs, SPORTS, Date.parse("2026-10-31T02:00:00Z"));
assert.equal(out.unmatched.length, 0, JSON.stringify(out.unmatched));
assert.equal(out.rows[0].marketVal, encVal("KXNCAAMBGAME-26NOV01NDVILL-VILL", "yes"));
assert.equal(out.rows[1].marketVal, encVal("KXNCAAMBSPREAD-26NOV01NDVILL-VILL8", "no"));
assert.equal(out.rows[2].marketVal, encVal("KXNCAAMBTOTAL-26NOV01NDVILL-140", "yes"));
assert.equal(flattenComboGames(SPORTS)[0].sportLabel, "NCAAB");

// A college football leg never lands on the basketball game with the same schools.
const cfb = mapPromoLegsToKalshi([{ name: "Notre Dame Fighting Irish ML", market: "ML", game, sport: "americanfootball_ncaaf" }], SPORTS, Date.parse("2026-10-31T02:00:00Z"));
assert.equal(cfb.unmatched.length, 1);

// Results: KXNCAAMB tickers are NCAAB and query ESPN's D1 men's college basketball scoreboard.
assert.equal(sportFromTicker("KXNCAAMBGAME-26NOV01NDVILL-VILL"), "ncaab");
assert.equal(sportFromTicker("KXNCAAFGAME-26NOV01NDVILL-ND"), "ncaaf");
assert.deepEqual(espnQueryForLeg({ ticker: "KXNCAAMBGAME-26NOV01NDVILL-VILL", gameKey: "26NOV01NDVILL" }), { sport: "ncaab", date: "20261101" });
assert.deepEqual(espn.queriesFromReq({ query: { queries: "ncaab:20261101,nba:20261101" } }), [{ sport: "ncaab", date: "20261101" }, { sport: "nba", date: "20261101" }]);
assert.match(espn.scoreboardUrl("ncaab", "20261101"), /mens-college-basketball\/scoreboard\?dates=20261101&groups=50&limit=500$/);

console.log("comboPrefill ncaab: ok");
