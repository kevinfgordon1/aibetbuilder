import assert from "node:assert";
import { positionBreakdown, positionState, sportOf } from "./sniperMatched.js";
const row = (id, legs, o = {}) => ({ rfq_id: id, legs, dry_run: false, status: "open", phase: "filled", filled_contracts: 100, filled_cost: 80, filled_fee: 0, created_at: "2026-10-25T08:00:00Z", ...o });
const R = { "KXNFLGAME-A-X": "yes", "KXNFLGAME-B-Y": "no", "KXNCAAFGAME-C-Z": "yes" };
const rows = [
  row("settled", ["KXNFLGAME-A-X:yes"], { phase: "settled", status: "released", realized_pnl: -81, settled_at: "2026-10-24T03:00:00Z" }),
  row("busted", ["KXNFLGAME-A-X:yes", "KXNFLGAME-B-Y:yes"]),          // B lost → we win 20
  row("allhit", ["KXNFLGAME-A-X:yes", "KXNCAAFGAME-C-Z:yes"]),        // all won → we lose 80
  row("live", ["KXNFLGAME-A-X:yes", "KXNFLGAME-D-W:yes"]),            // D pending
  row("dry", ["KXNFLGAME-B-Y:yes"], { dry_run: true }),
  row("unfilled", ["KXNFLGAME-B-Y:yes"], { filled_contracts: 0 }),
];
assert.strictEqual(positionState(rows[1], R).state, "busted");
assert.strictEqual(positionState(rows[2], R).state, "allHit");
assert.deepStrictEqual(positionState(rows[3], R).pending, ["KXNFLGAME-D-W:yes"]);
assert.strictEqual(positionState(row("no-side", ["KXNFLGAME-B-Y:no"]), R).state, "allHit", "No side that resolved No counts as a hit leg");
const b = positionBreakdown(rows, R);
assert.strictEqual(b.totals.settled.n, 1); assert.strictEqual(b.totals.settled.pnl, -81);
assert.strictEqual(b.totals.busted.pnl, 20); assert.strictEqual(b.totals.allHit.pnl, -80);
assert.strictEqual(b.totals.live.n, 1); assert.strictEqual(b.totals.live.maxWin, 20);
assert.strictEqual(b.decidedPnl, -141);
assert.strictEqual(b.positions.length, 3, "dry and unfilled rows excluded, settled not listed");
assert.strictEqual(b.positions[0].state, "allHit");
assert.strictEqual(sportOf(["KXNFLGAME-A:yes", "KXNCAAFGAME-C:yes"]), "CFB+NFL");
assert.ok(b.bySport.NFL && b.bySport["CFB+NFL"] && b.byDay["2026-10-25"]);
console.log("sniperBreakdown ok");
