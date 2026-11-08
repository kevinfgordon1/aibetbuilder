import assert from "node:assert/strict";
import {
  RESOLVE_ATTEMPT_LIMIT,
  classifyOfficialOrder,
  classifyLookup,
  mergeVerifiedTrack,
  protectCancelRecord,
  sameTrack,
} from "./liveDeskOrderTrack.js";

const packers = {
  id: "DKRCBER013ZK",
  marketSlug: "aec-nfl-ari-gb-2026-11-08",
  intent: "ORDER_INTENT_BUY_LONG",
  price: { value: "0.7125", currency: "USD" },
  quantity: 1403.5,
  cumQuantity: 0,
  leavesQuantity: 1403.5,
  state: "ORDER_STATE_NEW",
  createTime: "2026-11-08T22:23:14.000Z",
};

assert.equal(classifyOfficialOrder({ order: packers }).verifiedState, "open");
assert.equal(classifyOfficialOrder({ order: { ...packers, state: "ORDER_STATE_PARTIALLY_FILLED", cumQuantity: 40, leavesQuantity: 1363.5 } }).verifiedState, "partial");
assert.equal(classifyOfficialOrder({ order: { ...packers, state: "ORDER_STATE_FILLED", cumQuantity: 1403.5, leavesQuantity: 0, avgPx: { value: "0.7125" }, commissionNotionalTotalCollected: { value: "1.20" }, updateTime: "2026-11-08T22:34:10.000Z" } }).verifiedState, "filled");

const partialThenCancel = classifyOfficialOrder({
  order: {
    ...packers,
    state: "ORDER_STATE_CANCELED",
    cumQuantity: 40,
    leavesQuantity: 0,
    avgPx: { value: "0.71" },
    commissionNotionalTotalCollected: { value: "0.04" },
    updateTime: "2026-11-08T22:34:20.000Z",
  },
});
assert.equal(partialThenCancel.verifiedState, "canceled");
assert.equal(partialThenCancel.cumQty, 40);
assert.equal(partialThenCancel.avgYesPrice, 0.71);
assert.equal(partialThenCancel.fees, 0.04);
assert.notEqual(partialThenCancel.verifiedState, "filled");

assert.equal(classifyOfficialOrder({ order: { ...packers, state: "ORDER_STATE_EXPIRED", cumQuantity: 0 } }).verifiedState, "expired");
assert.equal(classifyOfficialOrder({ order: { ...packers, state: "ORDER_STATE_PENDING_CANCEL", cumQuantity: 10 } }).verifiedState, "partial");
assert.equal(classifyOfficialOrder({ order: { ...packers, state: "ORDER_STATE_REJECTED", cumQuantity: 0 } }).verifiedState, "canceled");

const missing = classifyLookup({ disappeared: true });
assert.equal(missing.verifiedState, "unknown");
assert.equal(missing.unknownReason, "disappeared");
assert.notEqual(missing.verifiedState, "filled");

const notFound = classifyLookup({ error: { statusCode: 404 } });
assert.equal(notFound.unknownReason, "not_found");
const blip = classifyLookup({ error: { statusCode: 503 } });
assert.equal(blip.unknownReason, "read_error");

const firstMiss = mergeVerifiedTrack(null, { ...notFound, orderId: packers.id, ownerEmail: "Kevin@Example.com" });
assert.equal(firstMiss.verifiedState, "unknown");
assert.equal(firstMiss.resolveAttempts, 1);
assert.equal(firstMiss.ownerEmail, "kevin@example.com");

let missed = firstMiss;
for (let i = 2; i < RESOLVE_ATTEMPT_LIMIT; i += 1) {
  missed = mergeVerifiedTrack(missed, notFound);
  assert.equal(missed.verifiedState, "unknown");
  assert.equal(missed.resolveAttempts, i);
}
const gaveUp = mergeVerifiedTrack(missed, notFound);
assert.equal(gaveUp.resolveAttempts, RESOLVE_ATTEMPT_LIMIT);
assert.equal(gaveUp.verifiedState, "unknown");

const filled = classifyOfficialOrder({
  order: { ...packers, state: "ORDER_STATE_FILLED", cumQuantity: 1403.5, leavesQuantity: 0, avgPx: { value: "0.7125" } },
});
const kept = mergeVerifiedTrack({ ...filled, orderId: packers.id }, notFound);
assert.equal(kept.verifiedState, "filled");
assert.equal(kept.cumQty, 1403.5);

const again = mergeVerifiedTrack(kept, filled);
assert.equal(sameTrack(kept, again), true);

const openThenCancel = mergeVerifiedTrack(
  { ...classifyOfficialOrder({ order: packers }), orderId: packers.id },
  partialThenCancel,
);
assert.equal(openThenCancel.verifiedState, "canceled");
assert.equal(openThenCancel.cumQty, 40);

const staleOpen = mergeVerifiedTrack(
  { ...filled, orderId: packers.id },
  classifyOfficialOrder({ order: packers }),
);
assert.equal(staleOpen.verifiedState, "filled", "a later open snapshot does not erase a verified fill");

const cancelNote = protectCancelRecord({
  order_id: "ord-1",
  owner_email: "k@example.com",
  market_slug: "m",
  lineage_id: "ord-1",
}, { replacedBy: "ord-2" });
assert.equal(cancelNote.verifiedState, "canceled");
assert.equal(cancelNote.cumQty, null);
assert.equal(cancelNote.replacedBy, "ord-2");
const linked = mergeVerifiedTrack({ ...filled, orderId: "ord-1", ownerEmail: "k@example.com" }, cancelNote);
assert.equal(linked.verifiedState, "canceled");
assert.equal(linked.replacedBy, "ord-2");

console.log("liveDeskOrderTrack.test.js ok");
