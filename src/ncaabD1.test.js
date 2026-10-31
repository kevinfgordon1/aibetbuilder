import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { isD1Game, isD1Team, d1Team } from "./ncaabD1.js";
import { gamesFromFreeFeeds } from "./freeFeedBoard.js";
import { sportByLeague, leagueForSport } from "./betstampBooks.js";
const require = createRequire(import.meta.url);
const cjs = require("../lib/ncaab-d1.js");
const kalshi = require("../api/fixtures-kalshi-ncaamb.json");

// ESM twin agrees with the server copy on every name we know.
const names = ["Villanova", "Notre Dame", "Villanova Wildcats", "Notre Dame Fighting Irish", "Grambling St.", "Miami (FL)", "Miami (OH)",
  "San Jose St.", "LIU", "Queens University", "Fisk", "Bethesda", "Mercer", "Reinhardt", "", null,
  ...kalshi.side.flatMap((e) => e.markets.map((m) => m.yes_sub_title))];
for (const n of names) assert.equal(isD1Team(n), cjs.isD1Team(n), `disagree on ${n}`);
assert.equal(d1Team("Miami (FL)").espnId, d1Team("Miami Hurricanes").espnId);
assert.notEqual(d1Team("Miami (OH)").espnId, d1Team("Miami (FL)").espnId);
assert.ok(isD1Game("Villanova Wildcats", "Notre Dame Fighting Irish"));
assert.ok(!isD1Game("Fisk", "Middle Tennessee"));

// New Odds Board has an NCAAB tab.
assert.equal(sportByLeague("NCAAB").id, "basketball_ncaab");
assert.equal(leagueForSport("basketball_ncaab"), "NCAAB");

// Board: Underdog phone games for NCAAB keep D1 vs D1 only; NCAAF board ignores NCAAB phone games.
const phone = { games: [
  { sport: "NCAAB", away: "Villanova Wildcats", home: "Notre Dame Fighting Irish", scheduledAt: "2026-11-01T14:30:00Z", lines: [] },
  { sport: "NCAAB", away: "Fisk Bulldogs", home: "Middle Tennessee Blue Raiders", scheduledAt: "2026-11-02T16:30:00Z", lines: [] },
] };
const now = Date.parse("2026-10-31T02:00:00Z");
const board = gamesFromFreeFeeds({ league: "NCAAB", underdog: phone, nowMs: now });
assert.deepEqual(board.map((g) => `${g.away}|${g.home}`), ["Villanova Wildcats|Notre Dame Fighting Irish"]);
assert.equal(gamesFromFreeFeeds({ league: "NCAAF", underdog: phone, nowMs: now }).length, 0);
console.log("ncaabD1: ok");
