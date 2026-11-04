import assert from "node:assert/strict";
import { mapPromoLegsToKalshi, slateIncomplete } from "./comboPrefill.js";

// Nov 4 2026 (Kevin): Promo -> Combo Locks with two NCAAB unders. Kalshi lists both exact strikes
// (KXNCAAMBTOTAL-26NOV04SELAAUB-152 "Over 151.5 points", KXNCAAMBTOTAL-26NOV04UMESHP-148 "Over 147.5 points").
const game = (key, title, sides, totals) => ({
  key, title, date: "Nov 4", startTime: "2026-11-05T01:00:00.000Z", startExact: true, sport: "ncaab", comboEligible: true,
  markets: {
    side: sides.map(([t, label]) => ({ ticker: `KXNCAAMBGAME-${key}-${t}`, side: "yes", label })),
    spread: [],
    total: totals.flatMap((line) => [
      { ticker: `KXNCAAMBTOTAL-${key}-${Math.ceil(line)}`, side: "yes", label: `Over ${line}`, sort: line },
      { ticker: `KXNCAAMBTOTAL-${key}-${Math.ceil(line)}`, side: "no", label: `Under ${line}`, sort: line + 0.001 },
    ]),
  },
});
const full = { ncaab: [
  game("26NOV04SELAAUB", "Southeastern Louisiana vs Auburn", [["AUB", "Auburn"], ["SELA", "Southeastern Louisiana"]], [146.5, 149.5, 151.5, 153.5]),
  game("26NOV04UMESHP", "Maryland-Eastern Shore vs High Point", [["HP", "High Point"], ["UMES", "Maryland-Eastern Shore"]], [144.5, 147.5, 149.5]),
] };
const legs = [
  { name: "SE Louisiana Lions/Auburn Tigers u151.5", market: "TOT", sport: "basketball_ncaab", game: "SE Louisiana Lions @ Auburn Tigers", commence_time: "2026-11-05T01:00:00Z" },
  { name: "Maryland-Eastern Shore Hawks/High Point Panthers u147.5", market: "TOT", sport: "basketball_ncaab", game: "Maryland-Eastern Shore Hawks @ High Point Panthers", commence_time: "2026-11-05T01:00:00Z" },
];
const now = Date.parse("2026-11-04T20:00:00Z");

const ok = mapPromoLegsToKalshi(legs, full, now);
assert.deepEqual(ok.unmatched, []);
assert.equal(ok.rows[0].marketVal, "KXNCAAMBTOTAL-26NOV04SELAAUB-152|no");
assert.equal(ok.rows[1].marketVal, "KXNCAAMBTOTAL-26NOV04UMESHP-148|no");

// The bad prod slate: totals failed to load, so every game has total: []. The server now flags it as partial
// (and does not cache it), and the client treats it as incomplete and reloads.
const broken = { ncaab: full.ncaab.map((g) => ({ ...g, markets: { ...g.markets, total: [] } })) };
assert.equal(mapPromoLegsToKalshi(legs, broken, now).unmatched.length, 2);
assert.equal(slateIncomplete({ sports: broken, partial: { ncaab: ["total"] } }), true);
assert.equal(slateIncomplete({ sports: full, failed: ["nba"] }), true);
assert.equal(slateIncomplete({ sports: full }), false);
assert.equal(slateIncomplete({ sports: full, partial: {} }), false);
assert.equal(slateIncomplete(null), false);
console.log("combo prefill partial slate: ok");
