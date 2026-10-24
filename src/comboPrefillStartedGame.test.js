import test from "node:test";
import assert from "node:assert/strict";
import { mapPromoLegsToKalshi, oneTeamOtherGames } from "./comboPrefill.js";

// Oct 24 2026: DraftKings "Arizona State Sun Devils -11.5" was K-State @ ASU
// (kickoff 3:45 PM ET). Kalshi had dropped it; the slate's other ASU game was
// ASU vs BYU on Oct 31. Never map or preselect that one.
const side = (l) => ({ label: l, ticker: l, side: "yes" });
const slate = { ncaaf: [
  { sport: "ncaaf", key: "26OCT23ISUARIZ", title: "Iowa St. vs Arizona", startTime: "2026-10-24T23:30:00Z", startExact: true, markets: { side: [side("Arizona"), side("Iowa St.")], spread: [], total: [] } },
  { sport: "ncaaf", key: "26OCT30ASUBYU", title: "Arizona St. vs BYU", startTime: "2026-10-31T19:30:00Z", startExact: true, markets: { side: [side("BYU"), side("Arizona St.")], spread: [{ label: "Arizona St. wins by over 11.5 Points", ticker: "S", side: "yes" }], total: [] } },
  { sport: "ncaaf", key: "26OCT30ARIZTTU", title: "Arizona vs Texas Tech", startTime: "2026-10-31T16:00:00Z", startExact: true, markets: { side: [side("Texas Tech"), side("Arizona")], spread: [], total: [] } },
] };
const now = Date.parse("2026-10-24T19:46:00Z");
const leg = (ct) => ({ sport: "americanfootball_ncaaf", market: "SPR", name: "Arizona State Sun Devils -11.5", game: "Kansas State Wildcats @ Arizona State Sun Devils", commence_time: ct });

test("started leg: no game preselected, clear started reason naming the other ASU game", () => {
  const { rows, unmatched } = mapPromoLegsToKalshi([leg("2026-10-24T19:45:00Z")], slate, now);
  assert.deepEqual(rows, [{ gameKey: "", marketVal: "" }]);
  assert.match(unmatched[0].reason, /already started \(kickoff Oct 24, 3:45 PM ET\)/);
  assert.match(unmatched[0].reason, /Arizona St\. vs BYU \(Oct 31\) is a different game — don't pick it/);
  assert.doesNotMatch(unmatched[0].reason, /Iowa St\. vs Arizona|Texas Tech/, "Arizona ≠ Arizona State");
});

test("leg without kickoff still never maps onto a different ASU game", () => {
  const { rows } = mapPromoLegsToKalshi([leg(undefined)], slate, now);
  assert.equal(rows[0].gameKey, "");
});

test("one-team lookup skips started games", () => {
  const out = oneTeamOtherGames(leg(), slate.ncaaf, Date.parse("2026-11-01T00:00:00Z"));
  assert.deepEqual(out, []);
});
