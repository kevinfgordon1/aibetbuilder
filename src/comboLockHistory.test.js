import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  quotingEnded,
  attemptFromTapeRow,
  buildLockAttempts,
  visibleAttempts,
  attemptSummaryLine,
  attemptSummaryParts,
  attemptSummaryFilled,
  collapseIdentity,
  collapseAttempts,
  attemptRepeatLabel,
  matchedRfqCounts,
  matchedRfqHeading,
  matchedRfqEmptyText,
  matchedRfqWatcherParked,
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
  const poly = attemptFromTapeRow({
    bucket: "skipped",
    reason: "skipped",
    skip: { kind: "skipped", text: "skipped · game started" },
    venue: "Polymarket",
    venueKey: "polymarket",
  });
  assert.equal(poly.key, "skipped");
  assert.equal(poly.label, "skipped · game started");
  assert.equal(poly.venueKey, "polymarket");
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
      { parlay_id: "p-tex", rfq_id: "r3", venue: "polymarket", status: "declined", skip_reason: "no_lock_overlap:leg_count", contracts: 8, created_at: "2026-09-04T19:30:00Z" },
    ],
    now: Date.parse("2026-09-05T12:00:00Z"),
  });
  const keys = hist.events.map((e) => e.key);
  assert.ok(keys.includes("armed") || keys.includes("created"));
  assert.ok(keys.includes("skipped") || keys.includes("unfilled"));
  assert.ok(hist.events.some((e) => e.key === "unfilled" || e.key === "skipped"));
  assert.ok(hist.events.some((e) => e.key === "expired"));
  assert.equal(hist.events.some((e) => e.key === "filled"), false);
  const polySkip = hist.events.find((e) => e.row && e.row.rfqId === "r3");
  assert.ok(polySkip);
  assert.equal(polySkip.label, "skipped · different leg count");
  assert.equal(polySkip.venueKey, "polymarket");
}

