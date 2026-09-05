import assert from "node:assert/strict";
import {
  quotingEnded,
  attemptFromTapeRow,
  buildLockAttempts,
  visibleAttempts,
} from "./comboLockHistory.js";

assert.equal(quotingEnded({ archived_at: "2026-09-04T00:00:00Z" }), true);
assert.equal(quotingEnded({ starts_at: "2026-09-01T00:00:00Z" }, Date.parse("2026-09-02T00:00:00Z")), true);
assert.equal(quotingEnded({ starts_at: "2026-09-13T17:00:00Z" }, Date.parse("2026-09-05T00:00:00Z")), false);

{
  const filled = attemptFromTapeRow({ bucket: "filled", at: "2026-09-04T12:00:00Z", contracts: 40 }, { filled: 40, ceiling: 750 });
  assert.equal(filled.key, "filled");
  assert.equal(filled.label, "filled (partial)");
}
{
  const full = attemptFromTapeRow({ bucket: "filled", contracts: 750 }, { filled: 750, ceiling: 750 });
  assert.equal(full.label, "filled");
}
{
  const q = attemptFromTapeRow({ bucket: "awaiting", reason: "open", contracts: 111 });
  assert.equal(q.key, "quoted");
  assert.equal(q.label, "quoted · rested");
}
{
  const skip = attemptFromTapeRow({
    bucket: "oversized",
    reason: "oversized",
    skip: { kind: "oversized", text: "skipped oversized 250 (need ≤750)" },
  });
  assert.equal(skip.key, "skipped");
  assert.match(skip.label, /skipped/);
}
{
  const c = attemptFromTapeRow({ bucket: "no_taker", reason: "cancelled" });
  assert.equal(c.key, "cancelled");
}
{
  const u = attemptFromTapeRow({ bucket: "no_taker", reason: "quoted · no take", contracts: 80 });
  assert.equal(u.key, "unfilled");
  assert.match(u.label, /unfilled/);
}

// Ari+Jax — armed + never matched (no RFQs yet)
{
  const hist = buildLockAttempts({
    parlay: {
      id: "ari-jax",
      active: true,
      created_at: "2026-09-04T18:00:00Z",
      starts_at: "2026-09-13T17:00:00Z",
      max_contracts: 750,
    },
    now: Date.parse("2026-09-05T12:00:00Z"),
  });
  assert.equal(hist.events[0].key, "armed");
  assert.equal(hist.events.some((e) => e.reason === "never_matched"), true);
  assert.equal(hist.events.some((e) => e.key === "expired"), false);
}

// Unfilled attempts (declined / unfilled submissions) appear — not fills only
{
  const hist = buildLockAttempts({
    parlay: {
      id: "p-tex",
      active: false,
      archived_at: "2026-09-05T06:00:00Z",
      created_at: "2026-09-04T12:00:00Z",
      starts_at: "2026-09-04T22:46:00Z",
      max_contracts: 150,
    },
    submissions: [
      { parlay_id: "p-tex", rfq_id: "r1", status: "declined", skip_reason: "oversized", contracts: 400, created_at: "2026-09-04T18:00:00Z" },
      { parlay_id: "p-tex", rfq_id: "r2", status: "unfilled", quote_id: "q1", is_live: false, contracts: 80, created_at: "2026-09-04T19:00:00Z" },
    ],
    now: Date.parse("2026-09-05T12:00:00Z"),
  });
  const keys = hist.events.map((e) => e.key);
  assert.ok(keys.includes("armed") || keys.includes("created"));
  assert.ok(keys.includes("skipped") || keys.includes("unfilled"));
  assert.ok(hist.events.some((e) => e.key === "unfilled" || e.key === "skipped"));
  assert.ok(hist.events.some((e) => e.key === "expired"));
  assert.equal(hist.events.some((e) => e.key === "filled"), false);
}

{
  const vis = visibleAttempts([
    { key: "armed", at: "a" },
    ...Array.from({ length: 80 }, (_, i) => ({ key: "skipped", at: String(i), reason: "x" + i })),
  ], 60);
  assert.equal(vis.shown[0].key, "armed");
  assert.equal(vis.shown.length, 60);
  assert.equal(vis.extra, 21);
}

console.log("comboLockHistory.test.js ok");
