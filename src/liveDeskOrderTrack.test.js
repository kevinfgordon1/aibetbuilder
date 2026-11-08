import assert from "node:assert/strict";
import { createMemoryOrderTrackStore } from "../lib/desk-order-tracks.js";
import {
  RESOLVE_ATTEMPT_LIMIT,
  classifyOfficialOrder,
  classifyLookup,
  executedRiskDollars,
  lineagePriorSpent,
  mergeVerifiedTrack,
  protectCancelRecord,
  replacementGate,
  sameTrack,
  tracksNeedingLookup,
  TRACK_LOOKUP_LIMIT,
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
assert.equal(partialThenCancel.verifiedState, "partial_canceled");
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
assert.equal(openThenCancel.verifiedState, "partial_canceled");
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
assert.equal(cancelNote.verifiedState, "unknown");
assert.equal(cancelNote.unknownReason, "cancel_unreconciled");
assert.equal(cancelNote.cumQty, null);
const linked = mergeVerifiedTrack({ ...filled, orderId: "ord-1", ownerEmail: "k@example.com" }, cancelNote);
assert.equal(linked.verifiedState, "filled", "an unreconciled cancel does not erase a verified fill");
assert.equal(linked.cumQty, 1403.5);

const reconciled = protectCancelRecord({
  order_id: "ord-1",
  owner_email: "k@example.com",
  market_slug: "m",
}, { replacedBy: "ord-2", official: partialThenCancel });
assert.equal(reconciled.verifiedState, "partial_canceled");
assert.equal(reconciled.cumQty, 40);
assert.equal(reconciled.avgYesPrice, 0.71);
assert.equal(reconciled.replacedBy, "ord-2");

const fullReplace = replacementGate({
  official: classifyOfficialOrder({ order: { ...packers, state: "ORDER_STATE_CANCELED", cumQuantity: 0, leavesQuantity: 0 } }),
  observedLeaves: 1403.5,
});
assert.equal(fullReplace.replace, true);
assert.equal(fullReplace.leaves, 1403.5);

const raced = replacementGate({
  official: partialThenCancel,
  observedLeaves: 1403.5,
  outcomeShort: false,
});
assert.equal(raced.replace, true);
assert.equal(raced.leaves, 1363.5);
assert.ok(raced.roomDollars < 1000);

const noPrice = replacementGate({
  official: { ...partialThenCancel, avgYesPrice: null },
  observedLeaves: 1403.5,
});
assert.equal(noPrice.replace, false);
assert.equal(noPrice.reason, "fill-cost-unknown");

const unconfirmed = replacementGate({ official: cancelNote, observedLeaves: 10 });
assert.equal(unconfirmed.replace, false);
assert.equal(unconfirmed.reason, "unconfirmed");

const over = replacementGate({
  official: { ...partialThenCancel, cumQuantity: 40, avgYesPrice: 0.99, orderQty: 50 },
  observedLeaves: 10,
  priorSpentDollars: 990,
  capDollars: 1000,
});
assert.equal(over.replace, false);
assert.equal(over.reason, "chain-cap");

assert.equal(executedRiskDollars({ cumQty: 100, avgYesPrice: 0.4, outcome: "long", action: "sell" }).dollars, 60);
assert.equal(executedRiskDollars({ cumQty: 100, avgYesPrice: 0.4, outcome: "short", action: "buy" }).dollars, 60);
assert.equal(executedRiskDollars({ cumQty: 100, avgYesPrice: 0.4, outcome: "short", action: "sell" }).dollars, 40);
assert.equal(executedRiskDollars({ cumQty: 10, avgYesPrice: null }).known, false);

const chain = lineagePriorSpent([
  { orderId: "root", cumQty: 800, avgYesPrice: 0.7, outcome: "long", action: "buy" },
  { orderId: "child", cumQty: 50, avgYesPrice: 0.6, outcome: "long", action: "buy" },
], { excludeOrderId: "child", outcome: "long", action: "buy" });
assert.equal(chain.known, true);
assert.equal(chain.dollars, 560);
const storedSell = lineagePriorSpent([
  { orderId: "root", cumQty: 100, avgYesPrice: 0.4, outcome: "long", action: "sell" },
], { excludeOrderId: "next", outcome: "long", action: "buy" });
assert.equal(storedSell.dollars, 60, "a stored sell keeps sell risk when the caller is a buy");
assert.equal(lineagePriorSpent([
  { orderId: "root", cumQty: 10, avgYesPrice: null },
], { excludeOrderId: "next" }).known, false);

const gateChain = replacementGate({
  official: classifyOfficialOrder({ order: { ...packers, state: "ORDER_STATE_CANCELED", quantity: 200, cumQuantity: 0, leavesQuantity: 0 } }),
  observedLeaves: 200,
  priorSpentDollars: 900,
  capDollars: 1000,
});
assert.equal(gateChain.replace, true);
assert.ok(gateChain.roomDollars <= 100 + 1e-6);
const blocked = replacementGate({
  official: classifyOfficialOrder({ order: { ...packers, state: "ORDER_STATE_CANCELED", quantity: 200, cumQuantity: 0, leavesQuantity: 0 } }),
  observedLeaves: 200,
  priorKnown: false,
});
assert.equal(blocked.reason, "prior-spent-unknown");

const pending = [
  { orderId: "a", verifiedState: "open", totalFailures: 0 },
  { orderId: "b", verifiedState: "unknown", totalFailures: 1 },
  { orderId: "c", verifiedState: "partial", totalFailures: 0 },
  { orderId: "d", verifiedState: "filled", totalFailures: 0 },
  { orderId: "e", verifiedState: "open", totalFailures: 6 },
];
{
  const store = createMemoryOrderTrackStore();
  await store.upsert({
    orderId: "sell-parent",
    ownerEmail: "kev120909@gmail.com",
    marketSlug: "m",
    verifiedState: "partial_canceled",
    cumQty: 100,
    avgYesPrice: 0.4,
    outcome: "long",
    action: "sell",
    lineageId: "sell-parent",
  });
  const back = await store.get("sell-parent");
  assert.equal(back.action, "sell");
  assert.equal(back.outcome, "long");
  const spent = lineagePriorSpent([back], { excludeOrderId: "child", outcome: "long", action: "buy" });
  assert.equal(spent.dollars, 60);
}

assert.deepEqual(tracksNeedingLookup(pending, ["a"], 2).map((row) => row.orderId), ["b", "c"]);
assert.equal(tracksNeedingLookup(pending, [], 10).length, TRACK_LOOKUP_LIMIT);

console.log("liveDeskOrderTrack.test.js ok");
