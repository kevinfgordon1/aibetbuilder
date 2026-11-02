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

// Nov 2 2026 (Kevin): Odds API spellings vs Kalshi labels. Combo Locks now identifies NCAAB teams with the
// shared D1 table, so all of these match, and each ML leg lands on its own team's contract.
{
  const g = (key, a, aCode, h, hCode) => ({
    key, sport: "ncaab", title: `${a} vs ${h}`, startTime: "2026-11-03T01:00:00.000Z", startExact: true,
    markets: { side: [
      { ticker: `KXNCAAMBGAME-${key}-${hCode}`, side: "yes", label: h },
      { ticker: `KXNCAAMBGAME-${key}-${aCode}`, side: "yes", label: a },
    ] },
  });
  const slate = { ncaab: [
    g("26NOV02AMCCTXST", "Texas A&M-Corpus Christi", "AMCC", "Texas St.", "TXST"),
    g("26NOV02BGSUGAST", "Bowling Green", "BGSU", "Georgia St.", "GAST"),
    g("26NOV02NAVYGW", "Navy", "NAVY", "George Washington", "GW"),
    g("26NOV02UMKCCREI", "Kansas City", "UMKC", "Creighton", "CREI"),
    g("26NOV02FAMUFSU", "Florida A&M", "FAMU", "Florida St.", "FSU"),
    g("26NOV02FLAMIA", "Florida", "FLA", "Miami (FL)", "MIA"),
  ] };
  const cases = [
    ["Texas A&M-CC Islanders @ Texas State Bobcats", "Texas State Bobcats ML", "KXNCAAMBGAME-26NOV02AMCCTXST-TXST"],
    ["Texas A&M-CC Islanders @ Texas State Bobcats", "Texas A&M-CC Islanders ML", "KXNCAAMBGAME-26NOV02AMCCTXST-AMCC"],
    ["Bowling Green Falcons @ Georgia St Panthers", "Georgia St Panthers ML", "KXNCAAMBGAME-26NOV02BGSUGAST-GAST"],
    ["Navy Midshipmen @ GW Revolutionaries", "GW Revolutionaries ML", "KXNCAAMBGAME-26NOV02NAVYGW-GW"],
    ["UMKC Kangaroos @ Creighton Bluejays", "UMKC Kangaroos ML", "KXNCAAMBGAME-26NOV02UMKCCREI-UMKC"],
    ["Florida A&M Rattlers @ Florida St Seminoles", "Florida St Seminoles ML", "KXNCAAMBGAME-26NOV02FAMUFSU-FSU"],
    ["Florida A&M Rattlers @ Florida St Seminoles", "Florida A&M Rattlers ML", "KXNCAAMBGAME-26NOV02FAMUFSU-FAMU"],
    ["Florida Gators @ Miami Hurricanes", "Florida Gators ML", "KXNCAAMBGAME-26NOV02FLAMIA-FLA"],
  ];
  for (const [game, name, ticker] of cases) {
    const r = mapPromoLegsToKalshi([{ name, market: "ML", game, sport: "basketball_ncaab", commence_time: "2026-11-03T01:00:00Z" }], slate, Date.parse("2026-11-02T18:00:00Z"));
    assert.equal(r.unmatched.length, 0, `${name}: ${JSON.stringify(r.unmatched)}`);
    assert.equal(r.rows[0].marketVal, encVal(ticker, "yes"), name);
  }
}

console.log("comboPrefill ncaab: ok");
