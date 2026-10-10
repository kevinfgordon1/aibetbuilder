import assert from "node:assert/strict";
import { lowCashText, openUserAlerts, openAlertsByUser, normalizeUserAlert } from "./lowCashAlerts.js";

let n = 0;
const row = (o) => ({ id: "a" + (n++), user_id: "u1", venue: "kalshi", parlay_id: "p1", created_at: "2026-10-09T20:00:00Z", ...o });

{
  const t = lowCashText(normalizeUserAlert(row({ shortfall_usd: 42.5, lock_label: "Guardians ML + Brewers ML" })));
  assert.equal(t.body, "Some of your Combo Locks quotes on Guardians ML + Brewers ML were skipped because your combos cash is too low. You're about $42.50 short. Add money on Kalshi or raise your Amount to keep for combos.");
  assert.ok(!/short\./.test(lowCashText(normalizeUserAlert(row({}))).body), "no shortfall line when unknown");
  assert.match(lowCashText(normalizeUserAlert(row({ venue: "polymarket" }))).body, /Polymarket US/);
}
{
  const rows = [row({ id: "1" }), row({ id: "2", created_at: "2026-10-09T21:00:00Z" }), row({ id: "3", resolved_at: "x" }), row({ id: "4", parlay_id: "p2", read_at: "x" })];
  assert.deepEqual(openUserAlerts(rows).map((a) => a.id), ["2"]);
  assert.deepEqual(openUserAlerts(rows, { includeRead: true }).map((a) => a.id), ["2", "4"]);
  const g = openAlertsByUser([row({ id: "5" }), row({ id: "6", user_id: "u2" })]);
  assert.deepEqual(Object.keys(g).sort(), ["u1", "u2"]);
}
assert.equal(lowCashText(normalizeUserAlert(row({ shortfall_usd: 18 })), { owner: true }).body, "Some of their Combo Locks quotes were skipped because their combos cash is too low. They're about $18.00 short. Add money on Kalshi or raise their Amount to keep for combos.");
console.log("lowCashAlerts tests passed");

// Out-of-credits alert (fee users) gets its own copy.
{
  const { lowCashText: t, openUserAlerts: o } = await import("./lowCashAlerts.js");
  const a = { kind: "no_credits", venue: "kalshi" };
  const x = t(a);
  if (x.title !== "Add credits to keep quoting" || !/Add credits on Combo Locks/.test(x.body)) throw new Error("no_credits copy");
  const rows = o([{ id: "1", user_id: "u", kind: "low_cash", created_at: "2026-10-09" }, { id: "2", user_id: "u", kind: "no_credits", created_at: "2026-10-09" }]);
  if (rows.length !== 2) throw new Error("no_credits and low_cash both show");
}
