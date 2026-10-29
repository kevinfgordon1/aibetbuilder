import assert from "node:assert";
import { legMeta, enginePositions, perfStats, rowMoney, isMatched, matchedStatus, isOpenRisk, isDecided, distinctGameCount } from "./sniperMatched.js";
import { rootFor } from "./rootForEngine.js";
assert.deepStrictEqual([legMeta("KXNFLGAME-26OCT25CINBAL-CIN:yes").bet, legMeta("KXNFLGAME-26OCT25CINBAL-CIN:yes").game], ["CIN to beat BAL", "CIN vs BAL"]);
const td = legMeta("KXNFLTD-26OCT25CINBAL-BALNVANNETT81-1:no", { "KXNFLTD-26OCT25CINBAL-BALNVANNETT81-1": "Nick Vannett: 1+ touchdowns" });
assert.strictEqual(td.bet, "Nick Vannett anytime TD — No"); assert.strictEqual(td.game, "BAL vs CIN"); assert.strictEqual(td.date, "2026-10-25");
const fill = { rfq_id: "f1", dry_run: false, status: "open", phase: "filled", legs: ["KXNFLGAME-26OCT25CINBAL-CIN:yes", "KXNFLGAME-26OCT25SFATL-SF:yes"], filled_contracts: 20, filled_cost: 10.3, filled_fee: 0, fair_yes: 0.4, roi: 0.03, created_at: "2026-10-22T16:48:00Z" };
const m = rowMoney(fill); assert.ok(Math.abs(m.toWin - 9.7) < 1e-9); assert.ok(Math.abs(m.ev - (20 * 0.6 - 10.3)) < 1e-9);
assert.ok(isMatched(fill)); assert.ok(!isMatched({ ...fill, filled_contracts: 0, phase: "quoted" })); assert.ok(!isMatched({ ...fill, dry_run: true }));
// house view: engine EV equals our expected profit (we win when any leg loses)
const pos = enginePositions([fill]); assert.strictEqual(pos[0].hit, -10.3); assert.ok(Math.abs(pos[0].miss - 9.7) < 1e-9);
const out = rootFor(pos, { "KXNFLGAME-26OCT25CINBAL": { CIN: 0.5, BAL: 0.5 }, "KXNFLGAME-26OCT25SFATL": { SF: 0.8, ATL: 0.2 } });
assert.ok(Math.abs(out.ev - (0.4 * -10.3 + 0.6 * 9.7)) < 1e-9);
const rows = [fill,
  { ...fill, rfq_id: "w", status: "released", phase: "settled", realized_pnl: 9.7, settled_at: "2026-10-26T01:00:00Z" },
  { ...fill, rfq_id: "l", status: "released", phase: "settled", realized_pnl: -10.3, settled_at: "2026-10-26T02:00:00Z", legs: ["KXNFLTD-26OCT25CINBAL-BALNVANNETT81-1:no", "KXNFLGAME-26OCT25SFATL-SF:yes"] }];
const s = perfStats(rows, { "KXNFLGAME-26OCT25SFATL-SF": "yes" });
assert.deepStrictEqual([s.total.won, s.total.lost, s.total.open], [1, 1, 1]);
assert.ok(Math.abs(s.total.pnl - -0.6) < 1e-9); assert.ok(Math.abs(s.total.roi - (-0.6 / 20.6)) < 1e-9);
assert.ok(Math.abs(s.total.expectedWins - 1.2) < 1e-9);
assert.strictEqual(s.curve.length, 2); assert.ok(Math.abs(s.curve[1].pnl - -0.6) < 1e-9);
assert.strictEqual(s.byMarket.find((g) => g.key === "ML + TD").lost, 1);
assert.strictEqual(s.beatUs[0].bet, "SF to beat ATL"); assert.strictEqual(matchedStatus(rows[1]), "won");
assert.strictEqual(perfStats([]).total.n, 0);
// a fill whose leg already lost (or whose legs all won) is decided, not open
const decidedResults = { "KXNFLGAME-26OCT25CINBAL-CIN": "no", "KXNFLGAME-26OCT26DALPHI-DAL": "yes" };
const busted = { ...fill, rfq_id: "bust", legs: ["KXNFLGAME-26OCT25CINBAL-CIN:yes", "KXNFLGAME-26OCT25SFATL-SF:yes"] };
const allHit = { ...fill, rfq_id: "hit", legs: ["KXNFLGAME-26OCT26DALPHI-DAL:yes"] };
const still = { ...fill, rfq_id: "still", legs: ["KXNFLGAME-26OCT26DALPHI-DAL:yes", "KXNFLGAME-26NOV01PHIWAS-WAS:yes"] };
assert.equal(isDecided(busted, decidedResults), true);
assert.equal(isOpenRisk(busted, decidedResults), false);
assert.equal(matchedStatus(busted, decidedResults), "decided");
assert.equal(isDecided(allHit, decidedResults), true);
assert.equal(isOpenRisk(still, decidedResults), true, "a won leg with one still pending stays open");
const ds = perfStats([still, busted, allHit], decidedResults);
assert.equal(ds.total.open, 1); assert.equal(ds.total.decided, 2);
assert.equal(distinctGameCount(["KXNFLGAME-26OCT26DALPHI", "KXNFLTD-26OCT26DALPHI-DALCDLAMB88-1", "KXNFLTOTAL-26OCT26DALPHI-45", "KXNFLGAME-26NOV01PHIWAS"]), 2);
console.log("sniperMatched.test.js ok");

// fillTimeOf: fill decision time, else created_at; never updated_at (settlement bumps it).
{
  const { fillTimeOf } = await import("./sniperMatched.js");
  const row = { created_at: "2026-10-23T07:16:56Z", updated_at: "2026-10-24T23:14:08Z" };
  assert.strictEqual(fillTimeOf(row, "2026-10-23T07:17:12Z"), "2026-10-23T07:17:12Z");
  assert.strictEqual(fillTimeOf(row, null), "2026-10-23T07:16:56Z");
  assert.strictEqual(fillTimeOf(row, "2026-10-23T12:00:00Z"), "2026-10-23T07:16:56Z");
}