{
  const hist = buildLockAttempts({
    parlay: {
      id: "p-funds",
      active: true,
      created_at: "2026-09-07T12:00:00Z",
      starts_at: "2026-09-07T22:00:00Z",
      max_contracts: 100,
    },
    submissions: [
      { parlay_id: "p-funds", rfq_id: "r-bal", status: "declined", skip_reason: "insufficient_balance", contracts: 20, created_at: "2026-09-07T16:00:00Z" },
    ],
    now: Date.parse("2026-09-07T17:00:00Z"),
  });
  const fundsSkip = hist.events.find((e) => e.row && e.row.rfqId === "r-bal");
  assert.ok(fundsSkip);
  assert.equal(fundsSkip.key, "skipped");
  assert.equal(fundsSkip.label, "skipped · insufficient funds");
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

{
  const skipHist = buildLockAttempts({
    parlay: {
      id: "p-skip-sum",
      active: true,
      created_at: "2026-09-04T12:00:00Z",
      starts_at: "2026-09-13T17:00:00Z",
      max_contracts: 100,
    },
    matches: [
      { rfq_id: "n1", matched_at: "2026-09-05T18:00:00Z", contracts: 12, tape_match: "none" },
      { rfq_id: "n2", matched_at: "2026-09-05T18:10:00Z", contracts: 9, tape_match: "none" },
    ],
    submissions: [
      { parlay_id: "p-skip-sum", rfq_id: "n1", status: "declined", skip_reason: "oversized", tape_match: "none", contracts: 12, created_at: "2026-09-05T18:00:00Z" },
      { parlay_id: "p-skip-sum", rfq_id: "n2", status: "declined", skip_reason: "oversized", tape_match: "none", contracts: 9, created_at: "2026-09-05T18:10:00Z" },
    ],
    now: Date.parse("2026-09-05T20:00:00Z"),
  });
  assert.equal(attemptSummaryLine(skipHist), "2 skipped · later filled 0 · 2 no print");
  assert.deepEqual(attemptSummaryParts(skipHist), {
    skip: "2 skipped · later filled 0 · 2 no print",
    miss: null,
  });
  assert.equal(attemptSummaryFilled(skipHist), false);
}

{
  const missHist = buildLockAttempts({
    parlay: {
      id: "p-miss-sum",
      active: true,
      created_at: "2026-09-04T12:00:00Z",
      starts_at: "2026-09-13T17:00:00Z",
      max_contracts: 100,
    },
    submissions: Array.from({ length: 16 }, (_, i) => ({
      parlay_id: "p-miss-sum",
      rfq_id: "m" + i,
      status: "unfilled",
      quote_id: "q" + i,
      is_live: false,
      contracts: 10,
      created_at: "2026-09-05T18:00:00Z",
    })),
    now: Date.parse("2026-09-05T20:00:00Z"),
  });
  assert.equal(attemptSummaryLine(missHist), "16 missed · later filled 0 · 16 no taker");
  assert.equal(attemptSummaryFilled(missHist), false);
}

{
  assert.equal(attemptSummaryLine(null), null);
  assert.equal(attemptSummaryLine({}), null);
  assert.deepEqual(attemptSummaryParts(null), { skip: null, miss: null });
}

// Kevin SEA+PHI+LAR — Poly oversized skips must not hide Poly quoted-no-take
{
  const mixed = buildLockAttempts({
    parlay: {
      id: "p-sea-phi-lar",
      active: true,
      created_at: "2026-09-07T12:00:00Z",
      starts_at: "2026-09-13T17:00:00Z",
      max_contracts: 100,
    },
    submissions: [
      { parlay_id: "p-sea-phi-lar", rfq_id: "s1", venue: "polymarket", status: "declined", skip_reason: "oversized", tape_match: "none", contracts: 80, created_at: "2026-09-08T01:00:00Z" },
      { parlay_id: "p-sea-phi-lar", rfq_id: "s2", venue: "polymarket", status: "declined", skip_reason: "oversized", tape_match: "none", contracts: 90, created_at: "2026-09-08T01:01:00Z" },
      ...Array.from({ length: 12 }, (_, i) => ({
        parlay_id: "p-sea-phi-lar",
        rfq_id: "q" + i,
        venue: "polymarket",
        status: "unfilled",
        quote_id: "pq" + i,
        is_live: false,
        contracts: 39,
        created_at: `2026-09-08T01:10:${String(i).padStart(2, "0")}Z`,
      })),
    ],
    now: Date.parse("2026-09-08T02:00:00Z"),
  });
  const parts = attemptSummaryParts(mixed);
  assert.equal(parts.skip, "2 skipped · later filled 0 · 2 no print");
  assert.equal(parts.miss, "12 missed · later filled 0 · 12 no taker");
  assert.match(attemptSummaryLine(mixed), /2 skipped/);
  assert.match(attemptSummaryLine(mixed), /12 missed/);
  const collapsed = collapseAttempts(mixed.events);
  const polyQuotes = collapsed.filter((e) => e.key === "unfilled" && e.contracts === 39);
  assert.equal(polyQuotes.length, 1);
  assert.equal(polyQuotes[0].count, 12);
  assert.equal(polyQuotes[0].venueKey, "polymarket");
  const vis = visibleAttempts(mixed.events);
  assert.ok(vis.shown.some((e) => e.count === 12 && e.contracts === 39));
}

{
  assert.equal(collapseIdentity({ key: "armed", reason: "armed" }), null);
  assert.equal(collapseIdentity({ key: "created", reason: "paused" }), null);
  assert.equal(
    collapseIdentity({ key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "polymarket" }),
    collapseIdentity({ key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "polymarket" }),
  );
}

{
  const same = collapseAttempts([
    { key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "polymarket", at: "2026-09-08T02:02:51Z" },
    { key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "polymarket", at: "2026-09-08T02:02:48Z" },
    { key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "polymarket", at: "2026-09-08T02:02:45Z" },
  ]);
  assert.equal(same.length, 1);
  assert.equal(same[0].count, 3);
  assert.equal(same[0].at, "2026-09-08T02:02:51Z");
  assert.equal(same[0].fromAt, "2026-09-08T02:02:45Z");
  assert.match(attemptRepeatLabel(same[0]), /×3/);
  assert.match(attemptRepeatLabel(same[0]), /last /);
  assert.equal(attemptRepeatLabel({ count: 1, at: "2026-09-08T02:02:51Z" }), "");
}

{
  const venues = collapseAttempts([
    { key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "polymarket", at: "2" },
    { key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "kalshi", at: "1" },
  ]);
  assert.equal(venues.length, 2);
}

{
  const sizes = collapseAttempts([
    { key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "polymarket", at: "2" },
    { key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 40, venueKey: "polymarket", at: "1" },
  ]);
  assert.equal(sizes.length, 2);
}

{
  const split = collapseAttempts([
    { key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "polymarket", at: "3" },
    { key: "skipped", reason: "oversized", label: "skipped oversized 80", contracts: 80, venueKey: "polymarket", at: "2" },
    { key: "unfilled", reason: "quoted · no take", label: "unfilled · quoted, no take", contracts: 39, venueKey: "polymarket", at: "1" },
  ]);
  assert.equal(split.length, 3);
  assert.equal(split[0].count, 1);
  assert.equal(split[2].count, 1);
}

{
  const armed = collapseAttempts([
    { key: "armed", reason: "armed", at: "a" },
    { key: "armed", reason: "armed", at: "b" },
  ]);
  assert.equal(armed.length, 2);
}

{
  const vis = visibleAttempts([
    { key: "armed", at: "a" },
    ...Array.from({ length: 80 }, () => ({
      key: "unfilled",
      at: "t",
      reason: "quoted · no take",
      label: "unfilled · quoted, no take",
      contracts: 39,
      venueKey: "polymarket",
    })),
  ], 60);
  assert.equal(vis.shown.length, 2);
  assert.equal(vis.shown[0].key, "armed");
  assert.equal(vis.shown[1].count, 80);
  assert.equal(vis.extra, 0);
}

{
  const empty = buildLockAttempts({
    parlay: {
      id: "never",
      active: true,
      created_at: "2026-09-08T12:00:00Z",
      starts_at: "2026-09-13T17:00:00Z",
      max_contracts: 100,
    },
    now: Date.parse("2026-09-08T16:00:00Z"),
  });
  assert.deepEqual(matchedRfqCounts(empty), { total: 0, quoted: 0, skipped: 0, lost: 0 });
  assert.equal(matchedRfqHeading(empty), "Matched RFQs — 0 total · 0 quoted · 0 skipped · 0 lost");
  assert.equal(matchedRfqEmptyText(empty), "No RFQs have matched this lock yet.");
  assert.doesNotMatch(matchedRfqEmptyText(empty), /watcher went live/);
  assert.equal(matchedRfqWatcherParked([], empty), false);
}

{
  const fillsOnly = buildLockAttempts({
    parlay: {
      id: "fill-only",
      active: true,
      created_at: "2026-09-08T12:00:00Z",
      starts_at: "2026-09-13T17:00:00Z",
      max_contracts: 408,
    },
    fills: [{ parlay_id: "fill-only", fill_id: "f1", count: 12, kalshi_created_time: "2026-09-08T15:00:00Z" }],
    now: Date.parse("2026-09-08T16:00:00Z"),
  });
  assert.ok(matchedRfqCounts(fillsOnly).total > 0);
  assert.equal(matchedRfqEmptyText(fillsOnly), null);
}

// Screenshot lock: History has skips/misses/fills, watcher combo_matches is empty.
{
  const sea = buildLockAttempts({
    parlay: {
      id: "p-sea-phi-lar-rfq",
      active: true,
      created_at: "2026-09-07T12:00:00Z",
      starts_at: "2026-09-13T17:00:00Z",
      max_contracts: 408,
    },
    fills: [
      { parlay_id: "p-sea-phi-lar-rfq", fill_id: "f-sea", rfq_id: "fill1", count: 98, kalshi_created_time: "2026-09-08T02:00:00Z" },
    ],
    submissions: [
      { parlay_id: "p-sea-phi-lar-rfq", rfq_id: "fill1", status: "filled", order_id: "o1", contracts: 98, created_at: "2026-09-08T02:00:00Z" },
      ...Array.from({ length: 46 }, (_, i) => ({
        parlay_id: "p-sea-phi-lar-rfq",
        rfq_id: "sk" + i,
        status: "declined",
        skip_reason: "oversized",
        tape_match: "none",
        contracts: 80,
        created_at: `2026-09-08T01:${String(i).padStart(2, "0")}:00Z`,
      })),
      ...Array.from({ length: 33 }, (_, i) => ({
        parlay_id: "p-sea-phi-lar-rfq",
        rfq_id: "ms" + i,
        status: "unfilled",
        quote_id: "q" + i,
        is_live: false,
        contracts: 39,
        created_at: `2026-09-08T03:${String(i).padStart(2, "0")}:00Z`,
      })),
    ],
    now: Date.parse("2026-09-08T16:00:00Z"),
  });
  const counts = matchedRfqCounts(sea);
  assert.equal(counts.total, 80);
  assert.equal(counts.skipped, 46);
  assert.equal(counts.quoted, 34);
  assert.equal(counts.lost, 33);
  assert.equal(matchedRfqEmptyText(sea), null);
  assert.equal(matchedRfqWatcherParked([], sea), true);
  assert.equal(matchedRfqWatcherParked([{ rfq_id: "x" }], sea), false);
  assert.match(matchedRfqHeading(sea), /80 total/);
  assert.match(matchedRfqHeading(sea), /34 quoted/);
  assert.match(matchedRfqHeading(sea), /46 skipped/);
  assert.match(matchedRfqHeading(sea), /33 lost/);
  assert.doesNotMatch(matchedRfqHeading(sea), /0 total · 0 quoted · 0 skipped · 0 lost/);
}

{
  const locksSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComboLocks.jsx"), "utf8");
  // Living cards: history starts collapsed behind hist-<id>; archive stays always-open once the card expands.
  assert.match(locksSrc, /function AttemptHistory\(\{ attempts, open = true, onToggle, showSummary = true \}\)/);
  assert.equal((locksSrc.match(/onToggle=\{\(\) => toggleOpen\("hist-" \+ p\.id\)\}/g) || []).length, 2);
  assert.match(locksSrc, /<AttemptHistory attempts=\{attemptsByParlay\[a\.id\]\} showSummary=\{false\} \/>/);
  assert.match(locksSrc, /className="hist-head"/);
  assert.match(locksSrc, /AttemptSummary/);
  assert.match(locksSrc, /attemptSummaryParts/);
  assert.match(locksSrc, /attemptRepeatLabel/);
  assert.match(locksSrc, /hist-sum/);
  assert.match(locksSrc, /hist-rpt/);
  assert.match(locksSrc, /matchedRfqHeading/);
  assert.match(locksSrc, /matchedRfqCounts/);
  assert.match(locksSrc, /matchedRfqEmptyText/);
  assert.match(locksSrc, /matchedRfqWatcherParked/);
  assert.match(locksSrc, /<MatchedRfqTable attempts=\{attemptsByParlay\[p\.id\]\}/);
  assert.doesNotMatch(locksSrc, /watcher went live/);
  assert.doesNotMatch(locksSrc, /matched 0 RFQs/);
  assert.match(locksSrc, /attempts && attempts\.tape && attempts\.tape\.rows/);
}

console.log("comboLockHistory.test.js ok");
