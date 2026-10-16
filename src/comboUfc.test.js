import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mapPromoLegsToKalshi, flattenComboGames } from "./comboPrefill.js";
const require = createRequire(import.meta.url);
const kg = require("../api/kalshi-games.js");

// Real Kalshi KXUFCFIGHT shapes (Oct 17 2026 card): two fighter markets per event,
// occurrence_datetime ~4h after walkout.
const ev = (key, a, b, an, bn, occ) => ({
  event_ticker: `KXUFCFIGHT-${key}`, title: `Fight Night: ${an} vs ${bn}`, sub_title: `${an.split(" ").pop()} vs ${bn.split(" ").pop()}`,
  markets: [
    { ticker: `KXUFCFIGHT-${key}-${a}`, yes_sub_title: an, occurrence_datetime: occ },
    { ticker: `KXUFCFIGHT-${key}-${b}`, yes_sub_title: bn, occurrence_datetime: occ },
  ],
});
const now = Date.parse("2026-10-16T19:00:00Z");
const ufc = kg._helpers.groupSportGames({ side: [
  ev("26OCT17CHOSTI", "CHO", "STI", "Katlyn Cerminara", "Mackenzie Stiller", "2026-10-18T02:00:00Z"),
  ev("26OCT17CHOYOU", "CHO", "YOU", "Cody Chovancek", "Soyoung You", "2026-10-18T03:00:00Z"),
  ev("26OCT17BUCMAL", "BUC", "MAL", "Joaquin Buckley", "Mike Malott", "2026-10-18T06:40:00Z"),
  ev("26MAR07BUCMAL", "BUC", "MAL", "Joaquin Buckley", "Mike Malott", "2027-03-08T06:40:00Z"),
] }, now, { occurrenceStartOffsetMs: kg.OCCURRENCE_START_OFFSET_MS.ufc }).map((g) => ({ ...g, sport: "ufc" }));
assert.ok(kg.MARKET_SERIES.ufc.side === "KXUFCFIGHT");
assert.equal(ufc.find((g) => g.key === "26OCT17BUCMAL").startTime, "2026-10-18T02:40:00.000Z"); // Odds API 02:45Z
assert.ok(flattenComboGames({ ufc }).every((g) => g.sportLabel === "UFC"));

const leg = (name, game, t) => ({ name: `${name} ML`, market: "ML", game, commence_time: t, sport: "mma_mixed_martial_arts" });
const { rows, unmatched } = mapPromoLegsToKalshi([
  leg("Su Young You", "Su Young You @ Cody Chovancek", "2026-10-17T21:10:00Z"),        // spacing
  leg("Katlyn Chookagian", "Katlyn Chookagian @ Mackenzie Stiller", "2026-10-17T22:25:00Z"), // name change, opp anchors
  leg("Mike Malott", "Mike Malott @ Joaquin Buckley", "2026-10-18T02:45:00Z"),          // Oct card, not March rematch
  leg("Mike Malott", "Mike Malott @ Joaquin Buckley", "2026-10-25T02:45:00Z"),          // >1.5 days from both → unmatched
  leg("Katlyn Smith", "Katlyn Smith @ Jane Doe", "2026-10-17T22:25:00Z"),               // first name only, no anchor
], { ufc });
assert.deepEqual(rows.map((r) => r.marketVal), [
  "KXUFCFIGHT-26OCT17CHOYOU-YOU|yes",
  "KXUFCFIGHT-26OCT17CHOSTI-CHO|yes",
  "KXUFCFIGHT-26OCT17BUCMAL-MAL|yes",
  "",
  "",
]);
assert.equal(unmatched.length, 2);
console.log("combo ufc tests passed");
