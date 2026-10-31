import assert from "node:assert";
import { fillDrift, driftSummary } from "./sniperDrift.js";
import { leagueOfLeg, leagueOfFill, fillMatchesLeague, pregameView } from "./sniperLeague.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const mk = (closeF) => ({ filledAt: "2026-10-24T01:00:00Z", contracts: 100, risk: 80, fairYes: 0.25, legs: [{ ticker: "KXNFLGAME-X-CIN", fillFair: 0.5, fillVenue: "kalshi", close: closeF == null ? null : { fair: closeF } }, { ticker: "KXNBAGAME-X-PHI", fillFair: 0.5, fillVenue: "novig", close: { fair: 0.5 } }] });
// drift
assert.strictEqual(fillDrift(mk(null)).status, "no close");
const d = fillDrift(mk(0.6)); near(d.evFill, -5); near(d.evClose, -10); near(d.driftPts, -6.25);
const s = driftSummary([...Array.from({ length: 30 }, () => mk(0.6)), mk(null)]);
assert.strictEqual(s.total.n, 30); assert.strictEqual(s.noClose, 1); assert.strictEqual(s.warn, true); assert.strictEqual(s.breakdown.Sport[0].key, "Mixed");
assert.strictEqual(driftSummary(Array.from({ length: 10 }, () => mk(0.6))).warn, false);
assert.strictEqual(driftSummary(Array.from({ length: 40 }, () => mk(0.5))).warn, false);
// per-leg league + filter
assert.strictEqual(leagueOfLeg("KXNBAGAME-X-PHI"), "NBA"); assert.strictEqual(leagueOfLeg("KXNCAAFSPREAD-X"), "NCAAF"); assert.strictEqual(leagueOfLeg("KXNFLTD-X"), "NFL");
assert.strictEqual(leagueOfLeg("KXNCAAMBGAME-26NOV01VILLND-VILL"), "NCAAB"); assert.strictEqual(leagueOfLeg("KXNCAAMBSPREAD-26NOV01VILLND-VILL5"), "NCAAB"); assert.strictEqual(leagueOfLeg("KXNCAAFGAME-X-ND"), "NCAAF");
const mixed = { legs: [{ ticker: "KXNCAAFGAME-X-NW" }, { ticker: "KXNBAGAME-X-PHI" }] }, nfl = { legs: [{ ticker: "KXNFLGAME-X-CIN" }, { ticker: "KXNFLTD-X-W" }] };
assert.strictEqual(leagueOfFill(mixed), "Mixed"); assert.strictEqual(leagueOfFill(nfl), "NFL");
assert.ok(fillMatchesLeague(mixed, "NBA") && fillMatchesLeague(mixed, "NCAAF") && fillMatchesLeague(mixed, "Mixed") && fillMatchesLeague(mixed, ""));
assert.ok(!fillMatchesLeague(mixed, "NFL") && !fillMatchesLeague(nfl, "Mixed"));
// needle pregame view: centered on fill-time EV, live kept as "now"
const pg = pregameView({ ev: -17, hist: { bins: [{ from: -100, to: 0, p: 0.5 }, { from: 0, to: 100, p: 0.5 }] }, worst: { pnl: -100 }, best: { pnl: 100 } }, 181);
assert.strictEqual(pg.ev, 181); assert.strictEqual(pg.now, -17); assert.strictEqual(pg.hist.bins[0].from, 98); assert.strictEqual(pg.worst.pnl, 98); assert.strictEqual(pg.pProfit, 1);
assert.strictEqual(pregameView(null, 5), null);
console.log("sniperDrift + sniperLeague: ok");
