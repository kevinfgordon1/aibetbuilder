import assert from "node:assert/strict";
import {
  validateFillAmerican,
  resolveExchangeFill,
  displayFillForEdit,
  fillEditLabel,
  fillEditedNote,
  openQuotesForLock,
  openQuoteLabel,
  fillEditParlayPatch,
  canManageLock,
  cancelOpenParlayPatch,
  cancelQuoteSubmissionPatch,
  COMBO_FEE_RATE,
  exchangeFromAllIn,
  allInFromExchange,
} from "./comboLockEdit.js";

assert.equal(validateFillAmerican("").ok, false);
assert.equal(validateFillAmerican(50).ok, false);
assert.equal(validateFillAmerican(1200).ok, true);
assert.equal(validateFillAmerican(-150).american, -150);

const feeFree = resolveExchangeFill(1200, { feesEnabled: false });
assert.equal(feeFree.fillAmerican, 1200);

const feeOn = resolveExchangeFill(allInFromExchange(1150), { feesEnabled: true });
assert.ok(feeOn.ok);
assert.equal(feeOn.fillAmerican, exchangeFromAllIn(allInFromExchange(1150)));
assert.ok(feeOn.fillAmerican <= 1150, "exchange never worse than all-in reverse");

assert.equal(fillEditLabel(true), "Your all-in price (includes 1% fee)");
assert.equal(fillEditLabel(false), "Sell at (odds you offer, after fees)");

const parlay = {
  id: "p1",
  user_id: "u1",
  fill_american: 1150,
  parlay_stake: 100,
  parlay_american: 2000,
  hedge_mode: "1x",
  bet_type: "cash",
  max_contracts: 3000,
  fill_edited_at: "2026-10-10T04:40:00Z",
};
assert.equal(displayFillForEdit(parlay, { feesEnabled: false }), "1150");
assert.equal(Number(displayFillForEdit(parlay, { feesEnabled: true })), allInFromExchange(1150));
assert.match(fillEditedNote(parlay), /Fill odds edited/);
assert.equal(fillEditedNote({}), "");

const patch = fillEditParlayPatch(parlay, 1000, { filled: 50, now: new Date("2026-10-10T05:00:00Z") });
assert.equal(patch.fill_american, 1000);
assert.equal(patch.fill_edited_at, "2026-10-10T05:00:00.000Z");
assert.equal(patch.cancel_open_at, patch.fill_edited_at);
assert.ok(patch.max_contracts >= 50);

const opens = openQuotesForLock([
  { id: "s1", parlay_id: "p1", is_live: true, quote_id: "q1", contracts: 100, venue: "kalshi", fill_american: 1150, created_at: "2026-10-10T04:00:00Z" },
  { id: "s2", parlay_id: "p1", is_live: false, status: "filled", quote_id: "q2", order_id: "o2", contracts: 50, created_at: "2026-10-10T03:00:00Z" },
  { id: "s3", parlay_id: "p1", is_live: true, quote_id: "q3", cancel_requested_at: "2026-10-10T04:30:00Z", created_at: "2026-10-10T04:10:00Z" },
  { id: "s4", parlay_id: "other", is_live: true, quote_id: "q4", created_at: "2026-10-10T04:20:00Z" },
], "p1");
assert.equal(opens.length, 1);
assert.equal(opens[0].id, "s1");
assert.match(openQuoteLabel(opens[0]), /Kalshi/);

assert.equal(canManageLock({ id: "u1" }, parlay), true);
assert.equal(canManageLock({ id: "u2" }, parlay), false);
assert.equal(canManageLock({ id: "u2" }, parlay, { isOwner: true }), true);

assert.ok(cancelOpenParlayPatch(new Date("2026-10-10T05:00:00Z")).cancel_open_at);
assert.ok(cancelQuoteSubmissionPatch(new Date("2026-10-10T05:00:00Z")).cancel_requested_at);
assert.equal(COMBO_FEE_RATE, 0.01);

console.log("comboLockEdit.test.js ok");
