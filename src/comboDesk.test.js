import assert from "node:assert/strict";
import {
  remainingFill,
  quotingState,
  tapeNoPrice,
  formatCents,
  formatLoss,
  skipLabel,
  lastSkip,
  lastLoss,
  lastRelevant,
  outcomesForParlay,
  buildParlayDesk,
} from "./comboDesk.js";

// ── remaining fill (ceilings accumulate; leftover is what the next RFQ can take) ──
{
  const r = remainingFill({ filled: 40, ceiling: 100 });
  assert.equal(r.filled, 40);
  assert.equal(r.ceiling, 100);
  assert.equal(r.left, 60);
  assert.equal(r.pct, 40);
}
{
  const r = remainingFill({ filled: 100, ceiling: 100 });
  assert.equal(r.left, 0);
  assert.equal(r.pct, 100);
}
{
  const r = remainingFill({ filled: 0, ceiling: 0 });
  assert.equal(r.left, 0);
  assert.equal(r.pct, 0);
}

// ── quoting on/off ──
assert.equal(quotingState({ active: true, kill: false, filled: 0, ceiling: 100 }).key, "watching");
assert.equal(quotingState({ active: false, kill: false, filled: 10, ceiling: 100 }).key, "paused");
assert.equal(quotingState({ active: true, kill: true, filled: 10, ceiling: 100 }).key, "kill");
assert.equal(quotingState({ active: false, kill: true, filled: 10, ceiling: 100 }).key, "kill");
assert.equal(quotingState({ active: false, kill: true, filled: 100, ceiling: 100 }).key, "ceiling");
assert.equal(quotingState({ active: true, kill: false, filled: 100, ceiling: 100 }).label, "deactivated at ceiling");
assert.equal(quotingState({ active: true, kill: false, filled: 40, ceiling: 100 }).quoting, true);
assert.equal(quotingState({ active: true, kill: true, filled: 40, ceiling: 100 }).quoting, false);

// ── tape clearing price: column or raw.tape fallback ──
assert.equal(tapeNoPrice({ tape_no_price: 0.91 }), 0.91);
assert.equal(tapeNoPrice({ raw: { tape: { no_price: 0.87, match: "matched" } } }), 0.87);
assert.equal(tapeNoPrice({ raw: { tape: { noPrice: 0.8 } } }), 0.8);
assert.equal(tapeNoPrice({}), null);
assert.equal(formatCents(0.91), "91¢");
assert.equal(formatCents(0.915), "92¢");

// ── last loss: outbid / too slow / no taker + tape price ──
assert.equal(formatLoss({ loss_reason: "outbid", tape_no_price: 0.91, tape_match: "matched" }), "outbid at 91¢");
assert.equal(formatLoss({ loss_reason: "no_purchase", raw: { tape: { match: "matched", no_price: 0.91 } } }), "outbid at 91¢");
assert.equal(formatLoss({ loss_reason: "no_purchase" }), "no taker");
assert.equal(formatLoss({ loss_reason: "too_slow" }), "too slow");
assert.equal(formatLoss({ loss_reason: "no_taker" }), "no taker");
assert.equal(formatLoss({ outcome: "lost" }), "lost");

{
  const loss = lastLoss([
    { outcome: "lost", loss_reason: "too_slow", posted_at: "2026-08-13T12:00:00Z" },
    { outcome: "lost", loss_reason: "outbid", tape_no_price: 0.91, tape_match: "matched", posted_at: "2026-08-13T13:00:00Z" },
    { outcome: "executed", posted_at: "2026-08-13T14:00:00Z" },
  ]);
  assert.equal(loss.reason, "outbid");
  assert.equal(loss.text, "outbid at 91¢");
  assert.equal(loss.clearingCents, "91¢");
}
assert.equal(lastLoss([{ outcome: "executed" }]), null);

// ── last skip: matched RFQ with no quote_outcome, especially oversized ──
{
  const oversized = skipLabel({ contracts: 250 }, { filled: 40, ceiling: 100 });
  assert.equal(oversized.kind, "oversized");
  assert.match(oversized.text, /skipped oversized 250/);
  assert.match(oversized.text, /60/);
}
{
  const small = skipLabel({ contracts: 10 }, { filled: 40, ceiling: 100 });
  assert.equal(small.kind, "skipped");
  assert.equal(small.text, "skipped 10");
}
{
  const skip = lastSkip({
    matches: [
      { rfq_id: "quoted-1", matched_at: "2026-08-13T14:00:00Z", contracts: 20 },
      { rfq_id: "skip-big", matched_at: "2026-08-13T13:00:00Z", contracts: 250 },
      { rfq_id: "skip-old", matched_at: "2026-08-13T12:00:00Z", contracts: 8 },
    ],
    outcomeByRfq: { "quoted-1": { outcome: "lost" } },
    filled: 40,
    ceiling: 100,
  });
  assert.equal(skip.rfqId, "skip-big");
  assert.equal(skip.kind, "oversized");
  assert.match(skip.text, /250/);
}
assert.equal(lastSkip({ matches: [{ rfq_id: "q", matched_at: "2026-08-13T12:00:00Z" }], outcomeByRfq: { q: { outcome: "posted" } } }), null);

// ── last relevant prefers the newer of skip vs loss ──
{
  const skip = { at: "2026-08-13T15:00:00Z", text: "skipped 12", kind: "skipped" };
  const loss = { at: "2026-08-13T14:00:00Z", text: "outbid at 91¢" };
  assert.equal(lastRelevant(skip, loss).kind, "skip");
  assert.equal(lastRelevant(skip, { ...loss, at: "2026-08-13T16:00:00Z" }).kind, "loss");
  assert.equal(lastRelevant(null, loss).kind, "loss");
  assert.equal(lastRelevant(null, null), null);
}

// ── outcomes join by parlay_id or matched rfq_id (unseeded watcher rows) ──
{
  const rows = outcomesForParlay(
    [
      { parlay_id: "p1", rfq_id: "a" },
      { parlay_id: "p2", rfq_id: "b" },
      { parlay_id: null, rfq_id: "c" },
    ],
    { parlayId: "p1", matches: [{ rfq_id: "c" }] },
  );
  assert.deepEqual(rows.map((r) => r.rfq_id).sort(), ["a", "c"]);
}

// ── full desk for an active card ──
{
  const desk = buildParlayDesk({
    parlay: { id: "p1", active: true, max_contracts: 100 },
    filled: 40,
    quoted: 40,
    kill: false,
    matches: [
      { rfq_id: "lost-1", matched_at: "2026-08-13T12:00:00Z", contracts: 20 },
      { rfq_id: "skip-1", matched_at: "2026-08-13T13:00:00Z", contracts: 80 },
    ],
    outcomes: [
      { parlay_id: "p1", rfq_id: "lost-1", outcome: "lost", loss_reason: "outbid", tape_no_price: 0.91, tape_match: "matched", posted_at: "2026-08-13T12:01:00Z" },
    ],
    outcomeByRfq: {
      "lost-1": { outcome: "lost" },
    },
  });
  assert.equal(desk.fill.left, 60);
  assert.equal(desk.quote.key, "watching");
  assert.equal(desk.skip.kind, "oversized");
  assert.equal(desk.loss.text, "outbid at 91¢");
  assert.equal(desk.awaiting, false);
}

{
  const desk = buildParlayDesk({
    parlay: { id: "p1", active: false, max_contracts: 100 },
    filled: 100,
    kill: true,
  });
  assert.equal(desk.quote.key, "ceiling");
  assert.equal(desk.fill.left, 0);
}

console.log("comboDesk.test.js ok");
