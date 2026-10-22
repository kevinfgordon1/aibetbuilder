import assert from "node:assert";
import { summarizeLedger, quoteRow, skipsByHour, statusFrom, americanFromProb, rowState } from "./sniperDashboard.js";
const T = "2026-10-22";
const rows = [
  { rfq_id: "a", status: "open", phase: "filled", risk: 90, games: ["26OCT25CINBAL", "26OCT25INDMIN"], created_at: "2026-10-22T15:00:00Z" },
  { rfq_id: "b", status: "open", phase: "quoted", risk: 50, games: ["26OCT25CINBAL"], created_at: "2026-10-22T16:00:00Z" },
  { rfq_id: "c", status: "released", phase: "settled", risk: 80, realized_pnl: -80, settled_at: "2026-10-22T20:00:00Z", created_at: "2026-10-21T15:00:00Z" },
  { rfq_id: "d", status: "released", phase: "settled", risk: 60, realized_pnl: 25, settled_at: "2026-10-21T20:00:00Z", created_at: "2026-10-20T15:00:00Z" },
  { rfq_id: "e", status: "released", phase: "cancelled", risk: 70, created_at: "2026-10-22T17:00:00Z" },
];
const s = summarizeLedger(rows, T);
assert.strictEqual(s.open, 140);
assert.deepStrictEqual(s.maxGame, { game: "26OCT25CINBAL", risk: 140 });
assert.strictEqual(s.dayRisk, 140);
assert.strictEqual(s.dayLoss, 80);
assert.strictEqual(s.runningPnl, -55);
assert.deepStrictEqual(s.days.map((d) => [d.day, d.pnl, d.running]), [["2026-10-21", 25, 25], ["2026-10-22", -80, -55]]);
assert.strictEqual(americanFromProb(0.25), 300); assert.strictEqual(americanFromProb(0.6), -150);
assert.strictEqual(rowState(rows[2]), "lost"); assert.strictEqual(rowState(rows[3]), "won");
assert.strictEqual(quoteRow({ fair_yes: 0.25, quote_yes: 0.2, roi: 0.04 }).fairAmerican, 300);
const sk = skipsByHour([
  { created_at: "2026-10-22T16:01:00Z", details: { counts: { skips: { a: 2, b: 1 } } } },
  { created_at: "2026-10-22T16:30:00Z", details: { counts: { skips: { a: 3 } } } },
  { created_at: "2026-10-22T17:01:00Z", details: { counts: { skips: { b: 4 } } } },
]);
assert.deepStrictEqual(sk.reasons, ["a", "b"]);
assert.deepStrictEqual(sk.hours[0], { hour: "2026-10-22 12:00", a: 5, b: 1 });
const st = statusFrom({ created_at: "2026-10-22T16:00:00Z", details: { mode: "dry", halted: false, kickoffs: { espn: 14 } } }, Date.parse("2026-10-22T16:01:00Z"));
assert.strictEqual(st.mode, "dry"); assert.strictEqual(st.stale, false); assert.strictEqual(st.kickoffs.espn, 14);
assert.strictEqual(statusFrom(null, 0).mode, "unknown");
console.log("sniperDashboard.test.js ok");
